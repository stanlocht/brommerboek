// Thin typed client for the public Brommerboek stops API. Kept separate from
// the generated auth client so it needs no live backend at build time.

import type { TripStats } from "./trip"
import type {
  LegTrackData,
  LiveLocation,
  LiveTrailPoint,
  MapFlag,
  MapFlagKind,
  MapFlagPatch,
  NewStop,
  RiddenSince,
  Stop,
  StopPatch,
  StopsResponse,
} from "./types"

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const STOPS_URL = `${BASE}/api/v1/stops/`
const STATS_URL = `${BASE}/api/v1/stops/stats`
const stopUrl = (id: string) => `${BASE}/api/v1/stops/${id}`
const mediaUrl = (id: string) => `${BASE}/api/v1/stops/${id}/media`
const mediaIndexUrl = (id: string, i: number) =>
  `${BASE}/api/v1/stops/${id}/media/${i}`
const honksUrl = (id: string) => `${BASE}/api/v1/stops/${id}/honks`
const commentsUrl = (id: string) => `${BASE}/api/v1/stops/${id}/comments`
const commentUrl = (id: string) => `${BASE}/api/v1/comments/${id}`
const commentHonksUrl = (id: string) => `${BASE}/api/v1/comments/${id}/honks`
const MAP_FLAGS_URL = `${BASE}/api/v1/map-flags/`
const mapFlagUrl = (kind: MapFlagKind) => `${BASE}/api/v1/map-flags/${kind}`
const LIVE_LOCATION_URL = `${BASE}/api/v1/location/live`
const LIVE_TRAIL_URL = `${BASE}/api/v1/location/trail`
const RIDDEN_URL = `${BASE}/api/v1/location/ridden`
const LEG_TRACKS_URL = `${BASE}/api/v1/location/tracks`
const PUSH_PUBLIC_KEY_URL = `${BASE}/api/v1/push/public-key`
const PUSH_SUBSCRIBE_URL = `${BASE}/api/v1/push/subscribe`
const WEATHER_SUGGEST_URL = `${BASE}/api/v1/weather/suggest`
const FEEDBACK_URL = `${BASE}/api/v1/feedback/`
const MY_FEEDBACK_URL = `${BASE}/api/v1/feedback/mine`
const feedbackUrl = (id: string) => `${BASE}/api/v1/feedback/${id}`

export interface Honker {
  user_id: string
  name: string
  is_mine: boolean
  created_at: string | null
}

// Weather auto-fill suggestion from the backend (which asks Open-Meteo).
// Either field may be null when the upstream data is incomplete.
export interface WeatherSuggestion {
  temp: number | null
  condition: string | null
}

export interface HonkState {
  stop_id: string
  count: number
  honked_by_me: boolean
  honkers: Honker[]
}

// Prefixes `/media/...` URLs (returned as server-relative) with the API base
// so <img> / <video> tags fetch from the right origin during dev. Absolute
// URLs — including blob:/data: local previews — pass through untouched.
export function mediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (/^(https?|blob|data):/.test(url)) return url
  return `${BASE}${url}`
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token") ?? ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchStops(): Promise<Stop[]> {
  const res = await fetch(STOPS_URL)
  if (!res.ok) throw new Error(`Failed to load stops (${res.status})`)
  const body = (await res.json()) as StopsResponse
  return body.data
}

