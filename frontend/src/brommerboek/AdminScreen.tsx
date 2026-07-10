// Vintage-styled superuser screen for user management. Replaces the
// template's shadcn sidebar + data-table admin page: every rijder gets a
// paper card with inline edit and delete, and new accounts are added with
// an inline form instead of a dialog.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type CSSProperties, type ReactNode, useId, useState } from "react"
import {
  type UserCreate,
  type UserPublic,
  UsersService,
  type UserUpdate,
} from "@/client"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
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

const CARD_ROTS = ["-.4deg", ".3deg", "-.2deg", ".4deg", "-.3deg", ".2deg"]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control lives in children
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  )
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginRight: 16,
        marginBottom: 12,
        cursor: "pointer",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: C.ochreDeep }}
      />
      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.sepia }}>
        {label}
      </span>
    </label>
  )
}

function Note({
  children,
  color = C.red,
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
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

// Paper sticker used for the role/status badges on a user card.
function Sticker({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 1,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  )
}

interface UserFormValues {
  email: string
  full_name: string
  password: string
  is_superuser: boolean
  is_active: boolean
}

// Shared add/edit form. For edits the password fields are optional and only
// sent when filled in.
function UserForm({
  initial,
  requirePassword,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: UserPublic
  requirePassword: boolean
  pending: boolean
  submitLabel: string
  onSubmit: (values: UserFormValues) => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState(initial?.email ?? "")
  const [fullName, setFullName] = useState(initial?.full_name ?? "")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [isSuperuser, setIsSuperuser] = useState(initial?.is_superuser ?? false)
  const [isActive, setIsActive] = useState(initial?.is_active ?? false)
  const [err, setErr] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("dat lijkt geen e-mailadres")
      return
    }
    if (requirePassword || password) {
      if (password.length < 8) {
        setErr("wachtwoord: minimaal 8 tekens")
        return
      }
      if (password !== confirm) {
        setErr("de wachtwoorden verschillen")
        return
      }
    }
    setErr(null)
    onSubmit({
      email,
      full_name: fullName,
      password,
      is_superuser: isSuperuser,
      is_active: isActive,
    })
  }

  return (
    <form noValidate onSubmit={submit}>
      <Field label="E-MAIL">
        <input
          data-testid="user-email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={fieldStyle}
        />
      </Field>
      <Field label="NAAM">
        <input
          data-testid="user-name-input"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={30}
          style={fieldStyle}
        />
      </Field>
      <Field label={requirePassword ? "WACHTWOORD" : "NIEUW WACHTWOORD"}>
        <input
          data-testid="user-password-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={requirePassword ? undefined : "laat leeg om te houden"}
          style={fieldStyle}
        />
      </Field>
      <Field label="BEVESTIG WACHTWOORD">
        <input
          data-testid="user-confirm-password-input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={fieldStyle}
        />
      </Field>
      <div>
        <CheckField
          label="superuser"
          checked={isSuperuser}
          onChange={setIsSuperuser}
        />
        <CheckField label="actief" checked={isActive} onChange={setIsActive} />
      </div>
      {err && <Note>{err}</Note>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={pending}
          style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          style={ghostBtn}
        >
          annuleer
        </button>
      </div>
    </form>
  )
}

function AddUserCard() {
  const qc = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: (data: UserCreate) =>
      UsersService.createUser({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("rijder toegevoegd")
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["users"] })
    },
  })

  return (
    <div
      style={{
        background: C.paperCard,
        border: `1.5px dashed ${C.ochre}`,
        borderRadius: 12,
        padding: 16,
        transform: "rotate(.3deg)",
        marginBottom: 14,
      }}
    >
      {open ? (
        <>
          <div style={{ ...labelStyle, letterSpacing: 3, marginBottom: 10 }}>
            NIEUWE RIJDER
          </div>
          <UserForm
            requirePassword
            pending={mutation.isPending}
            submitLabel="✓ voeg toe"
            onSubmit={(values) =>
              mutation.mutate({
                email: values.email,
                full_name: values.full_name || null,
                password: values.password,
                is_superuser: values.is_superuser,
                is_active: values.is_active,
              })
            }
            onCancel={() => setOpen(false)}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ ...ghostBtn, border: "none", padding: 0 }}
        >
          + nieuwe rijder
        </button>
      )}
    </div>
  )
}

