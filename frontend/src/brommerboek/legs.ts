// Which leg of the trip the scrubber is on, and how far/long that hop was.
// Mirrors the backend stats rule: prefer the odometer delta when both stops
// have a km reading (real road distance), fall back to great-circle.

import type { RouteGeometry } from "./geo"
import { haversine, legKm } from "./geo"
import type { Stop } from "./types"

export interface LegInfo {
  from: Stop
  to: Stop
  km: number
  days: number
  // This hop was a boat crossing (the arrival stop carries the flag).
  ferry: boolean
}

const MS_PER_DAY = 86_400_000

// Leg containing scrub fraction t ∈ [0, 1]; null when there is no leg (fewer
// than two stops). t ≤ 0 gives the first leg, t ≥ 1 the last.
export function legInfo(
  stops: Stop[],
  route: RouteGeometry,
  t: number,
): LegInfo | null {
  if (stops.length < 2 || stops.length !== route.stopCum.length) return null
  const dist = Math.max(0, Math.min(1, t)) * route.total
  let i = 1
  while (i < stops.length - 1 && dist > route.stopCum[i]) i++
  const from = stops[i - 1]
  const to = stops[i]
  // The route already follows the real ridden road wherever a leg track was
  // synced, so its own stop-to-stop length is the GPS candidate; without a
  // track it collapses to the straight line and changes nothing.
  const km = Math.round(
    legKm(
      haversine([from.lng, from.lat], [to.lng, to.lat]) / 1000,
      from.km !== null && to.km !== null ? to.km - from.km : null,
      (route.stopCum[i] - route.stopCum[i - 1]) / 1000,
      to.ferry,
    ),
  )
  const days = Math.max(
    0,
    Math.round((Date.parse(to.date) - Date.parse(from.date)) / MS_PER_DAY),
  )
  return { from, to, km, days, ferry: to.ferry }
}

// "Utrecht → Parijs · 430 km · 3 dagen" — the scrubber readout. Days are
// omitted for same-day hops. A crossing reads "· per veerboot" in place of
// the kilometres it didn't ride; one with a reading of its own keeps both,
// since that reading is the road to and from the port.
export function legLabel(leg: LegInfo): string {
  const measure =
    leg.ferry && leg.km <= 0
      ? "per veerboot"
      : `${leg.km.toLocaleString("nl-NL")} km${leg.ferry ? " · per veerboot" : ""}`
  const base = `${leg.from.place} → ${leg.to.place} · ${measure}`
  if (leg.days <= 0) return base
  return `${base} · ${leg.days} ${leg.days === 1 ? "dag" : "dagen"}`
}
