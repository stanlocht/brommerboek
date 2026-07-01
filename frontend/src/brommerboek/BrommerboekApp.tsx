import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import "./brommerboek.css"
import AddFlow from "./AddFlow"
import { createStop, fetchStops } from "./api"
import { buildRoute, nearestStop, stopFraction } from "./geo"
import { CubIcon } from "./icons"
import MapScreen from "./MapScreen"
import StopSheet from "./StopSheet"
import { C, FONT_MONO } from "./theme"
import { computeStats } from "./trip"
import type { NewStop } from "./types"

export type Role = "rijder" | "volger"
const ROLE_KEY = "brommerboek:role"

function loadRole(): Role {
  if (typeof window === "undefined") return "rijder"
  return window.localStorage.getItem(ROLE_KEY) === "volger"
    ? "volger"
    : "rijder"
}

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
        <CubIcon width={110} height={70} />
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

  const [role, setRole] = useState<Role>(loadRole)
  const [activeIndex, setActiveIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [repairOnly, setRepairOnly] = useState(false)
  const [progress, setProgress] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState("")
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jumpLast = useRef(false)

  useEffect(() => {
    window.localStorage.setItem(ROLE_KEY, role)
  }, [role])

  const route = useMemo(
    () =>
      buildRoute((stops ?? []).map((s) => [s.lng, s.lat] as [number, number])),
    [stops],
  )
  const stats = useMemo(() => computeStats(stops ?? []), [stops])

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
  const isRijder = role === "rijder"

  const onScrubStart = (p: number) => {
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

  return (
    <div className="bb-app">
      <MapScreen
        stops={stops}
        route={route}
        stats={stats}
        cur={cur}
        progress={progress}
        dragging={dragging}
        repairOnly={repairOnly}
        role={role}
        onRoleChange={setRole}
        onScrubStart={onScrubStart}
        onScrubMove={onScrubMove}
        onScrubEnd={onScrubEnd}
        onToggleRepair={() => setRepairOnly((r) => !r)}
        onOpenSheet={() => setSheetOpen(true)}
        onPinClick={(i) => {
          setActiveIndex(i)
          setSheetOpen(true)
        }}
        onAdd={isRijder ? () => setAddOpen(true) : undefined}
      />

      {/* paper textures over everything but chrome */}
      <div className="bb-grain" />
      <div className="bb-vignette" />

      {sheetOpen && (
        <StopSheet
          cur={cur}
          role={role}
          onClose={() => setSheetOpen(false)}
          onEdit={() => flash("✎ bewerken komt binnenkort")}
        />
      )}
      {addOpen && isRijder && (
        <AddFlow
          suggestedKm={stats.kmRaw}
          onClose={() => setAddOpen(false)}
          onSubmit={(s) => createMut.mutate(s)}
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
