// Ferry legs — the hops the rider crossed by boat instead of riding.
//
// The flag lives on the *arrival* stop (`stop.ferry`), so the leg from stop
// i-1 to stop i is a crossing when `stops[i].ferry` is set. The map draws
// those legs as a dashed sea line with a little boat halfway across, and the
// Cub sails rather than drives while the scrubber is inside one.

import type { LngLat, RouteGeometry } from "./geo"
import { haversine } from "./geo"
import type { Stop } from "./types"

export interface FerryLeg {
  // Index of the arrival stop — the one carrying the flag.
  index: number
  // The leg's own polyline: pin → (ridden/sailed track, when synced) → pin.
  points: LngLat[]
  // Halfway along that polyline, where the boat marker sits.
  mid: LngLat
  // Route fractions the crossing spans, for "is the Cub on a boat right now".
  from: number
  to: number
}

// Every crossing of the route, in order. Returns nothing when the stops and
// the route disagree about how many stops there are — the geometry is rebuilt
// on the next render and drawing half a route in the meantime is worse than
// drawing none.
export function ferryLegs(stops: Stop[], route: RouteGeometry): FerryLeg[] {
  if (stops.length < 2 || stops.length !== route.stopVertex.length) return []
  const legs: FerryLeg[] = []
  for (let i = 1; i < stops.length; i++) {
    if (!stops[i].ferry) continue
    const points = route.points.slice(
      route.stopVertex[i - 1],
      route.stopVertex[i] + 1,
    )
    if (points.length < 2) continue
    legs.push({
      index: i,
      points,
      mid: midpoint(points),
      from: route.total ? route.stopCum[i - 1] / route.total : 0,
      to: route.total ? route.stopCum[i] / route.total : 0,
    })
  }
  return legs
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
// map can paint the crossings in sea colours without breaking the ridden
// line into a feature per leg. Consecutive legs of the same kind stay one
// feature; each stretch keeps the shared pin, so the line has no gaps.
export function routeSegments(
  stops: Stop[],
  route: RouteGeometry,
): { points: LngLat[]; ferry: boolean }[] {
  if (route.points.length < 2) return []
  if (stops.length < 2 || stops.length !== route.stopVertex.length)
    return [{ points: route.points, ferry: false }]
  const out: { points: LngLat[]; ferry: boolean }[] = []
  let start = 0
  let kind = !!stops[1].ferry
  for (let i = 1; i < stops.length; i++) {
    const legFerry = !!stops[i].ferry
    if (legFerry !== kind) {
      out.push({
        points: route.points.slice(start, route.stopVertex[i - 1] + 1),
        ferry: kind,
      })
      start = route.stopVertex[i - 1]
      kind = legFerry
    }
  }
  out.push({ points: route.points.slice(start), ferry: kind })
  return out.filter((s) => s.points.length >= 2)
}

// Whether route fraction `t` falls inside a crossing — the Cub is on a boat.
// The endpoints are the two ports, where it is back on land, so a scrubber
// snapped to either stop shows a docked Cub rather than a sailing one.
export function ferryAt(legs: FerryLeg[], t: number): FerryLeg | null {
  for (const leg of legs) {
    if (t > leg.from && t < leg.to) return leg
  }
  return null
}

// GeoJSON for the drawn route, split into ridden and sailed stretches.
export function routeGeoJSON(
  segments: { points: LngLat[]; ferry: boolean }[],
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
