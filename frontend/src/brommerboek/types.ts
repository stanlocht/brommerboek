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
  // The stop's cover picture — the one on the map card, in the replay and in
  // share unfurls. At most one item per stop carries it; with none flagged
  // the first item stands in (see `coverItem`).
  cover?: boolean
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

// "preparation" is a pre-departure post (packing, tinkering at home): it
// shows in the journal and on the map, but counts toward no trip statistic.
export type StopType = "stop" | "repair" | "preparation"

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
  type: StopType
  // The leg *into* this stop was a boat crossing: the map draws it as a
  // dashed sea line with a little ferry on it, and its sea miles count as
  // sailed rather than ridden.
  ferry: boolean
  story: string
  broke: string | null
  fixed: string | null
  media: MediaItem[]
  // Reaction totals, included by the list/detail endpoints so the map can
  // badge pins without a per-stop honks request.
  honk_count: number
  comment_count: number
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
  type: StopType
  ferry: boolean
  story: string
  broke: string | null
  fixed: string | null
  media: MediaItem[]
}

// Same shape as NewStop but every field optional — matches the backend
// StopUpdate model.
export type StopPatch = Partial<NewStop>

// Start/finish flags on the map — mirror of the backend `MapFlagPublic`.
// Independent of the stops: the finish flag can sit far beyond the latest
// stop. Superusers can drag them to a new spot.
export type MapFlagKind = "start" | "finish"

export interface MapFlag {
  kind: MapFlagKind
  lat: number
  lng: number
  label: string
}

export type MapFlagPatch = Partial<Omit<MapFlag, "kind">>

// The trip's headline above the map — mirror of the backend `TripInfoPublic`.
// Everyone reads the same one; superusers can rewrite it from the header.
export interface TripInfo {
  title: string
}

// Last known GPS fix of the Cub — mirror of the backend `LiveLocation`,
// which proxies the Traccar tracker. `fix_time` is an ISO timestamp; the
// helpers in live.ts turn it into a "laatst gezien" label and a staleness
// verdict.
export interface LiveLocation {
  lat: number
  lng: number
  speed_kmh: number | null
  course: number | null
  battery: number | null
  fix_time: string | null
}

// One breadcrumb of the recent-trail endpoint — mirror of the backend
// `LiveTrailPoint`. Points arrive oldest-first, already decimated.
export interface LiveTrailPoint {
  lat: number
  lng: number
  fix_time: string | null
}

// Real ridden road of one leg, synced from Traccar's history — mirror of the
// backend `LegTrackPublic`. `points` are [lng, lat] pairs in GeoJSON order,
// endpoints near (not on) the two stops' pins.
export interface LegTrackData {
  from_stop_id: string
  to_stop_id: string
  points: [number, number][]
}

// Kilometres ridden since the trip's latest stop, measured live from the
// tracker — mirror of the backend `RiddenSince`. The logbook adds `km` on
// top of the through-the-last-stop total for a live figure.
export interface RiddenSince {
  km: number
  from_stop_id: string
  fix_time: string | null
}
