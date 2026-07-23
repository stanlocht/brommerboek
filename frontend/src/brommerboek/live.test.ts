import { describe, expect, it } from "vitest"
import {
  isLiveFresh,
  LIVE_FRESH_MINUTES,
  liveAgeLabel,
  liveAgeMinutes,
} from "./live"

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
