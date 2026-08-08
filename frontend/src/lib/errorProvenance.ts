// Telling our own defects apart from everything else that reaches an error
// handler: code injected into the page, and work that was deliberately
// cancelled. Both entry points — the global handlers in telemetry.ts and the
// query-cache handler via queryErrorPolicy.ts — share these predicates, so a
// rule can't end up applied to one path and forgotten on the other. That gap
// is what produced #90 (network errors filtered for axios but not raw fetch)
// and #121 (aborts filtered for queries but not for global rejections).
//
// A public site gets a lot of uninvited JavaScript: browser extensions, and
// the in-app browsers of Facebook, Instagram and friends, which inject sizable
// inline scripts. When that code throws, window.onerror and unhandledrejection
// catch it just the same, and it lands in the tracker as an untriageable
// minified message (issues #75, #110).
//
// The tell is the frame URL. The app ships exactly one script — an external
// module under /assets/ — and index.html carries no inline script at all, so a
// frame pointing at the document itself is by definition not ours.
//
// The rule deliberately demands *positive* evidence of foreign code: a stack
// with no URLs at all, or no stack, keeps reporting. Real bugs have arrived
// looking exactly like that — #61 (Object.hasOwn missing on old Safari) had no
// stack whatsoever, and #76's stack-overflow frames carry no URLs because the
// engine truncates them. Discarding on absence of evidence would have hidden
// both.

// Something cancelled on purpose — a component unmounting mid-request, or a
// dependency dropping work it no longer needs (maplibre aborts its tile
// fetches on every pan). The abort is the cancellation working, never a
// defect, so it is never worth filing. Matched on the name the spec fixes,
// because the message differs per engine: WebKit says "The operation was
// aborted.", Chromium "signal is aborted without reason".
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

const URL_IN_FRAME = /[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi

export function isForeignStack(stack: string, origin: string): boolean {
  // Our bundle, or a worker we spawned from it.
  if (stack.includes(`${origin}/assets/`)) return false
  if (stack.includes(`blob:${origin}`)) return false
  // No URL anywhere means the engine didn't say where this came from.
  URL_IN_FRAME.lastIndex = 0
  return URL_IN_FRAME.test(stack)
}
