import { Link } from "@tanstack/react-router"
import type { PointerEvent as ReactPointerEvent } from "react"
import { useEffect, useState } from "react"
import type { UserPublic } from "@/client"
import { mediaSrc } from "./api"
import FollowBell from "./FollowBell"
import type { RouteGeometry } from "./geo"
import { nearestStop, stopFraction } from "./geo"
import { legInfo, legLabel } from "./legs"
import { isLiveFresh, liveAgeLabel } from "./live"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF, kmLabel } from "./theme"
import type { TripStats } from "./trip"
import type {
  LiveLocation,
  LiveTrailPoint,
  MapFlag,
  MapFlagKind,
  Stop,
} from "./types"
import VintageMap from "./VintageMap"

function frac(e: ReactPointerEvent<HTMLDivElement>): number {
  const r = e.currentTarget.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}

// "LIVE · zojuist" while the tracker reports, "laatst gezien 3 uur geleden"
// once the fix goes stale. Re-renders itself every half minute so the age
// keeps up between the app's polls of the backend.
function LiveChip({ live }: { live: LiveLocation }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const fresh = isLiveFresh(live.fix_time, nowMs)
  const age = liveAgeLabel(live.fix_time, nowMs)
  return (
    <span
      style={{
        marginTop: 8,
        marginLeft: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 1,
        color: fresh ? C.teal : C.sepia,
      }}
    >
      <span
        className={fresh ? "bb-live-chip-dot" : undefined}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: fresh ? C.teal : C.sepia,
          flex: "none",
        }}
      />
      {fresh ? `LIVE · ${age}` : `laatst gezien ${age}`}
    </span>
  )
}

function AuthLink({
  me,
  onLogin,
}: {
  me: UserPublic | null | undefined
  onLogin: () => void
}) {
  const base = {
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: 1,
    color: C.ochreDeep,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "4px 6px",
    textDecoration: "underline",
  } as const
  if (!me) {
    return (
      <button type="button" onClick={onLogin} style={base}>
        log in
      </button>
    )
  }
  const name = me.full_name || me.email.split("@", 1)[0]
  return (
    <Link
      to="/settings"
      aria-label="Open je account"
      style={{
        ...base,
        color: C.ochreDeep,
      }}
    >
      {name}
    </Link>
  )
}

