import { describe, expect, it } from "vitest"
import {
  BPM,
  beatSeconds,
  midiToFreq,
  notesInWindow,
  TUNE,
  TUNE_BEATS,
  type TuneNote,
} from "./replayMusic"

describe("midiToFreq", () => {
  it("puts concert A where it belongs", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9)
  })

  it("doubles every octave", () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 9)
    expect(midiToFreq(57)).toBeCloseTo(220, 9)
  })
})

describe("beatSeconds", () => {
  it("derives the beat length from the tempo", () => {
    expect(beatSeconds(120)).toBeCloseTo(0.5, 9)
    expect(beatSeconds()).toBeCloseTo(60 / BPM, 9)
  })
})

describe("TUNE", () => {
  it("stays inside the loop and has both voices", () => {
    expect(TUNE.length).toBeGreaterThan(0)
    for (const n of TUNE) {
      expect(n.beat).toBeGreaterThanOrEqual(0)
      expect(n.beat).toBeLessThan(TUNE_BEATS)
      expect(n.dur).toBeGreaterThan(0)
    }
    expect(TUNE.some((n) => n.voice === "lead")).toBe(true)
    expect(TUNE.some((n) => n.voice === "bass")).toBe(true)
  })
})

describe("notesInWindow", () => {
  const tune: TuneNote[] = [
    { beat: 0, midi: 60, dur: 1, voice: "lead" },
    { beat: 1.5, midi: 62, dur: 0.5, voice: "lead" },
    { beat: 3, midi: 43, dur: 0.5, voice: "bass" },
  ]

  it("returns one loop's notes in order", () => {
    expect(notesInWindow(0, 4, tune, 4).map((n) => n.beat)).toEqual([0, 1.5, 3])
  })

  it("is half-open, so a note is never scheduled twice", () => {
    const first = notesInWindow(0, 1.5, tune, 4).map((n) => n.beat)
    const second = notesInWindow(1.5, 3, tune, 4).map((n) => n.beat)
    expect(first).toEqual([0])
    expect(second).toEqual([1.5])
  })

  it("keeps counting across the loop seam", () => {
    expect(notesInWindow(3, 6, tune, 4).map((n) => n.beat)).toEqual([3, 4, 5.5])
  })

  it("spans several loops at once", () => {
    expect(notesInWindow(0, 12, tune, 4)).toHaveLength(9)
  })

  it("returns nothing for an empty or backwards window", () => {
    expect(notesInWindow(2, 2, tune, 4)).toEqual([])
    expect(notesInWindow(4, 1, tune, 4)).toEqual([])
  })

  it("plays the real tune end to end without gaps or repeats", () => {
    const all = notesInWindow(0, TUNE_BEATS)
    expect(all).toHaveLength(TUNE.length)
    const seam = notesInWindow(TUNE_BEATS - 0.5, TUNE_BEATS + 0.5)
    expect(seam.every((n) => n.beat >= TUNE_BEATS - 0.5)).toBe(true)
  })
})
