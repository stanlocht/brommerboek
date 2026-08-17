import { describe, expect, it } from "vitest"
import { deriveStamps } from "./stamps"
import type { Stop } from "./types"

let nextId = 0

function makeStop(partial: Partial<Stop>): Stop {
  nextId += 1
  return {
    id: `stop-${nextId}`,
    order_index: nextId,
    place: "Amsterdam",
    country: "Nederland",
    flag: "🇳🇱",
    code: "NL",
    lat: 52.3676,
    lng: 4.9041,
    date: "2024-05-04",
    title: "Vertrek",
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
    ...partial,
  }
}

describe("deriveStamps", () => {
  it("returns no stamps for an empty trip", () => {
    expect(deriveStamps([])).toEqual([])
  })

  it("collapses a single-country trip into one stamp", () => {
    const stamps = deriveStamps([
      makeStop({ date: "2024-05-04" }),
      makeStop({ place: "Utrecht", date: "2024-05-05" }),
      makeStop({ place: "Maastricht", date: "2024-05-06" }),
    ])
    expect(stamps).toEqual([
      {
        code: "NL",
        flag: "🇳🇱",
        country: "Nederland",
        date: "2024-05-04",
        stops: 3,
      },
    ])
  })

  it("stamps each country once, in route order, with its first date", () => {
    const stamps = deriveStamps([
      makeStop({ code: "NL", country: "Nederland", date: "2024-05-04" }),
      makeStop({
        code: "BE",
        country: "België",
        flag: "🇧🇪",
        date: "2024-05-06",
      }),
      makeStop({
        code: "FR",
        country: "Frankrijk",
        flag: "🇫🇷",
        date: "2024-05-09",
      }),
      makeStop({
        code: "FR",
        country: "Frankrijk",
        flag: "🇫🇷",
        date: "2024-05-11",
      }),
    ])
    expect(stamps.map((s) => s.code)).toEqual(["NL", "BE", "FR"])
    expect(stamps.map((s) => s.date)).toEqual([
      "2024-05-04",
      "2024-05-06",
      "2024-05-09",
    ])
    expect(stamps.map((s) => s.stops)).toEqual([1, 1, 2])
  })

  it("does not add a second stamp when a country is revisited later", () => {
    const stamps = deriveStamps([
      makeStop({ code: "NL", date: "2024-05-04" }),
      makeStop({
        code: "BE",
        country: "België",
        flag: "🇧🇪",
        date: "2024-05-06",
      }),
      makeStop({ code: "NL", place: "Breda", date: "2024-05-08" }),
    ])
    expect(stamps.map((s) => s.code)).toEqual(["NL", "BE"])
    expect(stamps[0]).toMatchObject({ date: "2024-05-04", stops: 2 })
  })

  it("orders by order_index, not array position", () => {
    const stamps = deriveStamps([
      makeStop({
        code: "BE",
        country: "België",
        flag: "🇧🇪",
        date: "2024-05-06",
        order_index: 2,
      }),
      makeStop({ code: "NL", date: "2024-05-04", order_index: 1 }),
    ])
    expect(stamps.map((s) => s.code)).toEqual(["NL", "BE"])
  })

  it("skips stops without a country code", () => {
    const stamps = deriveStamps([makeStop({ code: "", country: "" })])
    expect(stamps).toEqual([])
  })

  it("ignores preparation posts entirely", () => {
    const stamps = deriveStamps([
      // Packing at home two weeks early must not claim NL's arrival date.
      makeStop({ type: "preparation", date: "2024-04-20" }),
      makeStop({ code: "NL", date: "2024-05-04" }),
      makeStop({
        code: "BE",
        country: "België",
        flag: "🇧🇪",
        date: "2024-05-06",
      }),
    ])
    expect(stamps.map((s) => s.code)).toEqual(["NL", "BE"])
    expect(stamps[0]).toMatchObject({ date: "2024-05-04", stops: 1 })
  })
})
