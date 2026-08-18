// Admin dialog for the trip's headline, opened by clicking the title on the
// map screen. One field, one button — styled after FlagEditor so it reads as
// the same family of small overlays.

import { useEffect, useRef, useState } from "react"
import { C, FONT_MONO, FONT_SERIF } from "./theme"
import { TRIP_TITLE_MAX_LENGTH } from "./trip"

interface TitleEditorProps {
  title: string
  saving: boolean
  onClose: () => void
  onSave: (title: string) => void
}

export default function TitleEditor({
  title,
  saving,
  onClose,
  onSave,
}: TitleEditorProps) {
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = value.trim()
  const unchanged = trimmed === title.trim()

  // Open with the current title selected, so typing replaces it outright.
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed || unchanged || saving) return
    onSave(trimmed)
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
      aria-label="Titel van de tocht wijzigen"
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
          titel van de tocht
        </div>

        <label style={{ display: "block" }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 2,
              color: C.ochreDeep,
            }}
          >
            KOPTEKST
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={TRIP_TITLE_MAX_LENGTH}
            style={{
              marginTop: 4,
              width: "100%",
              border: `1.5px solid ${C.border}`,
              borderRadius: 8,
              padding: "11px 12px",
              background: C.paperLight,
              fontFamily: FONT_SERIF,
              fontWeight: 700,
              fontSize: 18,
              color: C.ink,
              outline: "none",
            }}
          />
        </label>

        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.sepia }}>
          {trimmed.length}/{TRIP_TITLE_MAX_LENGTH} tekens · iedereen ziet deze
          titel boven de kaart
        </div>

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
            disabled={!trimmed || unchanged || saving}
            style={{
              ...btnStyle,
              background: C.ochreDeep,
              color: C.cream,
              flex: 1,
              opacity: !trimmed || unchanged || saving ? 0.6 : 1,
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
