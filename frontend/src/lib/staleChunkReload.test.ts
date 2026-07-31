import { describe, expect, it } from "vitest"
import { RELOAD_WINDOW_MS, shouldReloadForStaleChunk } from "./staleChunkReload"

const NOW = 1_800_000_000_000

describe("shouldReloadForStaleChunk", () => {
  describe("with working storage", () => {
    it("reloads when nothing has been tried yet", () => {
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: 0,
          isReloadNavigation: false,
        }),
      ).toBe(true)
    })

    it("does not reload again inside the window", () => {
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: NOW - (RELOAD_WINDOW_MS - 1),
          isReloadNavigation: true,
        }),
      ).toBe(false)
    })

    it("reloads again once the window has passed", () => {
      // A later deploy is a new problem, not the same broken asset.
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: NOW - RELOAD_WINDOW_MS,
          isReloadNavigation: true,
        }),
      ).toBe(true)
    })

    it("ignores the navigation type when storage answered", () => {
      // The recorded timestamp is the more precise signal: a visitor who hit
      // reload themselves should still get the automatic recovery.
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: 0,
          isReloadNavigation: true,
        }),
      ).toBe(true)
    })
  })

  describe("with storage unavailable", () => {
    it("still reloads once on a normal page load", () => {
      // The case that used to lose the recovery entirely (issue #98): the
      // visitor gets the fix rather than a crash screen.
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: null,
          isReloadNavigation: false,
        }),
      ).toBe(true)
    })

    it("refuses when this page load is already a reload", () => {
      // Without storage this is the only loop protection there is.
      expect(
        shouldReloadForStaleChunk({
          now: NOW,
          lastReloadAt: null,
          isReloadNavigation: true,
        }),
      ).toBe(false)
    })
  })
})
