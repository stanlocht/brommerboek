import { CubIcon } from "./icons"
import { C, FONT_MONO } from "./theme"
import { REEL_SCENES } from "./trip"

export default function ReelScreen({
  playing,
  onToggle,
}: {
  playing: boolean
  onToggle: () => void
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
        background: "#1f1a14",
        color: C.wrappedInk,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.wrappedAccent,
        }}
      >
        AUTO-MONTAGE · CONCEPT
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 27,
          lineHeight: 1,
          margin: "3px 0 14px",
        }}
      >
        Reis-highlight
      </div>

      {/* player */}
      <div
        style={{
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          border: "2px solid #4a3f2c",
          aspectRatio: "9 / 12",
          background: "radial-gradient(120% 90% at 50% 20%,#3a5c62,#1c2a2c)",
        }}
      >
        <svg
          viewBox="0 0 300 380"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.85,
          }}
        >
          <path
            d="M40 60 C120 100 90 200 200 240 C260 262 250 320 210 340"
            fill="none"
            stroke={C.redBright}
            strokeWidth="3"
            strokeDasharray="2 8"
          />
          <circle cx="40" cy="60" r="5" fill={C.red} />
          <circle cx="210" cy="340" r="5" fill={C.red} />
        </svg>
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 210,
            transform: "translate(-50%,-50%) rotate(28deg)",
          }}
          className={playing ? "bb-cub-bob" : undefined}
        >
          <CubIcon width={70} height={44} />
        </div>
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            fontFamily: FONT_MONO,
            fontSize: 11,
            background: "rgba(0,0,0,.4)",
            padding: "4px 8px",
            borderRadius: 4,
          }}
        >
          ● REC · vlucht over de kaart
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pauzeer voorbeeld" : "Speel voorbeeld"}
            style={{
              width: 56,
              height: 56,
              margin: "0 auto",
              border: "none",
              borderRadius: "50%",
              background: C.wrappedInk,
              color: "#1f1a14",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,.5)",
              cursor: "pointer",
              fontSize: 22,
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 6,
            right: 12,
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.wrappedAccent,
          }}
        >
          0:34
        </div>
      </div>

      {/* filmstrip */}
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: "#9c8a6a",
          margin: "16px 0 8px",
          letterSpacing: 2,
        }}
      >
        STORYBOARD · 6 SCÈNES
      </div>
      <div
        className="bb-scroll"
        style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}
      >
        {REEL_SCENES.map((r) => (
          <div key={r.time} style={{ flex: "none", width: 96 }}>
            <div
              style={{
                height: 70,
                borderRadius: 6,
                border: "2px solid #4a3f2c",
                background: `linear-gradient(150deg,rgba(255,255,255,.2),rgba(0,0,0,.35)),${r.tone}`,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: 3,
                  right: 4,
                  fontFamily: FONT_MONO,
                  fontSize: 8,
                  color: C.wrappedInk,
                }}
              >
                {r.time}
              </div>
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                color: "#c9b98a",
                marginTop: 4,
              }}
            >
              {r.cap}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: "#9c8a6a",
        }}
      >
        <span>♪</span>
        <div
          style={{
            flex: 1,
            height: 20,
            borderRadius: 4,
            background:
              "repeating-linear-gradient(90deg,#3a3226 0 2px,transparent 2px 6px)",
            opacity: 0.6,
          }}
        />
        <span>accordeon-wals</span>
      </div>
      <button
        type="button"
        disabled
        style={{
          marginTop: 18,
          width: "100%",
          padding: 13,
          border: "1.5px solid #4a3f2c",
          borderRadius: 10,
          background: "transparent",
          color: "#9c8a6a",
          fontFamily: FONT_MONO,
          fontSize: 12,
          letterSpacing: 1,
        }}
      >
        ⤓ EXPORTEER VIDEO · binnenkort
      </button>
    </div>
  )
}
