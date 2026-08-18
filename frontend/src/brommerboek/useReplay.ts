// Deterministic RAF clock for the "rij de reis" replay. The hook owns the
// timeline and phase machine; it drives the app's existing progress and
// activeIndex state through the provided setters, so the cub marker and
// camera machinery in VintageMap keep working untouched. Everything is
// skippable: Escape, exit() and skipToEnd() work in any phase, and exit()
// restores the exact progress/activeIndex from before the replay started.
//
// The clock advances by clamped frame deltas rather than by wall-clock time
// since the start, so a stalled frame (a tab in the background, a slow tile
// batch, a device waking from sleep) makes the replay pause for a beat
// instead of teleporting the cub down the route.

import { useCallback, useEffect, useRef, useState } from "react"
import { mediaSrc } from "./api"
import type { RouteGeometry } from "./geo"
import {
  type BorderCrossing,
  buildTimeline,
  INTRO_MS,
  photoIndexAt,
  type ReplayTimeline,
  replayPhotos,
  sampleTimeline,
  stampCrossings,
} from "./replayMath"
import { ReplayMusic } from "./replayMusic"
import type { Stop } from "./types"

export type ReplayPhase = "idle" | "intro" | "driving" | "stopped" | "done"

// Longest step the clock will take from one frame to the next. Anything
// bigger was a stall, not elapsed replay time.
const MAX_FRAME_MS = 64
// How many stops ahead the pictures are fetched, so a stop's slideshow is
// already in the browser cache by the time the cub rolls in.
const PREFETCH_AHEAD = 2
const MUTED_KEY = "bb-replay-muted"

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

function storedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1"
  } catch {
    // private-mode Safari and friends: no memory of the choice, no crash
    return false
  }
}

function rememberMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0")
  } catch {
    // ignore — muting still works for this replay
  }
}

// Warm the browser cache for the pictures a stop will show. Fire-and-forget:
// a failed fetch just means the card shows its placeholder tone.
function prefetchStop(stop: Stop | undefined): void {
  if (!stop || typeof Image === "undefined") return
  for (const m of replayPhotos(stop)) {
    if (m.kind === "video") continue
    const src = mediaSrc(m.thumb ?? m.url)
    if (src) new Image().src = src
  }
}

interface Engine {
  timeline: ReplayTimeline
  crossings: Map<number, BorderCrossing>
  photoCounts: number[]
  intro: number
  // Replay time since the start of the intro, in ms.
  elapsed: number
  last: number
  segKey: string
}

export interface ReplayHandle {
  phase: ReplayPhase
  stopIndex: number
  // Which of the current stop's pictures is on screen.
  photoIndex: number
  stamp: BorderCrossing | null
  reduced: boolean
  // False while the user has taken over the map; the timeline keeps running.
  following: boolean
  paused: boolean
  muted: boolean
  start: (saved: { progress: number; activeIndex: number }) => void
  again: () => void
  skipToEnd: () => void
  exit: () => void
  pauseFollow: () => void
  resumeFollow: () => void
  togglePause: () => void
  toggleMute: () => void
}

