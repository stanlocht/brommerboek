// Admin dialog for the start/finish flags, opened by clicking a flag on the
// map. Coordinates can be typed directly or picked by tapping the map (the
// caller hides this dialog while pick mode is active). Styled after
// LoginPrompt so it reads as the same family of small overlays.

import { useEffect } from "react"
import type { FlagDraft } from "./flagEdit"
import { parseFlagDraft } from "./flagEdit"
import { C, FONT_MONO } from "./theme"

interface FlagEditorProps {
  draft: FlagDraft
  saving: boolean
  onChange: (draft: FlagDraft) => void
  // Enter pick-on-map mode: the caller closes this dialog and waits for a
  // map click to fill the coordinates.
  onPickOnMap: () => void
  onClose: () => void
  onSave: () => void
}

export default function FlagEditor({
  draft,
  saving,
  onChange,
  onPickOnMap,
  onClose,
  onSave,
}: FlagEditorProps) {
  const parsed = parseFlagDraft(draft)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed || saving) return
    onSave()
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
        style={{
          position: "relative",
          background: C.paperCard,
          border: `1.5px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          width: "100%",
          maxWidth: 340,
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
          {draft.kind === "start" ? "startvlag" : "finishvlag"} verplaatsen
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}>
            label
          </span>
          <input
            type="text"
            maxLength={255}
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            style={inputStyle}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
            }}
          >
            <span
              style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}
            >
              breedtegraad
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={draft.lat}
              onChange={(e) => onChange({ ...draft, lat: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
            }}
          >
            <span
              style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}
            >
              lengtegraad
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={draft.lng}
              onChange={(e) => onChange({ ...draft, lng: e.target.value })}
              style={inputStyle}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={onPickOnMap}
          style={{
            ...btnStyle,
            background: "transparent",
            color: C.teal,
            borderColor: C.teal,
          }}
        >
          📍 kies een punt op de kaart
        </button>

        {!parsed && (
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.red }}>
            Ongeldige coördinaten — breedtegraad −90…90, lengtegraad −180…180.
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
            disabled={!parsed || saving}
            style={{
              ...btnStyle,
              background: C.ochreDeep,
              color: C.cream,
              flex: 1,
              opacity: !parsed || saving ? 0.6 : 1,
            }}
          >
            {saving ? "…" : "opslaan"}
          </button>
        </div>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  padding: "8px 10px",
  border: `1.5px solid ${C.border}`,
  borderRadius: 6,
  background: C.paperLight,
  color: C.ink,
  outline: "none",
  width: "100%",
}

const btnStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 12,
  padding: "8px 14px",
  border: `1.5px solid ${C.ochreDeep}`,
  borderRadius: 20,
  cursor: "pointer",
}
