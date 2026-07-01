// Thin typed client for the public Brommerboek stops API. Kept separate from
// the generated auth client so it needs no live backend at build time.

import type { TripStats } from "./trip"
import type { NewStop, Stop, StopsResponse } from "./types"

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const STOPS_URL = `${BASE}/api/v1/stops/`
const STATS_URL = `${BASE}/api/v1/stops/stats`

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

export async function createStop(stop: NewStop): Promise<Stop> {
  const token = localStorage.getItem("access_token") ?? ""
  const res = await fetch(STOPS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(stop),
  })
  if (!res.ok) throw new Error(`Failed to add stop (${res.status})`)
  return (await res.json()) as Stop
}
