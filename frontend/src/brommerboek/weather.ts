// Weather picker options + display helpers. The backend stores a temperature
// (°C) and a short condition code; the UI turns them back into "Zon, 17°"
// for read-only views and into a picker for the edit flow.

import type { WeatherCondition } from "./types"

export interface WeatherOption {
  code: WeatherCondition
  label: string // Dutch label shown in the picker
  icon: string // emoji shown next to the label
}

export const WEATHER_OPTIONS: readonly WeatherOption[] = [
  { code: "sunny", label: "Zon", icon: "☀️" },
  { code: "partly", label: "Halfbewolkt", icon: "⛅" },
  { code: "cloudy", label: "Bewolkt", icon: "☁️" },
  { code: "rain", label: "Regen", icon: "🌧️" },
  { code: "storm", label: "Onweer", icon: "⛈️" },
  { code: "wind", label: "Wind", icon: "💨" },
  { code: "snow", label: "Sneeuw", icon: "❄️" },
  { code: "fog", label: "Mist", icon: "🌫️" },
] as const

export function weatherLabel(
  condition: WeatherCondition,
  temp: number | null,
): string {
  const opt = WEATHER_OPTIONS.find((o) => o.code === condition)
  const parts: string[] = []
  if (opt) parts.push(opt.label)
  if (temp !== null && temp !== undefined) parts.push(`${temp}°`)
  return parts.join(", ")
}

export function weatherIcon(condition: WeatherCondition): string {
  return WEATHER_OPTIONS.find((o) => o.code === condition)?.icon ?? ""
}
