import { describe, expect, it } from "vitest"
import {
  isExtensionError,
  isForeignError,
  isForeignStack,
} from "./errorProvenance"

const ORIGIN = "https://brommerboek.nl"

const withStack = (name: string, message: string, stack: string) => {
  const error = new Error(message)
  error.name = name
  error.stack = stack
  return error
}

describe("isForeignStack", () => {
  describe("ours", () => {
    it("recognises a frame from our bundle", () => {
      const stack = [
        "TypeError: Cannot read properties of null (reading 'getSource')",
        "    at ga.getSource (https://brommerboek.nl/assets/index-DfpJPzI3.js:800:112478)",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })

    it("recognises a worker we spawned ourselves", () => {
      expect(
        isForeignStack(
          "at worker (blob:https://brommerboek.nl/2b1c-4f)",
          ORIGIN,
        ),
      ).toBe(false)
    })

    it("keeps a mixed stack that touches our bundle anywhere", () => {
      const stack = [
        "nh@",
        "at https://brommerboek.nl/assets/index-Dk_AKzKE.js:2:1",
        "@https://brommerboek.nl/:415:45",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })

    it("does not treat a bare message as a stack", () => {
      // Some engines hand back only the header line. No frames, nothing to
      // attribute — that must not read as foreign.
      expect(isForeignStack("TypeError: Type error", ORIGIN)).toBe(false)
      expect(isForeignStack("", ORIGIN)).toBe(false)
    })

    it("judges each origin on its own terms", () => {
      const stack = "at https://pr-95.brommerboek.nl/assets/index-abc.js:2:1"
      expect(isForeignStack(stack, "https://pr-95.brommerboek.nl")).toBe(false)
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
    })
  })

  describe("not ours", () => {
    it("catches code injected inline into the document", () => {
      // #110: index.html is 48 lines with no inline script, so a frame at
      // line 415 of the document is injected code.
      const stack = ["nh@", "mh@", "@https://brommerboek.nl/:415:45"].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
    })

    it("catches the media extension that keeps reporting", () => {
      // #124 verbatim — the fourth sighting of this one, after #75, #119
      // and #120. Frames name nothing, so none of them are ours.
      const stack = [
        "sortedTrackListForMenu@[native code]",
        "_canPickAudioTracks@",
        "syncControl@",
        "handleEvent@",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
    })

    it("catches extensions and other hosts by scheme", () => {
      expect(
        isForeignStack("at f (chrome-extension://abc/inject.js:1:220)", ORIGIN),
      ).toBe(true)
      expect(
        isForeignStack(
          "at t (https://cdn.example.com/tracker.js:1:9000)",
          ORIGIN,
        ),
      ).toBe(true)
    })
  })
})

describe("isExtensionError", () => {
  it("catches a WebExtension messaging failure", () => {
    // #123: nothing in this app talks to `runtime`.
    expect(
      isExtensionError(
        new Error("Invalid call to runtime.sendMessage(). Tab not found."),
      ),
    ).toBe(true)
    expect(isExtensionError(new Error("Extension context invalidated."))).toBe(
      true,
    )
  })

  it("leaves our own errors alone", () => {
    expect(isExtensionError(new Error("Failed to load stops (502)"))).toBe(
      false,
    )
    expect(isExtensionError("runtime.sendMessage")).toBe(false)
  })
})

describe("isForeignError", () => {
  it("keeps reporting an error with no stack", () => {
    // #61 (Object.hasOwn missing on old Safari) had none and was a real bug.
    const error = new Error("Object.hasOwn is not a function")
    error.stack = ""
    expect(isForeignError(error, ORIGIN)).toBe(false)
  })

  it("keeps reporting a stack overflow whatever its frames say", () => {
    // #76: the engine truncates frame information precisely because the
    // stack overflowed, so their silence is not evidence of anything.
    const error = withStack(
      "RangeError",
      "Maximum call stack size exceeded.",
      "Pk@\nNk@\nPk@\nNk@",
    )
    expect(isForeignError(error, ORIGIN)).toBe(false)
  })

  it("skips the media extension", () => {
    const error = withStack(
      "TypeError",
      "Type error",
      "sortedTrackListForMenu@[native code]\n_canPickAudioTracks@\nsyncControl@\nhandleEvent@",
    )
    expect(isForeignError(error, ORIGIN)).toBe(true)
  })

  it("skips a WebExtension error even without a stack", () => {
    const error = new Error(
      "Invalid call to runtime.sendMessage(). Tab not found.",
    )
    error.stack = ""
    expect(isForeignError(error, ORIGIN)).toBe(true)
  })

  it("keeps reporting our own crash", () => {
    const error = withStack(
      "TypeError",
      "x.map is not a function",
      "at f (https://brommerboek.nl/assets/index-abc.js:2:1)",
    )
    expect(isForeignError(error, ORIGIN)).toBe(false)
  })

  it("survives a non-Error rejection", () => {
    expect(isForeignError("boom", ORIGIN)).toBe(false)
    expect(isForeignError(null, ORIGIN)).toBe(false)
  })
})
