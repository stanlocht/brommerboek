// Helpers around the live GPS fix: how old it is, whether it still counts
// as "live", the Dutch "laatst gezien" label for the map chip, and the
// GeoJSON for the breadcrumb trail.

import type { LiveTrailPoint } from "./types"

// The breadcrumb trail as a LineString the map can draw. Fewer than two
// points isn't a trail — callers skip rendering entirely then.
export function trailGeoJSON(
  points: LiveTrailPoint[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      },
    ],
  }
}

// A fix younger than this shows the pulsing "live" treatment; older fixes
// grey out (tracker off, no coverage, or the Cub is parked in a garage).
export const LIVE_FRESH_MINUTES = 10

export function liveAgeMinutes(
  fixTime: string | null,
  nowMs: number,
): number | null {
  if (!fixTime) return null
  const t = Date.parse(fixTime)
  if (Number.isNaN(t)) return null
  return Math.max(0, (nowMs - t) / 60_000)
}

export function isLiveFresh(fixTime: string | null, nowMs: number): boolean {
  const age = liveAgeMinutes(fixTime, nowMs)
  return age !== null && age < LIVE_FRESH_MINUTES
}

// "zojuist" / "12 min geleden" / "3 uur geleden" / "2 dagen geleden".
export function liveAgeLabel(fixTime: string | null, nowMs: number): string {
  const age = liveAgeMinutes(fixTime, nowMs)
  if (age === null) return "onbekend"
  if (age < 1.5) return "zojuist"
  const mins = Math.round(age)
  if (mins < 60) return `${mins} min geleden`
  const hours = Math.round(age / 60)
  if (hours < 24) return hours === 1 ? "1 uur geleden" : `${hours} uur geleden`
  const days = Math.round(age / (60 * 24))
  return days === 1 ? "1 dag geleden" : `${days} dagen geleden`
}
