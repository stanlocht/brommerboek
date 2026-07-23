// Admin dialog for the start/finish flags, opened by clicking a flag on the
// map. Uses the same place picker as the stop flow: search, tap a result,
// save — the chosen place becomes the flag's position and label. Styled
// after LoginPrompt so it reads as the same family of small overlays.

import { useEffect, useState } from "react"
import type { PlaceHit } from "./geocode"
import PlaceSearch from "./PlaceSearch"
import { C, FONT_MONO } from "./theme"
import type { MapFlag } from "./types"

interface FlagEditorProps {
  flag: MapFlag
  saving: boolean
  onClose: () => void
  onSave: (hit: PlaceHit) => void
}

export default function FlagEditor({
  flag,
  saving,
  onClose,
  onSave,
}: FlagEditorProps) {
  const [picked, setPicked] = useState<PlaceHit | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!picked || saving) return
    onSave(picked)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(20,15,10,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <button
        type="button"
        aria-label="Sluit"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "transparent",
          border: "none",
          cursor: "default",
        }}
      />
      <form
        onSubmit={submit}
        className="bb-scroll"
        style={{
          position: "relative",
          background: C.paperCard,
          border: `1.5px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          width: "100%",
          maxWidth: 340,
          maxHeight: "80%",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.4)",
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1,
            color: C.ochreDeep,
            textTransform: "uppercase",
          }}
        >
          {flag.kind === "start" ? "startvlag" : "finishvlag"} verplaatsen
        </div>

        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}>
          nu: {flag.label ? `${flag.label} — ` : ""}
          {flag.lat.toFixed(4)}°, {flag.lng.toFixed(4)}°
        </div>

        <PlaceSearch autoFocus={!picked} onPick={setPicked} />

        {picked && (
          <div
            style={{
              border: `1.5px solid ${C.ochre}`,
              borderRadius: 12,
              padding: 14,
              background: C.paperCard,
              boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 2,
                  color: C.ochreDeep,
                }}
              >
                GEKOZEN PLEK
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 2 }}>
                {picked.flag} {picked.place}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.sepia,
                  marginTop: 6,
                }}
              >
                ◉ {picked.lat.toFixed(4)}° N, {picked.lng.toFixed(4)}° E
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              style={{
                border: `1.5px solid ${C.ochre}`,
                borderRadius: 8,
                background: "none",
                padding: "6px 10px",
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.ochreDeep,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              herkies
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ ...btnStyle, background: "transparent", color: C.ink }}
          >
            annuleer
          </button>
          <button
            type="submit"
            disabled={!picked || saving}
            style={{
              ...btnStyle,
              background: C.ochreDeep,
              color: C.cream,
              flex: 1,
              opacity: !picked || saving ? 0.6 : 1,
            }}
          >
            {saving ? "…" : "opslaan"}
          </button>
        </div>
      </form>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 12,
  padding: "8px 14px",
  border: `1.5px solid ${C.ochreDeep}`,
  borderRadius: 20,
  cursor: "pointer",
}
