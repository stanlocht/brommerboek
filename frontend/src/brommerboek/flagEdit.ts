// Draft state + validation for the admin flag editor. Coordinates are kept
// as strings while typing (so "-", "51," and half-finished numbers don't
// fight the input); parseFlagDraft turns a draft into a PATCH payload, or
// null when the coordinates don't form a valid point.

import type { MapFlag, MapFlagKind } from "./types"

export interface FlagDraft {
  kind: MapFlagKind
  lat: string
  lng: string
  label: string
}

export function draftFromFlag(flag: MapFlag): FlagDraft {
  return {
    kind: flag.kind,
    lat: String(flag.lat),
    lng: String(flag.lng),
    label: flag.label,
  }
}

export function parseFlagDraft(
  draft: FlagDraft,
): { lat: number; lng: number; label: string } | null {
  // Accept the Dutch decimal comma alongside the dot.
  const lat = Number(draft.lat.trim().replace(",", "."))
  const lng = Number(draft.lng.trim().replace(",", "."))
  if (draft.lat.trim() === "" || draft.lng.trim() === "") return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng, label: draft.label.trim() }
}
