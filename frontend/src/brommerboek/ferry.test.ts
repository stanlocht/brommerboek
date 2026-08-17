import { describe, expect, it } from "vitest"
import { ferryAt, ferryLegs, midpoint, routeSegments } from "./ferry"
import { buildRoute } from "./geo"
import type { Stop } from "./types"

let seq = 0
function makeStop(overrides: Partial<Stop>): Stop {
  seq += 1
  return {
    id: `stop-${seq}`,
    order_index: seq,
    place: `Plaats ${seq}`,
    country: "Nederland",
    flag: "🇳🇱",
    code: "NL",
    lat: 0,
    lng: 0,
    date: "2024-05-04",
    title: `Stop ${seq}`,
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
    ...overrides,
  }
}

// Three stops in a row on the equator: A —— B —— C, each leg the same length.
const A = makeStop({ place: "A", lng: 0 })
const B = makeStop({ place: "B", lng: 2 })
const C = makeStop({ place: "C", lng: 4 })

function routeFor(stops: Stop[], legs?: ([number, number][] | null)[]) {
  return buildRoute(
    stops.map((s) => [s.lng, s.lat] as [number, number]),
    legs,
  )
}

describe("ferryLegs", () => {
  it("finds nothing on an all-road route", () => {
    const stops = [A, B, C]
    expect(ferryLegs(stops, routeFor(stops))).toEqual([])
  })

  it("reads the flag off the arrival stop", () => {
    const stops = [A, { ...B, ferry: true }, C]
    const legs = ferryLegs(stops, routeFor(stops))
    expect(legs).toHaveLength(1)
    expect(legs[0].index).toBe(1)
    // A → B is the first half of the route.
    expect(legs[0].from).toBeCloseTo(0, 6)
    expect(legs[0].to).toBeCloseTo(0.5, 6)
    expect(legs[0].mid[0]).toBeCloseTo(1, 6)
  })

  it("follows the sailed track when one was synced", () => {
    const stops = [A, { ...B, ferry: true }]
    // The boat swung north on its way across.
    const route = routeFor(stops, [[[1, 1]]])
    const legs = ferryLegs(stops, route)
    expect(legs[0].points).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ])
    expect(legs[0].mid[1]).toBeCloseTo(1, 6)
  })

  it("gives up when the stops and the route disagree", () => {
    const stops = [A, { ...B, ferry: true }, C]
    expect(ferryLegs(stops, routeFor([A, B]))).toEqual([])
  })
})

describe("routeSegments", () => {
  it("keeps an all-road route in one piece", () => {
    const stops = [A, B, C]
    const segments = routeSegments(stops, routeFor(stops))
    expect(segments).toHaveLength(1)
    expect(segments[0].ferry).toBe(false)
    expect(segments[0].points).toHaveLength(3)
  })

  it("splits at the port and shares the pin, so the line has no gap", () => {
    const stops = [A, { ...B, ferry: true }, C]
    const segments = routeSegments(stops, routeFor(stops))
    expect(segments.map((s) => s.ferry)).toEqual([true, false])
    expect(segments[0].points).toEqual([
      [0, 0],
      [2, 0],
    ])
    expect(segments[1].points).toEqual([
      [2, 0],
      [4, 0],
    ])
  })

  it("keeps consecutive crossings in one stretch", () => {
    const stops = [A, { ...B, ferry: true }, { ...C, ferry: true }]
    const segments = routeSegments(stops, routeFor(stops))
    expect(segments).toHaveLength(1)
    expect(segments[0].ferry).toBe(true)
  })

  it("falls back to one ridden line when the geometry doesn't match", () => {
    const stops = [A, { ...B, ferry: true }, C]
    const segments = routeSegments(stops, routeFor([A, B]))
    expect(segments).toEqual([
      {
        points: [
          [0, 0],
          [2, 0],
        ],
        ferry: false,
      },
    ])
  })
})

describe("ferryAt", () => {
  const stops = [A, { ...B, ferry: true }, C]
  const legs = ferryLegs(stops, routeFor(stops))

  it("is on the boat mid-crossing", () => {
    expect(ferryAt(legs, 0.25)).not.toBeNull()
  })

  it("is ashore at either port and on the road after", () => {
    expect(ferryAt(legs, 0)).toBeNull()
    expect(ferryAt(legs, 0.5)).toBeNull()
    expect(ferryAt(legs, 0.75)).toBeNull()
  })
})

describe("midpoint", () => {
  it("measures by distance, not by vertex count", () => {
    // Three quarters of the line sits in the first segment, so the halfway
    // point lands inside it rather than on the shared vertex.
    const mid = midpoint([
      [0, 0],
      [3, 0],
      [4, 0],
    ])
    expect(mid[0]).toBeCloseTo(2, 6)
  })

  it("survives a degenerate line", () => {
    expect(midpoint([])).toEqual([0, 0])
    expect(midpoint([[1, 2]])).toEqual([1, 2])
  })
})
