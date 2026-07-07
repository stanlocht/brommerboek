import { describe, expect, it } from "vitest"
import { shareUrl, stopIdFromSearch, withoutStopParam } from "./share"

const ID = "0b7f9c1e-5d7a-4a04-9b1e-2f9f6f4c8a11"

describe("shareUrl", () => {
  it("joins origin and id under /s/", () => {
    expect(shareUrl("https://brommerboek.nl", ID)).toBe(
      `https://brommerboek.nl/s/${ID}`,
    )
  })

  it("tolerates a trailing slash on the origin", () => {
    expect(shareUrl("http://localhost:5173/", ID)).toBe(
      `http://localhost:5173/s/${ID}`,
    )
  })
})

describe("stopIdFromSearch", () => {
  it("reads the stop param", () => {
    expect(stopIdFromSearch(`?stop=${ID}`)).toBe(ID)
  })

  it("reads it among other params", () => {
    expect(stopIdFromSearch(`?utm_source=x&stop=${ID}`)).toBe(ID)
  })

  it("returns null when absent", () => {
    expect(stopIdFromSearch("")).toBeNull()
    expect(stopIdFromSearch("?foo=bar")).toBeNull()
  })
})

describe("withoutStopParam", () => {
  it("strips only the stop param", () => {
    expect(
      withoutStopParam(`https://brommerboek.nl/?stop=${ID}&utm_source=x`),
    ).toBe("https://brommerboek.nl/?utm_source=x")
  })

  it("drops the empty query entirely", () => {
    expect(withoutStopParam(`https://brommerboek.nl/?stop=${ID}`)).toBe(
      "https://brommerboek.nl/",
    )
  })

  it("leaves an unrelated URL untouched", () => {
    expect(withoutStopParam("https://brommerboek.nl/?foo=1")).toBe(
      "https://brommerboek.nl/?foo=1",
    )
  })
})
