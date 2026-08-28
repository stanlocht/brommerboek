import { describe, expect, it } from "vitest"
import {
  bearing,
  buildRoute,
  haversine,
  type LngLat,
  legKm,
  nearestStop,
  odometerTrusted,
  pointAt,
  routeBounds,
  stopFraction,
} from "./geo"

// Points are [lng, lat].
const AMSTERDAM: LngLat = [4.9041, 52.3676]
const PARIS: LngLat = [2.3522, 48.8566]

describe("odometerTrusted", () => {
  it("accepts any delta that moved forward", () => {
    expect(odometerTrusted(60, 78)).toBe(true)
    expect(odometerTrusted(60, 1)).toBe(true)
  })

  it("rejects a stale reading copied from the previous stop", () => {
    expect(odometerTrusted(62, 0)).toBe(false)
  })

  it("rejects a reading that counts down", () => {
    expect(odometerTrusted(60, -60)).toBe(false)
  })

  it("accepts a dial that stood still between two stops at one spot", () => {
    expect(odometerTrusted(0.2, 0)).toBe(true)
  })

  it("still rejects a countdown at one spot", () => {
    expect(odometerTrusted(0.2, -5)).toBe(false)
  })

  it("rejects a missing reading", () => {
    expect(odometerTrusted(60, null)).toBe(false)
  })
})

describe("legKm", () => {
  it("uses a believable odometer delta over everything else", () => {
    expect(legKm(60, 78, 72)).toBe(78)
  })

  it("falls back to the ridden road when the reading is stale", () => {
    expect(legKm(62, 0, 86)).toBe(86)
  })

  it("falls back to the ridden road when the reading counts down", () => {
    expect(legKm(60, -60, 72)).toBe(72)
  })

  it("falls back to the ridden road when there is no reading", () => {
    expect(legKm(62, null, 86)).toBe(86)
  })

  it("keeps the straight line when the track is shorter than it", () => {
    // A track that doesn't span both pins under-measures the leg.
    expect(legKm(62, null, 10)).toBe(62)
  })

  it("falls back to the straight line when nothing else is usable", () => {
    expect(legKm(62, 0, null)).toBe(62)
  })

  it("counts no kilometres for a crossing", () => {
    // Neither the sea miles between the ports nor the boat's own course
    // were ridden by the Cub.
    expect(legKm(62, null, null, true)).toBe(0)
    expect(legKm(62, null, 86, true)).toBe(0)
    expect(legKm(62, 0, 86, true)).toBe(0)
  })

  it("keeps the ride to the port when the dial moved", () => {
    expect(legKm(62, 40, 86, true)).toBe(40)
  })
})

describe("haversine", () => {
  it("returns 0 for identical points", () => {
    expect(haversine(AMSTERDAM, AMSTERDAM)).toBe(0)
  })

  it("is symmetric", () => {
    expect(haversine(AMSTERDAM, PARIS)).toBeCloseTo(
      haversine(PARIS, AMSTERDAM),
      6,
    )
  })

  it("matches the known Amsterdam–Paris distance (~430 km)", () => {
    const km = haversine(AMSTERDAM, PARIS) / 1000
    expect(km).toBeGreaterThan(425)
    expect(km).toBeLessThan(435)
  })

  it("measures one degree of longitude at the equator (~111.195 km)", () => {
    const oneDegree = (2 * Math.PI * 6371000) / 360
    expect(haversine([0, 0], [1, 0])).toBeCloseTo(oneDegree, 0)
  })
})

describe("bearing", () => {
  it("is 0 (north) heading up a meridian", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it("is 90 (east) along the equator", () => {
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 6)
  })

  it("is 180 (south) heading down a meridian", () => {
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(180, 6)
  })

  it("is 270 (west) along the equator", () => {
    expect(bearing([1, 0], [0, 0])).toBeCloseTo(270, 6)
  })
})

describe("buildRoute with leg tracks", () => {
  it("threads real leg geometry between the stops", () => {
    const route = buildRoute(
      [
        [0, 0],
        [2, 0],
        [4, 0],
      ],
      [[[1, 0]], null],
    )
    expect(route.points).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [4, 0],
    ])
    // Stops sit at vertices 0, 2 and 3; stop-indexed math reads stopCum.
    expect(route.stopCum).toEqual([route.cum[0], route.cum[2], route.cum[3]])
    expect(stopFraction(route, 1)).toBeCloseTo(0.5, 6)
    expect(nearestStop(route, 0.45)).toBe(1)
    expect(nearestStop(route, 1)).toBe(2)
  })

  it("keeps stopCum equal to cum without legs", () => {
    const route = buildRoute([AMSTERDAM, PARIS])
    expect(route.stopCum).toEqual(route.cum)
  })

  it("a detour leg lengthens the route", () => {
    const straight = buildRoute([
      [0, 0],
      [2, 0],
    ])
    const detour = buildRoute(
      [
        [0, 0],
        [2, 0],
      ],
      [[[1, 1]]],
    )
    expect(detour.total).toBeGreaterThan(straight.total)
    // The cub still parks exactly on the pins at the ends.
    expect(pointAt(detour, 0)).toMatchObject({ lng: 0, lat: 0 })
    expect(pointAt(detour, 1)).toMatchObject({ lng: 2, lat: 0 })
  })
})

