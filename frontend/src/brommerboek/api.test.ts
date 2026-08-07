import { describe, expect, it } from "vitest"
import { isRetryableStatus, mediaSrc } from "./api"
import type { MediaItem } from "./types"

describe("isRetryableStatus", () => {
  it("retries the failures that are about the moment, not the file", () => {
    // A dropped mobile connection surfaces as status 0; 5xx/408/429 are the
    // server having a moment. All of them are worth the same bytes again.
    for (const status of [0, 408, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true)
    }
  })

  it("does not retry a verdict on the file itself", () => {
    // 413 too large, 415 wrong type, 401/403 not allowed, 404 no such stop —
    // re-sending 5 MB over a mobile uplink would change none of them.
    for (const status of [400, 401, 403, 404, 413, 415, 422]) {
      expect(isRetryableStatus(status)).toBe(false)
    }
  })
})

describe("mediaSrc", () => {
  it("returns undefined for a placeholder without a file", () => {
    expect(mediaSrc(null)).toBeUndefined()
    expect(mediaSrc("")).toBeUndefined()
  })

  it("passes absolute URLs through untouched", () => {
    expect(mediaSrc("https://cdn.example/foto.jpg")).toBe(
      "https://cdn.example/foto.jpg",
    )
  })

  it("passes local-preview blob: and data: URLs through untouched", () => {
    const blob = "blob:https://app.example/1234-abcd"
    expect(mediaSrc(blob)).toBe(blob)
    const data = "data:image/png;base64,AAAA"
    expect(mediaSrc(data)).toBe(data)
  })

  it("resolves server-relative media paths", () => {
    expect(mediaSrc("/media/abc/foto.png")).toMatch(/\/media\/abc\/foto\.png$/)
  })

  it("prefers the thumb over the original when present", () => {
    const item: MediaItem = {
      tone: "",
      cap: "",
      kind: "image",
      url: "/media/abc/foto.png",
      thumb: "/media/abc/thumb_foto.webp",
    }
    expect(mediaSrc(item.thumb ?? item.url)).toMatch(/thumb_foto\.webp$/)
  })

  it("falls back to the original for thumb-less items (old uploads, videos)", () => {
    const item: MediaItem = {
      tone: "",
      cap: "",
      kind: "video",
      url: "/media/abc/clip.mp4",
      thumb: null,
    }
    expect(mediaSrc(item.thumb ?? item.url)).toMatch(/clip\.mp4$/)
  })
})
