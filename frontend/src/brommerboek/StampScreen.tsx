import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type CSSProperties, useMemo } from "react"
import { fetchStops } from "./api"
import { CubIcon } from "./icons"
import { deriveStamps, type Stamp } from "./stamps"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF, STAMP_ROTS } from "./theme"

function StampCard({ stamp, index }: { stamp: Stamp; index: number }) {
  const rot = STAMP_ROTS[index % STAMP_ROTS.length]
  return (
    <div style={{ marginTop: index % 2 === 1 ? 18 : 0 }}>
      <div
        className="bb-stampin"
        style={
          {
            "--r": rot,
            transform: `rotate(${rot})`,
            animationDelay: `${index * 90}ms`,
            background: C.paperCard,
            border: `1.5px solid ${C.border}`,
            borderRadius: 10,
            padding: 10,
            boxShadow: "2px 4px 0 rgba(120,90,40,.22)",
          } as CSSProperties
        }
      >
        <div
          style={{
            border: `2px solid ${C.red}`,
            borderRadius: "50%",
            boxShadow: `inset 0 0 0 2.5px ${C.paperCard}, inset 0 0 0 3.5px ${C.red}`,
            aspectRatio: "1.28",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            padding: "12px 10px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, lineHeight: 1 }}>{stamp.flag}</div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: C.ink,
              marginTop: 2,
            }}
          >
            {stamp.country}
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.red }}>
            · {dateLabelNL(stamp.date, false)} ·
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 1,
              color: C.sepia,
            }}
          >
            ENTRÉE · {stamp.code}
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.sepia,
            textAlign: "center",
            marginTop: 6,
          }}
        >
          {stamp.stops} {stamp.stops === 1 ? "stop" : "stops"}
        </div>
      </div>
    </div>
  )
}

function NextBorderCard({ index }: { index: number }) {
  return (
    <div style={{ marginTop: index % 2 === 1 ? 18 : 0 }}>
      <div
        style={{
          border: `2px dashed ${C.ochre}`,
          borderRadius: 10,
          minHeight: 160,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: 0.75,
        }}
      >
        <div style={{ opacity: 0.5 }}>
          <CubIcon width={54} height={35} />
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.ochreDeep,
            textAlign: "center",
          }}
        >
          volgende grens
          <br />
          wacht…
        </div>
      </div>
    </div>
  )
}

export default function StampScreen() {
  const {
    data: stops = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["stops"],
    queryFn: fetchStops,
  })

  const stamps = useMemo(() => deriveStamps(stops), [stops])

  if (isLoading) {
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
        <div
          style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ochreDeep }}
        >
          de stempelmuur wordt geladen…
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <div
        className="bb-app"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            background: C.paperCard,
            border: `1.5px solid ${C.border}`,
            borderRadius: 10,
            padding: "14px 16px",
            boxShadow: "1px 3px 0 rgba(120,90,40,.22)",
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            textAlign: "center",
          }}
        >
          kon de stempelmuur niet laden — draait de backend?
        </div>
      </div>
    )
  }

  return (
    <div className="bb-app">
      <div
        className="bb-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          background: C.paperLight,
        }}
      >
        {/* header */}
        <div style={{ padding: "18px 18px 4px", position: "relative" }}>
          <Link
            to="/"
            aria-label="Terug naar de kaart"
            style={{
              position: "absolute",
              top: 16,
              left: 14,
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: C.paperCard,
              border: `1.5px solid ${C.border}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.ink,
              fontSize: 18,
              textDecoration: "none",
              boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
            }}
          >
            ‹
          </Link>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              marginTop: 6,
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
              BROMMERBOEK · PASPOORT
            </div>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 30,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              Stempelmuur
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginTop: 4,
              }}
            >
              {stamps.length} {stamps.length === 1 ? "land" : "landen"} ·{" "}
              {stamps.length} {stamps.length === 1 ? "stempel" : "stempels"}{" "}
              verzameld
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 16px 40px" }}>
          {stamps.length === 0 && (
            <div
              style={{
                background: C.paperCard,
                border: `1.5px solid ${C.border}`,
                borderRadius: 10,
                padding: "14px 16px",
                boxShadow: "1px 3px 0 rgba(120,90,40,.22)",
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.sepia,
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              nog geen stempels — zet je eerste stop op de kaart en het eerste
              land verschijnt hier vanzelf
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              alignItems: "start",
            }}
          >
            {stamps.map((s, i) => (
              <StampCard key={s.code} stamp={s} index={i} />
            ))}
            <NextBorderCard index={stamps.length} />
          </div>
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
