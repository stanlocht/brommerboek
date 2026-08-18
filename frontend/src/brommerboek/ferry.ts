// Ferry legs — the hops the rider crossed by boat instead of riding.
//
// The flag lives on the *arrival* stop (`stop.ferry`), so the leg from stop
// i-1 to stop i is a crossing when `stops[i].ferry` is set. A flagged leg is
// rarely all sea, though: the rider rides to the port, sails, and rides off
// the boat on the other side. `water.ts` cuts the leg at the coastline using
// the map's own water polygons, and everything here works off those runs —
// the road stretches stay red, only the sea stretch turns into a dashed blue
// line with a little boat on it, and the Cub boards the boat exactly where
// the land runs out.
//
// Until that cut is known (tiles still loading, or a leg the map has no
// water under) the whole leg counts as the crossing: the rider said they
// took a boat, so the line says so too.

import type { LngLat, RouteGeometry } from "./geo"
import { haversine } from "./geo"
import type { Stop } from "./types"
import type { WaterRun } from "./water"

// Water/land runs per leg, keyed by `legKey`. VintageMap fills this in as
// the map's water polygons become available.
export type WaterSplits = Map<string, WaterRun[]>

export function legKey(from: Stop, to: Stop, points: LngLat[]): string {
  return `${from.id}→${to.id}|${points.length}`
}

// A stretch of the drawn route that is all road or all sea.
export interface RouteSegment {
  points: LngLat[]
  ferry: boolean
}

export interface FerryLeg {
  // Index of the arrival stop — the one carrying the flag.
  index: number
  // The leg's own polyline: pin → (ridden/sailed track, when synced) → pin.
  points: LngLat[]
  // Where the boat marker sits: halfway across the water, or halfway along
  // the leg while the coastline is still unknown.
  mid: LngLat
  // Route fractions the sea stretches span, for "is the Cub on a boat now".
  crossings: { from: number; to: number }[]
}

interface Leg {
  index: number
  points: LngLat[]
  // Cumulative route distance at the leg's two stops.
  start: number
  end: number
  ferry: boolean
  runs: WaterRun[] | null
}

// The legs of the route with their geometry and, for flagged ones, their
// water/land cut. Empty when the stops and the route disagree about how many
// stops there are — the geometry is rebuilt on the next render, and drawing
// half a route in the meantime is worse than drawing none.
function legsOf(
  stops: Stop[],
  route: RouteGeometry,
  splits?: WaterSplits,
): Leg[] {
  if (stops.length < 2 || stops.length !== route.stopVertex.length) return []
  const out: Leg[] = []
  for (let i = 1; i < stops.length; i++) {
    const points = route.points.slice(
      route.stopVertex[i - 1],
      route.stopVertex[i] + 1,
    )
    if (points.length < 2) continue
    const ferry = !!stops[i].ferry
    out.push({
      index: i,
      points,
      start: route.stopCum[i - 1],
      end: route.stopCum[i],
      ferry,
      runs: ferry
        ? (splits?.get(legKey(stops[i - 1], stops[i], points)) ?? null)
        : null,
    })
  }
  return out
}

// One leg as drawn: its road and sea stretches in order. A leg nobody has
// cut yet is a single stretch of its own kind.
function runsOf(leg: Leg): RouteSegment[] {
  if (!leg.ferry || !leg.runs || leg.runs.length === 0)
    return [{ points: leg.points, ferry: leg.ferry }]
  return leg.runs.map((run) => ({ points: run.points, ferry: run.water }))
}

// Every crossing of the route, in order.
export function ferryLegs(
  stops: Stop[],
  route: RouteGeometry,
  splits?: WaterSplits,
): FerryLeg[] {
  const total = route.total
  const out: FerryLeg[] = []
  for (const leg of legsOf(stops, route, splits)) {
    if (!leg.ferry) continue
    const seaRuns = leg.runs?.filter((r) => r.water) ?? null
    const crossings = (seaRuns ?? []).map((r) => ({
      from: total ? (leg.start + r.from) / total : 0,
      to: total ? (leg.start + r.to) / total : 0,
    }))
    // The longest sea stretch carries the boat; with no cut yet, the leg does.
    const longest = (seaRuns ?? []).reduce<WaterRun | null>(
      (best, r) => (!best || r.to - r.from > best.to - best.from ? r : best),
      null,
    )
    out.push({
      index: leg.index,
      points: leg.points,
      mid: midpoint(longest ? longest.points : leg.points),
      crossings: crossings.length
        ? crossings
        : [
            {
              from: total ? leg.start / total : 0,
              to: total ? leg.end / total : 0,
            },
          ],
    })
  }
  return out
}

// The point halfway along a polyline by distance (not by vertex count), so
// the boat sits mid-crossing on a curved ferry track too.
export function midpoint(points: LngLat[]): LngLat {
  if (points.length === 0) return [0, 0]
  if (points.length === 1) return points[0]
  let total = 0
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i])
    cum.push(total)
  }
  const half = total / 2
  for (let i = 1; i < points.length; i++) {
    if (cum[i] >= half) {
      const span = cum[i] - cum[i - 1] || 1
      const f = (half - cum[i - 1]) / span
      const a = points[i - 1]
      const b = points[i]
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
  }
  return points[points.length - 1]
}

// The route as drawn: one feature per stretch, flagged ferry or not, so the
// map can paint the sea crossings in their own colour and dash without
// breaking the ridden line into a feature per leg. Neighbouring stretches of
// the same kind are fused, and each keeps the shared point, so the line has
// no gaps.
export function routeSegments(
  stops: Stop[],
  route: RouteGeometry,
  splits?: WaterSplits,
): RouteSegment[] {
  if (route.points.length < 2) return []
  const legs = legsOf(stops, route, splits)
  if (legs.length === 0) return [{ points: route.points, ferry: false }]
  const out: RouteSegment[] = []
  for (const leg of legs) {
    for (const run of runsOf(leg)) {
      const last = out[out.length - 1]
      if (last && last.ferry === run.ferry) {
        // Same kind, so continue the stretch — the shared point is already
        // the last one we pushed.
        last.points.push(...run.points.slice(1))
      } else {
        out.push({ points: [...run.points], ferry: run.ferry })
      }
    }
  }
  return out.filter((s) => s.points.length >= 2)
}

// Whether route fraction `t` falls inside a crossing — the Cub is on a boat.
// The ends are the quaysides, where it is back on land, so a scrubber
// snapped to either stop shows a docked Cub rather than a sailing one.
export function ferryAt(legs: FerryLeg[], t: number): FerryLeg | null {
  for (const leg of legs) {
    for (const crossing of leg.crossings) {
      if (t > crossing.from && t < crossing.to) return leg
    }
  }
  return null
}

// GeoJSON for the drawn route, split into ridden and sailed stretches.
export function routeGeoJSON(
  segments: RouteSegment[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: s.points },
      properties: { ferry: s.ferry },
    })),
  }
}