export async function fetchStats(): Promise<TripStats> {
  const res = await fetch(STATS_URL)
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`)
  return (await res.json()) as TripStats
}

export async function suggestWeather(
  lat: number,
  lng: number,
  date: string,
): Promise<WeatherSuggestion> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    date,
  })
  const res = await fetch(`${WEATHER_SUGGEST_URL}?${params}`)
  if (!res.ok) throw new Error(`No weather suggestion (${res.status})`)
  return (await res.json()) as WeatherSuggestion
}

// Live GPS fix of the Cub via the backend's Traccar proxy. Null covers every
// "nothing to show" case — tracker not configured (404), Traccar unreachable
// (503), network failure — so callers just hide the live marker.
export async function fetchLiveLocation(): Promise<LiveLocation | null> {
  try {
    const res = await fetch(LIVE_LOCATION_URL)
    if (!res.ok) return null
    return (await res.json()) as LiveLocation
  } catch {
    return null
  }
}

// Recent GPS breadcrumbs (last week, decimated server-side). Same null-on-
// anything contract as fetchLiveLocation: no trail just means no trail drawn.
export async function fetchLiveTrail(): Promise<LiveTrailPoint[] | null> {
  try {
    const res = await fetch(LIVE_TRAIL_URL)
    if (!res.ok) return null
    const body = (await res.json()) as { points: LiveTrailPoint[] }
    return body.points
  } catch {
    return null
  }
}

// Kilometres ridden since the last stop, measured live from the tracker.
// Same null-on-anything contract as fetchLiveLocation: null just means the
// logbook shows the through-the-last-stop total without the live part.
export async function fetchRiddenSince(): Promise<RiddenSince | null> {
  try {
    const res = await fetch(RIDDEN_URL)
    if (!res.ok) return null
    return (await res.json()) as RiddenSince
  } catch {
    return null
  }
}

// Real ridden roads per leg (synced server-side from Traccar). Null means
// the route falls back to straight stop-to-stop lines.
export async function fetchLegTracks(): Promise<LegTrackData[] | null> {
  try {
    const res = await fetch(LEG_TRACKS_URL)
    if (!res.ok) return null
    const body = (await res.json()) as { data: LegTrackData[]; count: number }
    return body.data
  } catch {
    return null
  }
}

export async function createStop(stop: NewStop): Promise<Stop> {
  const res = await fetch(STOPS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(stop),
  })
  if (!res.ok) throw new Error(`Failed to add stop (${res.status})`)
  return (await res.json()) as Stop
}

// Superuser-only: swap a stop with its same-day neighbour on the route
// ("up" = earlier in the day, "down" = later). Posts carry no time, so this
// is the admin's fix for same-day posts added in the wrong order.
export async function moveStop(
  id: string,
  direction: "up" | "down",
): Promise<Stop> {
  const res = await fetch(`${stopUrl(id)}/move?direction=${direction}`, {
    method: "POST",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to move stop (${res.status})`)
  return (await res.json()) as Stop
}

export async function updateStop(id: string, patch: StopPatch): Promise<Stop> {
  const res = await fetch(stopUrl(id), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to update stop (${res.status})`)
  return (await res.json()) as Stop
}

// Abort an upload that stops making progress for this long. A mobile
// connection that drops mid-POST does not fail the request — the socket
// just goes quiet, and `fetch` will happily wait forever, which is what
// used to leave the edit flow stuck on "uploaden…" with no way out.
const UPLOAD_STALL_MS = 45_000
// Once the last byte is sent the server still has to write the file and
// render a thumbnail, during which there is nothing to report progress on.
const SERVER_WORK_MS = 90_000

export interface UploadOptions {
  // Fraction of the file sent so far, 0..1. Called often; keep it cheap.
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  // Land this file as the stop's cover picture. Used when a new stop's files
  // are uploaded after the fact: the rider marked one of the local previews,
  // and the flag has to travel with that file rather than with its position.
  cover?: boolean
}

export async function uploadStopMedia(
  id: string,
  file: File,
  caption = "",
  { onProgress, signal, cover }: UploadOptions = {},
): Promise<Stop> {
  const form = new FormData()
  form.append("file", file)
  // The backend reads `caption` and `cover` as query parameters, not form
  // fields.
  const params = new URLSearchParams()
  if (caption) params.set("caption", caption)
  if (cover) params.set("cover", "true")
  const query = params.toString()
  const url = query ? `${mediaUrl(id)}?${query}` : mediaUrl(id)

  // XHR rather than fetch: it is the only way to observe upload progress,
  // which we need both to show a percentage and to tell a slow upload
  // apart from a dead one.
  return new Promise<Stop>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let stalled = false

    const arm = (ms: number) => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        stalled = true
        xhr.abort()
      }, ms)
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      signal?.removeEventListener("abort", onAbort)
      fn()
    }
    const onAbort = () => xhr.abort()

    xhr.upload.onprogress = (e) => {
      arm(UPLOAD_STALL_MS)
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.upload.onload = () => {
      onProgress?.(1)
      arm(SERVER_WORK_MS)
    }
    xhr.onload = () =>
      finish(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Failed to upload media (${xhr.status})`))
          return
        }
        try {
          resolve(JSON.parse(xhr.responseText) as Stop)
        } catch {
          reject(new Error("Failed to upload media (bad response)"))
        }
      })
    xhr.onerror = () =>
      finish(() => reject(new Error("Upload mislukt — geen verbinding")))
    xhr.onabort = () =>
      finish(() =>
        reject(
          new Error(
            stalled
              ? "Upload vastgelopen — probeer het opnieuw"
              : "Upload afgebroken",
          ),
        ),
      )

    if (signal?.aborted) {
      reject(new Error("Upload afgebroken"))
      return
    }
    signal?.addEventListener("abort", onAbort)

    xhr.open("POST", url)
    const token = localStorage.getItem("access_token") ?? ""
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    arm(UPLOAD_STALL_MS)
    xhr.send(form)
  })
}

