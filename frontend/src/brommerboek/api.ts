// Thin typed client for the public Brommerboek stops API. Kept separate from
// the generated auth client so it needs no live backend at build time.

import type { NewStop, Stop, StopsResponse } from "./types"

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const STOPS_URL = `${BASE}/api/v1/stops/`

export async function fetchStops(): Promise<Stop[]> {
  const res = await fetch(STOPS_URL)
  if (!res.ok) throw new Error(`Failed to load stops (${res.status})`)
  const body = (await res.json()) as StopsResponse
  return body.data.slice().sort((a, b) => a.order_index - b.order_index)
}

export async function createStop(stop: NewStop): Promise<Stop> {
  const res = await fetch(STOPS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stop),
  })
  if (!res.ok) throw new Error(`Failed to add stop (${res.status})`)
  return (await res.json()) as Stop
}
