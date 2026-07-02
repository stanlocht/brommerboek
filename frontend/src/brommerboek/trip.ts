// Trip stats are pre-computed on the backend (see /stops/stats). This module
// mirrors that response shape and offers an EMPTY placeholder for the render
// path before the query resolves.

export interface TripStats {
  km: number // sum of per-leg km deltas (falls back to haversine when km is missing)
  suggested_km: number | null // most recent odometer reading; prefills the next stop's km
  days: number
  countries: number
  stops: number
  repairs: number
  stamps: number
}

export const EMPTY_STATS: TripStats = {
  km: 0,
  suggested_km: null,
  days: 0,
  countries: 0,
  stops: 0,
  repairs: 0,
  stamps: 0,
}
