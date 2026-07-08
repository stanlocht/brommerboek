// Deterministic RAF clock for the "rij de reis" replay. The hook owns the
// timeline and phase machine; it drives the app's existing progress and
// activeIndex state through the provided setters, so the cub marker and
// camera machinery in VintageMap keep working untouched. Everything is
// skippable: Escape, exit() and skipToEnd() work in any phase, and exit()
// restores the exact progress/activeIndex from before the replay started.

import { useCallback, useEffect, useRef, useState } from "react"
import type { RouteGeometry } from "./geo"
import {
  type BorderCrossing,
  buildTimeline,
  INTRO_MS,
  sampleTimeline,
  stampCrossings,
} from "./replayMath"
import type { Stop } from "./types"

export type ReplayPhase = "idle" | "intro" | "driving" | "stopped" | "done"

export interface ReplayHandle {
  phase: ReplayPhase
  stopIndex: number
  stamp: BorderCrossing | null
  reduced: boolean
  // False while the user has taken over the map; the timeline keeps running.
  following: boolean
  start: (saved: { progress: number; activeIndex: number }) => void
  again: () => void
  skipToEnd: () => void
  exit: () => void
  pauseFollow: () => void
  resumeFollow: () => void
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
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
  const [stamp, setStamp] = useState<BorderCrossing | null>(null)
  const [following, setFollowing] = useState(true)
  const [reduced, setReduced] = useState(false)
  const rafRef = useRef<number | null>(null)
  const savedRef = useRef({ progress: 1, activeIndex: 0 })
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
  useEffect(() => cancel, [cancel])

  const begin = useCallback(
    (saved: { progress: number; activeIndex: number } | null) => {
      const curStops = stopsRef.current
      const curRoute = routeRef.current
      if (curStops.length < 2) return
      cancel()
      if (saved) savedRef.current = saved
      const red = prefersReducedMotion()
      const timeline = buildTimeline(curStops, curRoute, red)
      const crossings = new Map(
        stampCrossings(curStops).map((c) => [c.index, c]),
      )
      const intro = red ? 0 : INTRO_MS
      setReduced(red)
      setFollowing(true)
      setStamp(null)
      setStopIndex(0)
      setPhase("intro")
      setProgress(0)
      setActiveIndex(0)
      const t0 = performance.now()
      let lastKey = ""
      const frame = (now: number) => {
        const elapsed = now - t0
        if (elapsed < intro) {
          rafRef.current = requestAnimationFrame(frame)
          return
        }
        const t = elapsed - intro
        if (t >= timeline.total) {
          rafRef.current = null
          setProgress(1)
          setActiveIndex(curStops.length - 1)
          setStopIndex(curStops.length - 1)
          setStamp(null)
          setPhase("done")
          return
        }
        const s = sampleTimeline(timeline, curRoute, t)
        setProgress(s.progress)
        setActiveIndex(s.stopIndex)
        const key = `${s.kind}:${s.stopIndex}`
        if (key !== lastKey) {
          lastKey = key
          setStopIndex(s.stopIndex)
          if (s.kind === "stop") {
            setPhase("stopped")
            setStamp(crossings.get(s.stopIndex) ?? null)
          } else {
            setPhase("driving")
            setStamp(null)
          }
        }
        rafRef.current = requestAnimationFrame(frame)
      }
      rafRef.current = requestAnimationFrame(frame)
    },
    [cancel, setProgress, setActiveIndex],
  )

  const start = useCallback(
    (saved: { progress: number; activeIndex: number }) => begin(saved),
    [begin],
  )
  // Replay again from the end card — keeps the originally saved state so a
  // later exit still restores where the user actually was.
  const again = useCallback(() => begin(null), [begin])

  const skipToEnd = useCallback(() => {
    cancel()
    const n = stopsRef.current.length
    setProgress(1)
    setActiveIndex(n - 1)
    setStopIndex(n - 1)
    setStamp(null)
    setPhase("done")
  }, [cancel, setProgress, setActiveIndex])

  const exit = useCallback(() => {
    cancel()
    setProgress(savedRef.current.progress)
    setActiveIndex(savedRef.current.activeIndex)
    setStamp(null)
    setPhase("idle")
  }, [cancel, setProgress, setActiveIndex])

  const pauseFollow = useCallback(() => setFollowing(false), [])
  const resumeFollow = useCallback(() => setFollowing(true), [])

  useEffect(() => {
    if (phase === "idle") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, exit])

  return {
    phase,
    stopIndex,
    stamp,
    reduced,
    following,
    start,
    again,
    skipToEnd,
    exit,
    pauseFollow,
    resumeFollow,
  }
}
