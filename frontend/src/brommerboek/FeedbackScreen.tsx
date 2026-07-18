// Vintage-styled feedback screen ("storingsdienst"): signed-in rijders report
// something broken on the site, watch the status of their own reports, and a
// superuser works through the full queue and marks reports resolved.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type CSSProperties, type ReactNode, useState } from "react"
import useAuth from "@/hooks/useAuth"
import {
  createFeedback,
  deleteFeedback,
  type FeedbackReport,
  type FeedbackStatus,
  fetchAllFeedback,
  fetchMyFeedback,
  updateFeedbackStatus,
} from "./api"
import { WrenchIcon } from "./icons"
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
  padding: "6px 10px",
  border: `1.5px solid ${C.ochre}`,
  borderRadius: 10,
  background: "none",
  fontFamily: FONT_MONO,
  fontSize: 11,
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

function Note({
  children,
  color = C.sepia,
}: {
  children: ReactNode
  color?: string
}) {
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 11, color, marginTop: 8 }}>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const resolved = status === "resolved"
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 1.5,
        padding: "3px 8px",
        borderRadius: 10,
        border: `1.5px solid ${resolved ? C.teal : C.red}`,
        color: resolved ? C.teal : C.red,
        whiteSpace: "nowrap",
      }}
    >
      {resolved ? "OPGELOST" : "OPEN"}
    </span>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function ReportRow({
  report,
  showAuthor,
  actions,
}: {
  report: FeedbackReport
  showAuthor: boolean
  actions?: ReactNode
}) {
  return (
    <div
      style={{
        borderTop: `1px dashed ${C.border}`,
        padding: "10px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <StatusBadge status={report.status} />
        {showAuthor && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.ink,
              fontWeight: 700,
            }}
          >
            {report.author_name}
          </span>
        )}
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.sepia }}>
          {formatDate(report.created_at)}
          {report.page ? ` · ${report.page}` : ""}
        </span>
      </div>
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontSize: 15,
          color: C.ink,
          marginTop: 6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {report.body}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{actions}</div>
      )}
    </div>
  )
}

function ReportForm() {
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const [page, setPage] = useState("")
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  )

  const mutation = useMutation({
    mutationFn: () => createFeedback(body.trim(), page.trim()),
    onSuccess: async () => {
      setBody("")
      setPage("")
      setMsg({ tone: "ok", text: "melding ontvangen — bedankt! 🔧" })
      await qc.invalidateQueries({ queryKey: ["feedback"] })
    },
    onError: (err) =>
      setMsg({
        tone: "err",
        text:
          err instanceof Error && err.message.includes("429")
            ? "even rustig aan — probeer het over een minuutje nog eens"
            : "versturen lukte niet — probeer het straks nog eens",
      }),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) {
      setMsg({ tone: "err", text: "vertel eerst wat er stuk is" })
      return
    }
    setMsg(null)
    mutation.mutate()
  }

  return (
    <Card title="MELD EEN STORING" rot="-.4deg">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: C.sepia,
          marginBottom: 10,
        }}
      >
        werkt er iets niet? beschrijf wat er misging, dan sleutelen wij eraan.
      </div>
      <form onSubmit={submit}>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={labelStyle}>WAT IS ER STUK?</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="bv. de kaart blijft grijs op mijn telefoon…"
            style={{ ...fieldStyle, marginTop: 4, resize: "vertical" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={labelStyle}>WAAR OP DE SITE? (MAG LEEG)</span>
          <input
            type="text"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            maxLength={255}
            placeholder="bv. de kaart, het logboek, de stempelmuur…"
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>
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
          {mutation.isPending ? "…" : "🔧 verstuur melding"}
        </button>
      </form>
    </Card>
  )
}

function MyReportsCard() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["feedback", "mine"],
    queryFn: fetchMyFeedback,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteFeedback(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  })

  return (
    <Card title="JOUW MELDINGEN" rot=".3deg">
      {isLoading ? (
        <Note>even geduld…</Note>
      ) : !data || data.count === 0 ? (
        <Note>nog geen meldingen — alles rijdt soepel.</Note>
      ) : (
        <div style={{ marginTop: -10 }}>
          {data.data.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              showAuthor={false}
              actions={
                <button
                  type="button"
                  onClick={() => remove.mutate(report.id)}
                  disabled={remove.isPending}
                  style={{ ...ghostBtn, borderColor: C.red, color: C.red }}
                >
                  ✕ verwijder
                </button>
              }
            />
          ))}
        </div>
      )}
    </Card>
  )
}

// Superuser-only queue of every report with resolve/reopen controls.
function AdminQueueCard() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<FeedbackStatus | "all">("open")

  const { data, isLoading } = useQuery({
    queryKey: ["feedback", "all", filter],
    queryFn: () => fetchAllFeedback(filter === "all" ? undefined : filter),
  })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      updateFeedbackStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteFeedback(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  })

  const filterChip = (value: FeedbackStatus | "all", label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      style={{
        ...ghostBtn,
        borderRadius: 20,
        ...(filter === value
          ? {
              background: C.ochreDeep,
              borderColor: C.ochreDeep,
              color: C.paperLight,
            }
          : {}),
      }}
    >
      {label}
    </button>
  )

  return (
    <Card title="ALLE MELDINGEN · BEHEER" rot="-.3deg">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filterChip("open", "open")}
        {filterChip("resolved", "opgelost")}
        {filterChip("all", "alles")}
      </div>
      {isLoading ? (
        <Note>even geduld…</Note>
      ) : !data || data.count === 0 ? (
        <Note>
          {filter === "open"
            ? "geen open meldingen — de machine loopt als een zonnetje."
            : "niets gevonden."}
        </Note>
      ) : (
        <div style={{ marginTop: 10 }}>
          {data.data.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              showAuthor
              actions={
                <>
                  {report.status === "open" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setStatus.mutate({ id: report.id, status: "resolved" })
                      }
                      disabled={setStatus.isPending}
                      style={{
                        ...ghostBtn,
                        borderColor: C.teal,
                        color: C.teal,
                      }}
                    >
                      ✓ opgelost
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setStatus.mutate({ id: report.id, status: "open" })
                      }
                      disabled={setStatus.isPending}
                      style={ghostBtn}
                    >
                      ↺ heropen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove.mutate(report.id)}
                    disabled={remove.isPending}
                    style={{ ...ghostBtn, borderColor: C.red, color: C.red }}
                  >
                    ✕ verwijder
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </Card>
  )
}

export default function FeedbackScreen() {
  const { user } = useAuth()

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
              BROMMERBOEK · STORINGSDIENST
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
              Iets kapot?
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginTop: 4,
              }}
            >
              meld het hier, dan pakken we de sleutels erbij
            </div>
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              <WrenchIcon size={28} color={C.sepia} />
            </div>
          </div>
        </div>

        <div style={{ padding: "0 16px 40px" }}>
          <ReportForm />
          <MyReportsCard />
          {user?.is_superuser && <AdminQueueCard />}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