export async function updateStopMediaCaption(
  id: string,
  index: number,
  cap: string,
): Promise<Stop> {
  const res = await fetch(mediaIndexUrl(id, index), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ cap }),
  })
  if (!res.ok) throw new Error(`Failed to update caption (${res.status})`)
  return (await res.json()) as Stop
}

// Mark one media item as the stop's cover (or clear the flag with
// `cover: false`, after which the first item stands in again).
export async function setStopMediaCover(
  id: string,
  index: number,
  cover = true,
): Promise<Stop> {
  const res = await fetch(
    `${mediaIndexUrl(id, index)}/cover?cover=${cover ? "true" : "false"}`,
    { method: "POST", headers: authHeaders() },
  )
  if (!res.ok) throw new Error(`Failed to set cover (${res.status})`)
  return (await res.json()) as Stop
}

// ----- Comments --------------------------------------------------------------

export interface StopComment {
  id: string
  stop_id: string
  user_id: string
  author_name: string
  is_mine: boolean
  body: string
  // Server-relative URLs of an attached photo or clip and its WebP thumbnail
  // ("/media/<stop>/comments/<uuid>.jpg"); null when the comment is
  // text-only, thumb also null for videos (the backend makes no video
  // thumbnails) and when thumbnail generation failed.
  photo: string | null
  photo_thumb: string | null
  // Which element renders `photo`; "image" on every text-only comment.
  media_kind: "image" | "video"
  created_at: string | null
  // Horn-honk tally on the comment itself, embedded in the list so the UI
  // needs no extra request per comment.
  honk_count: number
  honked_by_me: boolean
}

export interface CommentsList {
  data: StopComment[]
  count: number
}

export async function fetchComments(id: string): Promise<CommentsList> {
  const res = await fetch(commentsUrl(id), { headers: authHeaders() })
  if (!res.ok) throw new Error(`Failed to load comments (${res.status})`)
  return (await res.json()) as CommentsList
}

