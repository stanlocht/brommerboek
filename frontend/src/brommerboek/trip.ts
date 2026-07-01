// Trip stats are pre-computed on the backend (see /stops/stats). This module
// mirrors that response shape and offers an EMPTY placeholder for the render
// path before the query resolves.

export interface TripStats {
  km: number // real-geography distance, summed haversine between stops
  suggested_km: number // last odometer reading, prefills the next stop's km input
  days: number
  countries: number
  stops: number
  repairs: number
  stamps: number
}

export const EMPTY_STATS: TripStats = {
  km: 0,
  suggested_km: 0,
  days: 0,
  countries: 0,
  stops: 0,
  repairs: 0,
  stamps: 0,
}
