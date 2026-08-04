// Fire-and-forget crash reporting to the backend's /telemetry/errors
// endpoint. Reports are grouped server-side and turned into GitHub issues by
// the error-triage workflow, so broken things surface without anyone having
// to file a storingsdienst report.
//
// Everything here must be inert on failure: reporting an error may never
// throw, loop, or block the UI.

import { isForeignStack } from "./errorProvenance"

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const TELEMETRY_URL = `${BASE}/api/v1/telemetry/errors`

// Client-side backstops on top of the server's rate limit: each distinct
// error is reported once per page load, and a pathological page reports at
// most MAX_REPORTS in total.
const MAX_REPORTS = 15
const reported = new Set<string>()
let sent = 0

// Flipped when the page is about to be torn down on purpose (the stale-chunk
// reload in main.tsx): whatever errors the dying page still produces describe
// the teardown, not a defect, and would file bogus issues.
let suppressed = false

export function suppressErrorReporting(): void {
  suppressed = true
}

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`,
      stack: error.stack ?? "",
    }
  }
  return { message: String(error ?? "Unknown error"), stack: "" }
}

export function reportError(error: unknown, context = ""): void {
  try {
    // Dev servers log to the console; only real builds phone home.
    if (!import.meta.env.PROD) return
    if (suppressed) return
    const { message, stack } = describe(error)
    const prefixed = context ? `[${context}] ${message}` : message
    const key = `${prefixed}\n${stack.split("\n", 2).join("\n")}`
    if (sent >= MAX_REPORTS || reported.has(key)) return
    reported.add(key)
    sent += 1
    void fetch(TELEMETRY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive lets the report survive the page unloading right after a
      // fatal crash.
      keepalive: true,
      body: JSON.stringify({
        message: prefixed.slice(0, 2000),
        stack: stack.slice(0, 20000),
        url: window.location.href.slice(0, 1024),
        release: import.meta.env.VITE_RELEASE ?? "",
      }),
    }).catch(() => {})
  } catch {
    // Telemetry must never be the thing that breaks.
  }
}

// Uninvited code — extensions, and the in-app browsers that inject their own
// inline scripts — throws through these same handlers. Where the stack says
// outright that the code came from somewhere other than our bundle, it is not
// ours to fix and only crowds the tracker.
function isForeign(error: unknown): boolean {
  if (!(error instanceof Error) || !error.stack) return false
  return isForeignStack(error.stack, window.location.origin)
}

// Catch what React and TanStack never see: syntax/runtime errors outside
// components and promise rejections nobody awaited.
export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => {
    // Errors from cross-origin scripts (browser extensions, injected code —
    // we bundle everything same-origin) are masked by the browser to a bare
    // "Script error." with no stack or location. Nothing to act on, so
    // don't let them fill the error tracker.
    if (event.error == null && /^Script error\.?$/.test(event.message)) return
    if (isForeign(event.error)) return
    reportError(event.error ?? event.message, "window.onerror")
  })
  window.addEventListener("unhandledrejection", (event) => {
    if (isForeign(event.reason)) return
    reportError(event.reason, "unhandledrejection")
  })
}
