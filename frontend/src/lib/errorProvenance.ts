// Telling our own crashes apart from code that was injected into the page.
//
// A public site gets a lot of uninvited JavaScript: browser extensions, and
// the in-app browsers of Facebook, Instagram and friends, which inject sizable
// inline scripts. When that code throws, window.onerror and unhandledrejection
// catch it just the same, and it lands in the tracker as an untriageable
// minified message (#75, #110, #119, #120, #123, #124).
//
// The tell is the frame URL. The app ships exactly one script — an external
// module under /assets/ — and index.html carries no inline script whatsoever,
// so every frame of our own code names that bundle. Frames that name nothing,
// or name the document itself, are running code we did not load.
//
// #112 originally demanded a frame URL that existed and wasn't ours, treating
// a URL-less stack as merely unknown. Two things since then justify going
// further: four separate reports arrived with URL-less stacks that were all
// provably the same media-controller extension (they share syncControl /
// handleEvent frames over HTML media APIs), and the no-inline-script fact
// above means our code cannot produce such a stack in the first place.
//
// The caution that motivated the original rule is kept as two explicit
// exemptions rather than dropped — see isForeignError.

// A stack line rather than the "Name: message" header: "    at fn (url)" in
// Chromium, "fn@url" or a bare "@url" in WebKit and Gecko.
const FRAME_LINE = /^\s*(at\s|\S*@)/

function hasFrames(stack: string): boolean {
  return stack.split("\n").some((line) => FRAME_LINE.test(line))
}

export function isForeignStack(stack: string, origin: string): boolean {
  // Our bundle, or a worker we spawned from it.
  if (stack.includes(`${origin}/assets/`)) return false
  if (stack.includes(`blob:${origin}`)) return false
  // Frames that name neither: an extension, an injected inline script, or
  // something else we never loaded.
  return hasFrames(stack)
}

// Errors that name a WebExtension API. These reach us because an extension's
// content script shares the page, and the strings cannot occur in anything
// this app throws — nothing here talks to `runtime`, and no URL we handle
// carries an extension scheme.
const EXTENSION_MESSAGES = [
  "runtime.sendmessage",
  "extension context invalidated",
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
]

export function isExtensionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return EXTENSION_MESSAGES.some((needle) => message.includes(needle))
}

// Whether this error came from code that isn't ours, and so is not a defect
// worth filing. Applied only to the two global handlers; the error boundary
// and the query cache are by definition our own code paths.
export function isForeignError(error: unknown, origin: string): boolean {
  if (!(error instanceof Error)) return false
  if (isExtensionError(error)) return true
  // A stack that overflowed is reported with its frames truncated, so their
  // silence about the origin proves nothing (#76).
  if (error.name === "RangeError") return false
  // No stack at all is not evidence either. #61 (Object.hasOwn missing on old
  // Safari) arrived exactly like that and was a real bug.
  if (!error.stack) return false
  return isForeignStack(error.stack, origin)
}
