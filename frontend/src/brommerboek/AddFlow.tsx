import { type CSSProperties, type ReactNode, useState } from "react"
import { WrenchIcon } from "./icons"
import { C, FONT_MONO } from "./theme"
import type { NewStop } from "./types"

const COUNTRIES: Record<string, { country: string; flag: string }> = {
  NL: { country: "Nederland", flag: "🇳🇱" },
  BE: { country: "België", flag: "🇧🇪" },
  FR: { country: "Frankrijk", flag: "🇫🇷" },
  CH: { country: "Zwitserland", flag: "🇨🇭" },
  IT: { country: "Italië", flag: "🇮🇹" },
  DE: { country: "Duitsland", flag: "🇩🇪" },
  AT: { country: "Oostenrijk", flag: "🇦🇹" },
}

const TILE_TONES = ["#7ea6b4", "#c9a24e", "#94a06a", "#b26a4c"]
const STEP_LABELS = ["LOCATIE", "MEDIA", "VERHAAL", "TYPE"]

const labelStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  color: C.ochreDeep,
  display: "block",
}
const fieldStyle: CSSProperties = {
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  padding: "11px 12px",
  background: C.paperCard,
  fontSize: 16,
  width: "100%",
  color: C.ink,
  fontFamily: "inherit",
}

// A label that wraps its control (keeps them associated for a11y).
function Field({
  label,
  color,
  children,
}: {
  label: string
  color?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label style={{ display: "block" }}>
      <span style={{ ...labelStyle, color: color ?? C.ochreDeep }}>
        {label}
      </span>
      {children}
    </label>
  )
}

