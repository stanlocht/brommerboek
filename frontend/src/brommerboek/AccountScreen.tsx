// Vintage-styled account/settings screen. Replaces the template's shadcn
// tabs page. Lets a signed-in rijder update their profile, change password,
// log out, and delete their account — all in the paper/atlas idiom.

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { type UpdatePassword, UsersService, type UserUpdateMe } from "@/client"
import useAuth from "@/hooks/useAuth"
import IosInstallSheet from "./IosInstallSheet"
import { CubIcon } from "./icons"
import {
  currentSubscription,
  isPushSupported,
  needsIosInstall,
  readIosEnv,
  subscribe,
} from "./push"
import { C, FONT_MONO, FONT_SERIF } from "./theme"

const labelStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.ochreDeep,
  display: "block",
}
const fieldStyle: CSSProperties = {
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
const primaryBtn: CSSProperties = {
  padding: "10px 16px",
  border: "none",
  borderRadius: 10,
  background: C.red,
  color: C.wrappedInk,
  fontFamily: FONT_MONO,
  fontSize: 12,
  letterSpacing: 1,
  cursor: "pointer",
  boxShadow: "0 3px 0 rgba(90,30,20,.35)",
}
const ghostBtn: CSSProperties = {
  padding: "10px 14px",
  border: `1.5px solid ${C.ochre}`,
  borderRadius: 10,
  background: "none",
  fontFamily: FONT_MONO,
  fontSize: 12,
  color: C.sepia,
  cursor: "pointer",
}

function Card({
  title,
  children,
  rot = "-.4deg",
}: {
  title: string
  children: ReactNode
  rot?: string
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.ochreDeep,
          margin: "0 0 8px 2px",
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: C.paperCard,
          border: `1.5px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          boxShadow: "2px 4px 0 rgba(120,90,40,.22)",
          transform: `rotate(${rot})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control lives in children
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  )
}

function Note({
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
        marginTop: 8,
      }}
    >
      {children}
    </div>
  )
}

function ProfileCard() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(user?.full_name ?? "")
  const [email, setEmail] = useState(user?.email ?? "")
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  )

  // Sync when the user object arrives / refetches.
  useEffect(() => {
    if (!editing) {
      setFullName(user?.full_name ?? "")
      setEmail(user?.email ?? "")
    }
  }, [user, editing])

  const mutation = useMutation({
    mutationFn: (data: UserUpdateMe) =>
      UsersService.updateUserMe({ requestBody: data }),
    onSuccess: async () => {
      setMsg({ tone: "ok", text: "gegevens bijgewerkt" })
      setEditing(false)
      await qc.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: () => setMsg({ tone: "err", text: "kon gegevens niet opslaan" }),
  })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const patch: UserUpdateMe = {}
    if (fullName !== (user?.full_name ?? "")) patch.full_name = fullName || null
    if (email !== user?.email) patch.email = email
    if (!Object.keys(patch).length) {
      setEditing(false)
      return
    }
    mutation.mutate(patch)
  }

  const cancel = () => {
    setFullName(user?.full_name ?? "")
    setEmail(user?.email ?? "")
    setEditing(false)
    setMsg(null)
  }

  return (
    <Card title="GEGEVENS" rot="-.4deg">
      {editing ? (
        <form onSubmit={save}>
          <Field label="NAAM">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={30}
              style={fieldStyle}
            />
          </Field>
          <Field label="E-MAIL">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          {msg && (
            <Note color={msg.tone === "ok" ? C.teal : C.red}>{msg.text}</Note>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                ...primaryBtn,
                opacity: mutation.isPending ? 0.6 : 1,
              }}
            >
              {mutation.isPending ? "…" : "✓ opslaan"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={mutation.isPending}
              style={ghostBtn}
            >
              annuleer
            </button>
          </div>
        </form>
      ) : (
        <>
          <Field label="NAAM">
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontSize: 18,
                color: user?.full_name ? C.ink : C.sepia,
              }}
            >
              {user?.full_name || "—"}
            </div>
          </Field>
          <Field label="E-MAIL">
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 14,
                color: C.ink,
                wordBreak: "break-all",
              }}
            >
              {user?.email}
            </div>
          </Field>
          {msg && (
            <Note color={msg.tone === "ok" ? C.teal : C.red}>{msg.text}</Note>
          )}
          <button
            type="button"
            onClick={() => {
              setMsg(null)
              setEditing(true)
            }}
            style={ghostBtn}
          >
            ✎ bewerk
          </button>
        </>
      )}
    </Card>
  )
}

