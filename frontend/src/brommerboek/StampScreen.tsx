import type { CSSProperties } from "react"
import { CubIcon } from "./icons"
import { C, FONT_MONO } from "./theme"
import type { Stamp, TripStats } from "./trip"

export default function StampScreen({
  stamps,
  stats,
}: {
  stamps: Stamp[]
  stats: TripStats
}) {
  return (
    <div
      className="bb-scroll"
      style={{
        position: "absolute",
        inset: 0,
        bottom: 64,
        overflowY: "auto",
        padding: "20px 18px 30px",
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
        PASPOORT
      </div>
      <div style={{ fontWeight: 700, fontSize: 28, margin: "2px 0" }}>
        Stempelmuur
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 20,
        }}
      >
        {stats.countries} landen · {stats.stamps} stempels verzameld
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        {stamps.map((s, i) => (
          <div
            key={s.code}
            className="bb-stampin"
            style={
              {
                position: "relative",
                padding: 8,
                background: C.paperLight,
                borderRadius: 3,
                boxShadow: "0 2px 6px rgba(120,90,40,.2)",
                transform: `rotate(${s.rot})`,
                "--r": s.rot,
                animationDelay: `${i * 90}ms`,
              } as CSSProperties
            }
          >
            {/* perforated edge */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 3,
                padding: 3,
                background:
                  "repeating-linear-gradient(90deg,transparent 0 7px,#efe4c9 7px 9px),repeating-linear-gradient(0deg,transparent 0 7px,#efe4c9 7px 9px)",
                pointerEvents: "none",
                boxShadow: "inset 0 0 0 2px #e9dcbf",
              }}
            />
            <div
              style={{
                border: `2.5px solid ${s.ink}`,
                borderRadius: "50%/44%",
                padding: "14px 8px",
                textAlign: "center",
                color: s.ink,
                opacity: 0.9,
                position: "relative",
                zIndex: 1,
                overflow: "hidden",
                background: C.paperLight,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage:
                    "radial-gradient(rgba(255,255,255,.5) 1px,transparent 1px)",
                  backgroundSize: "3px 3px",
                  opacity: 0.5,
                }}
              />
              <div style={{ fontSize: 26 }}>{s.flag}</div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 1,
                  marginTop: 2,
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  transform: "rotate(-3deg)",
                  marginTop: 3,
                }}
              >
                ✦ {s.date} ✦
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 8,
                  letterSpacing: 2,
                  marginTop: 1,
                }}
              >
                ENTRÉE · {s.code}
              </div>
            </div>
          </div>
        ))}
        {/* next-border placeholder */}
        <div
          style={{
            opacity: 0.4,
            border: `2px dashed ${C.ochre}`,
            borderRadius: 3,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 150,
            color: "#8a6a3a",
          }}
        >
          <CubIcon width={70} height={46} style={{ opacity: 0.6 }} />
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              marginTop: 8,
              textAlign: "center",
            }}
          >
            volgende grens
            <br />
            wacht…
          </div>
        </div>
      </div>
    </div>
  )
}
