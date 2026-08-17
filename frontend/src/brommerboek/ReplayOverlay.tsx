// Overlay chrome for the "rij de reis" replay: rolling km/date header strip,
// compact stop cards with a little slideshow of the stop's pictures, passport
// border stamps, playback controls and the end card. The root is
// pointer-transparent so map gestures still reach MapLibre; only the controls
// themselves catch input.

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { mediaSrc } from "./api"
import type { RouteGeometry } from "./geo"
import {
  cumulativeKm,
  dateAtProgress,
  kmFromCum,
  replayPhotos,
} from "./replayMath"
import {
  C,
  dateLabelNL,
  FONT_MONO,
  FONT_SERIF,
  kmLabel,
  PIN_ROTS,
} from "./theme"
import type { TripStats } from "./trip"
import type { MediaItem, Stop } from "./types"
import type { ReplayHandle } from "./useReplay"

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 16px",
  borderRadius: 17,
  border: `1.5px solid ${C.border}`,
  background: C.paperCard,
  color: C.ink,
  fontFamily: FONT_MONO,
  fontSize: 12,
  cursor: "pointer",
  boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
  pointerEvents: "auto",
}

// Same pill, squared off for a single glyph (pause, sound).
const iconPillStyle: CSSProperties = {
  ...pillStyle,
  width: 40,
  padding: 0,
  justifyContent: "center",
  fontSize: 14,
}

