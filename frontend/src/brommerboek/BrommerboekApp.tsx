import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { UsersService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import "./brommerboek.css"
import AddFlow from "./AddFlow"
import {
  createStop,
  deleteStop,
  fetchStats,
  fetchStops,
  updateStop,
  uploadStopMedia,
} from "./api"
import { buildRoute, nearestStop, stopFraction } from "./geo"
import { CubIcon } from "./icons"
import LoginPrompt from "./LoginPrompt"
import MapScreen from "./MapScreen"
import ReplayOverlay from "./ReplayOverlay"
import StopSheet from "./StopSheet"
import { shareUrl, stopIdFromSearch, withoutStopParam } from "./share"
import { C, FONT_MONO } from "./theme"
import { EMPTY_STATS } from "./trip"
import type { NewStop, Stop } from "./types"
import useReplay from "./useReplay"

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
  const { data: statsData, isError: statsUnavailable } = useQuery({
    queryKey: ["stops", "stats"],
    queryFn: fetchStats,
  })
  // Fall back to zeros so the map keeps working when /stats fails; the flag
  // lets stat displays show a hint instead of confident zeros.
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
  // When set, AddFlow opens in edit mode for this existing stop instead of
  // creating a new one.
  const [editStop, setEditStop] = useState<Stop | null>(null)
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

  const replay = useReplay({
    stops: stops ?? [],
    route,
    setProgress,
    setActiveIndex,
  })
  const replaying = replay.phase !== "idle"

  // On first load, park the cub at the latest stop — unless the URL carries
  // a ?stop=<id> deep link (from a share link — /s/<id> bounces humans here —
  // or from a push notification), in which case ride to that stop and open
  // its sheet. The param is scrubbed from the address bar either way so a
  // refresh doesn't replay it; an unknown id is ignored silently.
  const initedRef = useRef(false)
  useEffect(() => {
    if (!stops || stops.length === 0 || initedRef.current) return
    initedRef.current = true
    const sharedId = stopIdFromSearch(window.location.search)
    if (sharedId) {
      window.history.replaceState(
        null,
        "",
        withoutStopParam(window.location.href),
      )
      const idx = stops.findIndex((s) => s.id === sharedId)
      if (idx >= 0) {
        setActiveIndex(idx)
        setProgress(stopFraction(route, idx))
        setSheetOpen(true)
        return
      }
    }
    setActiveIndex(stops.length - 1)
    setProgress(1)
  }, [stops, route])

  // After adding a stop, jump to the new latest stop once data refetches.
  useEffect(() => {
    if (!stops || stops.length === 0 || !jumpLast.current) return
    jumpLast.current = false
    setActiveIndex(stops.length - 1)
    setProgress(1)
  }, [stops])

  const createMut = useMutation({
    mutationFn: async (s: NewStop) => {
      // New stops carry local-preview media whose `url` is a blob: URL that
      // AddFlow made from the picked File. Create the stop first, then
      // re-fetch each blob and upload it against the fresh stop id.
      const created = await createStop({ ...s, media: [] })
      let failed = 0
      for (const item of s.media) {
        if (item.url?.startsWith("blob:")) {
          try {
            const blob = await fetch(item.url).then((r) => r.blob())
            const ext = item.kind === "video" ? "video.mp4" : "photo.jpg"
            const file = new File([blob], ext, { type: blob.type })
            await uploadStopMedia(created.id, file, item.cap)
          } catch {
            // Individual upload failures don't roll back the stop — the
            // user can retry the file from the edit flow.
            failed += 1
          } finally {
            // AddFlow made this blob: URL for the preview; it's ours to
            // release once the upload has settled either way.
            URL.revokeObjectURL(item.url)
          }
        }
      }
      return { created, failed }
    },
    onSuccess: async ({ failed }) => {
      jumpLast.current = true
      // Prefix match — invalidates both ["stops"] and ["stops", "stats"].
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setAddOpen(false)
      flash(
        failed > 0
          ? failed === 1
            ? "Stop toegevoegd, maar 1 bestand kon niet worden geüpload"
            : `Stop toegevoegd, maar ${failed} bestanden konden niet worden geüpload`
          : "✓ Stop toegevoegd aan de route",
      )
    },
    onError: () => flash("Kon de stop niet opslaan"),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NewStop }) =>
      updateStop(id, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setEditStop(null)
      flash("✓ Stop bijgewerkt")
    },
    onError: () => flash("Kon de wijziging niet opslaan"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteStop(id),
    onSuccess: async () => {
      // The current activeIndex may now be past the tail; reset before the
      // list refetches so we don't briefly render an out-of-range stop.
      initedRef.current = false
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setEditStop(null)
      flash("✓ Stop verwijderd")
    },
    onError: () => flash("Kon de stop niet verwijderen"),
  })

  const applyMediaChange = (updated: Stop) => {
    setEditStop(updated)
    qc.invalidateQueries({ queryKey: ["stops"] })
  }

  // Native share sheet when the browser has one (mobile), else copy the
  // link and confirm with a toast.
  const shareCurrentStop = async (stop: Stop) => {
    const url = shareUrl(window.location.origin, stop.id)
    if (navigator.share) {
      try {
        await navigator.share({ url })
      } catch {
        // Dismissing the share sheet rejects — nothing to report.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      flash("link gekopieerd")
    } catch {
      flash("kon de link niet kopiëren")
    }
  }

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
  if (isError || !stops)
    return <CenterState text="kon de reis niet laden — draait de backend?" />
  if (stops.length === 0)
    return <CenterState text="nog geen stops — voeg de eerste toe" />

  const cur = stops[activeIndex] ?? stops[0]

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

  // Starting a replay closes the sheet and add/edit flows first so the stage
  // is clean; exit restores the exact progress/activeIndex saved here.
  const startReplay = () => {
    cancelAnim()
    setDragging(false)
    setSheetOpen(false)
    setAddOpen(false)
    setEditStop(null)
    replay.start({ progress: progressRef.current, activeIndex })
  }

  return (
    <div className="bb-app">
      <MapScreen
        stops={stops}
        route={route}
        stats={stats}
        statsUnavailable={statsUnavailable}
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
          if (replaying) return
          setActiveIndex(i)
          setSheetOpen(true)
        }}
        onAdd={canEdit ? () => setAddOpen(true) : undefined}
        onLogin={() => setLoginOpen(true)}
        replaying={replaying}
        replayFollow={replay.following}
        replayReduced={replay.reduced}
        onReplay={stops.length >= 2 ? startReplay : undefined}
        onReplayGesture={replay.pauseFollow}
      />

      {replaying && (
        <ReplayOverlay
          replay={replay}
          stops={stops}
          route={route}
          stats={stats}
          progress={progress}
        />
      )}

      {/* paper textures over everything but chrome */}
      <div className="bb-grain" />
      <div className="bb-vignette" />

      {sheetOpen && (
        <StopSheet
          cur={cur}
          canEdit={canEdit}
          onClose={() => setSheetOpen(false)}
          onShare={() => shareCurrentStop(cur)}
          onEdit={() => {
            setEditStop(cur)
            setSheetOpen(false)
          }}
        />
      )}
      {addOpen && canEdit && (
        <AddFlow
          suggestedKm={stats.suggested_km}
          onClose={() => setAddOpen(false)}
          onCreate={(s) => createMut.mutate(s)}
        />
      )}
      {editStop && canEdit && (
        <AddFlow
          suggestedKm={stats.suggested_km}
          initialStop={editStop}
          onClose={() => setEditStop(null)}
          onPatch={(id, patch) => patchMut.mutate({ id, patch })}
          onDelete={(id) => deleteMut.mutate(id)}
          onMediaChanged={applyMediaChange}
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
