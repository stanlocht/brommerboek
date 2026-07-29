import { describe, expect, it } from "vitest"
import { buildRoute } from "./geo"
import { legInfo, legLabel } from "./legs"
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
    lat: 52,
    lng: 5,
    date: "2024-05-04",
    title: `Stop ${seq}`,
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
    ...overrides,
  }
}

function routeFor(stops: Stop[]) {
  return buildRoute(stops.map((s) => [s.lng, s.lat]))
}

// Amsterdam → Utrecht → Eindhoven, roughly a straight line south.
const trip = [
  makeStop({
    place: "Amsterdam",
    lat: 52.3676,
    lng: 4.9041,
    date: "2024-05-04",
    km: 0,
  }),
  makeStop({
    place: "Utrecht",
    lat: 52.0907,
    lng: 5.1214,
    date: "2024-05-05",
    km: 55,
  }),
  makeStop({
    place: "Eindhoven",
    lat: 51.4416,
    lng: 5.4697,
    date: "2024-05-08",
    km: 160,
  }),
]
const route = routeFor(trip)

describe("legInfo", () => {
  it("returns null when there is no leg", () => {
    expect(legInfo([], buildRoute([]), 0.5)).toBeNull()
    const single = [trip[0]]
    expect(legInfo(single, routeFor(single), 0.5)).toBeNull()
  })

  it("uses the odometer delta when both stops have km", () => {
    const leg = legInfo(trip, route, 0.1)
    expect(leg).not.toBeNull()
    expect(leg?.from.place).toBe("Amsterdam")
    expect(leg?.to.place).toBe("Utrecht")
    expect(leg?.km).toBe(55)
  })

  it("falls back to haversine when a km reading is missing", () => {
    const stops = [
      makeStop({ place: "Amsterdam", lat: 52.3676, lng: 4.9041, km: 0 }),
      makeStop({ place: "Parijs", lat: 48.8566, lng: 2.3522, km: null }),
    ]
    const leg = legInfo(stops, routeFor(stops), 0.5)
    // Amsterdam–Paris is ~430 km as the crow flies.
    expect(leg?.km).toBeGreaterThan(425)
    expect(leg?.km).toBeLessThan(435)
  })

  it("falls back to haversine when the odometer went backwards", () => {
    const stops = [
      makeStop({ place: "Amsterdam", lat: 52.3676, lng: 4.9041, km: 500 }),
      makeStop({ place: "Parijs", lat: 48.8566, lng: 2.3522, km: 10 }),
    ]
    const leg = legInfo(stops, routeFor(stops), 0.5)
    expect(leg?.km).toBeGreaterThan(425)
    expect(leg?.km).toBeLessThan(435)
  })

  it("ignores two stops noted at the same odometer reading", () => {
    // The reading was copied from the previous stop rather than re-read, so
    // the delta is 0 for a leg that was really ridden. Taking it at face
    // value made the leg vanish; the straight line is the floor instead.
    const stops = [
      makeStop({ place: "Rotterdam", lat: 51.9191, lng: 4.4896, km: 15228 }),
      makeStop({ place: "Wortel", lat: 51.3997, lng: 4.8257, km: 15228 }),
    ]
    const leg = legInfo(stops, routeFor(stops), 0.5)
    expect(leg?.km).toBeGreaterThan(55)
  })

  it("prefers the ridden road over an unbelievable odometer delta", () => {
    // Same leg, but with the real GPS track arcing well off the straight
    // line — the track wins over the great-circle floor.
    const stops = [
      makeStop({ place: "Rotterdam", lat: 51.9191, lng: 4.4896, km: 15228 }),
      makeStop({ place: "Wortel", lat: 51.3997, lng: 4.8257, km: 15228 }),
    ]
    const detour = buildRoute(
      stops.map((s) => [s.lng, s.lat] as [number, number]),
      [[[3.5, 51.7]]],
    )
    const leg = legInfo(stops, detour, 0.5)
    expect(leg?.km).toBeGreaterThan(130)
  })

  it("counts the days between the two stop dates", () => {
    expect(legInfo(trip, route, 0.1)?.days).toBe(1)
    expect(legInfo(trip, route, 0.9)?.days).toBe(3)
  })

  it("clamps days at 0 for out-of-order dates", () => {
    const stops = [
      makeStop({ lat: 52, lng: 5, date: "2024-05-10" }),
      makeStop({ lat: 51, lng: 5, date: "2024-05-04" }),
    ]
    expect(legInfo(stops, routeFor(stops), 0.5)?.days).toBe(0)
  })

  it("gives the first leg at t ≤ 0 and the last at t ≥ 1", () => {
    expect(legInfo(trip, route, 0)?.to.place).toBe("Utrecht")
    expect(legInfo(trip, route, -0.5)?.to.place).toBe("Utrecht")
    expect(legInfo(trip, route, 1)?.from.place).toBe("Utrecht")
    expect(legInfo(trip, route, 1.5)?.to.place).toBe("Eindhoven")
  })

  it("switches legs across the middle stop", () => {
    // Utrecht sits well before halfway (55 of 160 km); just past its
    // fraction the leg is Utrecht → Eindhoven.
    const utrechtT = route.cum[1] / route.total
    expect(legInfo(trip, route, utrechtT - 0.01)?.to.place).toBe("Utrecht")
    expect(legInfo(trip, route, utrechtT + 0.01)?.from.place).toBe("Utrecht")
  })

  it("returns null when stops and route are out of sync", () => {
    expect(legInfo(trip, routeFor(trip.slice(0, 2)), 0.5)).toBeNull()
  })
})

describe("legLabel", () => {
  it("formats place, km and days", () => {
    const leg = legInfo(trip, route, 0.9)
    expect(leg && legLabel(leg)).toBe("Utrecht → Eindhoven · 105 km · 3 dagen")
  })

  it("uses the singular for one day", () => {
    const leg = legInfo(trip, route, 0.1)
    expect(leg && legLabel(leg)).toBe("Amsterdam → Utrecht · 55 km · 1 dag")
  })

  it("omits days for a same-day hop", () => {
    const stops = [
      makeStop({ place: "A", lat: 52, lng: 5, date: "2024-05-04", km: 0 }),
      makeStop({ place: "B", lat: 51, lng: 5, date: "2024-05-04", km: 42 }),
    ]
    const leg = legInfo(stops, routeFor(stops), 0.5)
    expect(leg && legLabel(leg)).toBe("A → B · 42 km")
  })

  it("formats km in Dutch notation", () => {
    const stops = [
      makeStop({ place: "A", lat: 52, lng: 5, date: "2024-05-04", km: 0 }),
      makeStop({ place: "B", lat: 40, lng: 5, date: "2024-05-06", km: 1250 }),
    ]
    const leg = legInfo(stops, routeFor(stops), 0.5)
    expect(leg && legLabel(leg)).toBe("A → B · 1.250 km · 2 dagen")
  })
})
