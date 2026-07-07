// Brommerboek domain types — mirror of the backend `StopPublic` / `TripStats`.

export interface MediaItem {
  // Hex-colour swatch used as a vintage placeholder before a real file is
  // dropped in. Empty string once `url` is set.
  tone: string
  cap: string
  // "image" or "video". Kept as a plain string so new kinds don't require a
  // frontend rebuild.
  kind: "image" | "video"
  // Server-relative URL to the uploaded file (e.g. "/media/<stop>/<uuid>.jpg").
  // Null while the item is still just a placeholder.
  url: string | null
  // Pre-generated WebP thumbnail ("/media/<stop>/thumb_<uuid>.webp"). Null
  // for videos and for uploads that predate thumbnails — fall back to `url`.
  thumb?: string | null
}

// Short-code weather conditions the picker offers. Empty string means
// "unspecified".
export type WeatherCondition =
  | ""
  | "sunny"
  | "partly"
  | "cloudy"
  | "rain"
  | "storm"
  | "wind"
  | "snow"
  | "fog"

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
  km: number | null
  weather_temp: number | null
  weather_condition: WeatherCondition
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
  km: number | null
  weather_temp: number | null
  weather_condition: WeatherCondition
  type: "stop" | "repair"
  story: string
  broke: string | null
  fixed: string | null
  media: MediaItem[]
}

// Same shape as NewStop but every field optional — matches the backend
// StopUpdate model.
export type StopPatch = Partial<NewStop>
