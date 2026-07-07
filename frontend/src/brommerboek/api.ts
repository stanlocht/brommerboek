// Thin typed client for the public Brommerboek stops API. Kept separate from
// the generated auth client so it needs no live backend at build time.

import type { TripStats } from "./trip"
import type { NewStop, Stop, StopPatch, StopsResponse } from "./types"

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const STOPS_URL = `${BASE}/api/v1/stops/`
const STATS_URL = `${BASE}/api/v1/stops/stats`
const stopUrl = (id: string) => `${BASE}/api/v1/stops/${id}`
const mediaUrl = (id: string) => `${BASE}/api/v1/stops/${id}/media`
const mediaIndexUrl = (id: string, i: number) =>
  `${BASE}/api/v1/stops/${id}/media/${i}`
const honksUrl = (id: string) => `${BASE}/api/v1/stops/${id}/honks`
const PUSH_PUBLIC_KEY_URL = `${BASE}/api/v1/push/public-key`
const PUSH_SUBSCRIBE_URL = `${BASE}/api/v1/push/subscribe`
const WEATHER_SUGGEST_URL = `${BASE}/api/v1/weather/suggest`

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
// so <img> / <video> tags fetch from the right origin during dev.
export function mediaSrc(url: string | null): string | undefined {
  if (!url) return undefined
  if (/^https?:/.test(url)) return url
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

export async function uploadStopMedia(
  id: string,
  file: File,
  caption = "",
): Promise<Stop> {
  const form = new FormData()
  form.append("file", file)
  // The backend reads `caption` as a query parameter, not a form field.
  const url = caption
    ? `${mediaUrl(id)}?caption=${encodeURIComponent(caption)}`
    : mediaUrl(id)
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(`Failed to upload media (${res.status})`)
  return (await res.json()) as Stop
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

export async function deleteStop(id: string): Promise<void> {
  const res = await fetch(stopUrl(id), {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to delete stop (${res.status})`)
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
