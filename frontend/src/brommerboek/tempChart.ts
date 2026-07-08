// Pure data prep for the logbook temperature chart: stops in route order on
// the x-axis, weather_temp on the y-axis. Stops without a temperature leave a
// gap in the line (never a zero). Rendering happens in LogboekScreen.

import { dateLabelNL } from "./theme"
import type { Stop } from "./types"
import { weatherIcon } from "./weather"

export type TempChartStop = Pick<
  Stop,
  "date" | "code" | "weather_temp" | "weather_condition"
>

export interface TempChartPoint {
  x: number
  y: number
  temp: number
  // Condition emoji drawn just above the dot; empty when unspecified.
  icon: string
}

export interface TempChartTick {
  y: number
  label: string // e.g. "12°"
}

export interface TempChartLabel {
  x: number
  text: string // e.g. "4 mei"
}

export interface TempChart {
  width: number
  height: number
  // Maximal runs of consecutive stops that have a temperature — each run is
  // one line; a temp-less stop in between breaks the line.
  segments: TempChartPoint[][]
  // One smooth-ish SVG path covering every segment (own M per segment;
  // single-point segments render as a dot only).
  path: string
  ticks: TempChartTick[]
  labels: TempChartLabel[]
}

export const TEMP_CHART_WIDTH = 320
export const TEMP_CHART_HEIGHT = 132

// Inner plot area: room for tick labels left, emoji markers top and date
// labels below the baseline. Exported so the renderer can draw the axes on
// the same frame.
export const TEMP_CHART_PAD = { left: 30, right: 12, top: 20, bottom: 22 }
const PAD = TEMP_CHART_PAD
// Two x-axis labels closer together than this overlap; the later one loses.
const MIN_LABEL_GAP = 40

const r1 = (v: number) => Math.round(v * 10) / 10

// Midpoint-quadratic smoothing: through every point, gently curved between.
function segmentPath(points: TempChartPoint[]): string {
  if (points.length < 2) return ""
  const [first, ...rest] = points
  let d = `M${first.x} ${first.y}`
  if (rest.length === 1) return `${d} L${rest[0].x} ${rest[0].y}`
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i]
    const next = rest[i + 1]
    const endX = i === rest.length - 2 ? next.x : r1((p.x + next.x) / 2)
    const endY = i === rest.length - 2 ? next.y : r1((p.y + next.y) / 2)
    d += ` Q${p.x} ${p.y} ${endX} ${endY}`
  }
  return d
}

// Returns null when fewer than 2 stops carry a temperature — the caller
// falls back to the plain weather list.
export function buildTempChart(
  stops: readonly TempChartStop[],
  width = TEMP_CHART_WIDTH,
  height = TEMP_CHART_HEIGHT,
): TempChart | null {
  const temps = stops
    .map((s) => s.weather_temp)
    .filter((t): t is number => t != null)
  if (temps.length < 2) return null

  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const n = stops.length
  const x = (i: number) =>
    r1(PAD.left + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1)))

  // A flat series still gets a band of ±1° so the line sits mid-chart.
  let lo = Math.min(...temps)
  let hi = Math.max(...temps)
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  const y = (t: number) => r1(PAD.top + ((hi - t) / (hi - lo)) * innerH)

  const segments: TempChartPoint[][] = []
  let run: TempChartPoint[] = []
  stops.forEach((s, i) => {
    if (s.weather_temp == null) {
      if (run.length > 0) segments.push(run)
      run = []
      return
    }
    run.push({
      x: x(i),
      y: y(s.weather_temp),
      temp: s.weather_temp,
      icon: weatherIcon(s.weather_condition),
    })
  })
  if (run.length > 0) segments.push(run)

  const tickValues = [hi, Math.round((lo + hi) / 2), lo]
  const ticks = Array.from(new Set(tickValues)).map((t) => ({
    y: y(t),
    label: `${t}°`,
  }))

  // Sparse date labels: first and last stop take precedence, then country
  // changes that don't crowd an already placed label.
  const labelIdx = [0]
  if (n > 1) labelIdx.push(n - 1)
  for (let i = 1; i < n - 1; i++) {
    if (
      stops[i].code &&
      stops[i - 1].code &&
      stops[i].code !== stops[i - 1].code
    )
      labelIdx.push(i)
  }
  const labels: TempChartLabel[] = []
  for (const i of labelIdx) {
    const lx = x(i)
    if (labels.some((l) => Math.abs(l.x - lx) < MIN_LABEL_GAP)) continue
    labels.push({ x: lx, text: dateLabelNL(stops[i].date, false) })
  }
  labels.sort((a, b) => a.x - b.x)

  return {
    width,
    height,
    segments,
    path: segments.map(segmentPath).filter(Boolean).join(" "),
    ticks,
    labels,
  }
}
