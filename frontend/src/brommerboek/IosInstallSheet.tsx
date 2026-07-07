// Instruction overlay for iPhone/iPad Safari, where Web Push only works from
// an installed PWA. Shown when a visitor taps "volg de reis" in the plain
// browser tab; walks them through "zet op beginscherm" in the paper-atlas
// idiom. Dependency-free — same overlay pattern as LoginPrompt.

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { CubIcon } from "./icons"
import { C, FONT_MONO, FONT_SERIF } from "./theme"

function ShareGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={C.teal}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10H6.2C5.3 10 4.5 10.8 4.5 11.7v7.1c0 .9.8 1.7 1.7 1.7h11.6c.9 0 1.7-.8 1.7-1.7v-7.1c0-.9-.8-1.7-1.7-1.7H17" />
      <path d="M12 14.5V3.5" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
    </svg>
  )
}

function AddToHomeGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={C.teal}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

function Step({
  n,
  glyph,
  children,
}: {
  n: number
  glyph: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: C.paperLight,
        border: `1px solid ${C.borderSoft}`,
        borderRadius: 10,
        transform: `rotate(${n % 2 ? "-.35deg" : ".35deg"})`,
      }}
    >
      <span
        style={{
          flex: "none",
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: `1.5px solid ${C.ochreDeep}`,
          color: C.ochreDeep,
          fontFamily: FONT_MONO,
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </span>
      <span style={{ flex: "none", display: "inline-flex" }}>{glyph}</span>
      <span style={{ fontSize: 14, lineHeight: 1.45, color: C.inkSoft }}>
        {children}
      </span>
    </li>
  )
}

export default function IosInstallSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Portal to <body>: callers sit inside rotated (transformed) cards and
  // absolutely-positioned headers, which would otherwise trap the overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zet brommerboek op je beginscherm"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(20,15,10,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      className="bb-fadein"
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
      <div
        style={{
          position: "relative",
          background: C.paperCard,
          border: `1.5px solid ${C.border}`,
          borderRadius: 12,
          padding: "20px 18px 18px",
          width: "100%",
          maxWidth: 360,
          boxShadow: "0 10px 30px rgba(0,0,0,.4)",
          transform: "rotate(-.4deg)",
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
          BROMMERBOEK · MELDINGEN
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 24,
            lineHeight: 1.1,
            margin: "4px 0 6px",
            color: C.ink,
          }}
        >
          zet brommerboek op je beginscherm
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            marginBottom: 14,
          }}
        >
          op iphone werken meldingen zodra de app op het beginscherm staat —
          drie tikjes en je rijdt mee.
        </div>
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Step n={1} glyph={<ShareGlyph />}>
            tik op <strong>delen</strong> in de balk van safari
          </Step>
          <Step n={2} glyph={<AddToHomeGlyph />}>
            kies <strong>'zet op beginscherm'</strong>
          </Step>
          <Step n={3} glyph={<CubIcon width={30} height={22} />}>
            open de app vanaf je beginscherm en tik op <strong>volg</strong>
          </Step>
        </ol>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px 16px",
            border: "none",
            borderRadius: 10,
            background: C.red,
            color: C.wrappedInk,
            fontFamily: FONT_MONO,
            fontSize: 13,
            letterSpacing: 1,
            cursor: "pointer",
            boxShadow: "0 3px 0 rgba(90,30,20,.35)",
          }}
        >
          oké
        </button>
      </div>
    </div>,
    document.body,
  )
}
