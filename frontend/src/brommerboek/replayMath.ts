// Pure timeline math for the "rij de reis" replay: deterministic phase
// timings derived from the route geometry, plus km/date interpolation and
// border-crossing derivation. No React or MapLibre in here so vitest can
// exercise everything directly.

import { coverItem } from "./cover"
import type { RouteGeometry } from "./geo"
import { haversine, legKm, odometerTrusted, stopFraction } from "./geo"
import type { MediaItem, Stop } from "./types"

export const LEG_MIN_MS = 2500
export const LEG_MAX_MS = 5000
// Legs at or beyond this distance get the full LEG_MAX_MS.
const LEG_FULL_METERS = 400_000
export const STOP_PAUSE_MS = 2500
export const STOP_PAUSE_STORY_MS = 4000
// Every picture past the first extends the pause by this much, so a stop with
// a whole roll of film gets time to show a few instead of flashing one.
export const PHOTO_DWELL_MS = 1500
// More than this and the pause outstays its welcome; the rest of the gallery
// is one tap away in the stop sheet.
export const MAX_STOP_PHOTOS = 4
export const INTRO_MS = 1600
// A heading this close to due north or south is ambiguous — the cub keeps
// facing the way it already faced instead of flipping on every wobble.
export const FACING_DEADBAND_DEG = 20

export function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

// Driving time for one leg scales with its distance, clamped to keep short
// hops readable and monster legs bearable.
export function legDurationMs(meters: number): number {
  const t = Math.max(0, Math.min(1, meters / LEG_FULL_METERS))
  return LEG_MIN_MS + (LEG_MAX_MS - LEG_MIN_MS) * t
}

// The pictures the replay shows at one stop, cover first (the rider's pick
// leads the little slideshow) and then the rest in gallery order. Only items
// that actually carry a file — a colour swatch has nothing to show.
export function replayPhotos(
  stop: Pick<Stop, "media">,
  max = MAX_STOP_PHOTOS,
): MediaItem[] {
  const withFile = (stop.media ?? []).filter((m) => !!m.url)
  const cover = coverItem(withFile)
  const rest = withFile.filter((m) => m !== cover)
  return (cover ? [cover, ...rest] : rest).slice(0, Math.max(0, max))
}

// Pause length at a stop: longer when there is a story or media to look at,
// and longer still for every extra picture in the slideshow so each one gets
// a readable turn on screen.
export function stopPauseMs(stop: Pick<Stop, "story" | "media">): number {
  const base =
    stop.story.trim().length > 0 || stop.media.length > 0
      ? STOP_PAUSE_STORY_MS
      : STOP_PAUSE_MS
  const photos = replayPhotos(stop).length
  return photos > 1 ? base + (photos - 1) * PHOTO_DWELL_MS : base
}

// Which picture of `count` is on screen `frac` (0..1) of the way through a
// stop's pause — each one gets an equal share of it.
export function photoIndexAt(count: number, frac: number): number {
  if (count <= 1) return 0
  const k = Math.max(0, Math.min(1, frac))
  return Math.min(count - 1, Math.floor(k * count))
}

export interface TimelineSegment {
  kind: "stop" | "drive"
  // Stop index for "stop" segments; the target stop for "drive" segments.
  index: number
  start: number
  end: number
}

export interface ReplayTimeline {
  segments: TimelineSegment[]
  total: number
}

// Alternating stop-pause / drive segments over the whole route. In reduced
// mode drive segments collapse to zero so the replay steps stop-to-stop.
export function buildTimeline(
  stops: Stop[],
  route: RouteGeometry,
  reduced = false,
): ReplayTimeline {
  const segments: TimelineSegment[] = []
  let t = 0
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) {
      // A zero-distance leg (next stop at the same spot) has nothing to
      // drive — skip straight to the stop instead of idling for LEG_MIN_MS.
      const meters = route.stopCum[i] - route.stopCum[i - 1]
      const dur = reduced || meters <= 0 ? 0 : legDurationMs(meters)
      segments.push({ kind: "drive", index: i, start: t, end: t + dur })
      t += dur
    }
    const pause = stopPauseMs(stops[i])
    segments.push({ kind: "stop", index: i, start: t, end: t + pause })
    t += pause
  }
  return { segments, total: t }
}

export interface ReplaySample {
  kind: "stop" | "drive"
  stopIndex: number
  progress: number
  // How far through this segment we are, 0..1 — the stop slideshow reads it
  // to decide which picture is up.
  frac: number
  done: boolean
}

// State of the replay at elapsed time tMs. Drives use the same cubic ease as
// the scrubber step animation so the cub accelerates out of each stop.
export function sampleTimeline(
  timeline: ReplayTimeline,
  route: RouteGeometry,
  tMs: number,
): ReplaySample {
  const { segments, total } = timeline
  if (segments.length === 0)
    return { kind: "stop", stopIndex: 0, progress: 0, frac: 1, done: true }
  const last = segments[segments.length - 1]
  if (tMs >= total)
    return {
      kind: "stop",
      stopIndex: last.index,
      progress: stopFraction(route, last.index),
      frac: 1,
      done: true,
    }
  // Zero-length segments (reduced-motion drives) never match tMs < end.
  const seg = segments.find((s) => tMs < s.end) ?? last
  const span = seg.end - seg.start
  const k = span > 0 ? Math.max(0, (tMs - seg.start) / span) : 1
  if (seg.kind === "stop")
    return {
      kind: "stop",
      stopIndex: seg.index,
      progress: stopFraction(route, seg.index),
      frac: k,
      done: false,
    }
  const from = stopFraction(route, seg.index - 1)
  const to = stopFraction(route, seg.index)
  return {
    kind: "drive",
    stopIndex: seg.index,
    progress: from + (to - from) * easeInOutCubic(k),
    frac: k,
    done: false,
  }
}