export default function MapScreen({
  stops,
  route,
  stats,
  statsUnavailable,
  cur,
  progress,
  dragging,
  me,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onStep,
  onOpenSheet,
  onPinClick,
  flags,
  onFlagClick,
  live,
  trail,
  onAdd,
  onLogin,
  replaying = false,
  replayFollow = true,
  replayReduced = false,
  onReplay,
  onReplayGesture,
}: {
  stops: Stop[]
  route: RouteGeometry
  stats: TripStats
  // True when the stats query failed and `stats` is just the zeroed
  // fallback — show a hint instead of confident zeros.
  statsUnavailable: boolean
  cur: Stop
  progress: number
  dragging: boolean
  // Signed-in viewer, if any. Drives the login/name affordance and (via the
  // caller passing/omitting onAdd) the add button.
  me: UserPublic | null | undefined
  onScrubStart: (p: number) => void
  onScrubMove: (p: number) => void
  onScrubEnd: (p: number) => void
  onStep: (dir: -1 | 1) => void
  onOpenSheet: () => void
  onPinClick: (i: number) => void
  // Start/finish flags for the map; onFlagClick is present for admins only
  // and makes the flags clickable (opens the flag editor).
  flags?: MapFlag[]
  onFlagClick?: (kind: MapFlagKind) => void
  // Last GPS fix of the Cub (Traccar via the backend); null/absent means no
  // tracker — the live marker and chip simply don't render.
  live?: LiveLocation | null
  // Recent GPS breadcrumbs for the dotted trail on the map.
  trail?: LiveTrailPoint[] | null
  onAdd?: () => void
  onLogin: () => void
  // "Rij de reis" replay: while true the header/preview/scrubber/FAB chrome
  // hides for a clean stage and the map runs its cinematic camera.
  replaying?: boolean
  replayFollow?: boolean
  replayReduced?: boolean
  // Absent when a replay isn't possible (fewer than 2 stops) — hides the
  // play button.
  onReplay?: () => void
  onReplayGesture?: () => void
}) {
  const pct = `${(progress * 100).toFixed(2)}%`
  const showPreview = !dragging
  const currentStopIndex = nearestStop(route, progress)
  const atStart = currentStopIndex === 0
  const atEnd = currentStopIndex === stops.length - 1
  // While scrubbing the endpoint labels make way for the current leg.
  const leg = dragging ? legInfo(stops, route, progress) : null

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <VintageMap
        stops={stops}
        route={route}
        progress={progress}
        dragging={dragging}
        onPinClick={onPinClick}
        flags={flags}
        onFlagClick={onFlagClick}
        live={live}
        trail={trail}
        replaying={replaying}
        replayFollow={replayFollow}
        replayReduced={replayReduced}
        onReplayGesture={onReplayGesture}
      />

      {/* header (hidden during replay for a clean stage) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "14px 16px 22px",
          background: "linear-gradient(#efe4c9ee,#efe4c900)",
          pointerEvents: "none",
          display: replaying ? "none" : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 3,
                color: C.ochreDeep,
              }}
            >
              BROMMERBOEK · N°1
            </div>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 23,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              Van Mokum naar Marokko
            </div>
            <Link
              to="/logboek"
              aria-label="Open logboek met statistieken"
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "baseline",
                gap: 8,
                padding: "4px 10px",
                borderRadius: 8,
                background: C.paperCard,
                border: `1.5px solid ${C.border}`,
                boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                textDecoration: "none",
                cursor: "pointer",
                pointerEvents: "auto",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: 2,
                  color: C.ochreDeep,
                }}
              >
                LOGBOEK
              </span>
              {statsUnavailable ? (
                <span style={{ opacity: 0.8 }}>
                  statistieken niet beschikbaar
                </span>
              ) : (
                <>
                  <span style={{ color: C.red, fontSize: 13 }}>
                    {kmLabel(stats.km)}
                  </span>
                  <span>km · dag {stats.days}</span>
                </>
              )}
              <span
                aria-hidden="true"
                style={{
                  fontSize: 11,
                  color: C.ochreDeep,
                  marginLeft: 2,
                }}
              >
                ›
              </span>
            </Link>
            <Link
              to="/stempels"
              aria-label="Open de stempelmuur"
              style={{
                marginTop: 8,
                marginLeft: 6,
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 12px",
                borderRadius: 999,
                background: C.paperCard,
                border: `1.5px solid ${C.border}`,
                boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.ochreDeep,
                textDecoration: "none",
                cursor: "pointer",
                pointerEvents: "auto",
              }}
            >
              STEMPELS
            </Link>
            {live && <LiveChip live={live} />}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 8,
              pointerEvents: "auto",
            }}
          >
            <AuthLink me={me} onLogin={onLogin} />
            <FollowBell />
          </div>
        </div>
      </div>

      {/* landed preview card */}
      {!replaying && showPreview && (
        <button
          type="button"
          onClick={onOpenSheet}
          className="bb-fadein"
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            bottom: 108,
            zIndex: 22,
            cursor: "pointer",
            border: "none",
            background: "none",
            padding: 0,
            textAlign: "left",
            font: "inherit",
            color: "inherit",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              background: C.paperCard,
              border: `1.5px solid ${C.border}`,
              borderRadius: 12,
              padding: 10,
              boxShadow: "2px 4px 0 rgba(120,90,40,.28)",
              transform: "rotate(-.5deg)",
            }}
          >
            {(() => {
              const first = cur.media[0]
              const src = mediaSrc(first?.url)
              return (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 7,
                    flex: "none",
                    border: "3px solid #fff",
                    boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                    overflow: "hidden",
                    background: src
                      ? "#000"
                      : `linear-gradient(150deg,rgba(255,255,255,.28),rgba(0,0,0,.3)),${
                          first?.tone || "#c9a24e"
                        }`,
                  }}
                >
                  {src && first?.kind !== "video" && (
                    <img
                      src={mediaSrc(first?.thumb ?? first?.url)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                  {src && first?.kind === "video" && (
                    <video
                      src={src}
                      muted
                      playsInline
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </div>
              )
            })()}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.ochreDeep,
                }}
              >
                <span>
                  {cur.flag} {cur.place}
                </span>
                {cur.type === "repair" && (
                  <span style={{ color: C.teal }}>· REPARATIE</span>
                )}
                {cur.type === "preparation" && (
                  <span style={{ color: C.ochre }}>· VOORBEREIDING</span>
                )}
              </div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 16,
                  lineHeight: 1.1,
                  margin: "2px 0 3px",
                }}
              >
                {cur.title}
              </div>
              <div
                style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.sepia }}
              >
                {dateLabelNL(cur.date)} · tik voor verhaal ›
              </div>
            </div>
          </div>
        </button>
      )}

      {/* scrubber */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 23,
          padding: "12px 16px 20px",
          background: "linear-gradient(#efe4c900,#efe4c9 40%)",
          display: replaying ? "none" : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 9,
          }}
        >
          <div style={{ width: 28, flex: "none" }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: leg ? "center" : "space-between",
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.ochreDeep,
            }}
          >
            {leg ? (
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: C.sepia,
                }}
              >
                {legLabel(leg)}
              </span>
            ) : (
              <>
                <span>{stops[0]?.place}</span>
                <span>rijd de route ›</span>
                <span>{stops[stops.length - 1]?.place}</span>
              </>
            )}
          </div>
          <div style={{ width: 28, flex: "none" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={atStart}
            aria-label="Vorige stop"
            style={{
              width: 28,
              height: 28,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1.5px solid ${C.border}`,
              borderRadius: "50%",
              background: C.paperCard,
              color: C.sepia,
              fontSize: 16,
              fontFamily: FONT_MONO,
              lineHeight: 1,
              cursor: atStart ? "default" : "pointer",
              opacity: atStart ? 0.35 : 1,
              boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
            }}
          >
            ‹
          </button>
          <div
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              onScrubStart(frac(e))
            }}
            onPointerMove={(e) => {
              if (dragging) onScrubMove(frac(e))
            }}
            onPointerUp={(e) => onScrubEnd(frac(e))}
            style={{
              position: "relative",
              flex: 1,
              height: 34,
              cursor: "grab",
              touchAction: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 15,
                height: 4,
                borderRadius: 3,
                background: "#d8c79c",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 15,
                height: 4,
                borderRadius: 3,
                background: C.redBright,
                width: pct,
              }}
            />
            {stops.map((s, i) => (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  top: 11,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  transform: "translateX(-50%)",
                  left: `${(stopFraction(route, i) * 100).toFixed(2)}%`,
                  background:
                    s.type === "repair"
                      ? C.teal
                      : s.type === "preparation"
                        ? C.ochre
                        : C.red,
                  border: `2px solid ${C.paperLight}`,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={atEnd}
            aria-label="Volgende stop"
            style={{
              width: 28,
              height: 28,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1.5px solid ${C.border}`,
              borderRadius: "50%",
              background: C.paperCard,
              color: C.sepia,
              fontSize: 16,
              fontFamily: FONT_MONO,
              lineHeight: 1,
              cursor: atEnd ? "default" : "pointer",
              opacity: atEnd ? 0.35 : 1,
              boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
            }}
          >
            ›
          </button>
        </div>
      </div>

      {/* replay entry — round play button opposite the FAB, above scrubber */}
      {!replaying && onReplay && (
        <button
          type="button"
          onClick={onReplay}
          aria-label="Rij de reis af"
          style={{
            position: "absolute",
            left: 18,
            bottom: 90,
            zIndex: 25,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: `3px solid ${C.paperLight}`,
            background: C.teal,
            color: C.wrappedInk,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            paddingLeft: 3,
            cursor: "pointer",
            boxShadow: "0 4px 10px rgba(30,60,70,.4)",
          }}
        >
          ▶
        </button>
      )}

      {/* floating + (rijder only) */}
      {!replaying && onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Nieuwe stop"
          style={{
            position: "absolute",
            right: 18,
            bottom: 90,
            zIndex: 25,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: `3px solid ${C.paperLight}`,
            background: C.red,
            color: C.wrappedInk,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 10px rgba(90,30,20,.45)",
          }}
        >
          <svg
            aria-hidden="true"
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  )
}
