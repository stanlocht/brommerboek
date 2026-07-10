// Vintage-styled shell shared by the standalone auth routes (/login,
// /signup, /recover-password, /reset-password). Replaces the template's
// two-pane shadcn AuthLayout with the paper/atlas idiom of AccountScreen.

import { Link } from "@tanstack/react-router"
import type { CSSProperties, ReactNode } from "react"
import { CubIcon } from "./icons"
import { C, FONT_MONO, FONT_SERIF } from "./theme"

export const authFieldStyle: CSSProperties = {
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  padding: "11px 12px",
  background: C.paperLight,
  fontSize: 15,
  width: "100%",
  color: C.ink,
  fontFamily: "inherit",
  outline: "none",
}

export const authPrimaryBtn: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 16px",
  border: "none",
  borderRadius: 10,
  background: C.red,
  color: C.wrappedInk,
  fontFamily: FONT_MONO,
  fontSize: 13,
  letterSpacing: 1,
  cursor: "pointer",
  boxShadow: "0 3px 0 rgba(90,30,20,.35)",
}

export const authLinkStyle: CSSProperties = {
  color: C.ochreDeep,
  textDecoration: "underline",
}

// Mono label above the control, mono validation error below it.
export function AuthField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control lives in children
    <label style={{ display: "block", marginBottom: 14 }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: C.ochreDeep,
          display: "block",
        }}
      >
        {label}
      </span>
      <div style={{ marginTop: 4 }}>{children}</div>
      {error && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.red,
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </label>
  )
}

// Status line inside the card (success/failure after submit).
export function AuthNote({
  children,
  color = C.sepia,
}: {
  children: ReactNode
  color?: string
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        color,
        marginTop: 10,
      }}
    >
      {children}
    </div>
  )
}

// Paper card the form sits on, slightly rotated like the account cards.
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        borderRadius: 12,
        padding: 18,
        boxShadow: "2px 4px 0 rgba(120,90,40,.22)",
        transform: "rotate(-.4deg)",
        marginTop: 12,
      }}
    >
      {children}
    </div>
  )
}

// Mono line under the card ("nog geen account? …").
export function AuthFootnote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: C.sepia,
        textAlign: "center",
        marginTop: 16,
      }}
    >
      {children}
    </div>
  )
}

export default function AuthScreen({
  kicker,
  title,
  intro,
  children,
}: {
  kicker: string
  title: string
  intro?: string
  children: ReactNode
}) {
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
              {kicker}
            </div>
            <h1
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 30,
                lineHeight: 1,
                margin: "2px 0 0",
              }}
            >
              {title}
            </h1>
            {intro && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.sepia,
                  marginTop: 4,
                  textAlign: "center",
                  maxWidth: 300,
                }}
              >
                {intro}
              </div>
            )}
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              <CubIcon width={64} height={40} />
            </div>
          </div>
        </div>

        {/* .bb-app spans the full viewport since the mobile-first pass;
            keep the form itself at phone width so it reads well on desktop. */}
        <div
          style={{ padding: "0 16px 40px", maxWidth: 420, margin: "0 auto" }}
        >
          {children}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
