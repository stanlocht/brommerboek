import { describe, expect, it } from "vitest"
import type { WeatherCondition } from "./types"
import { WEATHER_OPTIONS, weatherIcon, weatherLabel } from "./weather"

describe("weatherLabel", () => {
  it("renders a known condition with temperature", () => {
    expect(weatherLabel("sunny", 17)).toBe("Zon, 17°")
    expect(weatherLabel("rain", 13)).toBe("Regen, 13°")
    expect(weatherLabel("partly", -2)).toBe("Halfbewolkt, -2°")
  })

  it("renders just the condition when temperature is null", () => {
    expect(weatherLabel("snow", null)).toBe("Sneeuw")
  })

  it("renders just the temperature for the unspecified condition", () => {
    expect(weatherLabel("", 21)).toBe("21°")
  })

  it("renders 0° (zero is a real temperature, not missing)", () => {
    expect(weatherLabel("fog", 0)).toBe("Mist, 0°")
  })

  it("returns an empty string when nothing is known", () => {
    expect(weatherLabel("", null)).toBe("")
  })

  it("ignores unknown condition codes gracefully", () => {
    expect(weatherLabel("hail" as WeatherCondition, 5)).toBe("5°")
    expect(weatherLabel("hail" as WeatherCondition, null)).toBe("")
  })

  it("has a label for every picker option", () => {
    for (const opt of WEATHER_OPTIONS) {
      expect(weatherLabel(opt.code, null)).toBe(opt.label)
    }
  })
})

describe("weatherIcon", () => {
  it("returns the emoji for a known code", () => {
    expect(weatherIcon("sunny")).toBe("☀️")
    expect(weatherIcon("storm")).toBe("⛈️")
  })

  it("returns an empty string for unknown or unspecified codes", () => {
    expect(weatherIcon("")).toBe("")
    expect(weatherIcon("hail" as WeatherCondition)).toBe("")
  })
})
