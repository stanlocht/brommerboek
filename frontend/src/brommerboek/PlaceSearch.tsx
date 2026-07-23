// Shared search-as-you-type place picker backed by the Photon geocoder — the
// exact control the stop flow uses on its "Waar ben je?" step, reused by the
// flag editor so both pick locations the same way. Owns its query/result
// state; the caller only receives the chosen PlaceHit.

import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { type PlaceHit, searchPlaces } from "./geocode"
import { C, FONT_MONO } from "./theme"

interface PlaceSearchProps {
  onPick: (hit: PlaceHit) => void
  label?: string
  placeholder?: string
  // Focus the input on mount and whenever this flips back to true (the stop
  // flow re-focuses when the picked place is cleared).
  autoFocus?: boolean
}

export default function PlaceSearch({
  onPick,
  label = "ZOEK PLAATS",
  placeholder = "bv. Firenze, Grimselpass, Vernazza…",
  autoFocus = false,
}: PlaceSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Debounced search: fires 400ms after the last keystroke, cancels the
  // in-flight request when the user keeps typing.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    const ac = new AbortController()
    const t = setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      searchPlaces(trimmed, ac.signal)
        .then((hits) => {
          setResults(hits)
          setSearching(false)
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return
          setSearching(false)
          setSearchError("Kon geen plaatsen ophalen")
        })
    }, 400)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [query])

  const pick = (hit: PlaceHit) => {
    setResults([])
    setQuery("")
    onPick(hit)
  }

  return (
    <div>
      <label style={{ display: "block" }}>
        <span
          style={{
            letterSpacing: 2,
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.ochreDeep,
            display: "block",
          }}
        >
          {label}
        </span>
        <div style={{ position: "relative", marginTop: 4 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            style={{ ...inputStyle, paddingLeft: 34 }}
          />
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.ochreDeep,
              fontSize: 14,
            }}
          >
            🔍
          </span>
        </div>
      </label>

      {searching && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.sepia,
            marginTop: 10,
          }}
        >
          zoeken…
        </div>
      )}
      {searchError && !searching && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.red,
            marginTop: 10,
          }}
        >
          {searchError}
        </div>
      )}

      {results.length > 0 && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {results.map((hit) => (
            <button
              key={hit.key}
              type="button"
              onClick={() => pick(hit)}
              style={{
                textAlign: "left",
                border: `1.5px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                background: C.paperCard,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: "inherit",
                color: C.ink,
              }}
            >
              <span style={{ fontSize: 22 }} aria-hidden="true">
                {hit.flag || "📍"}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {hit.place}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: C.sepia,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {[hit.region, hit.country].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const inputStyle: CSSProperties = {
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  padding: "11px 12px",
  background: C.paperCard,
  fontSize: 16,
  width: "100%",
  color: C.ink,
  fontFamily: "inherit",
}
