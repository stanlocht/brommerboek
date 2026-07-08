import { describe, expect, it } from "vitest"
import {
  buildTempChart,
  TEMP_CHART_HEIGHT,
  TEMP_CHART_PAD,
  TEMP_CHART_WIDTH,
  type TempChartStop,
} from "./tempChart"
import type { WeatherCondition } from "./types"

function stop(
  temp: number | null,
  over: Partial<TempChartStop> = {},
): TempChartStop {
  return {
    date: "2024-05-04",
    code: "NL",
    weather_temp: temp,
    weather_condition: "" as WeatherCondition,
    ...over,
  }
}

const PAD = TEMP_CHART_PAD
const LEFT = PAD.left
const RIGHT = TEMP_CHART_WIDTH - PAD.right
const TOP = PAD.top
const BOTTOM = TEMP_CHART_HEIGHT - PAD.bottom

describe("buildTempChart", () => {
  it("returns null when fewer than 2 stops have a temperature", () => {
    expect(buildTempChart([])).toBeNull()
    expect(buildTempChart([stop(12)])).toBeNull()
    expect(buildTempChart([stop(null), stop(null), stop(null)])).toBeNull()
    expect(buildTempChart([stop(12), stop(null), stop(null)])).toBeNull()
  })

  it("builds a chart once 2 stops have temperatures", () => {
    expect(buildTempChart([stop(12), stop(15)])).not.toBeNull()
    expect(buildTempChart([stop(null), stop(12), stop(15)])).not.toBeNull()
  })

  it("spreads all stops across the inner width in route order", () => {
    const chart = buildTempChart([stop(10), stop(12), stop(14), stop(16)])
    expect(chart).not.toBeNull()
    const xs = chart?.segments.flat().map((p) => p.x) ?? []
    expect(xs[0]).toBe(LEFT)
    expect(xs[xs.length - 1]).toBe(RIGHT)
    // Strictly increasing, evenly spaced.
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 0)
  })

  it("keeps stops without a temp on the x-axis (gap, not reflow)", () => {
    // The temp-less middle stop still occupies its slot: the neighbours sit
    // at 1/3 and 2/3 of the inner width, not squeezed together.
    const chart = buildTempChart([stop(10), stop(null), stop(12), stop(14)])
    const xs = chart?.segments.flat().map((p) => p.x) ?? []
    const step = (RIGHT - LEFT) / 3
    expect(xs).toEqual([LEFT, Math.round((LEFT + 2 * step) * 10) / 10, RIGHT])
  })

  it("maps higher temperatures to smaller y (up on the chart)", () => {
    const chart = buildTempChart([stop(5), stop(25), stop(15)])
    const [a, b, c] = chart?.segments.flat() ?? []
    expect(b.y).toBeLessThan(c.y)
    expect(c.y).toBeLessThan(a.y)
    // Extremes touch the top and bottom of the plot area.
    expect(b.y).toBe(TOP)
    expect(a.y).toBe(BOTTOM)
  })

  it("breaks the line at stops without a temperature", () => {
    const chart = buildTempChart([
      stop(10),
      stop(null),
      stop(20),
      stop(22),
      stop(null),
      stop(18),
    ])
    expect(chart?.segments.map((seg) => seg.length)).toEqual([1, 2, 1])
    expect(chart?.segments.map((seg) => seg.map((p) => p.temp))).toEqual([
      [10],
      [20, 22],
      [18],
    ])
  })

  it("emits no path for single-point segments, dots only", () => {
    const chart = buildTempChart([stop(10), stop(null), stop(20)])
    expect(chart?.segments.flat()).toHaveLength(2)
    expect(chart?.path).toBe("")
  })

  it("draws a straight line for two points and curves through more", () => {
    const two = buildTempChart([stop(10), stop(20)])
    expect(two?.path).toMatch(/^M[\d. ]+ L[\d. ]+$/)
    const more = buildTempChart([stop(10), stop(20), stop(15), stop(18)])
    expect(more?.path.startsWith("M")).toBe(true)
    expect(more?.path).toContain("Q")
    // The curve ends exactly on the last point.
    const points = more?.segments.flat() ?? []
    const last = points[points.length - 1]
    expect(more?.path.endsWith(`${last.x} ${last.y}`)).toBe(true)
  })

  it("pads a flat series so the line sits mid-chart", () => {
    const chart = buildTempChart([stop(10), stop(10), stop(10)])
    const midY = TOP + (BOTTOM - TOP) / 2
    for (const p of chart?.segments.flat() ?? []) {
      expect(p.y).toBe(midY)
    }
    expect(chart?.ticks.map((t) => t.label)).toEqual(["11°", "10°", "9°"])
  })

  it("offers 3 ticks (max, mid, min) with °C labels", () => {
    const chart = buildTempChart([stop(8), stop(20), stop(14)])
    expect(chart?.ticks.map((t) => t.label)).toEqual(["20°", "14°", "8°"])
    const ys = chart?.ticks.map((t) => t.y) ?? []
    expect(ys[0]).toBe(TOP)
    expect(ys[2]).toBe(BOTTOM)
    expect(ys[1]).toBeGreaterThan(ys[0])
    expect(ys[1]).toBeLessThan(ys[2])
  })

  it("dedupes ticks on a tiny temperature range", () => {
    const chart = buildTempChart([stop(10), stop(11)])
    const labels = chart?.ticks.map((t) => t.label) ?? []
    expect(labels).toEqual(Array.from(new Set(labels)))
    expect(labels).toContain("10°")
    expect(labels).toContain("11°")
  })

  it("attaches the condition emoji to dots, empty when unspecified", () => {
    const chart = buildTempChart([
      stop(10, { weather_condition: "sunny" }),
      stop(12),
      stop(14, { weather_condition: "storm" }),
    ])
    expect(chart?.segments.flat().map((p) => p.icon)).toEqual(["☀️", "", "⛈️"])
  })

  it("labels the first and last stop with short Dutch dates", () => {
    const chart = buildTempChart([
      stop(10, { date: "2024-05-04" }),
      stop(12, { date: "2024-05-10" }),
      stop(14, { date: "2024-05-19" }),
    ])
    expect(chart?.labels).toEqual([
      { x: LEFT, text: "4 mei" },
      { x: RIGHT, text: "19 mei" },
    ])
  })

  it("adds a label where the country changes", () => {
    const stops = [
      stop(10, { date: "2024-05-04", code: "NL" }),
      stop(12, { date: "2024-05-06", code: "NL" }),
      stop(14, { date: "2024-05-08", code: "NL" }),
      stop(16, { date: "2024-05-10", code: "BE" }),
      stop(18, { date: "2024-05-12", code: "BE" }),
      stop(20, { date: "2024-05-14", code: "BE" }),
      stop(22, { date: "2024-05-19", code: "BE" }),
    ]
    const chart = buildTempChart(stops)
    expect(chart?.labels.map((l) => l.text)).toEqual([
      "4 mei",
      "10 mei",
      "19 mei",
    ])
  })

  it("drops a country-change label that would crowd the first or last", () => {
    const stops = [
      stop(10, { date: "2024-05-04", code: "NL" }),
      stop(12, { date: "2024-05-05", code: "BE" }),
      stop(14, { date: "2024-05-06", code: "BE" }),
      stop(16, { date: "2024-05-07", code: "BE" }),
      stop(18, { date: "2024-05-08", code: "BE" }),
      stop(20, { date: "2024-05-09", code: "BE" }),
      stop(22, { date: "2024-05-10", code: "BE" }),
      stop(24, { date: "2024-05-11", code: "BE" }),
      stop(26, { date: "2024-05-19", code: "BE" }),
    ]
    const chart = buildTempChart(stops)
    // The NL→BE change at index 1 sits on top of the first label.
    expect(chart?.labels.map((l) => l.text)).toEqual(["4 mei", "19 mei"])
  })

  it("ignores country changes when a code is missing", () => {
    const stops = [
      stop(10, { date: "2024-05-04", code: "NL" }),
      stop(12, { date: "2024-05-06", code: "" }),
      stop(14, { date: "2024-05-08", code: "NL" }),
      stop(16, { date: "2024-05-10", code: "NL" }),
      stop(18, { date: "2024-05-19", code: "NL" }),
    ]
    const chart = buildTempChart(stops)
    expect(chart?.labels.map((l) => l.text)).toEqual(["4 mei", "19 mei"])
  })

  it("carries the requested dimensions", () => {
    const chart = buildTempChart([stop(10), stop(20)], 400, 200)
    expect(chart?.width).toBe(400)
    expect(chart?.height).toBe(200)
    const xs = chart?.segments.flat().map((p) => p.x) ?? []
    expect(xs[1]).toBe(400 - PAD.right)
  })
})
