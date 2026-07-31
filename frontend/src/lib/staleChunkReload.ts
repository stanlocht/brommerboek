// Deciding whether to reload the page after a chunk import failed.
//
// A deploy deletes the hashed chunks the open page still refers to, so the
// recovery is simply to reload into the new index.html. The only hard part is
// not doing it forever when an asset is broken for some other reason, which
// means remembering that we already tried — across the reload itself.
//
// sessionStorage is the natural place for that, but reading or writing it can
// throw outright (Safari private browsing, "block all cookies", lockdown-style
// settings). An exception there used to escape the event listener, which
// skipped both the reload and the telemetry suppression: the visitor was left
// on the crash screen *and* it filed an issue about it. So every storage
// access is guarded, and when storage is unavailable the loop protection falls
// back to asking the browser whether this page load is itself a reload —
// which needs no storage at all.

export const RELOAD_WINDOW_MS = 60_000

export interface ReloadEnvironment {
  now: number
  // Milliseconds since epoch of the last reload we triggered, 0 if there was
  // none — or null when storage could not be read at all.
  lastReloadAt: number | null
  // Whether the current page load is itself a reload. Only consulted when
  // storage is unavailable, as the sole defence against a reload loop.
  isReloadNavigation: boolean
}

export function shouldReloadForStaleChunk(env: ReloadEnvironment): boolean {
  if (env.lastReloadAt === null) return !env.isReloadNavigation
  return env.now - env.lastReloadAt >= RELOAD_WINDOW_MS
}

const KEY = "bb-chunk-reload-at"

function readLastReloadAt(): number | null {
  try {
    // Touching the property itself can throw, not just the call.
    const raw = window.sessionStorage.getItem(KEY)
    return Number(raw ?? 0) || 0
  } catch {
    return null
  }
}

function writeLastReloadAt(at: number): void {
  try {
    window.sessionStorage.setItem(KEY, String(at))
  } catch {
    // Unavailable; isReloadNavigation carries the loop protection instead.
  }
}

function isReloadNavigation(): boolean {
  try {
    const [entry] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[]
    return entry?.type === "reload"
  } catch {
    // Unknown: assume it is a reload, so an unrecoverable page stops rather
    // than risks looping.
    return true
  }
}

// Take the right to reload once, recording the attempt. Returns false when a
// reload would risk looping. Never throws: a failure to decide must not take
// the recovery down with it.
export function claimStaleChunkReload(now = Date.now()): boolean {
  try {
    const allowed = shouldReloadForStaleChunk({
      now,
      lastReloadAt: readLastReloadAt(),
      isReloadNavigation: isReloadNavigation(),
    })
    if (allowed) writeLastReloadAt(now)
    return allowed
  } catch {
    return false
  }
}
