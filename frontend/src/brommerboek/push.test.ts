import { describe, expect, it } from "vitest"
import {
  type IosEnv,
  isPushSupported,
  needsIosInstall,
  urlBase64ToUint8Array,
} from "./push"

describe("urlBase64ToUint8Array", () => {
  it("decodes plain base64url", () => {
    // "AQAB" = bytes [1, 0, 1] (a classic RSA exponent, easy to eyeball).
    expect(Array.from(urlBase64ToUint8Array("AQAB"))).toEqual([1, 0, 1])
  })

  it("adds missing padding", () => {
    // "TWFu" -> "Man"; strip padding variants decode to the same bytes.
    expect(Array.from(urlBase64ToUint8Array("TWFuTQ"))).toEqual([
      77, 97, 110, 77,
    ])
  })

  it("maps url-safe characters onto their base64 counterparts", () => {
    // 0xfb 0xff encodes as "+/8=" in base64, "-_8" in base64url.
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255])
  })

  it("round-trips a realistic VAPID key length (65-byte P-256 point)", () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 7) % 256)
    let bin = ""
    for (const b of bytes) bin += String.fromCharCode(b)
    const base64url = btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    expect(Array.from(urlBase64ToUint8Array(base64url))).toEqual(
      Array.from(bytes),
    )
  })
})

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36"

function env(overrides: Partial<IosEnv>): IosEnv {
  return {
    userAgent: IPHONE_UA,
    maxTouchPoints: 5,
    standalone: undefined,
    displayModeStandalone: false,
    ...overrides,
  }
}

describe("needsIosInstall", () => {
  it("asks an iPhone Safari tab to install first", () => {
    expect(needsIosInstall(env({}))).toBe(true)
  })

  it("lets an installed iPhone PWA subscribe (navigator.standalone)", () => {
    expect(needsIosInstall(env({ standalone: true }))).toBe(false)
  })

  it("lets an installed PWA subscribe (display-mode: standalone)", () => {
    expect(needsIosInstall(env({ displayModeStandalone: true }))).toBe(false)
  })

  it("detects iPadOS masquerading as macOS via touch points", () => {
    expect(
      needsIosInstall(env({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })),
    ).toBe(true)
  })

  it("leaves real macOS Safari alone", () => {
    expect(
      needsIosInstall(env({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 })),
    ).toBe(false)
  })

  it("leaves Android alone", () => {
    expect(needsIosInstall(env({ userAgent: ANDROID_UA }))).toBe(false)
  })
})

describe("isPushSupported", () => {
  it("is false outside a browser (no window/navigator)", () => {
    // vitest runs in a node environment: the guard must short-circuit
    // instead of throwing on the missing globals.
    expect(isPushSupported()).toBe(false)
  })
})
