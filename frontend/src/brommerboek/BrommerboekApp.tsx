import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { UsersService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import AddFlow from "./AddFlow"
import {
  createStop,
  deleteStop,
  fetchLegTracks,
  fetchLiveLocation,
  fetchLiveTrail,
  fetchMapFlags,
  fetchStats,
  fetchStops,
  fetchTripInfo,
  moveStop,
  updateMapFlag,
  updateStop,
  updateTripTitle,
  uploadStopMedia,
} from "./api"
import FlagEditor from "./FlagEditor"
import { buildRoute, nearestStop, stopFraction } from "./geo"
import { CubIcon } from "./icons"
import LoginPrompt from "./LoginPrompt"
import MapScreen from "./MapScreen"
import ReplayOverlay from "./ReplayOverlay"
import StopSheet from "./StopSheet"
import { shareUrl, stopIdFromSearch, withoutStopParam } from "./share"
import TitleEditor from "./TitleEditor"
import { C, FONT_MONO } from "./theme"
import { DEFAULT_TRIP_TITLE, EMPTY_STATS } from "./trip"
import type { MapFlagKind, MapFlagPatch, NewStop, Stop } from "./types"
import useLiveKm from "./useLiveKm"
import useReplay from "./useReplay"

function CenterState({
  text,
  children,
}: {
  text: string
  children?: ReactNode
}) {
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
      {children}
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
  // The logbook card's km total includes the live part (ridden since the
  // last stop), matching the logbook screen's headline figure.
  const liveKm = useLiveKm()
  // Everyone sees the same trip; only superusers get the add/edit affordances.
  // Query only fires when a token is present so a signed-out viewer never
  // triggers a 401 → login redirect.
  const { data: me } = useQuery({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })
  const canEdit = !!me?.is_superuser

  // The headline above the map. Public read; admins rewrite it from the
  // header. Until it loads (or if it fails) the header shows the default.
  const { data: tripInfo } = useQuery({
    queryKey: ["tripInfo"],
    queryFn: fetchTripInfo,
  })
  const tripTitle = tripInfo?.title ?? DEFAULT_TRIP_TITLE
  const [editTitleOpen, setEditTitleOpen] = useState(false)
  const titleMut = useMutation({
    mutationFn: (title: string) => updateTripTitle(title),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tripInfo"] })
      setEditTitleOpen(false)
      flash("✓ titel gewijzigd")
    },
    // A failed save keeps the dialog open so the typed title isn't lost.
    onError: () => flash("kon de titel niet wijzigen"),
  })

  // Start/finish flags — everyone sees them; admins can drag them around.
  // Loads independently of the stops, so a failure just means no flags.
  const { data: mapFlags } = useQuery({
    queryKey: ["mapFlags"],
    queryFn: fetchMapFlags,
  })

  // Live GPS fix of the Cub (Traccar via the backend). Polled every minute;
  // the backend caches upstream calls, so many viewers stay cheap. Null (no
  // tracker configured, Traccar down, offline) just hides the live marker.
  const { data: liveLocation } = useQuery({
    queryKey: ["liveLocation"],
    queryFn: fetchLiveLocation,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // The breadcrumb trail behind the live marker. The backend caches the
  // Traccar history query for 5 minutes, so polling faster buys nothing.
  const { data: liveTrail } = useQuery({
    queryKey: ["liveTrail"],
    queryFn: fetchLiveTrail,
    refetchInterval: 300_000,
    staleTime: 240_000,
  })

  // Real ridden roads per leg. They change only when a stop lands (the
  // backend syncs in the background right after), so a slow poll plus the
  // invalidation on stop create keeps them current.
  const { data: legTracks } = useQuery({
    queryKey: ["legTracks"],
    queryFn: fetchLegTracks,
    refetchInterval: 300_000,
  })

  // Clicking a flag (admins only) opens the editor for that kind; saving a
  // picked place moves the flag there and relabels it after the place.
  const [editFlagKind, setEditFlagKind] = useState<MapFlagKind | null>(null)
  const editFlag = mapFlags?.find((f) => f.kind === editFlagKind) ?? null
  const flagMut = useMutation({
    mutationFn: ({ kind, patch }: { kind: MapFlagKind; patch: MapFlagPatch }) =>
      updateMapFlag(kind, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mapFlags"] })
      setEditFlagKind(null)
      flash("✓ vlag verplaatst")
    },
    // A failed save keeps the dialog open so the picked place isn't lost.
    onError: () => flash("kon de vlag niet verplaatsen"),
  })

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
  // Live "what is the save doing" line for AddFlow while a new stop's media
  // uploads against the id it only just got. Null when nothing is in flight.
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
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

  // Route geometry: real ridden roads where a leg track exists (matched on
  // both endpoints so reordered stops never get a stale track), straight
  // pin-to-pin lines everywhere else.
  const route = useMemo(() => {
    const list = stops ?? []
    const byLeg = new Map<string, [number, number][]>()
    for (const t of legTracks ?? []) {
      byLeg.set(`${t.from_stop_id}→${t.to_stop_id}`, t.points)
    }
    const legs = list
      .slice(1)
      .map((s, i) => byLeg.get(`${list[i].id}→${s.id}`) ?? null)
    return buildRoute(
      list.map((s) => [s.lng, s.lat] as [number, number]),
      legs,
    )
  }, [stops, legTracks])

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
    mutationFn: async ({
      stop: s,
      files,
    }: {
      stop: NewStop
      files: Map<string, File>
    }) => {
      // New stops carry local-preview media whose `url` is a blob: URL
      // standing in for a File that AddFlow already shrank and parked in
      // `files`. Create the stop first, then upload each File against the
      // fresh stop id. Taking the File straight from the map (rather than
      // re-reading the blob: URL through fetch, as this used to) avoids a
      // second full copy of every picture and survives the preview URL
      // being revoked underneath us.
      const created = await createStop({ ...s, media: [] })
      const pending = s.media.filter((m) => m.url?.startsWith("blob:"))
      let failed = 0
      for (const [i, item] of pending.entries()) {
        const url = item.url as string
        const file = files.get(url)
        const label =
          pending.length > 1 ? `bestand ${i + 1}/${pending.length} · ` : ""
        try {
          if (!file) throw new Error("file missing")
          // Same progress reporting as the edit flow: a deferred upload of
          // a clip takes long enough that a silent "opslaan…" reads as a
          // hang, and a hang is what makes people force-quit mid-upload.
          setSaveStatus(`${label}uploaden 0%`)
          // The cover flag travels with its own file rather than with a
          // position, so the rider's pick holds whatever order these
          // uploads land in (and whichever of them fail).
          await uploadStopMedia(created.id, file, item.cap, {
            cover: item.cover,
            onProgress: (f) =>
              setSaveStatus(`${label}uploaden ${Math.round(f * 100)}%`),
            onRetry: (attempt) =>
              setSaveStatus(`${label}opnieuw proberen (${attempt + 1})…`),
          })
        } catch {
          // Individual upload failures don't roll back the stop — the
          // user can retry the file from the edit flow.
          failed += 1
        } finally {
          // AddFlow made this blob: URL for the preview; it's ours to
          // release once the upload has settled either way.
          URL.revokeObjectURL(url)
          files.delete(url)
        }
      }
      return { created, failed }
    },
    onSettled: () => setSaveStatus(null),
    onSuccess: async ({ failed }) => {
      jumpLast.current = true
      // The backend syncs the new leg's ridden road in the background right
      // after the stop lands; re-ask for the tracks once it has had a moment.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["legTracks"] }),
        10_000,
      )
      // Prefix match — invalidates both ["stops"] and ["stops", "stats"].
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setAddOpen(false)
      flash(
        failed > 0
          ? failed === 1
            ? "Stop toegevoegd, maar 1 bestand mislukte — voeg het toe via bewerken"
            : `Stop toegevoegd, maar ${failed} bestanden mislukten — voeg ze toe via bewerken`
          : "✓ Stop toegevoegd aan de route",
      )
    },
    onError: () => flash("Kon de stop niet opslaan"),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NewStop }) =>
      updateStop(id, patch),
    onSuccess: async () => {
      // Date/pin edits re-slice the surrounding ridden roads server-side.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["legTracks"] }),
        10_000,
      )
      await qc.invalidateQueries({ queryKey: ["stops"] })
      setEditStop(null)
      flash("✓ Stop bijgewerkt")
    },
    onError: () => flash("Kon de wijziging niet opslaan"),
  })

  const moveMut = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) =>
      moveStop(id, direction),
    onSuccess: async (_moved, { direction }) => {
      // The stop shifted one route position; follow it so the sheet keeps
      // showing the same post after the list refetches.
      setActiveIndex((i) => (direction === "up" ? Math.max(0, i - 1) : i + 1))
      // Swapping neighbours reshapes the ridden roads around both stops;
      // the server re-slices them in the background.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["legTracks"] }),
        10_000,
      )
      await qc.invalidateQueries({ queryKey: ["stops"] })
      flash("✓ Volgorde aangepast")
    },
    onError: () => flash("Kon de volgorde niet aanpassen"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteStop(id),
    onSuccess: async () => {
      // The current activeIndex may now be past the tail; reset before the
      // list refetches so we don't briefly render an out-of-range stop.
      initedRef.current = false
      // Deleting merges the two legs around the stop; the server re-slices
      // the merged ridden road in the background.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["legTracks"] }),
        10_000,
      )
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

  const toastEl = toast && (
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
  )

  if (isLoading) return <CenterState text="de kaart wordt geladen…" />
  if (isError || !stops)
    return <CenterState text="kon de reis niet laden — draait de backend?" />
  if (stops.length === 0)
    return (
      <CenterState
        text={
          canEdit
            ? "nog geen stops — voeg de eerste toe"
            : "nog geen stops op de route"
        }
      >
        {canEdit ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 1,
              color: C.wrappedInk,
              background: C.red,
              border: `2px solid ${C.paperLight}`,
              borderRadius: 20,
              padding: "10px 20px",
              cursor: "pointer",
              boxShadow: "0 4px 10px rgba(0,0,0,.25)",
            }}
          >
            + nieuwe stop
          </button>
        ) : (
          !me && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1,
                color: C.ochreDeep,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 6px",
                textDecoration: "underline",
              }}
            >
              log in
            </button>
          )
        )}
        {addOpen && canEdit && (
          <AddFlow
            suggestedKm={stats.suggested_km}
            saving={createMut.isPending}
            savingStatus={saveStatus}
            onClose={() => setAddOpen(false)}
            onCreate={(s, files) => createMut.mutate({ stop: s, files })}
          />
        )}
        {loginOpen && (
          <LoginPrompt
            intent="signin"
            onClose={() => setLoginOpen(false)}
            onSuccess={() => setLoginOpen(false)}
          />
        )}
        {toastEl}
      </CenterState>
    )

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
    // Step from the active stop, not from nearestStop(progress): stops that
    // share a location (several posts from the same place) collapse to the
    // same route fraction, so deriving the current stop from progress made
    // prev/next unable to move between them.
    const targetIdx = Math.max(0, Math.min(stops.length - 1, activeIndex + dir))
    if (targetIdx === activeIndex) return
    const to = stopFraction(route, targetIdx)
    const duration = 400 + 800 * Math.abs(to - from)
    const t0 = performance.now()
    setDragging(true)
    setActiveIndex(targetIdx)
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration)
      const eased = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      setProgress(from + (to - from) * eased)
      if (k < 1) {
        animRef.current = requestAnimationFrame(step)
      } else {
        animRef.current = null
        setDragging(false)
        setProgress(to)
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
        stats={{ ...stats, km: stats.km + liveKm }}
        statsUnavailable={statsUnavailable}
        title={tripTitle}
        onEditTitle={
          canEdit
            ? () => {
                if (replaying) return
                setEditTitleOpen(true)
              }
            : undefined
        }
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
        flags={mapFlags}
        live={liveLocation}
        trail={liveTrail}
        onFlagClick={
          canEdit
            ? (kind) => {
                if (replaying) return
                setEditFlagKind(kind)
              }
            : undefined
        }
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
          canMoveUp={
            canEdit &&
            activeIndex > 0 &&
            stops[activeIndex - 1].date === cur.date
          }
          canMoveDown={
            canEdit &&
            activeIndex < stops.length - 1 &&
            stops[activeIndex + 1].date === cur.date
          }
          moving={moveMut.isPending}
          onMove={(direction) => moveMut.mutate({ id: cur.id, direction })}
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
          saving={createMut.isPending}
          savingStatus={saveStatus}
          onClose={() => setAddOpen(false)}
          onCreate={(s, files) => createMut.mutate({ stop: s, files })}
        />
      )}
      {editStop && canEdit && (
        <AddFlow
          suggestedKm={stats.suggested_km}
          initialStop={editStop}
          saving={patchMut.isPending || deleteMut.isPending}
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

      {editFlag && canEdit && (
        <FlagEditor
          flag={editFlag}
          saving={flagMut.isPending}
          onClose={() => setEditFlagKind(null)}
          onSave={(hit) =>
            flagMut.mutate({
              kind: editFlag.kind,
              patch: { lat: hit.lat, lng: hit.lng, label: hit.place },
            })
          }
        />
      )}

      {editTitleOpen && canEdit && (
        <TitleEditor
          title={tripTitle}
          saving={titleMut.isPending}
          onClose={() => setEditTitleOpen(false)}
          onSave={(title) => titleMut.mutate(title)}
        />
      )}

      {toastEl}
    </div>
  )
}
