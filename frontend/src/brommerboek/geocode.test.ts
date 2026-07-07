import { afterEach, describe, expect, it, vi } from "vitest"
import { flagEmoji, searchPlaces } from "./geocode"

describe("flagEmoji", () => {
  it("maps ISO alpha-2 codes to regional-indicator flags", () => {
    expect(flagEmoji("NL")).toBe("🇳🇱")
    expect(flagEmoji("BE")).toBe("🇧🇪")
    expect(flagEmoji("IT")).toBe("🇮🇹")
  })

  it("normalises lowercase input", () => {
    expect(flagEmoji("nl")).toBe("🇳🇱")
    expect(flagEmoji("Ch")).toBe("🇨🇭")
  })

  it("returns an empty string for wrong-length or empty codes", () => {
    expect(flagEmoji("")).toBe("")
    expect(flagEmoji("N")).toBe("")
    expect(flagEmoji("NLD")).toBe("")
  })
})

// searchPlaces networking is stubbed out — these tests exercise only the
// pure response-to-PlaceHit mapping (naming, Dutch country names, dedupe).
type Properties = Record<string, string | number | undefined>

function feature(coordinates: [number, number], properties: Properties) {
  return { geometry: { coordinates }, properties }
}

function stubFetch(features: unknown[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features }),
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("searchPlaces result mapping", () => {
  it("returns [] for queries shorter than 2 chars without fetching", async () => {
    const fetchMock = stubFetch([])
    expect(await searchPlaces("")).toEqual([])
    expect(await searchPlaces(" a ")).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps a Photon feature to a PlaceHit with a Dutch country name", async () => {
    stubFetch([
      feature([4.9041, 52.3676], {
        osm_id: 1,
        osm_type: "N",
        name: "Amsterdam",
        state: "Noord-Holland",
        country: "Netherlands",
        countrycode: "nl",
      }),
    ])
    const hits = await searchPlaces("amsterdam")
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.place).toBe("Amsterdam")
    expect(hit.country).toBe("Nederland") // NL_COUNTRY translation
    expect(hit.code).toBe("NL") // uppercased
    expect(hit.flag).toBe("🇳🇱")
    expect(hit.lng).toBe(4.9041)
    expect(hit.lat).toBe(52.3676)
    expect(hit.region).toBe("Noord-Holland")
  })

  it("keeps untranslated country names as-is", async () => {
    stubFetch([
      feature([139.69, 35.68], {
        name: "Tokyo",
        country: "Japan",
        countrycode: "JP",
      }),
    ])
    const [hit] = await searchPlaces("tokyo")
    expect(hit.country).toBe("Japan")
    expect(hit.flag).toBe("🇯🇵")
  })

  it("falls back through name → city → town → village → county", async () => {
    stubFetch([
      feature([1, 1], { city: "Gent", country: "Belgium", countrycode: "BE" }),
      feature([2, 2], { village: "Elspeet", countrycode: "NL" }),
    ])
    const hits = await searchPlaces("somewhere")
    expect(hits.map((h) => h.place)).toEqual(["Gent", "Elspeet"])
  })

  it("joins region parts and drops ones equal to the place", async () => {
    stubFetch([
      feature([1, 1], {
        name: "Utrecht",
        state: "Utrecht", // same as place — dropped
        county: "Kromme Rijn",
        countrycode: "NL",
      }),
    ])
    const [hit] = await searchPlaces("utrecht")
    expect(hit.region).toBe("Kromme Rijn")
  })

  it("skips features without a country code or resolvable place", async () => {
    stubFetch([
      feature([1, 1], { name: "Open water" }), // no countrycode
      feature([2, 2], { countrycode: "NL" }), // no name at all
      feature([3, 3], { name: "Echt", countrycode: "NL" }),
    ])
    const hits = await searchPlaces("query")
    expect(hits.map((h) => h.place)).toEqual(["Echt"])
  })

  it("dedupes near-identical results", async () => {
    const dup = {
      name: "Reims",
      country: "France",
      countrycode: "FR",
    }
    stubFetch([
      feature([4.0317, 49.2583], { ...dup, osm_id: 1 }),
      feature([4.0317, 49.2583], { ...dup, osm_id: 2 }),
    ])
    const hits = await searchPlaces("reims")
    expect(hits).toHaveLength(1)
  })

  it("throws on a non-ok geocoder response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    )
    await expect(searchPlaces("amsterdam")).rejects.toThrow("Geocoder 503")
  })
})
