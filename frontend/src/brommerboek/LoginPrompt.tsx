// Inline login dialog surfaced from the trip view when a viewer tries to
// comment or honk without being signed in. Deliberately not a route — the
// trip stays on screen behind the dialog and the caller resumes their action
// on success.

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { LoginService, OpenAPI } from "@/client"
import { C, FONT_MONO } from "./theme"

interface LoginPromptProps {
  intent: "comment" | "toeteren" | "signin"
  onClose: () => void
  onSuccess: () => void
}

const INTENT_COPY: Record<LoginPromptProps["intent"], string> = {
  comment: "Log in om een reactie te plaatsen.",
  toeteren: "Log in om te toeteren.",
  signin: "Inloggen",
}

export default function LoginPrompt({
  intent,
  onClose,
  onSuccess,
}: LoginPromptProps) {
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const login = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const res = await LoginService.loginAccessToken({ formData: creds })
      localStorage.setItem("access_token", res.access_token)
    },
    onSuccess: async () => {
      // Force the current-user query to refetch so gated UI (honks, add
      // buttons) flips over without a page reload.
      OpenAPI.TOKEN = async () => localStorage.getItem("access_token") ?? ""
      await qc.invalidateQueries({ queryKey: ["currentUser"] })
      onSuccess()
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || login.isPending) return
    login.mutate({ username: email, password })
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
          {INTENT_COPY[intent]}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}>
            e-mail
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}>
            wachtwoord
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {login.isError && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.red,
            }}
          >
            Inloggen mislukt — check e-mail en wachtwoord.
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
            disabled={login.isPending}
            style={{
              ...btnStyle,
              background: C.ochreDeep,
              color: C.cream,
              flex: 1,
              opacity: login.isPending ? 0.6 : 1,
            }}
          >
            {login.isPending ? "…" : "log in"}
          </button>
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.sepia,
            textAlign: "center",
          }}
        >
          nog geen account?{" "}
          <RouterLink
            to="/signup"
            style={{ color: C.ochreDeep, textDecoration: "underline" }}
          >
            aanmelden
          </RouterLink>
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
}

const btnStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 12,
  padding: "8px 14px",
  border: `1.5px solid ${C.ochreDeep}`,
  borderRadius: 20,
  cursor: "pointer",
}
