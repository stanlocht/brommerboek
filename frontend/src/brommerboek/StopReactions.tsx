// Comments + horn-honk reactions rendered inside the StopSheet. Reads are
// public (any visitor sees comments and the honk tally). Writes require an
// account — attempting one when signed out triggers LoginPrompt and resumes
// the action once the login round-trip succeeds.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { ReactionsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import LoginPrompt from "./LoginPrompt"
import { C, dateLabelNL, FONT_MONO } from "./theme"

interface StopReactionsProps {
  stopId: string
}

type PendingAction = null | "comment" | "toeteren"

export default function StopReactions({ stopId }: StopReactionsProps) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState("")
  // The action the viewer clicked while signed out. Set → LoginPrompt shows;
  // on successful login we replay the action so the click "just worked".
  const [pending, setPending] = useState<PendingAction>(null)

  const commentsQ = useQuery({
    queryKey: ["stops", stopId, "comments"],
    queryFn: () => ReactionsService.readComments({ stopId }),
  })
  const honksQ = useQuery({
    queryKey: ["stops", stopId, "honks"],
    queryFn: () => ReactionsService.readHonks({ stopId }),
  })

  const addComment = useMutation({
    mutationFn: (body: string) =>
      ReactionsService.createComment({ stopId, requestBody: { body } }),
    onSuccess: () => {
      setDraft("")
      qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] })
    },
  })

  const deleteComment = useMutation({
    mutationFn: (commentId: string) =>
      ReactionsService.deleteComment({ commentId }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] }),
  })

  const toggleHonk = useMutation({
    mutationFn: () => ReactionsService.toggleHonk({ stopId }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stops", stopId, "honks"] }),
  })

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || addComment.isPending) return
    if (!isLoggedIn()) {
      setPending("comment")
      return
    }
    addComment.mutate(body)
  }

  const onHonk = () => {
    if (toggleHonk.isPending) return
    if (!isLoggedIn()) {
      setPending("toeteren")
      return
    }
    toggleHonk.mutate()
  }

  const onLoggedIn = () => {
    const action = pending
    setPending(null)
    if (action === "toeteren") toggleHonk.mutate()
    if (action === "comment") {
      const body = draft.trim()
      if (body) addComment.mutate(body)
    }
    // Refetch personalised bits so is_mine / honked_by_me update.
    qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] })
    qc.invalidateQueries({ queryKey: ["stops", stopId, "honks"] })
  }

  const honks = honksQ.data
  const honked = honks?.honked_by_me ?? false
  const honkCount = honks?.count ?? 0

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          onClick={onHonk}
          aria-pressed={honked}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 22,
            border: `1.5px solid ${honked ? C.red : C.ochre}`,
            background: honked ? C.red : C.paperLight,
            color: honked ? C.cream : C.ink,
            fontFamily: FONT_MONO,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 2px 5px rgba(0,0,0,.15)",
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>
            📯
          </span>
          <span>{honked ? "getoeterd" : "toeter!"}</span>
          <span style={{ opacity: 0.75 }}>· {honkCount}</span>
        </button>
        {!isLoggedIn() && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.sepia,
            }}
          >
            log in om te toeteren of reageren
          </span>
        )}
      </div>

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: 1,
          color: C.ochreDeep,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Reacties {commentsQ.data ? `· ${commentsQ.data.count}` : ""}
      </div>

      <form
        onSubmit={submitComment}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isLoggedIn() ? "schrijf iets…" : "log in om een reactie te plaatsen"
          }
          rows={3}
          maxLength={2000}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 13,
            padding: "8px 10px",
            border: `1.5px solid ${C.border}`,
            borderRadius: 6,
            background: C.paperLight,
            color: C.ink,
            outline: "none",
            resize: "vertical",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={!draft.trim() || addComment.isPending}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 18,
              border: `1.5px solid ${C.ochreDeep}`,
              background: C.ochreDeep,
              color: C.cream,
              cursor: "pointer",
              opacity: !draft.trim() || addComment.isPending ? 0.55 : 1,
            }}
          >
            {addComment.isPending ? "…" : "plaats"}
          </button>
        </div>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(commentsQ.data?.data ?? []).map((c) => (
          <div
            key={c.id}
            style={{
              padding: 10,
              background: C.paperLight,
              border: `1px solid ${C.borderSoft}`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.ochreDeep,
                marginBottom: 4,
              }}
            >
              <span style={{ fontWeight: 700 }}>{c.author_name}</span>
              {c.created_at && (
                <span style={{ color: C.sepia }}>
                  {dateLabelNL(c.created_at)}
                </span>
              )}
              {c.is_mine && (
                <button
                  type="button"
                  onClick={() => deleteComment.mutate(c.id)}
                  style={{
                    marginLeft: "auto",
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.red,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  verwijder
                </button>
              )}
            </div>
            <div
              style={{ fontSize: 14, color: C.inkSoft, whiteSpace: "pre-wrap" }}
            >
              {c.body}
            </div>
          </div>
        ))}
        {commentsQ.data?.data.length === 0 && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.sepia,
            }}
          >
            nog geen reacties — wees de eerste.
          </div>
        )}
      </div>

      {pending && (
        <LoginPrompt
          intent={pending}
          onClose={() => setPending(null)}
          onSuccess={onLoggedIn}
        />
      )}
    </div>
  )
}
