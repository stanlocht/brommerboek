import { describe, expect, it } from "vitest"
import { isForeignStack } from "./errorProvenance"

const ORIGIN = "https://brommerboek.nl"

describe("isForeignStack", () => {
  describe("keeps reporting", () => {
    it("a stack from our own bundle", () => {
      const stack = [
        "TypeError: Cannot read properties of null (reading 'getSource')",
        "    at ga.getSource (https://brommerboek.nl/assets/index-DfpJPzI3.js:800:112478)",
        "    at Ee (https://brommerboek.nl/assets/index-DfpJPzI3.js:805:1700)",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })

    it("a stack with no stack at all", () => {
      // Issue #61 (Object.hasOwn missing on old Safari) arrived like this and
      // was a genuine bug.
      expect(isForeignStack("", ORIGIN)).toBe(false)
    })

    it("a stack whose frames carry no URLs", () => {
      // Issue #76's stack overflow: the engine truncates the frames, so there
      // is nothing to attribute. Inconclusive is not the same as foreign.
      const stack = "Pk@\nNk@\nPk@\nNk@\nPk@\nNk@"
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })

    it("a worker we spawned ourselves", () => {
      const stack = "at worker (blob:https://brommerboek.nl/2b1c-4f)"
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })

    it("a mixed stack that touches our bundle anywhere", () => {
      const stack = [
        "nh@",
        "at https://brommerboek.nl/assets/index-Dk_AKzKE.js:2:1",
        "@https://brommerboek.nl/:415:45",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(false)
    })
  })

  describe("skips", () => {
    it("code injected inline into the document", () => {
      // Issue #110, verbatim: index.html is 48 lines and has no inline
      // script, so a frame at line 415 of the document is injected code.
      const stack = [
        "nh@",
        "mh@",
        "jq@",
        "@",
        "anonymous@",
        "@https://brommerboek.nl/:415:45",
      ].join("\n")
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
    })

    it("a browser extension", () => {
      const stack = "at f (chrome-extension://abcdefghijklmnop/inject.js:1:220)"
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
      const safari = "handler@safari-web-extension://1234-5678/content.js:9:1"
      expect(isForeignStack(safari, ORIGIN)).toBe(true)
    })

    it("a script from another host entirely", () => {
      const stack = "at t (https://cdn.example.com/tracker.js:1:9000)"
      expect(isForeignStack(stack, ORIGIN)).toBe(true)
    })
  })

  it("judges each origin on its own terms", () => {
    // Preview deploys run on pr-<n>.brommerboek.nl; their bundle is theirs.
    const stack = "at https://pr-95.brommerboek.nl/assets/index-abc.js:2:1"
    expect(isForeignStack(stack, "https://pr-95.brommerboek.nl")).toBe(false)
    expect(isForeignStack(stack, ORIGIN)).toBe(true)
  })
})
