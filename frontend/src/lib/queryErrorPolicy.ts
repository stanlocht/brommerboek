// What to do with an error that surfaced from a react-query query or mutation.
//
// Kept separate from main.tsx (and free of browser globals) so the rules are
// unit-testable: they decide what does and doesn't become a GitHub issue via
// the error telemetry, and getting them wrong either buries real defects in
// noise or hides them completely.

import { ApiError } from "@/client"

export type QueryErrorDecision =
  | { kind: "logout" }
  | { kind: "ignore"; reason: string }
  | { kind: "report"; context: string }

// A dead or missing token: the caller drops it and sends the visitor to
// /login. (The backend answers an invalid token with 403, not just 401.)
const AUTH_STATUSES = [401, 403]

const endsWith = (suffix: string) => (path: string) => path.endsWith(suffix)
const contains = (part: string) => (path: string) => path.includes(part)

// Requests whose failure is an expected outcome the UI already explains, so
// they are not defects: a mistyped password, an email that already has an
// account, and password recovery while e-mail sending is unconfigured (the
// backend answers that with a deliberate 503 and a human-readable detail).
// Matched narrowly on method + status + path — any other status on the same
// endpoint still reports.
const HANDLED_IN_UI: Array<{
  method: string
  status: number
  matches: (path: string) => boolean
}> = [
  { method: "POST", status: 400, matches: endsWith("/login/access-token") },
  { method: "POST", status: 400, matches: endsWith("/users/signup") },
  { method: "PATCH", status: 400, matches: endsWith("/users/me/password") },
  { method: "POST", status: 503, matches: contains("/password-recovery/") },
]

// The request never reached the API: the visitor is offline, the connection
// dropped, or the page navigated away mid-flight. Nothing here to fix, and
// when the API really is unreachable the report can't be delivered either.
//
// axios (the generated client) reports these as codes; the hand-written fetch
// calls in brommerboek/api.ts reject with a TypeError whose wording is
// per-browser, so those have to be matched on the message.
const NETWORK_CODES = ["ERR_NETWORK", "ERR_CANCELED"]
const NETWORK_MESSAGES = [
  "failed to fetch", // Chromium
  "networkerror when attempting to fetch resource", // Firefox
  "load failed", // Safari
  "network request failed", // older WebKit
]

// Path params can carry personal data (/password-recovery/{email}) — mask
// them, which also keeps one endpoint to one telemetry fingerprint instead of
// one per address.
export function maskPath(url: string, origin: string): string {
  let path = url
  try {
    path = new URL(url, origin).pathname
  } catch {
    // Not a parseable URL; fall back to reporting it verbatim.
  }
  return path
    .split("/")
    .map((seg) =>
      seg.includes("@") || seg.toLowerCase().includes("%40") ? ":email" : seg,
    )
    .join("/")
}

export function classifyQueryError(
  error: unknown,
  origin: string,
): QueryErrorDecision {
  if (error instanceof ApiError && AUTH_STATUSES.includes(error.status)) {
    return { kind: "logout" }
  }

  const code = (error as { code?: string } | null)?.code
  if (code && NETWORK_CODES.includes(code)) {
    return { kind: "ignore", reason: `network (${code})` }
  }
  // A request dropped because the page moved on. The wording differs per
  // engine, so go by the name the spec fixes.
  if (error instanceof Error && error.name === "AbortError") {
    return { kind: "ignore", reason: "aborted" }
  }
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase()
    if (NETWORK_MESSAGES.some((m) => message.includes(m))) {
      return { kind: "ignore", reason: "network (fetch)" }
    }
  }

  if (error instanceof ApiError) {
    const path = maskPath(error.url, origin)
    const handled = HANDLED_IN_UI.some(
      (c) =>
        c.method === error.request.method &&
        c.status === error.status &&
        c.matches(path),
    )
    if (handled) {
      return { kind: "ignore", reason: "answered in the UI" }
    }
    // A bare "ApiError: Bad Request" is untriageable, so name the failing
    // call. Path only: query strings can carry tokens, and their variety
    // would defeat the server-side deduping.
    return { kind: "report", context: `query ${error.request.method} ${path}` }
  }

  return { kind: "report", context: "query" }
}
