// Stempelmuur derivation — turns the trip's stops into passport stamps, one
// per country, in the order the route first crosses each border.

import type { Stop } from "./types"

export interface Stamp {
  code: string
  flag: string
  country: string
  // ISO date of the FIRST arrival in this country; later visits don't move it.
  date: string
  stops: number
}

export function deriveStamps(stops: Stop[]): Stamp[] {
  const ordered = [...stops].sort((a, b) => a.order_index - b.order_index)
  const byCode = new Map<string, Stamp>()
  for (const s of ordered) {
    if (!s.code) continue
    const cur = byCode.get(s.code)
    if (cur) cur.stops += 1
    else
      byCode.set(s.code, {
        code: s.code,
        flag: s.flag,
        country: s.country,
        date: s.date,
        stops: 1,
      })
  }
  return Array.from(byCode.values())
}
