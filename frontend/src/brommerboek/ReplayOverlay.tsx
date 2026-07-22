// Overlay chrome for the "rij de reis" replay: rolling km/date header strip,
// compact stop cards, passport border stamps, skip/stop controls and the end
// card. The root is pointer-transparent so map gestures still reach MapLibre;
// only the controls themselves catch input.

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { mediaSrc } from "./api"
import type { RouteGeometry } from "./geo"
import { dateAtProgress, kmAtProgress } from "./replayMath"
import {
  C,
  dateLabelNL,
  FONT_MONO,
  FONT_SERIF,
  kmLabel,
  PIN_ROTS,
} from "./theme"
import type { TripStats } from "./trip"
import type { Stop } from "./types"
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

function ReplayStopCard({ stop }: { stop: Stop }) {
  const first = stop.media[0]
  const src = mediaSrc(first?.url)
  return (
    <div
      className="bb-fadeup"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 84,
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
      <div
        style={{
          width: 56,
          height: 56,
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
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        {src && first?.kind === "video" && (
          <video
            src={src}
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
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
  // Any tap or drag anywhere brings the skip/stop controls back for a bit.
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
  const kmNow = kmAtProgress(stops, route, progress)
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

      {/* skip / stop controls */}
      {driving && controlsVisible && (
        <div
          className="bb-fadein"
          style={{
            position: "absolute",
            bottom: 26,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 10,
          }}
        >
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
