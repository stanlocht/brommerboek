// Brommerboek domain types — mirror of the backend `StopPublic` / `TripStats`.

export interface MediaItem {
  tone: string
  cap: string
  video: boolean
}

export interface Stop {
  id: string
  order_index: number
  place: string
  country: string
  flag: string
  code: string
  lat: number
  lng: number
  date: string // ISO date (YYYY-MM-DD)
  title: string
  km: number
  weather: string
  type: "stop" | "repair"
  story: string
  broke: string | null
  fixed: string | null
  media: MediaItem[]
}

export interface StopsResponse {
  data: Stop[]
  count: number
}

// `flag` is intentionally absent — the server derives it from `code` on
// write, so the client shouldn't (and can't) drift out of sync.
export interface NewStop {
  place: string
  country: string
  code: string
  lat: number
  lng: number
  date: string
  title: string
  km: number
  weather: string
  type: "stop" | "repair"
  story: string
  broke: string | null
  fixed: string | null
  media: MediaItem[]
}
