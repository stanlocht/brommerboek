import { describe, expect, it } from "vitest"
import { buildRoute, haversine } from "./geo"
import {
  bearingDelta,
  buildTimeline,
  cumulativeKm,
  dampenBearing,
  dateAtProgress,
  kmAtProgress,
  LEG_MAX_MS,
  LEG_MIN_MS,
  legAt,
  legDurationMs,
  MAX_CAM_TURN_DEG,
  STOP_PAUSE_MS,
  STOP_PAUSE_STORY_MS,
  sampleTimeline,
  stampCrossings,
  stopPauseMs,
} from "./replayMath"
import type { Stop } from "./types"

function makeStop(over: Partial<Stop>): Stop {
  return {
    id: "s0",
    order_index: 0,
    place: "Mokum",
    country: "Nederland",
    flag: "🇳🇱",
    code: "NL",
    lat: 52.37,
    lng: 4.9,
    date: "2024-05-01",
    title: "vertrek",
    km: null,
    weather_temp: null,
    weather_condition: "",
    type: "stop",
    story: "",
    broke: null,
    fixed: null,
    media: [],
    honk_count: 0,
    comment_count: 0,
    ...over,
  }
}

// Three stops along the equator: 0° → 1° → 3° lng, so leg 2 is twice leg 1.
const STOPS = [
  makeStop({ id: "a", lat: 0, lng: 0, date: "2024-05-01", km: 0 }),
  makeStop({
    id: "b",
    order_index: 1,
    lat: 0,
    lng: 1,
    date: "2024-05-03",
    km: 120,
  }),
  makeStop({
    id: "c",
    order_index: 2,
    lat: 0,
    lng: 3,
    date: "2024-05-07",
    km: 360,
  }),
]
const ROUTE = buildRoute(STOPS.map((s) => [s.lng, s.lat]))

describe("legDurationMs", () => {
  it("clamps a zero-length leg to the minimum", () => {
    expect(legDurationMs(0)).toBe(LEG_MIN_MS)
  })

  it("clamps huge legs to the maximum", () => {
    expect(legDurationMs(2_000_000)).toBe(LEG_MAX_MS)
  })

  it("scales linearly in between", () => {
    expect(legDurationMs(200_000)).toBe(
      LEG_MIN_MS + (LEG_MAX_MS - LEG_MIN_MS) / 2,
    )
  })
})

describe("stopPauseMs", () => {
  it("uses the short pause for a bare stop", () => {
    expect(stopPauseMs(makeStop({}))).toBe(STOP_PAUSE_MS)
  })

  it("lingers when there is a story", () => {
    expect(stopPauseMs(makeStop({ story: "lekke band" }))).toBe(
      STOP_PAUSE_STORY_MS,
    )
  })

  it("lingers when there is media", () => {
    expect(
      stopPauseMs(
        makeStop({
          media: [{ tone: "#c9a24e", cap: "", kind: "image", url: null }],
        }),
      ),
    ).toBe(STOP_PAUSE_STORY_MS)
  })

  it("ignores whitespace-only stories", () => {
    expect(stopPauseMs(makeStop({ story: "   " }))).toBe(STOP_PAUSE_MS)
  })
})

describe("buildTimeline", () => {
  it("alternates stop pauses and drives over the route", () => {
    const tl = buildTimeline(STOPS, ROUTE)
    expect(tl.segments.map((s) => s.kind)).toEqual([
      "stop",
      "drive",
      "stop",
      "drive",
      "stop",
    ])
    expect(tl.segments.map((s) => s.index)).toEqual([0, 1, 1, 2, 2])
  })

  it("is contiguous and sums to total", () => {
    const tl = buildTimeline(STOPS, ROUTE)
    expect(tl.segments[0].start).toBe(0)
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i].start).toBe(tl.segments[i - 1].end)
    }
    expect(tl.segments[tl.segments.length - 1].end).toBe(tl.total)
  })

  it("gives longer legs more time", () => {
    const tl = buildTimeline(STOPS, ROUTE)
    const drives = tl.segments.filter((s) => s.kind === "drive")
    const dur = (s: { start: number; end: number }) => s.end - s.start
    expect(dur(drives[1])).toBeGreaterThan(dur(drives[0]))
  })

  it("collapses drives to zero in reduced-motion mode", () => {
    const tl = buildTimeline(STOPS, ROUTE, true)
    for (const s of tl.segments.filter((s) => s.kind === "drive")) {
      expect(s.end - s.start).toBe(0)
    }
    expect(tl.total).toBe(STOP_PAUSE_MS * 3)
  })
})