// Leg index (between stops) + within-leg distance fraction at route
// fraction t. Legs run stop-to-stop even when the geometry between them is
// a many-vertex real ridden road.
export function legAt(
  route: RouteGeometry,
  t: number,
): { index: number; frac: number } {
  const { stopCum, total } = route
  if (stopCum.length < 2 || total === 0) return { index: 0, frac: 0 }
  const dist = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < stopCum.length; i++) {
    if (dist <= stopCum[i] || i === stopCum.length - 1) {
      const len = stopCum[i] - stopCum[i - 1] || 1
      return {
        index: i - 1,
        frac: Math.min(1, (dist - stopCum[i - 1]) / len),
      }
    }
  }
  return { index: stopCum.length - 2, frac: 1 }
}

// Odometer reading per stop. A believable pair of readings snaps the counter
// straight onto the dial; otherwise it advances by the leg's measured
// distance, using the same source order as the logboek's leg stats. Passing
// the route lets a leg's real ridden road stand in for the straight line.
export function cumulativeKm(stops: Stop[], route?: RouteGeometry): number[] {
  if (stops.length === 0) return []
  let running = stops[0].km ?? 0
  const out = [running]
  const tracked = route != null && route.stopCum.length === stops.length
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const crowKm = haversine([a.lng, a.lat], [b.lng, b.lat]) / 1000
    const odometerKm = a.km != null && b.km != null ? b.km - a.km : null
    if (odometerTrusted(crowKm, odometerKm)) running = b.km as number
    else
      running += legKm(
        crowKm,
        null,
        tracked ? (route.stopCum[i] - route.stopCum[i - 1]) / 1000 : null,
        // The dial stands still on the boat deck.
        b.ferry,
      )
    out.push(running)
  }
  return out
}

// Rolling km counter value at route fraction t, from a pre-built per-stop
// odometer table. The replay header calls this every animation frame, so the
// table is built once by the caller instead of per frame.
export function kmFromCum(
  cum: number[],
  route: RouteGeometry,
  t: number,
): number {
  if (cum.length === 0) return 0
  const { index, frac } = legAt(route, t)
  const a = cum[Math.min(index, cum.length - 1)]
  const b = cum[Math.min(index + 1, cum.length - 1)]
  return Math.round(a + (b - a) * frac)
}

// Rolling km counter value at route fraction t.
export function kmAtProgress(
  stops: Stop[],
  route: RouteGeometry,
  t: number,
): number {
  if (stops.length === 0) return 0
  return kmFromCum(cumulativeKm(stops, route), route, t)
}

// Rolling date (ISO YYYY-MM-DD) at route fraction t, interpolated linearly
// between the bracketing stops' dates. Never rolls backwards.
export function dateAtProgress(
  stops: Stop[],
  route: RouteGeometry,
  t: number,
): string {
  if (stops.length === 0) return ""
  const { index, frac } = legAt(route, t)
  const a = Date.parse(stops[Math.min(index, stops.length - 1)].date)
  const b = Date.parse(stops[Math.min(index + 1, stops.length - 1)].date)
  const ms = b >= a ? a + (b - a) * frac : a
  return new Date(ms).toISOString().slice(0, 10)
}

export interface BorderCrossing {
  index: number
  code: string
  flag: string
  country: string
}

// Border crossings derived purely from the ordered stops' country codes: a
// stamp belongs to every stop whose code differs from the previous stop's.
// Preparation posts predate the trip — they neither stamp nor count as the
// "previous" stop another one is compared against.
export function stampCrossings(stops: Stop[]): BorderCrossing[] {
  const out: BorderCrossing[] = []
  let prev: Stop | null = null
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    if (s.type === "preparation") continue
    if (prev && s.code && s.code !== prev.code)
      out.push({
        index: i,
        code: s.code,
        flag: s.flag,
        country: s.country,
      })
    prev = s
  }
  return out
}

// Which way the cub faces during a replay: 1 = right (eastbound), -1 = left
// (westbound). Real ridden roads wiggle constantly, and tilting or flipping
// the art with every wiggle is what made the moped look jumpy — so the replay
// keeps it level and only mirrors when the route has clearly committed to the
// other side of the compass. Headings inside the deadband around north/south
// keep whatever facing the cub already had.
export function cubFacing(travelBearing: number, prev: 1 | -1): 1 | -1 {
  const b = ((travelBearing % 360) + 360) % 360
  if (b > FACING_DEADBAND_DEG && b < 180 - FACING_DEADBAND_DEG) return 1
  if (b > 180 + FACING_DEADBAND_DEG && b < 360 - FACING_DEADBAND_DEG) return -1
  return prev
}

// Shortest signed angular difference a→b in degrees, in [-180, 180).
export function bearingDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180
}
