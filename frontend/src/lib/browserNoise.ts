// Error events that announce no defect.
//
// `window.onerror` does not only fire for crashes. Browsers also route a
// handful of housekeeping notices through it — things that carry no Error
// object, no stack and no location, because there is nothing to point at. They
// look like crashes in the tracker and cannot be triaged, because the browser
// has handed us nothing to triage.
//
// The shape is always the same: `event.error` is null and the message is one
// of a small set of fixed strings. That pairing is what makes these safe to
// drop — a real crash always brings its Error along.

// "Script error." is what a cross-origin script's exception is masked to. We
// bundle everything same-origin, so this is always someone else's code, and
// the browser has deliberately withheld every detail of it.
//
// The ResizeObserver notices (#137) are fired when a callback changed layout
// in a way that queued more observations than the loop budget allows. The
// browser's own remedy is to deliver them on the next frame instead; nothing
// is broken and nothing is lost. We register no ResizeObserver ourselves —
// this comes from maplibre watching the map container — so there would be
// nothing for us to fix even if there were a stack to read. Both wordings are
// listed: Chromium and Firefox settled on "completed with undelivered
// notifications", older engines on "loop limit exceeded".
const NOTICE_MESSAGES = [
  /^Script error\.?$/,
  /^(Uncaught )?ResizeObserver loop completed with undelivered notifications\.?$/,
  /^(Uncaught )?ResizeObserver loop limit exceeded\.?$/,
]

// Whether an "error" event is one of those notices rather than a defect.
//
// Both halves matter. Without the null check, a genuine crash whose message
// happened to quote one of these strings would be dropped; without the message
// check, every error from a cross-origin script would be.
export function isBrowserNotice(error: unknown, message: string): boolean {
  if (error != null) return false
  return NOTICE_MESSAGES.some((pattern) => pattern.test(message.trim()))
}
