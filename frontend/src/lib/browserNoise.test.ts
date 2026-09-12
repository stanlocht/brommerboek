import { describe, expect, it } from "vitest"
import { isBrowserNotice } from "./browserNoise"

describe("isBrowserNotice", () => {
  it("catches the ResizeObserver notices", () => {
    // #137 verbatim, plus the older wording and the Firefox prefix.
    expect(
      isBrowserNotice(
        null,
        "ResizeObserver loop completed with undelivered notifications.",
      ),
    ).toBe(true)
    expect(isBrowserNotice(null, "ResizeObserver loop limit exceeded")).toBe(
      true,
    )
    expect(
      isBrowserNotice(null, "Uncaught ResizeObserver loop limit exceeded"),
    ).toBe(true)
  })

  it("catches a masked cross-origin error", () => {
    expect(isBrowserNotice(null, "Script error.")).toBe(true)
    expect(isBrowserNotice(null, "Script error")).toBe(true)
    expect(isBrowserNotice(undefined, "  Script error.  ")).toBe(true)
  })

  it("keeps anything that brought an Error along", () => {
    // A real crash always carries its Error. If one ever quotes a notice
    // verbatim it is still ours to look at, because something threw.
    const error = new Error(
      "ResizeObserver loop completed with undelivered notifications.",
    )
    expect(
      isBrowserNotice(
        error,
        "ResizeObserver loop completed with undelivered notifications.",
      ),
    ).toBe(false)
    expect(isBrowserNotice(new Error("Script error."), "Script error.")).toBe(
      false,
    )
  })

  it("keeps our own crashes", () => {
    expect(isBrowserNotice(null, "TypeError: x.map is not a function")).toBe(
      false,
    )
    expect(isBrowserNotice(null, "Failed to load stops (502)")).toBe(false)
    expect(isBrowserNotice(null, "")).toBe(false)
  })

  it("does not match on a mere mention", () => {
    // The patterns are anchored: a message that discusses a notice is not
    // the notice itself.
    expect(
      isBrowserNotice(
        null,
        "Our observer logged: ResizeObserver loop limit exceeded",
      ),
    ).toBe(false)
    expect(
      isBrowserNotice(null, "ResizeObserver loop limit exceeded while drawing"),
    ).toBe(false)
  })
})