export default function AddFlow({
  suggestedKm,
  onClose,
  onSubmit,
}: {
  suggestedKm: number
  onClose: () => void
  onSubmit: (stop: NewStop) => void
}) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState<"stop" | "repair">("stop")
  const [place, setPlace] = useState("Firenze")
  const [code, setCode] = useState("IT")
  const [lat, setLat] = useState("43.7696")
  const [lng, setLng] = useState("11.2558")
  const [date, setDate] = useState("2024-05-21")
  const [title, setTitle] = useState("Aankomst in Toscane")
  const [weather, setWeather] = useState("Zon, 27°")
  const [km, setKm] = useState(String(suggestedKm + 96))
  const [story, setStory] = useState(
    "De heuvels werden goudkleurig toen we Firenze binnenreden. Cub liep als een zonnetje na de opknapbeurt bij de pas…",
  )
  const [broke, setBroke] = useState("Bougie verzopen na regen")
  const [fixed, setFixed] = useState("Nieuwe bougie, tank gedroogd")
  const [tones, setTones] = useState<string[]>([TILE_TONES[0], TILE_TONES[1]])

  const addPhoto = () =>
    setTones((t) => [...t, TILE_TONES[t.length % TILE_TONES.length]])

  const submit = () => {
    const meta = COUNTRIES[code] ?? COUNTRIES.IT
    onSubmit({
      place: place.trim() || "Naamloze stop",
      country: meta.country,
      flag: meta.flag,
      code,
      lat: Number.parseFloat(lat) || 0,
      lng: Number.parseFloat(lng) || 0,
      date,
      title: title.trim() || place.trim() || "Nieuwe stop",
      km: Number.parseInt(km, 10) || 0,
      weather: weather.trim(),
      type,
      story: story.trim(),
      broke: type === "repair" ? broke.trim() : null,
      fixed: type === "repair" ? fixed.trim() : null,
      media: tones.map((tone) => ({ tone, cap: "", video: false })),
    })
  }

  const next = () => {
    if (step < 3) setStep((s) => s + 1)
    else submit()
  }
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 70,
        background: C.paperLight,
        display: "flex",
        flexDirection: "column",
      }}
      className="bb-fadein"
    >
      <div
        style={{
          padding: "16px 18px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "none",
            fontSize: 15,
            fontFamily: FONT_MONO,
            color: C.sepia,
            cursor: "pointer",
          }}
        >
          ✕ sluit
        </button>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.ochreDeep,
          }}
        >
          NIEUWE STOP · {STEP_LABELS[step]}
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* progress dots */}
      <div style={{ display: "flex", gap: 6, padding: "12px 18px" }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= step ? C.red : C.borderSoft,
            }}
          />
        ))}
      </div>

      <div
        className="bb-scroll"
        style={{ flex: 1, overflowY: "auto", padding: "6px 18px 18px" }}
      >
        {step === 0 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 10 }}>
              Waar ben je?
            </div>
            <div
              style={{
                position: "relative",
                height: 230,
                borderRadius: 12,
                overflow: "hidden",
                border: `2px solid ${C.ochre}`,
              }}
            >
              <svg
                viewBox="0 0 300 230"
                aria-hidden="true"
                style={{ width: "100%", height: "100%", background: C.sea }}
              >
                <path
                  d="M-10 40 C80 60 120 20 180 60 C240 100 260 60 320 90 L320 240 L-10 240 Z"
                  fill="#e7d9b6"
                  stroke={C.ochre}
                  strokeWidth="2"
                />
                <path
                  d="M20 120 C90 140 150 130 250 170"
                  fill="none"
                  stroke={C.redBright}
                  strokeWidth="2.5"
                  strokeDasharray="1 7"
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  left: 172,
                  top: 120,
                  transform: "translate(-50%,-100%)",
                }}
              >
                <svg
                  width="30"
                  height="40"
                  viewBox="0 0 30 40"
                  aria-hidden="true"
                >
                  <path
                    d="M15 0C7 0 1 6 1 14c0 10 14 26 14 26s14-16 14-26C29 6 23 0 15 0Z"
                    fill={C.red}
                    stroke={C.cream}
                    strokeWidth="2"
                  />
                  <circle cx="15" cy="14" r="5" fill={C.cream} />
                </svg>
              </div>
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  background: C.paperLight,
                  padding: "3px 7px",
                  borderRadius: 5,
                }}
              >
                kies je plek ›
              </div>
            </div>
            <div
              style={{
                marginTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <Field label="PLAATSNAAM">
                <input
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  style={{ ...fieldStyle, marginTop: 4 }}
                />
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field label="LAND">
                    <select
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4 }}
                    >
                      {Object.entries(COUNTRIES).map(([c, m]) => (
                        <option key={c} value={c}>
                          {m.flag} {m.country}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="DATUM">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4 }}
                    />
                  </Field>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field label="◉ LAT">
                    <input
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      inputMode="decimal"
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 14 }}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="◉ LNG">
                    <input
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      inputMode="decimal"
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 14 }}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 4 }}>
              Foto's & video's
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginBottom: 14,
              }}
            >
              {tones.length} toegevoegd
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {tones.map((tone, i) => (
                <div
                  key={`${tone}-${i}`}
                  style={{
                    aspectRatio: "1",
                    borderRadius: 8,
                    border: "4px solid #fff",
                    boxShadow: "0 2px 5px rgba(0,0,0,.2)",
                    background: `linear-gradient(150deg,rgba(255,255,255,.25),rgba(0,0,0,.3)),${tone}`,
                  }}
                />
              ))}
              <button
                type="button"
                onClick={addPhoto}
                aria-label="Voeg foto toe"
                style={{
                  aspectRatio: "1",
                  border: `2px dashed ${C.ochre}`,
                  borderRadius: 8,
                  background: "none",
                  color: "#8a6a3a",
                  fontSize: 30,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ＋
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 12 }}>
              Het verhaal
            </div>
            <Field label="TITEL">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  ...fieldStyle,
                  margin: "4px 0 14px",
                  fontSize: 17,
                  fontWeight: 600,
                }}
              />
            </Field>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <Field label="WEER">
                  <input
                    value={weather}
                    onChange={(e) => setWeather(e.target.value)}
                    style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                  />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="KM-STAND">
                  <input
                    value={km}
                    onChange={(e) => setKm(e.target.value)}
                    inputMode="numeric"
                    style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                  />
                </Field>
              </div>
            </div>
            <Field label="VERHAAL">
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                style={{
                  ...fieldStyle,
                  marginTop: 4,
                  minHeight: 150,
                  fontSize: 15.5,
                  lineHeight: 1.6,
                  color: C.inkSoft,
                  resize: "vertical",
                }}
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 14 }}>
              Wat voor stop?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                type="button"
                onClick={() => setType("stop")}
                style={{
                  textAlign: "left",
                  border: `2px solid ${type === "stop" ? C.red : C.border}`,
                  borderRadius: 12,
                  padding: 16,
                  background: type === "stop" ? "#f7edd6" : C.paperCard,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <svg
                  width="34"
                  height="44"
                  viewBox="0 0 30 40"
                  aria-hidden="true"
                >
                  <path
                    d="M15 0C7 0 1 6 1 14c0 10 14 26 14 26s14-16 14-26C29 6 23 0 15 0Z"
                    fill={C.red}
                    stroke={C.paperLight}
                    strokeWidth="2"
                  />
                  <circle cx="15" cy="14" r="5" fill={C.paperLight} />
                </svg>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>
                    Gewone stop
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                    }}
                  >
                    een plek, een verhaal
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setType("repair")}
                style={{
                  textAlign: "left",
                  border: `2px solid ${type === "repair" ? C.teal : C.border}`,
                  borderRadius: 12,
                  padding: 16,
                  background: type === "repair" ? "#eaf1f2" : C.paperCard,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: C.teal,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <WrenchIcon size={20} color={C.cream} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>Reparatie</div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                    }}
                  >
                    wat brak, wat je maakte
                  </div>
                </div>
              </button>
              {type === "repair" && (
                <div
                  className="bb-fadein"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 2,
                  }}
                >
                  <Field label="WAT BRAK">
                    <input
                      value={broke}
                      onChange={(e) => setBroke(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                    />
                  </Field>
                  <Field label="WAT JE MAAKTE" color={C.teal}>
                    <input
                      value={fixed}
                      onChange={(e) => setFixed(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "14px 18px",
          borderTop: `1px solid ${C.borderSoft}`,
          display: "flex",
          gap: 10,
        }}
      >
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            style={{
              flex: "none",
              padding: "14px 18px",
              border: `1.5px solid ${C.ochre}`,
              borderRadius: 10,
              background: "none",
              fontFamily: FONT_MONO,
              fontSize: 13,
              color: C.sepia,
              cursor: "pointer",
            }}
          >
            ‹ terug
          </button>
        )}
        <button
          type="button"
          onClick={next}
          style={{
            flex: 1,
            padding: 14,
            border: "none",
            borderRadius: 10,
            background: C.red,
            color: C.wrappedInk,
            fontFamily: FONT_MONO,
            fontSize: 14,
            letterSpacing: 1,
            cursor: "pointer",
            boxShadow: "0 3px 0 rgba(90,30,20,.4)",
          }}
        >
          {step < 3 ? "volgende ›" : "✓ plaats stop"}
        </button>
      </div>
    </div>
  )
}
