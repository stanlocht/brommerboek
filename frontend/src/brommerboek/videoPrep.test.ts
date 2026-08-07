import { describe, expect, it } from "vitest"
import {
  canSkipReencode,
  MAX_VIDEO_SECONDS,
  pickRecordingType,
  shouldReencode,
  videoTargetSize,
} from "./videoPrep"

// The re-encode itself needs a browser with MediaRecorder, so it's covered
// by the Playwright specs. What's checked here are the decisions taken
// around it — the ones that decide whether a clip reaches the stop at all.

describe("videoTargetSize", () => {
  it("caps the longest edge and keeps the aspect ratio", () => {
    expect(videoTargetSize(3840, 2160)).toEqual({ w: 1280, h: 720 })
    expect(videoTargetSize(1080, 1920)).toEqual({ w: 720, h: 1280 })
  })

  it("leaves an already-small frame at its own size", () => {
    expect(videoTargetSize(640, 480)).toEqual({ w: 640, h: 480 })
  })

  it("rounds to even dimensions — odd ones make some Android encoders fail", () => {
    const { w, h } = videoTargetSize(1921, 1081)
    expect(w % 2).toBe(0)
    expect(h % 2).toBe(0)
  })
})

describe("canSkipReencode", () => {
  it("skips a clip that is already small and short", () => {
    expect(canSkipReencode(2 * 1024 * 1024, 8)).toBe(true)
  })

  it("re-encodes a big clip even when it is short", () => {
    expect(canSkipReencode(30 * 1024 * 1024, 5)).toBe(false)
  })

  it("re-encodes a long clip even when it is small", () => {
    expect(canSkipReencode(1024, MAX_VIDEO_SECONDS + 1)).toBe(false)
  })

  it("re-encodes when the duration is unknown", () => {
    // Android recordings turn up with no usable duration often enough that
    // trusting the metadata here would let a 3-minute clip straight through.
    expect(canSkipReencode(1024, Number.NaN)).toBe(false)
    expect(canSkipReencode(1024, Number.POSITIVE_INFINITY)).toBe(false)
    expect(canSkipReencode(1024, 0)).toBe(false)
  })
})

describe("pickRecordingType", () => {
  it("prefers MP4 — iOS Safari plays no WebM", () => {
    const type = pickRecordingType(() => true)
    expect(type?.ext).toBe("mp4")
  })

  it("falls back to WebM when MP4 recording isn't supported", () => {
    const type = pickRecordingType((mime) => mime.startsWith("video/webm"))
    expect(type?.ext).toBe("webm")
  })

  it("returns null when the browser can't record at all", () => {
    expect(pickRecordingType(() => false)).toBeNull()
  })
})

describe("shouldReencode", () => {
  it("always re-encodes to MP4", () => {
    expect(shouldReencode({ mime: "video/mp4", ext: "mp4" }, false)).toBe(true)
  })

  it("only re-encodes to WebM when the original would be refused anyway", () => {
    // A WebM re-encode uploads fine and then shows a black box on iPhones,
    // so it's only worth it when the alternative is no clip at all.
    const webm = { mime: "video/webm", ext: "webm" } as const
    expect(shouldReencode(webm, false)).toBe(false)
    expect(shouldReencode(webm, true)).toBe(true)
  })
})