// Multipart on purpose: the backend takes `body` as a form field so a photo
// or a short clip can ride along in the same request. Either part may be
// omitted, not both.
export async function createComment(
  id: string,
  body: string,
  file?: File | null,
): Promise<StopComment> {
  const form = new FormData()
  form.append("body", body)
  if (file) form.append("file", file)
  const res = await fetch(commentsUrl(id), {
    method: "POST",
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(`Failed to post comment (${res.status})`)
  return (await res.json()) as StopComment
}

export async function deleteComment(id: string): Promise<void> {
  const res = await fetch(commentUrl(id), {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to delete comment (${res.status})`)
}

export async function fetchHonks(id: string): Promise<HonkState> {
  const res = await fetch(honksUrl(id), { headers: authHeaders() })
  if (!res.ok) throw new Error(`Failed to load honks (${res.status})`)
  return (await res.json()) as HonkState
}

export async function toggleHonk(id: string): Promise<HonkState> {
  const res = await fetch(honksUrl(id), {
    method: "POST",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to toggle honk (${res.status})`)
  return (await res.json()) as HonkState
}

export interface CommentHonkState {
  comment_id: string
  count: number
  honked_by_me: boolean
}

export async function toggleCommentHonk(id: string): Promise<CommentHonkState> {
  const res = await fetch(commentHonksUrl(id), {
    method: "POST",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to toggle comment honk (${res.status})`)
  return (await res.json()) as CommentHonkState
}

export async function deleteStop(id: string): Promise<void> {
  const res = await fetch(stopUrl(id), {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to delete stop (${res.status})`)
}

// ----- Map flags (start + finish) --------------------------------------------

export async function fetchMapFlags(): Promise<MapFlag[]> {
  const res = await fetch(MAP_FLAGS_URL)
  if (!res.ok) throw new Error(`Failed to load map flags (${res.status})`)
  const body = (await res.json()) as { data: MapFlag[]; count: number }
  return body.data
}

// Superuser-only: move a flag (or rename its label).
export async function updateMapFlag(
  kind: MapFlagKind,
  patch: MapFlagPatch,
): Promise<MapFlag> {
  const res = await fetch(mapFlagUrl(kind), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to move flag (${res.status})`)
  return (await res.json()) as MapFlag
}

// ----- Feedback / bug reports ("storingsdienst") -----------------------------

export type FeedbackStatus = "open" | "resolved"

export interface FeedbackReport {
  id: string
  user_id: string
  author_name: string
  is_mine: boolean
  body: string
  page: string
  status: FeedbackStatus
  created_at: string | null
}

export interface FeedbackList {
  data: FeedbackReport[]
  count: number
}

export async function createFeedback(
  body: string,
  page = "",
): Promise<FeedbackReport> {
  const res = await fetch(FEEDBACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ body, page }),
  })
  if (!res.ok) throw new Error(`Failed to send report (${res.status})`)
  return (await res.json()) as FeedbackReport
}

export async function fetchMyFeedback(): Promise<FeedbackList> {
  const res = await fetch(MY_FEEDBACK_URL, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Failed to load reports (${res.status})`)
  return (await res.json()) as FeedbackList
}

// Superuser-only: the full queue, optionally filtered by status.
export async function fetchAllFeedback(
  status?: FeedbackStatus,
): Promise<FeedbackList> {
  const url = status ? `${FEEDBACK_URL}?status=${status}` : FEEDBACK_URL
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Failed to load reports (${res.status})`)
  return (await res.json()) as FeedbackList
}

// Superuser-only: mark a report resolved, or reopen it.
export async function updateFeedbackStatus(
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackReport> {
  const res = await fetch(feedbackUrl(id), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(`Failed to update report (${res.status})`)
  return (await res.json()) as FeedbackReport
}

export async function deleteFeedback(id: string): Promise<void> {
  const res = await fetch(feedbackUrl(id), {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to delete report (${res.status})`)
}

// ----- Web Push ("volg de reis") ---------------------------------------------

export interface PushSubscriptionPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function fetchPushPublicKey(): Promise<string> {
  const res = await fetch(PUSH_PUBLIC_KEY_URL)
  if (!res.ok) throw new Error(`Failed to load push key (${res.status})`)
  const body = (await res.json()) as { public_key: string }
  return body.public_key
}

export async function subscribePush(
  sub: PushSubscriptionPayload,
  wantsReactions = false,
): Promise<void> {
  const res = await fetch(PUSH_SUBSCRIBE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ ...sub, wants_reactions: wantsReactions }),
  })
  if (!res.ok) throw new Error(`Failed to subscribe (${res.status})`)
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await fetch(PUSH_SUBSCRIBE_URL, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ endpoint }),
  })
  if (!res.ok) throw new Error(`Failed to unsubscribe (${res.status})`)
}

export async function deleteStopMedia(
  id: string,
  index: number,
): Promise<Stop> {
  const res = await fetch(mediaIndexUrl(id, index), {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to delete media (${res.status})`)
  return (await res.json()) as Stop
}
