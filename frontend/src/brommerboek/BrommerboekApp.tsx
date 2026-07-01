import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { UsersService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import "./brommerboek.css"
import AddFlow from "./AddFlow"
import { createStop, fetchStats, fetchStops } from "./api"
import { buildRoute, nearestStop, stopFraction } from "./geo"
import { CubIcon } from "./icons"
import LoginPrompt from "./LoginPrompt"
import MapScreen from "./MapScreen"
import StopSheet from "./StopSheet"
import { C, FONT_MONO } from "./theme"
import { EMPTY_STATS } from "./trip"
import type { NewStop } from "./types"

function CenterState({ text }: { text: string }) {
  return (
    <div
      className="bb-app"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
      }}
    >
      <div className="bb-cub-bob">
        <CubIcon width={70} height={94} />
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ochreDeep }}>
        {text}
      </div>
    </div>
  )
}

export default function BrommerboekApp() {
  const qc = useQueryClient()
  const {
    data: stops,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["stops"],
    queryFn: fetchStops,
  })
  const { data: statsData } = useQuery({
    queryKey: ["stops", "stats"],
    queryFn: fetchStats,
  })
  const stats = statsData ?? EMPTY_STATS
  // Everyone sees the same trip; only superusers get the add/edit affordances.
  // Query only fires when a token is present so a signed-out viewer never
  // triggers a 401 → login redirect.
  const { data: me } = useQuery({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })
  const canEdit = !!me?.is_superuser

  const [activeIndex, setActiveIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [progress, setProgress] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toast, setToast] = useState("")
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jumpLast = useRef(false)
  const progressRef = useRef(progress)
  const animRef = useRef<number | null>(null)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])
  useEffect(
    () => () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    },
    [],
  )

  const route = useMemo(
    () =>
      buildRoute((stops ?? []).map((s) => [s.lng, s.lat] as [number, number])),
    [stops],
  )

  // On first load, park the cub at the latest stop.
  const initedRef = useRef(false)
  useEffect(() => {
    if (!stops || stops.length === 0 || initedRef.current) return
    initedRef.current = true
    setActiveIndex(stops.length - 1)
    setProgress(1)
  }, [stops])

  // After adding a stop, jump to the new latest stop once data refetches.
  useEffect(() => {
    if (!stops || stops.length === 0 || !jumpLast.current) return
    jumpLast.current = false
    setActiveIndex(stops.length - 1)
    setProgress(1)
  }, [stops])

  const createMut = useMutation({
    mutationFn: (s: NewStop) => createStop(s),
    onSuccess: async () => {
      jumpLast.current = true
      // Prefix match — invalidates both ["stops"] and ["stops", "stats"].
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setAddOpen(false)
      flash("✓ Stop toegevoegd aan de route")
    },
    onError: () => flash("Kon de stop niet opslaan"),
  })

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    if (msg) toastTimer.current = setTimeout(() => setToast(""), 2200)
  }
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  if (isLoading) return <CenterState text="de kaart wordt geladen…" />
  if (isError || !stops || stops.length === 0)
    return <CenterState text="kon de reis niet laden — draait de backend?" />

  const cur = stops[activeIndex] ?? stops[0]

  const onLogout = () => {
    localStorage.removeItem("access_token")
    qc.removeQueries({ queryKey: ["currentUser"] })
    flash("uitgelogd")
  }

  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
  }
  const onScrubStart = (p: number) => {
    cancelAnim()
    setDragging(true)
    setProgress(p)
    setActiveIndex(nearestStop(route, p))
  }
  const onScrubMove = (p: number) => {
    setProgress(p)
    setActiveIndex(nearestStop(route, p))
  }
  const onScrubEnd = (p: number) => {
    const idx = nearestStop(route, p)
    setDragging(false)
    setProgress(stopFraction(route, idx))
    setActiveIndex(idx)
  }
  // Ride the moped smoothly to the neighbouring stop instead of teleporting.
  // We flag `dragging` for the duration so VintageMap uses jumpTo on the
  // camera and it stays glued to the marker as it traces the route.
  const onStep = (dir: -1 | 1) => {
    cancelAnim()
    const from = progressRef.current
    const currentIdx = nearestStop(route, from)
    const targetIdx = Math.max(0, Math.min(stops.length - 1, currentIdx + dir))
    if (targetIdx === currentIdx) return
    const to = stopFraction(route, targetIdx)
    const duration = 400 + 800 * Math.abs(to - from)
    const t0 = performance.now()
    setDragging(true)
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration)
      const eased = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      const cur = from + (to - from) * eased
      setProgress(cur)
      setActiveIndex(nearestStop(route, cur))
      if (k < 1) {
        animRef.current = requestAnimationFrame(step)
      } else {
        animRef.current = null
        setDragging(false)
        setProgress(to)
        setActiveIndex(targetIdx)
      }
    }
    animRef.current = requestAnimationFrame(step)
  }

  return (
    <div className="bb-app">
      <MapScreen
        stops={stops}
        route={route}
        stats={stats}
        cur={cur}
        progress={progress}
        dragging={dragging}
        me={me}
        onScrubStart={onScrubStart}
        onScrubMove={onScrubMove}
        onScrubEnd={onScrubEnd}
        onStep={onStep}
        onOpenSheet={() => setSheetOpen(true)}
        onPinClick={(i) => {
          setActiveIndex(i)
          setSheetOpen(true)
        }}
        onAdd={canEdit ? () => setAddOpen(true) : undefined}
        onLogin={() => setLoginOpen(true)}
        onLogout={onLogout}
      />

      {/* paper textures over everything but chrome */}
      <div className="bb-grain" />
      <div className="bb-vignette" />

      {sheetOpen && (
        <StopSheet
          cur={cur}
          canEdit={canEdit}
          onClose={() => setSheetOpen(false)}
          onEdit={() => flash("✎ bewerken komt binnenkort")}
        />
      )}
      {addOpen && canEdit && (
        <AddFlow
          suggestedKm={stats.suggested_km}
          onClose={() => setAddOpen(false)}
          onSubmit={(s) => createMut.mutate(s)}
        />
      )}
      {loginOpen && (
        <LoginPrompt
          intent="signin"
          onClose={() => setLoginOpen(false)}
          onSuccess={() => setLoginOpen(false)}
        />
      )}

      {toast && (
        <div
          className="bb-toast"
          style={{
            position: "absolute",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 90,
            background: "#332c22",
            color: C.wrappedInk,
            fontFamily: FONT_MONO,
            fontSize: 12,
            padding: "10px 18px",
            borderRadius: 20,
            boxShadow: "0 4px 12px rgba(0,0,0,.35)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
