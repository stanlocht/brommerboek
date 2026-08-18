import { describe, expect, it } from "vitest"
import { buildRoute, haversine } from "./geo"
import {
  bearingDelta,
  buildTimeline,
  cubFacing,
  cumulativeKm,
  dateAtProgress,
  kmAtProgress,
  kmFromCum,
  LEG_MAX_MS,
  LEG_MIN_MS,
  legAt,
  legDurationMs,
  MAX_STOP_PHOTOS,
  PHOTO_DWELL_MS,
  photoIndexAt,
  replayPhotos,
  STOP_PAUSE_MS,
  STOP_PAUSE_STORY_MS,
  sampleTimeline,
  stampCrossings,
  stopPauseMs,
} from "./replayMath"
import type { MediaItem, Stop } from "./types"

function pic(over: Partial<MediaItem> = {}): MediaItem {
  return {
    tone: "",
    cap: "",
    kind: "image",
    url: `/media/x/${Math.random().toString(36).slice(2)}.jpg`,
    ...over,
  }
}

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
    ferry: false,
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

  it("gives every extra picture its own dwell", () => {
    const stop = makeStop({ media: [pic(), pic(), pic()] })
    expect(stopPauseMs(stop)).toBe(STOP_PAUSE_STORY_MS + 2 * PHOTO_DWELL_MS)
  })

  it("does not stretch past the pictures the replay actually shows", () => {
    const many = makeStop({ media: Array.from({ length: 9 }, () => pic()) })
    expect(stopPauseMs(many)).toBe(
      STOP_PAUSE_STORY_MS + (MAX_STOP_PHOTOS - 1) * PHOTO_DWELL_MS,
    )
  })
})

describe("replayPhotos", () => {
  it("puts the rider's cover first and keeps gallery order after it", () => {
    const a = pic({ url: "/a.jpg" })
    const b = pic({ url: "/b.jpg", cover: true })
    const c = pic({ url: "/c.jpg" })
    expect(replayPhotos({ media: [a, b, c] })).toEqual([b, a, c])
  })

  it("skips colour swatches that carry no file", () => {
    const real = pic({ url: "/a.jpg" })
    const swatch = pic({ tone: "#c9a24e", url: null })
    expect(replayPhotos({ media: [swatch, real] })).toEqual([real])
  })

  it("caps the slideshow", () => {
    const media = Array.from({ length: 7 }, () => pic())
    expect(replayPhotos({ media })).toHaveLength(MAX_STOP_PHOTOS)
    expect(replayPhotos({ media }, 2)).toHaveLength(2)
  })

  it("returns nothing for a stop without media", () => {
    expect(replayPhotos({ media: [] })).toEqual([])
  })
})

describe("photoIndexAt", () => {
  it("splits the pause evenly between the pictures", () => {
    expect(photoIndexAt(3, 0)).toBe(0)
    expect(photoIndexAt(3, 0.33)).toBe(0)
    expect(photoIndexAt(3, 0.34)).toBe(1)
    expect(photoIndexAt(3, 0.9)).toBe(2)
  })

  it("never runs past the last picture", () => {
    expect(photoIndexAt(3, 1)).toBe(2)
    expect(photoIndexAt(3, 5)).toBe(2)
    expect(photoIndexAt(1, 0.99)).toBe(0)
    expect(photoIndexAt(0, 0.5)).toBe(0)
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

  it("skips the drive for a zero-distance leg (same-place stops)", () => {
    // Two posts from the same spot, then a real leg — there is nothing to
    // drive between the co-located stops, so that segment takes no time.
    const stops = [
      makeStop({ id: "a", lat: 52.02, lng: 4.87 }),
      makeStop({ id: "b", order_index: 1, lat: 52.02, lng: 4.87 }),
      makeStop({ id: "c", order_index: 2, lat: 52.37, lng: 4.89 }),
    ]
    const route = buildRoute(stops.map((s) => [s.lng, s.lat]))
    const tl = buildTimeline(stops, route)
    const drives = tl.segments.filter((s) => s.kind === "drive")
    expect(drives[0].end - drives[0].start).toBe(0)
    expect(drives[1].end - drives[1].start).toBeGreaterThan(0)
    // The zero-length drive is skipped over, never sampled mid-"drive".
    expect(tl.total).toBe(STOP_PAUSE_MS * 3 + (drives[1].end - drives[1].start))
  })
})

describe("sampleTimeline", () => {
  const tl = buildTimeline(STOPS, ROUTE)

  it("parks at the first stop at t=0", () => {
    expect(sampleTimeline(tl, ROUTE, 0)).toEqual({
      kind: "stop",
      stopIndex: 0,
      progress: 0,
      frac: 0,
      done: false,
    })
  })

  it("reports how far through a stop's pause it is", () => {
    const pause = tl.segments[0]
    const mid = sampleTimeline(tl, ROUTE, (pause.start + pause.end) / 2)
    expect(mid.frac).toBeCloseTo(0.5, 6)
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

  it("matches the pre-built-table form the replay header uses", () => {
    const cum = cumulativeKm(STOPS, ROUTE)
    for (const t of [0, 1 / 6, 0.5, 2 / 3, 1]) {
      expect(kmFromCum(cum, ROUTE, t)).toBe(kmAtProgress(STOPS, ROUTE, t))
    }
    expect(kmFromCum([], ROUTE, 0.5)).toBe(0)
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

  it("ignores preparation posts as stamp and as comparison point", () => {
    const stops = [
      // Prep post abroad (picking up the moped) — never a crossing itself,
      // and the trip's first real stop still doesn't stamp after it.
      makeStop({ code: "DE", type: "preparation" }),
      makeStop({ id: "x", code: "NL" }),
      makeStop({ id: "y", code: "FR", country: "Frankrijk", flag: "🇫🇷" }),
    ]
    expect(stampCrossings(stops).map((c) => c.index)).toEqual([2])
  })
})

describe("cubFacing", () => {
  it("faces the way the route clearly goes", () => {
    expect(cubFacing(90, -1)).toBe(1)
    expect(cubFacing(270, 1)).toBe(-1)
  })

  it("keeps its facing through near-north and near-south headings", () => {
    expect(cubFacing(0, -1)).toBe(-1)
    expect(cubFacing(5, 1)).toBe(1)
    expect(cubFacing(180, 1)).toBe(1)
    expect(cubFacing(184, -1)).toBe(-1)
  })

  it("does not flip back and forth across a wobbling northbound leg", () => {
    let facing: 1 | -1 = 1
    for (const b of [2, 358, 6, 352, 1, 359]) facing = cubFacing(b, facing)
    expect(facing).toBe(1)
  })

  it("normalises headings outside 0..360", () => {
    expect(cubFacing(-90, 1)).toBe(-1)
    expect(cubFacing(450, -1)).toBe(1)
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
