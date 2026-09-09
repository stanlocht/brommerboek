// Where a leg actually crosses water.
//
// A ferry leg is rarely all sea: the rider first rides to the port, sails,
// then rides off the boat again. The map already knows where the water is —
// the vintage style paints OpenMapTiles' `water` polygons — so we sample
// those polygons along the leg and cut it into land and water runs. The
// drawn route then keeps its red road dashes right up to the quay and only
// turns into a blue sea line where the boat really is.
//
// The geometry here is deliberately pure: VintageMap hands in an `isWater`
// probe built from whatever the map has loaded, and everything else is
// testable without a map.

import type { LngLat } from "./geo"
import { haversine } from "./geo"

// A polygon as MapLibre hands it over: outer ring first, holes after.
export type Ring = LngLat[]
export type Polygon = Ring[]

interface Boxed {
  poly: Polygon
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

// Ray casting, counting crossings of the ring to the west of the point.
// Points exactly on an edge fall whichever way the arithmetic lands — a
// coastline sample is never that precise anyway.
export function pointInRing(point: LngLat, ring: Ring): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y) {
      const cross = xi + ((y - yi) / (yj - yi)) * (xj - xi)
      if (cross > x) inside = !inside
    }
  }
  return inside
}

// Inside the outer ring and outside every hole (an island in a lake is land).
export function pointInPolygon(point: LngLat, poly: Polygon): boolean {
  if (poly.length === 0 || !pointInRing(point, poly[0])) return false
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(point, poly[i])) return false
  }
  return true
}

// The polygon rings out of a set of GeoJSON features — what a vector tile
// source hands back for its `water` layer. Anything that isn't an area is
// dropped (a waterway line says nothing about where the coast is).
export function polygonsFromFeatures(features: GeoJSON.Feature[]): Polygon[] {
  const polys: Polygon[] = []
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === "Polygon") polys.push(g.coordinates as Polygon)
    else if (g.type === "MultiPolygon")
      for (const poly of g.coordinates) polys.push(poly as Polygon)
  }
  return polys
}

// A reusable "is this point in the water?" test over many polygons, with a
// bounding box per polygon so a sample only pays for the few it might be in.
// Vector tiles hand over the same ocean clipped per tile, so there are a lot
// of them and most are nowhere near the leg.
export function waterProbe(polys: Polygon[]): (point: LngLat) => boolean {
  const boxed: Boxed[] = []
  for (const poly of polys) {
    const outer = poly[0]
    if (!outer || outer.length < 3) continue
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    for (const [lng, lat] of outer) {
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
    }
    boxed.push({ poly, minLng, minLat, maxLng, maxLat })
  }
  return (point: LngLat) => {
    const [lng, lat] = point
    for (const b of boxed) {
      if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat)
        continue
      if (pointInPolygon(point, b.poly)) return true
    }
    return false
  }
}

// One stretch of a leg that is all land or all water, with its distances
// (metres from the start of the leg) so the caller can turn them back into
// route fractions.
export interface WaterRun {
  points: LngLat[]
  water: boolean
  from: number
  to: number
}

// How far apart the samples are, how short a run may be before it is
// swallowed by its neighbours (a bridge over a river is not a ferry, and a
// spit of sand mid-crossing is not a stop), and a ceiling on the work.
const STEP_M = 1_000
const MIN_RUN_M = 4_000
const MAX_SAMPLES = 400
// Bisections per coastline hit: 6 steps land the cut within STEP_M / 64.
const BISECTIONS = 6

function cumulative(points: LngLat[]): number[] {
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]))
  }
  return cum
}

// The point `d` metres along the polyline.
function at(points: LngLat[], cum: number[], d: number): LngLat {
  const total = cum[cum.length - 1]
  const dist = Math.max(0, Math.min(total, d))
  for (let i = 1; i < points.length; i++) {
    if (dist <= cum[i]) {
      const span = cum[i] - cum[i - 1] || 1
      const f = (dist - cum[i - 1]) / span
      const a = points[i - 1]
      const b = points[i]
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
  }
  return points[points.length - 1]
}

// The polyline between two distances, endpoints included, keeping every
// original vertex in between so a sailed GPS track keeps its shape.
function slice(
  points: LngLat[],
  cum: number[],
  d0: number,
  d1: number,
): LngLat[] {
  const out: LngLat[] = [at(points, cum, d0)]
  for (let i = 0; i < points.length; i++) {
    if (cum[i] > d0 && cum[i] < d1) out.push(points[i])
  }
  out.push(at(points, cum, d1))
  return out
}

// Cut a leg into land and water runs. Returns a single run when the whole
// leg is one or the other, and an empty list for a degenerate line.
export function splitByWater(
  points: LngLat[],
  isWater: (point: LngLat) => boolean,
): WaterRun[] {
  if (points.length < 2) return []
  const cum = cumulative(points)
  const total = cum[cum.length - 1]
  if (total <= 0) return []

  // Sample the leg at a fixed spacing (thinned out on very long crossings).
  const step = Math.max(STEP_M, total / MAX_SAMPLES)
  const marks: number[] = []
  for (let d = 0; d < total; d += step) marks.push(d)
  marks.push(total)
  const wet = marks.map((d) => isWater(at(points, cum, d)))

  // Cut where the answer changes, bisecting for a coastline rather than a
  // sample-spaced staircase.
  const cuts: number[] = []
  for (let i = 1; i < marks.length; i++) {
    if (wet[i] === wet[i - 1]) continue
    let lo = marks[i - 1]
    let hi = marks[i]
    for (let k = 0; k < BISECTIONS; k++) {
      const mid = (lo + hi) / 2
      if (isWater(at(points, cum, mid)) === wet[i - 1]) lo = mid
      else hi = mid
    }
    cuts.push((lo + hi) / 2)
  }

  // Every cut flips the answer, so the runs alternate from whatever the
  // first sample said.
  const bounds = [0, ...cuts, total]
  const runs = mergeShortRuns(
    bounds.slice(1).map((end, i) => ({
      from: bounds[i],
      to: end,
      water: i % 2 === 0 ? wet[0] : !wet[0],
    })),
    total,
  )
  return runs.map((r) => ({
    points: slice(points, cum, r.from, r.to),
    water: r.water,
    from: r.from,
    to: r.to,
  }))
}

// Swallow runs too short to be a real crossing (or a real landfall) into
// their neighbours: a bridge over an estuary shouldn't turn blue, and the
// island the ferry threads past shouldn't break the sea line in two.
function mergeShortRuns(
  runs: { from: number; to: number; water: boolean }[],
  total: number,
): { from: number; to: number; water: boolean }[] {
  const limit = Math.min(MIN_RUN_M, total / 4)
  let out = runs
  let changed = true
  while (changed && out.length > 1) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      if (out[i].to - out[i].from >= limit) continue
      // Hand the stretch to the longer neighbour, then fuse anything that
      // now touches a run of its own kind.
      const before = out[i - 1]
      const after = out[i + 1]
      const target =
        !before || (after && after.to - after.from > before.to - before.from)
          ? "after"
          : "before"
      if (target === "after" && after) after.from = out[i].from
      else if (before) before.to = out[i].to
      out = out.filter((_, j) => j !== i)
      out = fuse(out)
      changed = true
      break
    }
  }
  return out
}

function fuse(
  runs: { from: number; to: number; water: boolean }[],
): { from: number; to: number; water: boolean }[] {
  const out: { from: number; to: number; water: boolean }[] = []
  for (const run of runs) {
    const last = out[out.length - 1]
    if (last && last.water === run.water) last.to = run.to
    else out.push({ ...run })
  }
  return out
}
