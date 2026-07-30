import { describe, expect, it } from "vitest"
import { ApiError } from "@/client"
import type { ApiRequestOptions } from "@/client/core/ApiRequestOptions"
import type { ApiResult } from "@/client/core/ApiResult"
import { classifyQueryError, maskPath } from "./queryErrorPolicy"

const ORIGIN = "https://brommerboek.nl"

const apiError = (
  method: ApiRequestOptions["method"],
  url: string,
  status: number,
  statusText = "Error",
) => {
  const request: ApiRequestOptions = { method, url }
  const response: ApiResult = {
    body: undefined,
    ok: false,
    status,
    statusText,
    url: `${ORIGIN}${url}`,
  }
  return new ApiError(request, response, statusText)
}

const classify = (error: unknown) => classifyQueryError(error, ORIGIN)

describe("classifyQueryError", () => {
  it("logs out on a dead token, whether reported as 401 or 403", () => {
    // The backend answers an invalid/expired JWT with 403, not only 401.
    expect(classify(apiError("GET", "/api/v1/users/me", 401)).kind).toBe(
      "logout",
    )
    expect(classify(apiError("GET", "/api/v1/users/me", 403)).kind).toBe(
      "logout",
    )
  })

  it("ignores axios network and cancellation codes", () => {
    for (const code of ["ERR_NETWORK", "ERR_CANCELED"]) {
      const error = Object.assign(new Error("Network Error"), { code })
      expect(classify(error)).toEqual({
        kind: "ignore",
        reason: `network (${code})`,
      })
    }
  })

  it("ignores raw fetch network failures in every browser's wording", () => {
    // brommerboek/api.ts calls fetch directly, so these arrive as a TypeError
    // with no axios code attached (telemetry issue #90 was the Firefox one).
    const messages = [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "Network request failed",
    ]
    for (const message of messages) {
      expect(classify(new TypeError(message))).toEqual({
        kind: "ignore",
        reason: "network (fetch)",
      })
    }
  })

  it("ignores a request aborted because the page moved on", () => {
    const aborted = new Error("signal is aborted without reason")
    aborted.name = "AbortError"
    expect(classify(aborted)).toEqual({ kind: "ignore", reason: "aborted" })
  })

  it("still reports a TypeError that is a real bug, not a network failure", () => {
    expect(classify(new TypeError("x.map is not a function"))).toEqual({
      kind: "report",
      context: "query",
    })
  })

  it("ignores failures the UI already explains to the visitor", () => {
    const handled = [
      apiError("POST", "/api/v1/login/access-token", 400),
      apiError("POST", "/api/v1/users/signup", 400),
      apiError("PATCH", "/api/v1/users/me/password", 400),
      // Deliberate 503 while e-mail sending is unconfigured.
      apiError("POST", "/api/v1/password-recovery/paul@octana.nl", 503),
    ]
    for (const error of handled) {
      expect(classify(error).kind).toBe("ignore")
    }
  })

  it("keeps reporting other statuses on those same endpoints", () => {
    // A 500 from signup or recovery is a genuine defect and must not be
    // swallowed by the expected-outcome filter.
    expect(classify(apiError("POST", "/api/v1/users/signup", 500)).kind).toBe(
      "report",
    )
    expect(
      classify(apiError("POST", "/api/v1/password-recovery/a@b.nl", 500)).kind,
    ).toBe("report")
    // Right status, wrong method.
    expect(
      classify(apiError("POST", "/api/v1/users/me/password", 400)).kind,
    ).toBe("report")
  })

  it("names the failing call so a report is triageable", () => {
    expect(classify(apiError("GET", "/api/v1/trips/42/stops", 500))).toEqual({
      kind: "report",
      context: "query GET /api/v1/trips/42/stops",
    })
  })

  it("keeps email addresses out of the reported context", () => {
    const decision = classify(
      apiError("POST", "/api/v1/password-recovery/paul@octana.nl", 500),
    )
    expect(decision).toEqual({
      kind: "report",
      context: "query POST /api/v1/password-recovery/:email",
    })
  })

  it("falls back to a bare context for non-Api errors", () => {
    expect(classify(new Error("boom"))).toEqual({
      kind: "report",
      context: "query",
    })
  })
})

describe("maskPath", () => {
  it("strips the origin and query string", () => {
    expect(maskPath(`${ORIGIN}/api/v1/stops?token=secret`, ORIGIN)).toBe(
      "/api/v1/stops",
    )
  })

  it("masks both plain and percent-encoded addresses", () => {
    expect(maskPath("/api/v1/password-recovery/paul@octana.nl", ORIGIN)).toBe(
      "/api/v1/password-recovery/:email",
    )
    expect(maskPath("/api/v1/password-recovery/paul%40octana.nl", ORIGIN)).toBe(
      "/api/v1/password-recovery/:email",
    )
  })
})
