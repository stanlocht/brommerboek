// Derivations from the raw stop list: trip stats, passport stamps, recap cards.
// Mirrors the design's renderVals() computations.

import { C, dateLabelNL, kmLabel, STAMP_ROTS } from "./theme"
import type { Stop } from "./types"

export interface TripStats {
  km: string // formatted "1.024"
  kmRaw: number
  days: number
  countries: number
  stops: number
  repairs: number
  stamps: number
}

export interface Stamp {
  code: string
  name: string
  flag: string
  date: string // "4 mei"
  ink: string
  rot: string
}

export interface StatCard {
  value: string
  label: string
  rot: string
}

export function computeStats(stops: Stop[]): TripStats {
  const kmRaw = stops.reduce((m, s) => Math.max(m, s.km), 0)
  const codes = new Set(stops.map((s) => s.code).filter(Boolean))
  const repairs = stops.filter((s) => s.type === "repair").length
  let days = 0
  if (stops.length) {
    const times = stops.map((s) => new Date(s.date).getTime())
    days = Math.round((Math.max(...times) - Math.min(...times)) / 86400000)
  }
  return {
    km: kmLabel(kmRaw),
    kmRaw,
    days,
    countries: codes.size,
    stops: stops.length,
    repairs,
    stamps: codes.size,
  }
}

export function computeStamps(stops: Stop[]): Stamp[] {
  const seen = new Set<string>()
  const stamps: Stamp[] = []
  for (const s of stops) {
    if (!s.code || seen.has(s.code)) continue
    seen.add(s.code)
    stamps.push({
      code: s.code,
      name: s.country,
      flag: s.flag,
      date: dateLabelNL(s.date, false),
      ink: "#7a3a2e",
      rot: STAMP_ROTS[stamps.length % STAMP_ROTS.length],
    })
  }
  return stamps
}

export function computeStatCards(stops: Stop[]): StatCard[] {
  const st = computeStats(stops)
  return [
    { value: st.km, label: "kilometer", rot: "-1.5deg" },
    { value: String(st.days), label: "dagen onderweg", rot: "1.5deg" },
    { value: String(st.countries), label: "landen", rot: "1deg" },
    { value: String(st.stops), label: "stops", rot: "-1deg" },
    { value: String(st.repairs), label: "reparaties", rot: "1.5deg" },
    { value: String(st.stamps), label: "stempels", rot: "-2deg" },
  ]
}

// Static Dutch recap lines cycled by the "regenerate" button (from the design).
export const RECAPS = [
  "Van de grachten tot de Middellandse Zee — 1.024 km op 50cc, en de Cub draait nog.",
  "Hoogste punt: Grimselpass, 2.046 m. Laagste moment: die spijker bij Reims.",
  "Vijf landen, twee reparaties, nul pech die een berm en een kop koffie niet oplosten.",
  "15 dagen onderweg, ontelbare espresso’s, één brommer die nergens voor terugdeinst.",
]

export interface ReelScene {
  tone: string
  time: string
  cap: string
}

export const REEL_SCENES: ReelScene[] = [
  { tone: "#c9a24e", time: "0:00", cap: "Vertrek A’dam" },
  { tone: "#94a06a", time: "0:07", cap: "Gent regen" },
  { tone: "#9c4a3a", time: "0:14", cap: "Reparatie" },
  { tone: "#7ea6b4", time: "0:21", cap: "Léman" },
  { tone: "#6d7f8f", time: "0:27", cap: "Grimsel" },
  { tone: "#b26a4c", time: "0:32", cap: "Zee" },
]

export const REEL_ACCENT = C.wrappedAccent