describe("sampleTimeline", () => {
  const tl = buildTimeline(STOPS, ROUTE)

  it("parks at the first stop at t=0", () => {
    expect(sampleTimeline(tl, ROUTE, 0)).toEqual({
      kind: "stop",
      stopIndex: 0,
      progress: 0,
      done: false,
    })
  })

  it("is done at the last stop past the total", () => {
    const s = sampleTimeline(tl, ROUTE, tl.total + 1)
    expect(s.done).toBe(true)
    expect(s.stopIndex).toBe(2)
    expect(s.progress).toBeCloseTo(1, 9)
  })

  it("eases through the middle of a drive", () => {
    const drive = tl.segments.find((s) => s.kind === "drive")
    if (!drive) throw new Error("no drive segment")
    const mid = sampleTimeline(tl, ROUTE, (drive.start + drive.end) / 2)
    expect(mid.kind).toBe("drive")
    expect(mid.stopIndex).toBe(1)
    // cubic ease is exactly halfway at k=0.5; stop 1 sits at 1/3 of the route
    expect(mid.progress).toBeCloseTo(1 / 6, 6)
  })

  it("never leaves a stop's fraction during its pause", () => {
    const pause = tl.segments[2] // stop 1
    const s = sampleTimeline(tl, ROUTE, pause.start + 1)
    expect(s.kind).toBe("stop")
    expect(s.progress).toBeCloseTo(1 / 3, 6)
  })

  it("steps stop-to-stop in reduced mode without drive samples", () => {
    const red = buildTimeline(STOPS, ROUTE, true)
    for (let t = 0; t < red.total; t += 100) {
      expect(sampleTimeline(red, ROUTE, t).kind).toBe("stop")
    }
  })

  it("handles an empty timeline", () => {
    const empty = buildTimeline([], buildRoute([]))
    expect(sampleTimeline(empty, buildRoute([]), 0).done).toBe(true)
  })
})

describe("legAt", () => {
  it("finds the leg and within-leg fraction", () => {
    expect(legAt(ROUTE, 0)).toEqual({ index: 0, frac: 0 })
    const mid = legAt(ROUTE, 1 / 6)
    expect(mid.index).toBe(0)
    expect(mid.frac).toBeCloseTo(0.5, 6)
    const later = legAt(ROUTE, 2 / 3)
    expect(later.index).toBe(1)
    expect(later.frac).toBeCloseTo(0.5, 6)
  })

  it("clamps to the last leg at t=1 and beyond", () => {
    expect(legAt(ROUTE, 1)).toEqual({ index: 1, frac: 1 })
    expect(legAt(ROUTE, 2)).toEqual({ index: 1, frac: 1 })
  })

  it("handles a degenerate single-point route", () => {
    expect(legAt(buildRoute([[0, 0]]), 0.5)).toEqual({ index: 0, frac: 0 })
  })
})

describe("cumulativeKm", () => {
  it("uses odometer readings when they move forward", () => {
    expect(cumulativeKm(STOPS)).toEqual([0, 120, 360])
  })

  it("falls back to haversine km when a reading is missing", () => {
    const stops = [
      makeStop({ lat: 0, lng: 0, km: 100 }),
      makeStop({ id: "x", lat: 0, lng: 1, km: null }),
    ]
    const [a, b] = cumulativeKm(stops)
    expect(a).toBe(100)
    expect(b).toBeCloseTo(100 + haversine([0, 0], [1, 0]) / 1000, 6)
  })

  it("falls back when the odometer rolls backwards", () => {
    const stops = [
      makeStop({ lat: 0, lng: 0, km: 500 }),
      makeStop({ id: "x", lat: 0, lng: 1, km: 10 }),
    ]
    const [, b] = cumulativeKm(stops)
    expect(b).toBeGreaterThan(500)
  })

  it("returns [] for no stops", () => {
    expect(cumulativeKm([])).toEqual([])
  })
})

