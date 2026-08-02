// Telling our own crashes apart from code that was injected into the page.
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

const URL_IN_FRAME = /[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi

export function isForeignStack(stack: string, origin: string): boolean {
  // Our bundle, or a worker we spawned from it.
  if (stack.includes(`${origin}/assets/`)) return false
  if (stack.includes(`blob:${origin}`)) return false
  // No URL anywhere means the engine didn't say where this came from.
  URL_IN_FRAME.lastIndex = 0
  return URL_IN_FRAME.test(stack)
}
