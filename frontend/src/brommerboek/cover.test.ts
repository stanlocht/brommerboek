import { describe, expect, it } from "vitest"
import { coverIndex, coverItem } from "./cover"
import type { MediaItem } from "./types"

const item = (url: string | null, cover?: boolean): MediaItem => ({
  tone: "",
  cap: "",
  kind: "image",
  url,
  cover,
})

describe("coverItem", () => {
  it("is undefined without media", () => {
    expect(coverItem(undefined)).toBeUndefined()
    expect(coverItem([])).toBeUndefined()
  })

  it("falls back to the first item when nothing is flagged", () => {
    const media = [item("/media/a.jpg"), item("/media/b.jpg")]
    expect(coverItem(media)).toBe(media[0])
    expect(coverIndex(media)).toBe(0)
  })

  it("uses the flagged item whatever its position", () => {
    const media = [item("/media/a.jpg"), item("/media/b.jpg", true)]
    expect(coverItem(media)).toBe(media[1])
    expect(coverIndex(media)).toBe(1)
  })

  it("skips tone-swatch placeholders when nothing is flagged", () => {
    const media = [item(null), item("/media/b.jpg")]
    expect(coverItem(media)).toBe(media[1])
  })

  it("honours a flagged placeholder over a later real file", () => {
    const media = [item(null, true), item("/media/b.jpg")]
    expect(coverItem(media)).toBe(media[0])
  })
})