describe("kmAtProgress", () => {
  it("reads the endpoints exactly", () => {
    expect(kmAtProgress(STOPS, ROUTE, 0)).toBe(0)
    expect(kmAtProgress(STOPS, ROUTE, 1)).toBe(360)
  })

  it("interpolates within a leg by distance", () => {
    expect(kmAtProgress(STOPS, ROUTE, 1 / 6)).toBe(60)
    expect(kmAtProgress(STOPS, ROUTE, 2 / 3)).toBe(240)
  })

  it("returns 0 for no stops", () => {
    expect(kmAtProgress([], buildRoute([]), 0.5)).toBe(0)
  })
})

describe("dateAtProgress", () => {
  it("reads the endpoints exactly", () => {
    expect(dateAtProgress(STOPS, ROUTE, 0)).toBe("2024-05-01")
    expect(dateAtProgress(STOPS, ROUTE, 1)).toBe("2024-05-07")
  })

  it("interpolates between the bracketing stops", () => {
    expect(dateAtProgress(STOPS, ROUTE, 1 / 6)).toBe("2024-05-02")
    expect(dateAtProgress(STOPS, ROUTE, 2 / 3)).toBe("2024-05-05")
  })

  it("never rolls backwards on out-of-order dates", () => {
    const stops = [
      makeStop({ lat: 0, lng: 0, date: "2024-05-10" }),
      makeStop({ id: "x", lat: 0, lng: 1, date: "2024-05-01" }),
    ]
    const route = buildRoute(stops.map((s) => [s.lng, s.lat]))
    expect(dateAtProgress(stops, route, 0.5)).toBe("2024-05-10")
  })

  it("returns empty for no stops", () => {
    expect(dateAtProgress([], buildRoute([]), 0)).toBe("")
  })
})

describe("stampCrossings", () => {
  it("stamps every stop whose code differs from the previous one", () => {
    const stops = [
      makeStop({ code: "NL", country: "Nederland", flag: "🇳🇱" }),
      makeStop({ id: "x", code: "NL", country: "Nederland", flag: "🇳🇱" }),
      makeStop({ id: "y", code: "FR", country: "Frankrijk", flag: "🇫🇷" }),
      makeStop({ id: "z", code: "FR", country: "Frankrijk", flag: "🇫🇷" }),
      makeStop({ id: "w", code: "ES", country: "Spanje", flag: "🇪🇸" }),
    ]
    expect(stampCrossings(stops)).toEqual([
      { index: 2, code: "FR", flag: "🇫🇷", country: "Frankrijk" },
      { index: 4, code: "ES", flag: "🇪🇸", country: "Spanje" },
    ])
  })

  it("never stamps the first stop", () => {
    expect(stampCrossings([makeStop({ code: "NL" })])).toEqual([])
  })

  it("skips stops with an empty code", () => {
    const stops = [
      makeStop({ code: "NL" }),
      makeStop({ id: "x", code: "" }),
      makeStop({ id: "y", code: "NL" }),
    ]
    // "" is not a crossing, and NL after "" stamps because the code changed
    expect(stampCrossings(stops).map((c) => c.index)).toEqual([2])
  })
})

describe("dampenBearing", () => {
  it("keeps small headings as-is", () => {
    expect(dampenBearing(10)).toBe(10)
    expect(dampenBearing(350)).toBe(-10)
  })

  it("caps the turn at the maximum in both directions", () => {
    expect(dampenBearing(90)).toBe(MAX_CAM_TURN_DEG)
    expect(dampenBearing(270)).toBe(-MAX_CAM_TURN_DEG)
    expect(dampenBearing(181)).toBe(-MAX_CAM_TURN_DEG)
  })
})

describe("bearingDelta", () => {
  it("takes the short way around the circle", () => {
    expect(bearingDelta(350, 10)).toBe(20)
    expect(bearingDelta(10, 350)).toBe(-20)
    expect(bearingDelta(0, 90)).toBe(90)
    expect(bearingDelta(-25, 25)).toBe(50)
  })
})
