// Derivations from the raw stop list. Trimmed to what the map-first app
// actually shows: km/days for the header, country count for the follower
// header, and the raw km used to suggest the next stop's odometer.

import { kmLabel } from "./theme"
import type { Stop } from "./types"

export interface TripStats {
  km: string // formatted "1.024"
  kmRaw: number
  days: number
  countries: number
  stops: number
  repairs: number
}

export function computeStats(stops: Stop[]): TripStats {
  const kmRaw = stops.reduce((m, s) => Math.max(m, s.km), 0)
  const codes = new Set(stops.map((s) => s.code).filter(Boolean))
  const repairs = stops.filter((s) => s.type === "repair").length
  let days = 0
  if (stops.length) {
    const times = stops.map((s) => new Date(s.date).getTime())
    days = Math.round((Math.max(...times) - Math.min(...times)) / 86400000)
  }
  return {
    km: kmLabel(kmRaw),
    kmRaw,
    days,
    countries: codes.size,
    stops: stops.length,
    repairs,
  }
}
