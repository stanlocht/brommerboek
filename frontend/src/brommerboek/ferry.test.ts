import { describe, expect, it } from "vitest"
import { ferryAt, ferryLegs, legKey, midpoint, routeSegments } from "./ferry"
import type { LngLat } from "./geo"
import { buildRoute } from "./geo"
import type { Stop } from "./types"
import { splitByWater, waterProbe } from "./water"

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
    // Nobody has cut this leg at the coastline yet, so the whole of it — the
    // first half of the route — counts as the crossing.
    expect(legs[0].crossings).toHaveLength(1)
    expect(legs[0].crossings[0].from).toBeCloseTo(0, 6)
    expect(legs[0].crossings[0].to).toBeCloseTo(0.5, 6)
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

// A → B with the sea in its middle third: the rider rides to the port,
// sails, and rides off the boat again.
const MID_SEA = waterProbe([
  [
    [
      [0.7, -1],
      [1.3, -1],
      [1.3, 1],
      [0.7, 1],
      [0.7, -1],
    ],
  ],
])

function splitFor(from: Stop, to: Stop, points: LngLat[]) {
  return new Map([[legKey(from, to, points), splitByWater(points, MID_SEA)]])
}

describe("a crossing cut at the coastline", () => {
  const from = A
  const to = { ...B, ferry: true }
  const stops = [from, to]
  const route = routeFor(stops)
  const splits = splitFor(from, to, [
    [0, 0],
    [2, 0],
  ])

  it("keeps the ride to the port red and only the sea blue", () => {
    const segments = routeSegments(stops, route, splits)
    expect(segments.map((s) => s.ferry)).toEqual([false, true, false])
    // The road stops at the coast (lng 0.7) and picks up again at lng 1.3.
    const road = segments[0].points
    expect(road[road.length - 1][0]).toBeCloseTo(0.7, 2)
    expect(segments[1].points[0][0]).toBeCloseTo(0.7, 2)
    expect(segments[2].points[0][0]).toBeCloseTo(1.3, 2)
    expect(segments[2].points[segments[2].points.length - 1]).toEqual([2, 0])
  })

  it("boards the Cub at the quayside, not at the pin", () => {
    const legs = ferryLegs(stops, route, splits)
    expect(legs[0].crossings).toHaveLength(1)
    expect(legs[0].crossings[0].from).toBeCloseTo(0.35, 2)
    expect(legs[0].crossings[0].to).toBeCloseTo(0.65, 2)
    // Ashore on the ride to the port, aboard mid-crossing, ashore after.
    expect(ferryAt(legs, 0.2)).toBeNull()
    expect(ferryAt(legs, 0.5)).not.toBeNull()
    expect(ferryAt(legs, 0.8)).toBeNull()
  })

  it("puts the boat halfway across the water, not halfway along the leg", () => {
    // Same leg, sea in its *first* third: the boat belongs there, not at the
    // midpoint of the whole leg.
    const early = waterProbe([
      [
        [
          [0.1, -1],
          [0.7, -1],
          [0.7, 1],
          [0.1, 1],
          [0.1, -1],
        ],
      ],
    ])
    const points: LngLat[] = [
      [0, 0],
      [2, 0],
    ]
    const legs = ferryLegs(
      stops,
      route,
      new Map([[legKey(from, to, points), splitByWater(points, early)]]),
    )
    expect(legs[0].mid[0]).toBeCloseTo(0.4, 1)
  })

  it("draws the whole leg as sea while the coastline is unknown", () => {
    const segments = routeSegments(stops, route)
    expect(segments.map((s) => s.ferry)).toEqual([true])
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