export default function useReplay({
  stops,
  route,
  setProgress,
  setActiveIndex,
}: {
  stops: Stop[]
  route: RouteGeometry
  setProgress: (p: number) => void
  setActiveIndex: (i: number) => void
}): ReplayHandle {
  const [phase, setPhase] = useState<ReplayPhase>("idle")
  const [stopIndex, setStopIndex] = useState(0)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [stamp, setStamp] = useState<BorderCrossing | null>(null)
  const [following, setFollowing] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(storedMuted)
  const rafRef = useRef<number | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const savedRef = useRef({ progress: 1, activeIndex: 0 })
  const musicRef = useRef<ReplayMusic | null>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  // True while the tab is hidden: the replay is held, and coming back resumes
  // it — unless the user had pressed pause themselves.
  const autoPausedRef = useRef(false)
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const routeRef = useRef(route)
  routeRef.current = route

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopMusic = useCallback(() => {
    musicRef.current?.stop()
    musicRef.current = null
  }, [])

  // The tune fades out as the end card lands — a closing beat, and nothing
  // left playing behind a card the user may leave open.
  const finish = useCallback(() => {
    cancel()
    engineRef.current = null
    stopMusic()
    const n = stopsRef.current.length
    setProgress(1)
    setActiveIndex(n - 1)
    setStopIndex(n - 1)
    setPhotoIndex(0)
    setStamp(null)
    setPaused(false)
    setPhase("done")
  }, [cancel, setProgress, setActiveIndex, stopMusic])

  const frame = useCallback(
    (now: number) => {
      const eng = engineRef.current
      if (!eng) return
      // Clamped delta: a stall costs the replay a beat, never a jump.
      eng.elapsed += Math.min(Math.max(0, now - eng.last), MAX_FRAME_MS)
      eng.last = now
      if (eng.elapsed < eng.intro) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }
      const t = eng.elapsed - eng.intro
      if (t >= eng.timeline.total) {
        finish()
        return
      }
      const s = sampleTimeline(eng.timeline, routeRef.current, t)
      setProgress(s.progress)
      setActiveIndex(s.stopIndex)
      const key = `${s.kind}:${s.stopIndex}`
      if (key !== eng.segKey) {
        eng.segKey = key
        setStopIndex(s.stopIndex)
        setPhotoIndex(0)
        if (s.kind === "stop") {
          setPhase("stopped")
          setStamp(eng.crossings.get(s.stopIndex) ?? null)
          for (let i = 1; i <= PREFETCH_AHEAD; i++)
            prefetchStop(stopsRef.current[s.stopIndex + i])
        } else {
          setPhase("driving")
          setStamp(null)
        }
      }
      if (s.kind === "stop") {
        const count = eng.photoCounts[s.stopIndex] ?? 0
        setPhotoIndex(photoIndexAt(count, s.frac))
      }
      rafRef.current = requestAnimationFrame(frame)
    },
    [finish, setProgress, setActiveIndex],
  )

  const run = useCallback(() => {
    cancel()
    const eng = engineRef.current
    if (!eng) return
    eng.last = performance.now()
    rafRef.current = requestAnimationFrame(frame)
  }, [cancel, frame])

  const begin = useCallback(
    (saved: { progress: number; activeIndex: number } | null) => {
      const curStops = stopsRef.current
      const curRoute = routeRef.current
      if (curStops.length < 2) return
      cancel()
      if (saved) savedRef.current = saved
      const red = prefersReducedMotion()
      engineRef.current = {
        timeline: buildTimeline(curStops, curRoute, red),
        crossings: new Map(stampCrossings(curStops).map((c) => [c.index, c])),
        photoCounts: curStops.map((s) => replayPhotos(s).length),
        intro: red ? 0 : INTRO_MS,
        elapsed: 0,
        last: performance.now(),
        segKey: "",
      }
      autoPausedRef.current = false
      setReduced(red)
      setFollowing(true)
      setPaused(false)
      setStamp(null)
      setStopIndex(0)
      setPhotoIndex(0)
      setPhase("intro")
      setProgress(0)
      setActiveIndex(0)
      for (let i = 0; i <= PREFETCH_AHEAD; i++) prefetchStop(curStops[i])
      // begin() only ever runs from a press (the play button, "opnieuw"), so
      // the audio context starts unblocked.
      stopMusic()
      const music = new ReplayMusic(mutedRef.current)
      musicRef.current = music
      music.start()
      run()
    },
    [cancel, run, setProgress, setActiveIndex, stopMusic],
  )

  const start = useCallback(
    (saved: { progress: number; activeIndex: number }) => begin(saved),
    [begin],
  )
  // Replay again from the end card — keeps the originally saved state so a
  // later exit still restores where the user actually was.
  const again = useCallback(() => begin(null), [begin])

  const skipToEnd = useCallback(() => finish(), [finish])

  const exit = useCallback(() => {
    cancel()
    engineRef.current = null
    stopMusic()
    setProgress(savedRef.current.progress)
    setActiveIndex(savedRef.current.activeIndex)
    setStamp(null)
    setPaused(false)
    setPhase("idle")
  }, [cancel, setProgress, setActiveIndex, stopMusic])

  const setRunning = useCallback(
    (running: boolean) => {
      setPaused(!running)
      musicRef.current?.setPlaying(running)
      if (running) run()
      else cancel()
    },
    [cancel, run],
  )

  const togglePause = useCallback(() => {
    if (!engineRef.current) return
    autoPausedRef.current = false
    setRunning(rafRef.current === null)
  }, [setRunning])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m
      rememberMuted(next)
      musicRef.current?.setMuted(next)
      return next
    })
  }, [])

  const pauseFollow = useCallback(() => setFollowing(false), [])
  const resumeFollow = useCallback(() => setFollowing(true), [])

  // Hold the replay while the tab is in the background — RAF is throttled to
  // a crawl there, and the tune has no business playing over another app.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return
    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current === null) return
        autoPausedRef.current = true
        setRunning(false)
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false
        setRunning(true)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [phase, setRunning])

  useEffect(() => {
    if (phase === "idle") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit()
      if (e.key === " " || e.key === "k") {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, exit, togglePause])

  // Unmount (navigating away mid-replay) must not leave a RAF loop or a tune
  // running behind the next screen.
  useEffect(
    () => () => {
      cancel()
      stopMusic()
    },
    [cancel, stopMusic],
  )

  return {
    phase,
    stopIndex,
    photoIndex,
    stamp,
    reduced,
    following,
    paused,
    muted,
    start,
    again,
    skipToEnd,
    exit,
    pauseFollow,
    resumeFollow,
    togglePause,
    toggleMute,
  }
}