function PasswordCard() {
  const [cur, setCur] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  )

  const mutation = useMutation({
    mutationFn: (data: UpdatePassword) =>
      UsersService.updatePasswordMe({ requestBody: data }),
    onSuccess: () => {
      setMsg({ tone: "ok", text: "wachtwoord bijgewerkt" })
      setCur("")
      setNext("")
      setConfirm("")
    },
    onError: () => setMsg({ tone: "err", text: "kon wachtwoord niet opslaan" }),
  })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8) {
      setMsg({ tone: "err", text: "minimaal 8 tekens" })
      return
    }
    if (next !== confirm) {
      setMsg({ tone: "err", text: "de wachtwoorden verschillen" })
      return
    }
    mutation.mutate({ current_password: cur, new_password: next })
  }

  return (
    <Card title="WACHTWOORD" rot=".3deg">
      <form onSubmit={save}>
        <Field label="HUIDIG WACHTWOORD">
          <input
            type="password"
            autoComplete="current-password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            required
            style={fieldStyle}
          />
        </Field>
        <Field label="NIEUW WACHTWOORD">
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            style={fieldStyle}
          />
        </Field>
        <Field label="BEVESTIG WACHTWOORD">
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            style={fieldStyle}
          />
        </Field>
        {msg && (
          <Note color={msg.tone === "ok" ? C.teal : C.red}>{msg.text}</Note>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          style={{
            ...primaryBtn,
            marginTop: 4,
            opacity: mutation.isPending ? 0.6 : 1,
          }}
        >
          {mutation.isPending ? "…" : "✓ wachtwoord opslaan"}
        </button>
      </form>
    </Card>
  )
}

// Superuser-only: push notifications for new comments and honks. The flag
// lives on the push subscription server-side; we mirror the choice locally
// because the API has no read-back endpoint.
const REACTIONS_FLAG = "bb_push_reactions"

function NotificationsCard() {
  const supported = isPushSupported()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  )

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    currentSubscription().then((sub) => {
      if (!cancelled) {
        setEnabled(sub !== null && localStorage.getItem(REACTIONS_FLAG) === "1")
      }
    })
    return () => {
      cancelled = true
    }
  }, [supported])

  const toggle = async () => {
    if (busy) return
    if (!enabled && needsIosInstall(readIosEnv())) {
      setSheetOpen(true)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      if (enabled) {
        // Re-POST with the flag off — keeps the browser subscribed for
        // new-stop pushes, just drops the reaction notifications.
        await subscribe(false)
        localStorage.removeItem(REACTIONS_FLAG)
        setEnabled(false)
        setMsg({ tone: "ok", text: "meldingen bij reacties uitgezet" })
      } else {
        const result = await subscribe(true)
        if (result === "subscribed") {
          localStorage.setItem(REACTIONS_FLAG, "1")
          setEnabled(true)
          setMsg({ tone: "ok", text: "meldingen bij reacties aan 📯" })
        } else if (result === "denied") {
          setMsg({
            tone: "err",
            text: "meldingen geblokkeerd — zet ze aan in je browserinstellingen",
          })
        }
      }
    } catch (err) {
      setMsg({
        tone: "err",
        text:
          err instanceof Error && err.message.includes("503")
            ? "meldingen staan nog niet aan op de server"
            : "dat lukte niet — probeer het straks nog eens",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="MELDINGEN" rot=".2deg">
      {supported ? (
        <>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: C.sepia,
              marginBottom: 10,
            }}
          >
            krijg een push zodra iemand reageert of toetert op de route.
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={enabled}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 14px",
              borderRadius: 20,
              border: `1.5px solid ${enabled ? C.red : C.ochre}`,
              background: enabled ? C.red : "none",
              color: enabled ? C.wrappedInk : C.sepia,
              fontFamily: FONT_MONO,
              fontSize: 12,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>
              📯
            </span>
            {busy
              ? "…"
              : enabled
                ? "meldingen bij reacties: aan"
                : "meldingen bij reacties: uit"}
          </button>
          {msg && (
            <Note color={msg.tone === "ok" ? C.teal : C.red}>{msg.text}</Note>
          )}
        </>
      ) : (
        <Note>meldingen worden niet ondersteund in deze browser.</Note>
      )}
      {sheetOpen && <IosInstallSheet onClose={() => setSheetOpen(false)} />}
    </Card>
  )
}

