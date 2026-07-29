import { describe, expect, it } from "vitest"
import { notedKm } from "./odometer"

describe("notedKm", () => {
  it("stores the reading the rider typed", () => {
    expect(notedKm(true, "15288")).toBe(15288)
  })

  it("stores nothing while the toggle is off", () => {
    // Even with a number left in the field from before it was switched off.
    expect(notedKm(false, "15288")).toBeNull()
  })

  it("stores nothing for an empty field", () => {
    expect(notedKm(true, "")).toBeNull()
    expect(notedKm(true, "   ")).toBeNull()
  })

  it("never turns junk into a reading", () => {
    // null, not 0 — a 0 would read as a real dial and make the next leg
    // measure as a ride of the moped's entire life.
    expect(notedKm(true, "abc")).toBeNull()
    expect(notedKm(true, "-12")).toBeNull()
  })

  it("keeps a genuine zero on a brand-new moped", () => {
    expect(notedKm(true, "0")).toBe(0)
  })

  it("takes the whole kilometres off a decimal dial", () => {
    expect(notedKm(true, "15288.7")).toBe(15288)
  })
})