// The stop's pictures, crossfading one into the next while the cub waits.
// Every picture is mounted from the start (there are at most a handful) so the
// browser has them decoded before their turn comes — a fade never lands on a
// blank frame.
function ReplayPhotos({
  photos,
  index,
  paused,
}: {
  photos: MediaItem[]
  index: number
  paused: boolean
}) {
  const cur = Math.max(0, Math.min(index, photos.length - 1))
  const active = photos[cur]
  const videosRef = useRef<(HTMLVideoElement | null)[]>([])
  // Only the picture on screen plays — four clips decoding at once is exactly
  // the kind of background work that makes the map stutter — and pausing the
  // replay pauses the clip with it.
  useEffect(() => {
    videosRef.current.forEach((v, i) => {
      if (!v) return
      if (i === cur && !paused) {
        // Autoplay can still be refused; a frozen first frame is fine.
        void v.play().catch(() => {})
      } else {
        v.pause()
      }
    })
  }, [cur, paused])
  return (
    <div
      style={{
        position: "relative",
        height: 146,
        borderRadius: 8,
        overflow: "hidden",
        background: "#000",
        border: "3px solid #fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
      }}
    >
      {photos.map((m, i) => (
        <div
          key={m.url ?? i}
          className="bb-replay-photo"
          style={{ opacity: i === cur ? 1 : 0 }}
        >
          {m.kind === "video" ? (
            <video
              ref={(el) => {
                videosRef.current[i] = el
              }}
              src={mediaSrc(m.url)}
              muted
              loop
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <img
              src={mediaSrc(m.thumb ?? m.url)}
              alt=""
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      ))}
      {active?.cap && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "14px 8px 6px",
            background: "linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.55))",
            color: "#f6efdc",
            fontFamily: FONT_MONO,
            fontSize: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active.cap}
        </div>
      )}
      {photos.length > 1 && (
        <div
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            display: "flex",
            gap: 4,
          }}
        >
          {photos.map((m, i) => (
            <span
              key={m.url ?? i}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: i === cur ? "#f6efdc" : "rgba(246,239,220,.4)",
                boxShadow: "0 0 2px rgba(0,0,0,.5)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReplayStopCard({
  stop,
  photoIndex,
  paused,
}: {
  stop: Stop
  photoIndex: number
  paused: boolean
}) {
  const photos = replayPhotos(stop)
  const tone = stop.media[0]?.tone || "#c9a24e"
  return (
    <div
      className="bb-fadeup"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 84,
        display: "flex",
        flexDirection: "column",
        gap: 9,
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        borderRadius: 12,
        padding: 10,
        boxShadow: "2px 4px 0 rgba(120,90,40,.28)",
        transform: "rotate(-.5deg)",
      }}
    >
      {photos.length > 0 ? (
        <ReplayPhotos photos={photos} index={photoIndex} paused={paused} />
      ) : (
        stop.media.length > 0 && (
          <div
            style={{
              height: 56,
              borderRadius: 8,
              border: "3px solid #fff",
              boxShadow: "0 1px 3px rgba(0,0,0,.2)",
              background: `linear-gradient(150deg,rgba(255,255,255,.28),rgba(0,0,0,.3)),${tone}`,
            }}
          />
        )
      )}
      <div style={{ minWidth: 0 }}>
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
            {stop.flag} {stop.place}
          </span>
          {stop.type === "repair" && (
            <span style={{ color: C.teal }}>· REPARATIE</span>
          )}
          {stop.type === "preparation" && (
            <span style={{ color: C.ochre }}>· VOORBEREIDING</span>
          )}
        </div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 15,
            lineHeight: 1.1,
            margin: "2px 0 3px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {stop.title}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.sepia }}>
          {dateLabelNL(stop.date)}
          {stop.km != null && ` · ${kmLabel(stop.km)} km`}
        </div>
      </div>
    </div>
  )
}

function EndStat({
  value,
  label,
  color = C.red,
  rot = "-.5deg",
}: {
  value: string | number
  label: string
  color?: string
  rot?: string
}) {
  return (
    <div
      style={{
        background: C.paperLight,
        border: `1.5px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 10px",
        boxShadow: "1px 3px 0 rgba(120,90,40,.22)",
        transform: `rotate(${rot})`,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 28,
          lineHeight: 1,
          color,
          fontFamily: FONT_SERIF,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: C.sepia,
          marginTop: 4,
          letterSpacing: 1,
        }}
      >
        {label}
      </div>
    </div>
  )
}

export default function ReplayOverlay({
  replay,
  stops,
  route,
  stats,
  progress,
}: {
  replay: ReplayHandle
  stops: Stop[]
  route: RouteGeometry
  stats: TripStats
  progress: number
}) {
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3200)
  }, [])
  // Any tap or drag anywhere brings the playback controls back for a bit.
  useEffect(() => {
    poke()
    const onDown = () => poke()
    window.addEventListener("pointerdown", onDown)
    return () => {
      window.removeEventListener("pointerdown", onDown)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [poke])

  const driving = replay.phase !== "done"
  // The odometer table is the same for the whole replay — build it once
  // instead of on every animation frame's re-render.
  const cum = useMemo(() => cumulativeKm(stops, route), [stops, route])
  const kmNow = kmFromCum(cum, route, progress)
  const dateNow = dateAtProgress(stops, route, progress)
  const stampRot = replay.stamp
    ? PIN_ROTS[replay.stamp.index % PIN_ROTS.length]
    : 0

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        pointerEvents: "none",
      }}
    >
      {/* rolling km + date strip */}
      {driving && (
        <div
          className="bb-fadein"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "14px 16px 28px",
            background: "linear-gradient(#efe4c9ee,#efe4c900)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.ochreDeep,
            }}
          >
            RIJ DE REIS
          </div>
          <div
            style={{
              fontFamily: FONT_SERIF,
              fontWeight: 700,
              fontSize: 27,
              lineHeight: 1,
              marginTop: 4,
              color: C.red,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {kmLabel(kmNow)}
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.sepia,
                marginLeft: 5,
              }}
            >
              km
            </span>
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.sepia,
              marginTop: 3,
            }}
          >
            {dateNow && dateLabelNL(dateNow)}
          </div>
        </div>
      )}

      {/* compact stop card while the cub pauses */}
      {replay.phase === "stopped" && stops[replay.stopIndex] && (
        <ReplayStopCard
          key={stops[replay.stopIndex].id}
          stop={stops[replay.stopIndex]}
          photoIndex={replay.photoIndex}
          paused={replay.paused}
        />
      )}

      {/* passport stamp on a border crossing */}
      {replay.stamp && (
        <div
          key={replay.stamp.index}
          className="bb-replay-stamp"
          style={
            {
              "--r": `${stampRot}deg`,
              position: "absolute",
              left: "50%",
              top: "34%",
              marginLeft: -105,
              width: 210,
              height: 120,
              borderRadius: "50%",
              border: `3px solid ${C.teal}`,
              boxShadow: `inset 0 0 0 2px ${C.paperLight}, inset 0 0 0 3.5px ${C.teal}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: C.teal,
              background: "rgba(244,236,214,.4)",
            } as CSSProperties
          }
        >
          <div style={{ fontSize: 30, lineHeight: 1 }}>{replay.stamp.flag}</div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 3,
              textTransform: "uppercase",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {replay.stamp.country}
          </div>
        </div>
      )}

      {/* volg — camera follow was paused by a map gesture */}
      {driving && !replay.following && (
        <div
          style={{
            position: "absolute",
            top: 112,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            onClick={replay.resumeFollow}
            style={{ ...pillStyle, borderColor: C.teal, color: C.teal }}
          >
            ◉ volg
          </button>
        </div>
      )}

      {/* playback controls — kept on screen while paused so the way back in
          is never hidden behind a tap */}
      {driving && (controlsVisible || replay.paused) && (
        <div
          className="bb-fadein"
          style={{
            position: "absolute",
            bottom: 26,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={replay.togglePause}
            aria-label={replay.paused ? "verder rijden" : "pauzeer"}
            style={iconPillStyle}
          >
            {replay.paused ? "▶" : "⏸"}
          </button>
          <button
            type="button"
            onClick={replay.toggleMute}
            aria-label={replay.muted ? "muziek aan" : "muziek uit"}
            style={{
              ...iconPillStyle,
              color: replay.muted ? C.sepia : C.teal,
              borderColor: replay.muted ? C.border : C.teal,
            }}
          >
            {replay.muted ? "🔇" : "♪"}
          </button>
          <button type="button" onClick={replay.skipToEnd} style={pillStyle}>
            ⏭ einde
          </button>
          <button type="button" onClick={replay.exit} style={pillStyle}>
            ✕ stop
          </button>
        </div>
      )}

      {/* end card */}
      {replay.phase === "done" && (
        <div
          className="bb-fadein"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(233,220,191,.72)",
            pointerEvents: "auto",
          }}
        >
          <div
            className="bb-fadeup"
            style={{
              width: "100%",
              maxWidth: 340,
              background: C.paperCard,
              border: `1.5px solid ${C.border}`,
              borderRadius: 14,
              padding: "20px 18px",
              boxShadow: "3px 6px 0 rgba(120,90,40,.3)",
              transform: "rotate(-.4deg)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 3,
                color: C.ochreDeep,
              }}
            >
              EINDE VAN DE RIT
            </div>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 24,
                lineHeight: 1.1,
                margin: "6px 0 14px",
              }}
            >
              tot hier — en verder
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                textAlign: "left",
              }}
            >
              <EndStat value={kmLabel(stats.km)} label="KM" rot="-.6deg" />
              <EndStat value={stats.days} label="DAGEN" rot=".5deg" />
              <EndStat
                value={stats.countries}
                label="LANDEN"
                color={C.teal}
                rot=".4deg"
              />
              <EndStat
                value={stats.repairs}
                label="REPARATIES"
                color={C.teal}
                rot="-.5deg"
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 10,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={replay.again}
                style={{
                  ...pillStyle,
                  background: C.red,
                  borderColor: C.red,
                  color: C.wrappedInk,
                }}
              >
                ↺ opnieuw
              </button>
              <button type="button" onClick={replay.exit} style={pillStyle}>
                sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