describe("buildRoute", () => {
  it("accumulates distances along the vertices", () => {
    const route = buildRoute([
      [0, 0],
      [1, 0],
      [3, 0],
    ])
    expect(route.cum[0]).toBe(0)
    expect(route.cum[1]).toBeCloseTo(haversine([0, 0], [1, 0]), 6)
    expect(route.cum[2]).toBeCloseTo(route.total, 6)
    expect(route.total).toBeCloseTo(haversine([0, 0], [1, 0]) * 3, 0)
  })

  it("handles a single point (total 0)", () => {
    const route = buildRoute([AMSTERDAM])
    expect(route.total).toBe(0)
    expect(route.cum).toEqual([0])
  })
})

describe("pointAt", () => {
  const equator = buildRoute([
    [0, 0],
    [1, 0],
    [2, 0],
  ])

  it("returns the first vertex at t=0", () => {
    const p = pointAt(equator, 0)
    expect(p.lng).toBeCloseTo(0, 9)
    expect(p.lat).toBeCloseTo(0, 9)
  })

  it("returns the last vertex at t=1", () => {
    const p = pointAt(equator, 1)
    expect(p.lng).toBeCloseTo(2, 9)
    expect(p.lat).toBeCloseTo(0, 9)
  })

  it("interpolates linearly halfway", () => {
    const p = pointAt(equator, 0.5)
    expect(p.lng).toBeCloseTo(1, 6)
    expect(p.lat).toBeCloseTo(0, 6)
    expect(p.bearing).toBeCloseTo(90, 6)
  })

  it("clamps t outside [0, 1]", () => {
    expect(pointAt(equator, -0.5).lng).toBeCloseTo(0, 9)
    expect(pointAt(equator, 1.5).lng).toBeCloseTo(2, 9)
  })

  it("handles an empty route", () => {
    expect(pointAt(buildRoute([]), 0.5)).toEqual({ lng: 0, lat: 0, bearing: 0 })
  })

  it("handles a single-stop route at any t", () => {
    const single = buildRoute([AMSTERDAM])
    for (const t of [0, 0.5, 1]) {
      expect(pointAt(single, t)).toEqual({
        lng: AMSTERDAM[0],
        lat: AMSTERDAM[1],
        bearing: 0,
      })
    }
  })
})

describe("stopFraction", () => {
  const route = buildRoute([
    [0, 0],
    [1, 0],
    [2, 0],
  ])

  it("is 0 at the first stop and 1 at the last", () => {
    expect(stopFraction(route, 0)).toBe(0)
    expect(stopFraction(route, route.points.length - 1)).toBeCloseTo(1, 9)
  })

  it("is proportional along equal segments", () => {
    expect(stopFraction(route, 1)).toBeCloseTo(0.5, 6)
  })

  it("returns 0 for a zero-length route instead of dividing by zero", () => {
    const single = buildRoute([AMSTERDAM])
    expect(stopFraction(single, 0)).toBe(0)
  })
})

describe("nearestStop", () => {
  const route = buildRoute([
    [0, 0],
    [1, 0],
    [2, 0],
  ])

  it("snaps to the closest vertex fraction", () => {
    expect(nearestStop(route, 0)).toBe(0)
    expect(nearestStop(route, 0.45)).toBe(1)
    expect(nearestStop(route, 0.8)).toBe(2)
    expect(nearestStop(route, 1)).toBe(2)
  })

  it("returns 0 for a single-stop route", () => {
    expect(nearestStop(buildRoute([AMSTERDAM]), 0.7)).toBe(0)
  })
})

describe("routeBounds", () => {
  it("computes the bounding box of the points", () => {
    const [min, max] = routeBounds([AMSTERDAM, PARIS])
    expect(min).toEqual([PARIS[0], PARIS[1]])
    expect(max).toEqual([AMSTERDAM[0], AMSTERDAM[1]])
  })
})