// Superuser-only entry points to the admin screens, now that the template's
// sidebar navigation is gone.
function AdminCard() {
  const chip: CSSProperties = {
    display: "inline-block",
    padding: "9px 14px",
    border: `1.5px solid ${C.ochre}`,
    borderRadius: 20,
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: C.sepia,
    textDecoration: "none",
  }
  return (
    <Card title="BEHEER" rot=".2deg">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 10,
        }}
      >
        superuser-gereedschap: accounts en meterstanden.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link to="/admin" style={chip}>
          rijdersregister
        </Link>
        <Link to="/status" style={chip}>
          machinekamer
        </Link>
      </div>
    </Card>
  )
}

// Entry point to the feedback screen — every signed-in rijder can report
// something broken on the site from here.
function FeedbackCard() {
  return (
    <Card title="STORINGSDIENST" rot="-.2deg">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 10,
        }}
      >
        werkt er iets niet op de site? meld het, dan sleutelen wij eraan.
      </div>
      <Link
        to="/feedback"
        style={{
          display: "inline-block",
          padding: "9px 14px",
          border: `1.5px solid ${C.ochre}`,
          borderRadius: 20,
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          textDecoration: "none",
        }}
      >
        🔧 meld een storing
      </Link>
    </Card>
  )
}

function LogoutCard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const onLogout = () => {
    localStorage.removeItem("access_token")
    qc.removeQueries({ queryKey: ["currentUser"] })
    navigate({ to: "/" })
  }
  return (
    <Card title="SESSIE" rot="-.3deg">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 10,
        }}
      >
        klaar voor vandaag? sluit de brommerboek af.
      </div>
      <button
        type="button"
        onClick={onLogout}
        style={{
          ...primaryBtn,
          background: C.ochreDeep,
        }}
      >
        ⎋ uitloggen
      </button>
    </Card>
  )
}

function DangerCard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => UsersService.deleteUserMe(),
    onSuccess: () => {
      localStorage.removeItem("access_token")
      qc.removeQueries({ queryKey: ["currentUser"] })
      navigate({ to: "/" })
    },
    onError: () => setErr("kon account niet verwijderen"),
  })

  return (
    <Card title="GEVAARZONE" rot=".4deg">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 10,
        }}
      >
        verwijder je account en alle bijbehorende gegevens permanent.
      </div>
      {confirming ? (
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: C.red,
              marginBottom: 10,
            }}
          >
            zeker weten? dit kan niet ongedaan worden gemaakt.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              style={{
                ...primaryBtn,
                background: C.red,
                opacity: mutation.isPending ? 0.6 : 1,
              }}
            >
              {mutation.isPending ? "…" : "✕ ja, verwijder"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={mutation.isPending}
              style={ghostBtn}
            >
              annuleer
            </button>
          </div>
          {err && <Note color={C.red}>{err}</Note>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setErr(null)
            setConfirming(true)
          }}
          style={{
            ...ghostBtn,
            border: `1.5px solid ${C.red}`,
            color: C.red,
          }}
        >
          ✕ verwijder account
        </button>
      )}
    </Card>
  )
}

export default function AccountScreen() {
  const { user } = useAuth()
  const displayName = user?.full_name || user?.email?.split("@", 1)[0] || ""

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
              BROMMERBOEK · ACCOUNT
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
              Jouw hoekje
            </div>
            {displayName && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.sepia,
                  marginTop: 4,
                }}
              >
                hallo, {displayName}
              </div>
            )}
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              <CubIcon width={64} height={40} />
            </div>
          </div>
        </div>

        <div style={{ padding: "0 16px 40px" }}>
          <ProfileCard />
          <PasswordCard />
          {user?.is_superuser && <NotificationsCard />}
          {user?.is_superuser && <AdminCard />}
          <FeedbackCard />
          <LogoutCard />
          <DangerCard />
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
