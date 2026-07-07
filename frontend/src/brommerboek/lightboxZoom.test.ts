import { describe, expect, it } from "vitest"
import {
  clampPan,
  clampScale,
  clampZoomState,
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  pinchScale,
  toggleZoom,
  ZOOM_RESET,
  zoomAt,
} from "./lightboxZoom"

const W = 400
const H = 300

describe("clampScale", () => {
  it("passes through values inside the range", () => {
    expect(clampScale(2)).toBe(2)
  })

  it("clamps below MIN_SCALE and above MAX_SCALE", () => {
    expect(clampScale(0.3)).toBe(MIN_SCALE)
    expect(clampScale(9)).toBe(MAX_SCALE)
  })
})

describe("clampPan", () => {
  it("allows no pan at scale 1", () => {
    expect(clampPan(50, W, 1)).toBe(0)
    // Math.max(-0, …) can yield -0 — numerically still "no pan".
    expect(clampPan(-50, W, 1)).toBeCloseTo(0, 12)
  })

  it("bounds pan symmetrically by the overflow at the given scale", () => {
    // At scale 2 a 400px container overflows 400px → ±200px of pan.
    expect(clampPan(500, W, 2)).toBe(200)
    expect(clampPan(-500, W, 2)).toBe(-200)
    expect(clampPan(120, W, 2)).toBe(120)
  })
})

describe("clampZoomState", () => {
  it("clamps scale and both axes together", () => {
    const z = clampZoomState({ scale: 10, x: 9999, y: -9999 }, W, H)
    expect(z.scale).toBe(MAX_SCALE)
    expect(z.x).toBe((W * (MAX_SCALE - 1)) / 2)
    expect(z.y).toBe(-(H * (MAX_SCALE - 1)) / 2)
  })
})

describe("zoomAt", () => {
  it("keeps the focal point stationary", () => {
    // Content point under the focal: c = (p - offset) / scale. After the
    // zoom the same c must map back to p.
    const z = { scale: 1.5, x: 20, y: -10 }
    const [px, py] = [40, 30]
    const out = zoomAt(z, px, py, 3, W, H)
    const cx = (px - z.x) / z.scale
    const cy = (py - z.y) / z.scale
    expect(cx * out.scale + out.x).toBeCloseTo(px, 6)
    expect(cy * out.scale + out.y).toBeCloseTo(py, 6)
  })

  it("zooming about the centre never pans", () => {
    const out = zoomAt(ZOOM_RESET, 0, 0, 2, W, H)
    expect(out).toEqual({ scale: 2, x: 0, y: 0 })
  })

  it("clamps the resulting offset to the pan bounds", () => {
    const out = zoomAt(ZOOM_RESET, -W / 2, -H / 2, MAX_SCALE, W, H)
    expect(Math.abs(out.x)).toBeLessThanOrEqual((W * (MAX_SCALE - 1)) / 2)
    expect(Math.abs(out.y)).toBeLessThanOrEqual((H * (MAX_SCALE - 1)) / 2)
  })
})

describe("toggleZoom", () => {
  it("zooms in on the tapped point from rest", () => {
    const out = toggleZoom(ZOOM_RESET, 100, 50, W, H)
    expect(out.scale).toBe(DOUBLE_TAP_SCALE)
    // The tapped point stays put: c = p at scale 1, so p·s + x = p.
    expect(100 * out.scale + out.x).toBeCloseTo(100, 6)
    expect(50 * out.scale + out.y).toBeCloseTo(50, 6)
  })

  it("resets when already zoomed", () => {
    expect(toggleZoom({ scale: 2, x: 40, y: 40 }, 0, 0, W, H)).toEqual(
      ZOOM_RESET,
    )
  })
})

describe("panBy", () => {
  it("moves by the delta while zoomed", () => {
    expect(panBy({ scale: 2, x: 0, y: 0 }, 30, -20, W, H)).toEqual({
      scale: 2,
      x: 30,
      y: -20,
    })
  })

  it("cannot escape the pan bounds", () => {
    const out = panBy({ scale: 2, x: 190, y: 0 }, 500, 0, W, H)
    expect(out.x).toBe(200)
  })

  it("is a no-op at scale 1", () => {
    expect(panBy(ZOOM_RESET, 30, 40, W, H)).toEqual(ZOOM_RESET)
  })
})

describe("pinchScale", () => {
  it("scales proportionally to the distance ratio", () => {
    expect(pinchScale(1, 100, 200)).toBe(2)
    expect(pinchScale(2, 100, 50)).toBe(1)
  })

  it("clamps to the scale range", () => {
    expect(pinchScale(1, 100, 1000)).toBe(MAX_SCALE)
    expect(pinchScale(1, 100, 1)).toBe(MIN_SCALE)
  })

  it("tolerates a zero start distance", () => {
    expect(pinchScale(2, 0, 100)).toBe(2)
  })
})
