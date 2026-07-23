import { describe, expect, it } from "vitest"
import { draftFromFlag, parseFlagDraft } from "./flagEdit"
import type { MapFlag } from "./types"

const tanger: MapFlag = {
  kind: "finish",
  lat: 35.7595,
  lng: -5.834,
  label: "Tanger",
}

describe("draftFromFlag", () => {
  it("stringifies the coordinates for the inputs", () => {
    expect(draftFromFlag(tanger)).toEqual({
      kind: "finish",
      lat: "35.7595",
      lng: "-5.834",
      label: "Tanger",
    })
  })
})

describe("parseFlagDraft", () => {
  it("round-trips a valid draft", () => {
    expect(parseFlagDraft(draftFromFlag(tanger))).toEqual({
      lat: 35.7595,
      lng: -5.834,
      label: "Tanger",
    })
  })

  it("accepts a Dutch decimal comma and stray whitespace", () => {
    expect(
      parseFlagDraft({
        kind: "start",
        lat: " 52,3676 ",
        lng: "4,9041",
        label: "",
      }),
    ).toEqual({ lat: 52.3676, lng: 4.9041, label: "" })
  })

  it("trims the label", () => {
    expect(
      parseFlagDraft({ kind: "start", lat: "52", lng: "4", label: "  Dam  " }),
    ).toEqual({ lat: 52, lng: 4, label: "Dam" })
  })

  it("rejects empty or non-numeric coordinates", () => {
    expect(
      parseFlagDraft({ kind: "start", lat: "", lng: "4", label: "" }),
    ).toBeNull()
    expect(
      parseFlagDraft({ kind: "start", lat: "52", lng: "", label: "" }),
    ).toBeNull()
    expect(
      parseFlagDraft({ kind: "start", lat: "abc", lng: "4", label: "" }),
    ).toBeNull()
  })

  it("rejects out-of-range coordinates", () => {
    expect(
      parseFlagDraft({ kind: "start", lat: "91", lng: "0", label: "" }),
    ).toBeNull()
    expect(
      parseFlagDraft({ kind: "start", lat: "-91", lng: "0", label: "" }),
    ).toBeNull()
    expect(
      parseFlagDraft({ kind: "start", lat: "0", lng: "181", label: "" }),
    ).toBeNull()
    expect(
      parseFlagDraft({ kind: "start", lat: "0", lng: "-181", label: "" }),
    ).toBeNull()
  })
})
