import { describe, expect, it } from "vitest"
import { buildRoute } from "./geo"
import {
  cubPoint,
  isLiveFresh,
  LIVE_FRESH_MINUTES,
  liveAgeLabel,
  liveAgeMinutes,
  trailGeoJSON,
} from "./live"
import type { LiveLocation } from "./types"

const NOW = Date.parse("2026-07-20T15:00:00Z")

function minutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString()
}

describe("liveAgeMinutes", () => {
  it("measures the age of a fix in minutes", () => {
    expect(liveAgeMinutes(minutesAgo(5), NOW)).toBeCloseTo(5)
    expect(liveAgeMinutes(minutesAgo(0), NOW)).toBe(0)
  })

  it("clamps fixes from the future to zero", () => {
    // Clock skew between tracker and viewer shouldn't yield negative ages.
    expect(liveAgeMinutes(minutesAgo(-3), NOW)).toBe(0)
  })

  it("is null for missing or unparseable timestamps", () => {
    expect(liveAgeMinutes(null, NOW)).toBeNull()
    expect(liveAgeMinutes("gisteren", NOW)).toBeNull()
  })
})

describe("isLiveFresh", () => {
  it("is fresh under the threshold, stale at and beyond it", () => {
    expect(isLiveFresh(minutesAgo(LIVE_FRESH_MINUTES - 1), NOW)).toBe(true)
    expect(isLiveFresh(minutesAgo(LIVE_FRESH_MINUTES), NOW)).toBe(false)
    expect(isLiveFresh(minutesAgo(120), NOW)).toBe(false)
  })

  it("is never fresh without a timestamp", () => {
    expect(isLiveFresh(null, NOW)).toBe(false)
  })
})

describe("liveAgeLabel", () => {
  it("labels very recent fixes as zojuist", () => {
    expect(liveAgeLabel(minutesAgo(0), NOW)).toBe("zojuist")
    expect(liveAgeLabel(minutesAgo(1), NOW)).toBe("zojuist")
  })

  it("labels minutes, hours and days in Dutch", () => {
    expect(liveAgeLabel(minutesAgo(12), NOW)).toBe("12 min geleden")
    expect(liveAgeLabel(minutesAgo(59), NOW)).toBe("59 min geleden")
    expect(liveAgeLabel(minutesAgo(60), NOW)).toBe("1 uur geleden")
    expect(liveAgeLabel(minutesAgo(3 * 60), NOW)).toBe("3 uur geleden")
    expect(liveAgeLabel(minutesAgo(26 * 60), NOW)).toBe("1 dag geleden")
    expect(liveAgeLabel(minutesAgo(3 * 24 * 60), NOW)).toBe("3 dagen geleden")
  })

  it("falls back for missing timestamps", () => {
    expect(liveAgeLabel(null, NOW)).toBe("onbekend")
  })
})

describe("cubPoint", () => {
  const AMS: [number, number] = [4.9, 52.37]
  const UTR: [number, number] = [5.12, 52.09]
  const route = buildRoute([AMS, UTR])
  const LAST_DATE = "2026-07-20"
  // A fix well south-east of the last pin: an afternoon of riding past the
  // place the last story was posted.
  const fix: LiveLocation = {
    lat: 51.7,
    lng: 5.3,
    speed_kmh: 42,
    course: 132,
    battery: 80,
    fix_time: `${LAST_DATE}T14:00:00Z`,
  }

  it("parks the cub on the live dot at the end of the route", () => {
    const pt = cubPoint(route, 1, fix, LAST_DATE)
    expect(pt.lng).toBe(fix.lng)
    expect(pt.lat).toBe(fix.lat)
  })

  it("stays on the route without a fix", () => {
    const pt = cubPoint(route, 1, null, LAST_DATE)
    expect([pt.lng, pt.lat]).toEqual(UTR)
  })

  it("ignores the fix anywhere but the end of the route", () => {
    const pt = cubPoint(route, 0.5, fix, LAST_DATE)
    expect(pt.lng).toBeCloseTo((AMS[0] + UTR[0]) / 2, 4)
    expect(pt.lat).toBeCloseTo((AMS[1] + UTR[1]) / 2, 4)
  })

  it("keeps the cub on the pin when the fix predates the last stop", () => {
    // Tracker off for two days while a new stop landed: the pin is then the
    // fresher answer to where the brommer is.
    const stale = { ...fix, fix_time: "2026-07-18T14:00:00Z" }
    expect([cubPoint(route, 1, stale, LAST_DATE).lng]).toEqual([UTR[0]])
  })

  it("takes the fix without a usable timestamp — it is still a position", () => {
    const undated = { ...fix, fix_time: null }
    expect(cubPoint(route, 1, undated, LAST_DATE).lat).toBe(fix.lat)
  })

  it("faces the tracker's own course while the brommer is moving", () => {
    expect(cubPoint(route, 1, fix, LAST_DATE).bearing).toBeCloseTo(132, 5)
  })

  it("ignores a stale course while standing still", () => {
    // Parked trackers keep reporting the heading they last saw; the way out
    // of the last stop reads better than that.
    const parked = { ...fix, speed_kmh: 0, course: 300 }
    const b = cubPoint(route, 1, parked, LAST_DATE).bearing
    expect(b).toBeGreaterThan(140)
    expect(b).toBeLessThan(180)
  })

  it("keeps the route bearing for a fix on top of the last pin", () => {
    const onPin = {
      ...fix,
      lng: UTR[0],
      lat: UTR[1],
      speed_kmh: 0,
      course: null,
    }
    const onRoute = cubPoint(route, 1, null, LAST_DATE)
    expect(cubPoint(route, 1, onPin, LAST_DATE).bearing).toBeCloseTo(
      onRoute.bearing,
      5,
    )
  })
})

describe("trailGeoJSON", () => {
  it("builds a lng/lat LineString from the breadcrumbs", () => {
    const fc = trailGeoJSON([
      { lat: 52.3, lng: 4.9, fix_time: null },
      { lat: 51.9, lng: 4.4, fix_time: null },
    ])
    const geometry = fc.features[0].geometry as GeoJSON.LineString
    expect(geometry.type).toBe("LineString")
    expect(geometry.coordinates).toEqual([
      [4.9, 52.3],
      [4.4, 51.9],
    ])
  })
})
