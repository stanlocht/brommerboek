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

// Headline above the map. The backend serves the real one (/trip); this is
// what the header shows until that query resolves — and if it never does.
export const DEFAULT_TRIP_TITLE = "Van Mokum naar Marokko"

// Mirrors the backend's TRIP_TITLE_MAX_LENGTH; longer titles wrap over the
// logbook card, so the editor stops typing there instead of taking a 422.
export const TRIP_TITLE_MAX_LENGTH = 60

export const EMPTY_STATS: TripStats = {
  km: 0,
  suggested_km: null,
  days: 0,
  countries: 0,
  stops: 0,
  repairs: 0,
  stamps: 0,
}
