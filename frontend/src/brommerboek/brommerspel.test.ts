import { describe, expect, it } from "vitest"
import {
  BASE_SPEED,
  GRAVITY,
  HIT_PAD,
  JUMP_VELOCITY,
  MAX_SPEED,
  nextGap,
  OBSTACLES,
  overlaps,
  pickObstacle,
  RIDING,
  scoreFor,
  scoreLabel,
  speedAt,
  startJump,
  stepJump,
} from "./brommerspel"

describe("startJump", () => {
  it("launches from the ground with the jump velocity", () => {
    const s = startJump(RIDING)
    expect(s.airborne).toBe(true)
    expect(s.vy).toBe(JUMP_VELOCITY)
  })

  it("ignores a second press while airborne (no double jump)", () => {
    const mid = stepJump(startJump(RIDING), 0.1)
    expect(startJump(mid)).toBe(mid)
  })
})

describe("stepJump", () => {
  it("is a no-op while riding", () => {
    expect(stepJump(RIDING, 0.016)).toBe(RIDING)
  })

  it("rises, peaks and comes back down", () => {
    let s = startJump(RIDING)
    let peak = 0
    for (let i = 0; i < 200 && s.airborne; i++) {
      s = stepJump(s, 0.016)
      peak = Math.min(peak, s.y)
    }
    expect(s).toEqual(RIDING) // landed exactly on the ground
    expect(peak).toBeLessThan(-60) // clears the tallest obstacle (36)
  })

  it("lands in roughly 2·v/g seconds regardless of tick size", () => {
    const expected = (2 * -JUMP_VELOCITY) / GRAVITY
    for (const dt of [0.008, 0.016, 0.033]) {
      let s = startJump(RIDING)
      let t = 0
      while (s.airborne) {
        s = stepJump(s, dt)
        t += dt
      }
      expect(Math.abs(t - expected)).toBeLessThanOrEqual(dt)
    }
  })
})

describe("speedAt", () => {
  it("starts at the base speed and ramps up", () => {
    expect(speedAt(0)).toBe(BASE_SPEED)
    expect(speedAt(10)).toBeGreaterThan(BASE_SPEED)
  })

  it("never exceeds the cap", () => {
    expect(speedAt(10_000)).toBe(MAX_SPEED)
  })
})

describe("nextGap", () => {
  it("always leaves at least a jumpable gap", () => {
    for (const speed of [BASE_SPEED, MAX_SPEED]) {
      for (const rand of [0, 0.5, 0.999]) {
        expect(nextGap(speed, rand)).toBeGreaterThanOrEqual(260)
      }
    }
  })

  it("stretches with speed and randomness", () => {
    expect(nextGap(MAX_SPEED, 0.9)).toBeGreaterThan(nextGap(BASE_SPEED, 0.9))
    expect(nextGap(MAX_SPEED, 0.9)).toBeGreaterThan(nextGap(MAX_SPEED, 0.1))
  })
})

describe("overlaps", () => {
  const cub = { x: 38, y: 150, w: 40, h: 54 }

  it("detects a real collision", () => {
    expect(overlaps(cub, { x: 50, y: 170, w: 20, h: 27 })).toBe(true)
  })

  it("forgives a graze within the padding", () => {
    const grazing = { x: cub.x + cub.w - HIT_PAD, y: 150, w: 20, h: 27 }
    expect(overlaps(cub, grazing)).toBe(false)
  })

  it("misses an obstacle passing under a jump", () => {
    const jumped = { x: 40, y: 60, w: 40, h: 54 } // cub high in the air
    expect(overlaps(jumped, { x: 50, y: 170, w: 20, h: 27 })).toBe(false)
  })
})

describe("pickObstacle", () => {
  it("covers every kind across the random range", () => {
    const kinds = new Set(
      [0, 0.3, 0.6, 0.999, 1].map((r) => pickObstacle(r).kind),
    )
    expect(kinds).toEqual(new Set(OBSTACLES.map((o) => o.kind)))
  })
})

describe("score", () => {
  it("converts distance to points", () => {
    expect(scoreFor(0)).toBe(0)
    expect(scoreFor(199)).toBe(9)
    expect(scoreFor(200)).toBe(10)
  })

  it("renders the dino-style padded label", () => {
    expect(scoreLabel(0)).toBe("00000")
    expect(scoreLabel(42)).toBe("00042")
    expect(scoreLabel(123456)).toBe("123456")
  })
})
