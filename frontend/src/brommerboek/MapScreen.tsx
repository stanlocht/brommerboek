import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"
import type { Role } from "./BrommerboekApp"
import type { RouteGeometry } from "./geo"
import { nearestStop, stopFraction } from "./geo"
import { WrenchIcon } from "./icons"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF, kmLabel } from "./theme"
import type { TripStats } from "./trip"
import type { Stop } from "./types"
import VintageMap from "./VintageMap"

function frac(e: ReactPointerEvent<HTMLDivElement>): number {
  const r = e.currentTarget.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}

// "vandaag" / "gisteren" / "N dagen geleden" — colloquial Dutch relative time
// for the follower's "Aangekomen in X" line.
function daysAgoLabel(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const days = Math.max(0, Math.floor((now - then) / 86400000))
  if (days === 0) return "vandaag"
  if (days === 1) return "gisteren"
  return `${days} dagen geleden`
}

const roleBtnBase: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 1,
  padding: "4px 10px",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  color: C.ink,
  background: "transparent",
}

function RoleToggle({
  role,
  onChange,
}: {
  role: Role
  onChange: (r: Role) => void
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 14,
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
      }}
    >
      <button
        type="button"
        onClick={() => onChange("rijder")}
        style={{
          ...roleBtnBase,
          background: role === "rijder" ? C.red : "transparent",
          color: role === "rijder" ? C.wrappedInk : C.sepia,
        }}
      >
        RIJDER
      </button>
      <button
        type="button"
        onClick={() => onChange("volger")}
        style={{
          ...roleBtnBase,
          background: role === "volger" ? C.teal : "transparent",
          color: role === "volger" ? C.wrappedInk : C.sepia,
        }}
      >
        VOLGER
      </button>
    </div>
  )
}

export default function MapScreen({
  stops,
  route,
  stats,
  cur,
  progress,
  dragging,
  repairOnly,
  role,
  onRoleChange,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onStep,
  onToggleRepair,
  onOpenSheet,
  onPinClick,
  onAdd,
}: {
  stops: Stop[]
  route: RouteGeometry
  stats: TripStats
  cur: Stop
  progress: number
  dragging: boolean
  repairOnly: boolean
  role: Role
  onRoleChange: (r: Role) => void
  onScrubStart: (p: number) => void
  onScrubMove: (p: number) => void
  onScrubEnd: (p: number) => void
  onStep: (dir: -1 | 1) => void
  onToggleRepair: () => void
  onOpenSheet: () => void
  onPinClick: (i: number) => void
  onAdd?: () => void
}) {
  const pct = `${(progress * 100).toFixed(2)}%`
  const showPreview = !dragging
  const isRijder = role === "rijder"
  const latest = stops[stops.length - 1]
  const currentStopIndex = nearestStop(route, progress)
  const atStart = currentStopIndex === 0
  const atEnd = currentStopIndex === stops.length - 1

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <VintageMap
        stops={stops}
        route={route}
        progress={progress}
        dragging={dragging}
        repairOnly={repairOnly}
        onPinClick={onPinClick}
      />

      {/* header */}
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
              De Grote Tocht
            </div>
            {isRijder ? (
              <div
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
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: 2,
                    color: C.ochreDeep,
                  }}
                >
                  JOUW LOGBOEK
                </span>
                <span style={{ color: C.red, fontSize: 13 }}>
                  {kmLabel(stats.km)}
                </span>
                <span>km · dag {stats.days}</span>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      letterSpacing: 2,
                      color: C.wrappedInk,
                      background: C.teal,
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}
                  >
                    ✦ VOLGEND
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.ink,
                    }}
                  >
                    Je volgt Daan de Vries
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: C.sepia,
                    marginTop: 3,
                  }}
                >
                  ◉ Aangekomen in {latest.place} · {daysAgoLabel(latest.date)}
                </div>
              </div>
            )}
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
            <RoleToggle role={role} onChange={onRoleChange} />
          </div>
        </div>
      </div>

      {/* repair toggle (top-right, below the header) */}
      <button
        type="button"
        onClick={onToggleRepair}
        style={{
          position: "absolute",
          top: isRijder ? 128 : 128,
          right: 14,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: `1.5px solid ${C.ochre}`,
          borderRadius: 20,
          padding: "6px 11px",
          background: repairOnly ? C.teal : C.paperCard,
          color: repairOnly ? C.cream : C.ink,
          fontFamily: FONT_MONO,
          fontSize: 11,
          cursor: "pointer",
          boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
        }}
      >
        <WrenchIcon size={15} color="currentColor" />
        Reparaties
      </button>

      {/* landed preview card */}
      {showPreview && (
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
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 7,
                flex: "none",
                border: "3px solid #fff",
                boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                background: `linear-gradient(150deg,rgba(255,255,255,.28),rgba(0,0,0,.3)),${
                  cur.media[0]?.tone ?? "#c9a24e"
                }`,
              }}
            />
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
              justifyContent: "space-between",
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.ochreDeep,
            }}
          >
            <span>{stops[0]?.place}</span>
            <span>rijd de route ›</span>
            <span>{stops[stops.length - 1]?.place}</span>
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
                  background: s.type === "repair" ? C.teal : C.red,
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

      {/* floating + (rijder only) */}
      {onAdd && (
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
