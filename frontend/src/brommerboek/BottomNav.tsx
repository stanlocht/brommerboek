import type { CSSProperties } from "react"
import { C, FONT_MONO } from "./theme"

type Screen = "map" | "stamps" | "stats" | "reel"

const tab: CSSProperties = {
  border: "none",
  background: "none",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  cursor: "pointer",
  fontFamily: FONT_MONO,
  fontSize: 9,
  padding: 0,
}

export default function BottomNav({
  screen,
  onMap,
  onStamps,
  onStats,
  onReel,
  onAdd,
}: {
  screen: Screen
  onMap: () => void
  onStamps: () => void
  onStats: () => void
  onReel: () => void
  onAdd: () => void
}) {
  const col = (s: Screen) => (screen === s ? C.red : C.navIdle)
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 64,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        background: C.paperLight,
        borderTop: `1.5px solid ${C.border}`,
        boxShadow: "0 -2px 6px rgba(120,90,40,.12)",
      }}
    >
      <button
        type="button"
        onClick={onMap}
        style={{ ...tab, color: col("map") }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
        KAART
      </button>
      <button
        type="button"
        onClick={onStamps}
        style={{ ...tab, color: col("stamps") }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="12" cy="11" r="3.5" />
          <path d="M8 17h8" />
        </svg>
        STEMPELS
      </button>
      <button
        type="button"
        onClick={onAdd}
        aria-label="Nieuwe stop"
        style={{
          border: `3px solid ${C.paperLight}`,
          background: C.red,
          width: 52,
          height: 52,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: C.wrappedInk,
          marginTop: -14,
          boxShadow: "0 3px 8px rgba(90,30,20,.4)",
        }}
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onStats}
        style={{ ...tab, color: col("stats") }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M5 19V9M12 19V5M19 19v-7" />
        </svg>
        RECAP
      </button>
      <button
        type="button"
        onClick={onReel}
        style={{ ...tab, color: col("reel") }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 9h18M8 5v14M16 5v14" />
        </svg>
        REEL
      </button>
    </div>
  )
}
