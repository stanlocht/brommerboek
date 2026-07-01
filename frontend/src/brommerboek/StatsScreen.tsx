import { CubIcon } from "./icons"
import { C, FONT_MONO, FONT_SERIF } from "./theme"
import type { StatCard } from "./trip"

export default function StatsScreen({
  cards,
  recap,
  onRegen,
}: {
  cards: StatCard[]
  recap: string
  onRegen: () => void
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
        background: `linear-gradient(160deg,${C.wrappedFrom},${C.wrappedTo})`,
        color: C.wrappedInk,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.wrappedAccent,
            }}
          >
            BROMMERBOEK WRAPPED
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 30,
              lineHeight: 1,
              marginTop: 3,
            }}
          >
            Tot nu toe
          </div>
        </div>
        <CubIcon width={72} height={46} style={{ opacity: 0.9 }} />
      </div>

      <button
        type="button"
        onClick={onRegen}
        style={{
          display: "block",
          textAlign: "left",
          width: "100%",
          margin: "16px 0",
          padding: "14px 16px",
          border: `1.5px dashed ${C.wrappedAccent}`,
          borderRadius: 10,
          cursor: "pointer",
          background: "rgba(0,0,0,.12)",
          color: "inherit",
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.wrappedAccent,
            letterSpacing: 2,
            marginBottom: 5,
          }}
        >
          ★ HOOGTEPUNT · tik om te wisselen
        </div>
        <div
          key={recap}
          className="bb-fadein"
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: 18,
            lineHeight: 1.3,
          }}
        >
          {recap}
        </div>
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: C.wrappedInk,
              color: C.ink,
              borderRadius: 10,
              padding: 14,
              boxShadow: "0 3px 0 rgba(0,0,0,.18)",
              transform: `rotate(${c.rot})`,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1,
                color: C.red,
              }}
            >
              {c.value}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginTop: 4,
              }}
            >
              {c.label}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onRegen}
        style={{
          marginTop: 18,
          width: "100%",
          padding: 13,
          border: "none",
          borderRadius: 10,
          background: C.wrappedInk,
          color: C.wrappedFrom,
          fontFamily: FONT_MONO,
          fontSize: 13,
          letterSpacing: 1,
          cursor: "pointer",
          boxShadow: "0 3px 0 rgba(0,0,0,.2)",
        }}
      >
        ↻ GENEREER RECAP OPNIEUW
      </button>
      <div
        style={{
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: C.wrappedAccent,
          marginTop: 14,
          opacity: 0.8,
        }}
      >
        deel je reis · #brommerboek
      </div>
    </div>
  )
}
