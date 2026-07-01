import type { PointerEvent as ReactPointerEvent } from "react"
import type { RouteGeometry } from "./geo"
import { stopFraction } from "./geo"
import { CubIcon, WrenchIcon } from "./icons"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF } from "./theme"
import type { TripStats } from "./trip"
import type { Stop } from "./types"
import VintageMap from "./VintageMap"

function frac(e: ReactPointerEvent<HTMLDivElement>): number {
  const r = e.currentTarget.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}

export default function MapScreen({
  stops,
  route,
  stats,
  cur,
  progress,
  dragging,
  repairOnly,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onToggleRepair,
  onOpenSheet,
  onPinClick,
}: {
  stops: Stop[]
  route: RouteGeometry
  stats: TripStats
  cur: Stop
  progress: number
  dragging: boolean
  repairOnly: boolean
  onScrubStart: (p: number) => void
  onScrubMove: (p: number) => void
  onScrubEnd: (p: number) => void
  onToggleRepair: () => void
  onOpenSheet: () => void
  onPinClick: (i: number) => void
}) {
  const pct = `${(progress * 100).toFixed(2)}%`
  const showPreview = !dragging

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
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
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
          </div>
          <div
            style={{
              textAlign: "right",
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: "#5a5040",
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 19, color: C.red }}>{stats.km}</div>
            <div>km · dag {stats.days}</div>
          </div>
        </div>
      </div>

      {/* repair toggle */}
      <button
        type="button"
        onClick={onToggleRepair}
        style={{
          position: "absolute",
          top: 72,
          left: 14,
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
            bottom: 150,
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
          bottom: 64,
          zIndex: 23,
          padding: "12px 16px 14px",
          background: "linear-gradient(#efe4c900,#efe4c9 40%)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.ochreDeep,
            marginBottom: 9,
          }}
        >
          <span>{stops[0]?.place}</span>
          <span>rijd de route ›</span>
          <span>{stops[stops.length - 1]?.place}</span>
        </div>
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
          <div
            style={{
              position: "absolute",
              top: -9,
              left: pct,
              transform: "translateX(-50%)",
              width: 52,
              height: 34,
              pointerEvents: "none",
            }}
          >
            <CubIcon width={52} height={34} />
          </div>
        </div>
      </div>
    </div>
  )
}