function UserCard({
  user,
  isCurrentUser,
  rot,
}: {
  user: UserPublic
  isCurrentUser: boolean
  rot: string
}) {
  const qc = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view")

  const updateMutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      UsersService.updateUser({ userId: user.id, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("rijder bijgewerkt")
      setMode("view")
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => UsersService.deleteUser({ userId: user.id }),
    onSuccess: () => {
      showSuccessToast("rijder verwijderd")
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["users"] })
    },
  })

  return (
    <div
      data-testid="user-card"
      style={{
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: "2px 4px 0 rgba(120,90,40,.22)",
        transform: `rotate(${rot})`,
        marginBottom: 14,
      }}
    >
      {mode === "edit" ? (
        <UserForm
          initial={user}
          requirePassword={false}
          pending={updateMutation.isPending}
          submitLabel="✓ opslaan"
          onSubmit={(values) => {
            const patch: UserUpdate = {
              email: values.email,
              full_name: values.full_name || null,
              is_superuser: values.is_superuser,
              is_active: values.is_active,
            }
            if (values.password) {
              patch.password = values.password
            }
            updateMutation.mutate(patch)
          }}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 18,
                color: user.full_name ? C.ink : C.sepia,
              }}
            >
              {user.full_name || "—"}
            </span>
            {isCurrentUser && <Sticker color={C.teal}>jij</Sticker>}
            {user.is_superuser && (
              <Sticker color={C.ochreDeep}>superuser</Sticker>
            )}
            <Sticker color={user.is_active ? C.teal : C.sepia}>
              {user.is_active ? "actief" : "inactief"}
            </Sticker>
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: C.sepia,
              marginTop: 4,
              wordBreak: "break-all",
            }}
          >
            {user.email}
          </div>

          {mode === "delete" ? (
            <div style={{ marginTop: 12 }}>
              <Note>
                zeker weten? alles van deze rijder wordt permanent verwijderd.
              </Note>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  style={{
                    ...primaryBtn,
                    opacity: deleteMutation.isPending ? 0.6 : 1,
                  }}
                >
                  {deleteMutation.isPending ? "…" : "✕ ja, verwijder"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  disabled={deleteMutation.isPending}
                  style={ghostBtn}
                >
                  annuleer
                </button>
              </div>
            </div>
          ) : (
            !isCurrentUser && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  style={ghostBtn}
                >
                  ✎ bewerk
                </button>
                <button
                  type="button"
                  onClick={() => setMode("delete")}
                  style={{
                    ...ghostBtn,
                    border: `1.5px solid ${C.red}`,
                    color: C.red,
                  }}
                >
                  ✕ verwijder
                </button>
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

export default function AdminScreen() {
  const { user: currentUser } = useAuth()
  const { data: users, isError } = useQuery({
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
  })

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
              BROMMERBOEK · ADMIN
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
              Rijdersregister
            </h1>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginTop: 4,
                textAlign: "center",
              }}
            >
              beheer accounts en rechten
              {" · "}
              <Link to="/status" style={{ color: C.ochreDeep }}>
                machinekamer
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "12px 16px 40px",
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          <AddUserCard />
          {users ? (
            users.data.map((user, i) => (
              <UserCard
                key={user.id}
                user={user}
                isCurrentUser={currentUser?.id === user.id}
                rot={CARD_ROTS[i % CARD_ROTS.length]}
              />
            ))
          ) : (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: isError ? C.red : C.sepia,
                textAlign: "center",
                marginTop: 24,
              }}
            >
              {isError
                ? "kon het register niet ophalen — probeer het straks nog eens."
                : "het register wordt opengeslagen…"}
            </div>
          )}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
