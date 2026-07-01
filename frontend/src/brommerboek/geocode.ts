// Location search via Photon (komoot.io) — an OpenStreetMap-based geocoder
// optimised for search-as-you-type. Free public endpoint, no key, browser CORS
// works. Data is OpenStreetMap under ODbL — attribute in the UI.
//
// Photon usage: https://photon.komoot.io — "please be fair" is the policy;
// we debounce keystrokes and cap results, so a personal app fits comfortably.

const PHOTON = "https://photon.komoot.io/api/"

export interface PlaceHit {
  key: string // unique id for React keys
  place: string // short label — city / town / name
  region: string // county / state / country (for the result subtitle)
  country: string // localised country name for display
  code: string // ISO-3166 alpha-2 (uppercase)
  flag: string // emoji flag
  lat: number
  lng: number
}

// English → Dutch country names for the handful of European countries this
// app targets. Anything not in the table falls back to the source name.
const NL_COUNTRY: Record<string, string> = {
  Netherlands: "Nederland",
  Belgium: "België",
  France: "Frankrijk",
  Germany: "Duitsland",
  Switzerland: "Zwitserland",
  Austria: "Oostenrijk",
  Italy: "Italië",
  Spain: "Spanje",
  Portugal: "Portugal",
  Luxembourg: "Luxemburg",
  Denmark: "Denemarken",
  Sweden: "Zweden",
  Norway: "Noorwegen",
  "United Kingdom": "Verenigd Koninkrijk",
  Ireland: "Ierland",
  Poland: "Polen",
  "Czech Republic": "Tsjechië",
  Czechia: "Tsjechië",
  Slovakia: "Slowakije",
  Slovenia: "Slovenië",
  Croatia: "Kroatië",
  Hungary: "Hongarije",
  Greece: "Griekenland",
}

// ISO-3166 alpha-2 → 🇦🇦 via regional-indicator symbols.
export function flagEmoji(code: string): string {
  if (code?.length !== 2) return ""
  const A = 0x1f1e6
  const cc = code.toUpperCase()
  return String.fromCodePoint(
    A + cc.charCodeAt(0) - 65,
    A + cc.charCodeAt(1) - 65,
  )
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id?: number
    osm_type?: string
    name?: string
    city?: string
    town?: string
    village?: string
    county?: string
    state?: string
    country?: string
    countrycode?: string
    type?: string
  }
}

function toHit(f: PhotonFeature, i: number): PlaceHit | null {
  const p = f.properties
  const [lng, lat] = f.geometry.coordinates
  const code = (p.countrycode ?? "").toUpperCase()
  if (!code) return null // skip results with no country (open water, generic ways)
  const place = p.name ?? p.city ?? p.town ?? p.village ?? p.county ?? ""
  if (!place) return null
  const region = [p.state, p.county].filter((s) => s && s !== place).join(" · ")
  const rawCountry = p.country ?? code
  return {
    key: `${p.osm_type ?? "?"}-${p.osm_id ?? i}-${lat}-${lng}`,
    place,
    region,
    country: NL_COUNTRY[rawCountry] ?? rawCountry,
    code,
    flag: flagEmoji(code),
    lat,
    lng,
  }
}

// Fetch up to `limit` suggestions for the query. Aborts on signal.
export async function searchPlaces(
  q: string,
  signal?: AbortSignal,
  limit = 6,
): Promise<PlaceHit[]> {
  const trimmed = q.trim()
  if (trimmed.length < 2) return []
  const url = `${PHOTON}?q=${encodeURIComponent(trimmed)}&limit=${limit}&lang=en`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Geocoder ${res.status}`)
  const body = (await res.json()) as { features: PhotonFeature[] }
  const seen = new Set<string>()
  const hits: PlaceHit[] = []
  for (let i = 0; i < body.features.length; i++) {
    const hit = toHit(body.features[i], i)
    if (!hit) continue
    const dedupe = `${hit.place}|${hit.code}|${hit.lat.toFixed(3)}|${hit.lng.toFixed(3)}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    hits.push(hit)
  }
  return hits
}
