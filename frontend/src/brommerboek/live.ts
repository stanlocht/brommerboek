// Helpers around the live GPS fix: how old it is, whether it still counts
// as "live", the Dutch "laatst gezien" label for the map chip, the GeoJSON
// for the breadcrumb trail, and where the Cub parks at the end of the route.

import type { LngLat, RouteGeometry, RoutePoint } from "./geo"
import { bearing, haversine, pointAt } from "./geo"
import type { LiveLocation, LiveTrailPoint } from "./types"

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

// A fix within this distance of the last pin is the same spot as far as the
// Cub's heading goes — keep the route bearing instead of swinging the Cub
// around on GPS jitter.
const SAME_SPOT_METRES = 60

// Whether the tracker fix is the fresher answer to "where is the brommer?"
// than the trip's last pin. A fix from before the last stop's day means the
// tracker is lagging behind the journal (switched off, out of coverage, on a
// boat) — the pin is then the better truth. A fix without a usable timestamp
// is still a position, and it is already the one the live dot claims, so it
// counts.
function liveOutranksStop(
  fixTime: string | null,
  lastStopDate: string | null | undefined,
): boolean {
  if (!lastStopDate) return true
  const stop = Date.parse(lastStopDate)
  const fix = fixTime ? Date.parse(fixTime) : Number.NaN
  if (Number.isNaN(stop) || Number.isNaN(fix)) return true
  return fix >= stop
}

// Which way the Cub faces while parked on the live dot.
function liveBearing(
  routeBearing: number,
  from: LngLat,
  fix: LiveLocation,
): number {
  const to: LngLat = [fix.lng, fix.lat]
  // The tracker's own heading is the truth while it is moving; standing
  // still it keeps reporting whatever it last saw, so it is ignored then.
  if (fix.course !== null && (fix.speed_kmh ?? 0) > 1)
    return ((fix.course % 360) + 360) % 360
  if (haversine(from, to) > SAME_SPOT_METRES) return bearing(from, to)
  return routeBearing
}

// Where the Cub sits at scrub fraction `t`. Anywhere along the trip that is
// the route itself, but at the very end a tracker fix parks the Cub on the
// live dot: the last pin is where the last story was posted, the dot is
// where the brommer actually is, and those drift apart over a riding day.
export function cubPoint(
  route: RouteGeometry,
  t: number,
  live: LiveLocation | null | undefined,
  lastStopDate?: string | null,
): RoutePoint {
  const onRoute = pointAt(route, t)
  if (!live || t < 1 || !liveOutranksStop(live.fix_time, lastStopDate))
    return onRoute
  return {
    lng: live.lng,
    lat: live.lat,
    bearing: liveBearing(onRoute.bearing, [onRoute.lng, onRoute.lat], live),
  }
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
