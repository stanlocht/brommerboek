// Comments + horn-honk reactions rendered inside the StopSheet. Reads are
// public (any visitor sees comments and the honk tally). Writes require an
// account — attempting one when signed out triggers LoginPrompt and resumes
// the action once the login round-trip succeeds.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { UsersService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import {
  createComment,
  deleteComment as deleteCommentApi,
  fetchComments,
  fetchHonks,
  mediaSrc,
  type StopComment,
  toggleCommentHonk as toggleCommentHonkApi,
  toggleHonk as toggleHonkApi,
} from "./api"
import Lightbox from "./Lightbox"
import LoginPrompt from "./LoginPrompt"
import { C, dateLabelNL, FONT_MONO } from "./theme"

// Mirror of the backend cap — caught here so an oversized pick fails with a
// friendly message before uploading megabytes that will be rejected anyway.
const PHOTO_MAX_BYTES = 10 * 1024 * 1024

interface StopReactionsProps {
  stopId: string
}

// The comment-toeter variant carries the comment id so the click can be
// replayed after the login round-trip.
type PendingAction = null | "comment" | "toeteren" | { commentToeter: string }

export default function StopReactions({ stopId }: StopReactionsProps) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState("")
  // The action the viewer clicked while signed out. Set → LoginPrompt shows;
  // on successful login we replay the action so the click "just worked".
  const [pending, setPending] = useState<PendingAction>(null)
  const [showAllHonkers, setShowAllHonkers] = useState(false)
  // Inline error line for failed writes; cleared when a new attempt starts.
  const [actionError, setActionError] = useState("")
  // Photo picked for the next comment, shown as a small preview until posted.
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Comment photo shown full-screen; null = lightbox closed.
  const [lightboxComment, setLightboxComment] = useState<StopComment | null>(
    null,
  )

  // Object URL for the preview <img>; revoked when replaced or on unmount.
  useEffect(() => {
    if (!photo) {
      setPhotoPreview("")
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const commentsQ = useQuery({
    queryKey: ["stops", stopId, "comments"],
    queryFn: () => fetchComments(stopId),
  })
  // The backend lets superusers delete any comment; mirror that in the UI.
  // Query only fires when a token is present so a signed-out viewer never
  // triggers a 401 → login redirect.
  const { data: me } = useQuery({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })
  const isAdmin = !!me?.is_superuser
  const honksQ = useQuery({
    queryKey: ["stops", stopId, "honks"],
    queryFn: () => fetchHonks(stopId),
  })

  const addComment = useMutation({
    mutationFn: ({ body, file }: { body: string; file: File | null }) =>
      createComment(stopId, body, file),
    onMutate: () => setActionError(""),
    onSuccess: () => {
      setDraft("")
      setPhoto(null)
      qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] })
    },
    onError: () =>
      setActionError("reactie plaatsen lukte niet — probeer het opnieuw"),
  })

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => deleteCommentApi(commentId),
    onMutate: () => setActionError(""),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] }),
    onError: () => setActionError("kon de reactie niet verwijderen"),
  })

  const toggleHonk = useMutation({
    mutationFn: () => toggleHonkApi(stopId),
    onMutate: () => setActionError(""),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stops", stopId, "honks"] }),
    onError: () => setActionError("toeteren lukte niet — probeer het opnieuw"),
  })

  const toggleCommentHonk = useMutation({
    mutationFn: (commentId: string) => toggleCommentHonkApi(commentId),
    onMutate: () => setActionError(""),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] }),
    onError: () => setActionError("toeteren lukte niet — probeer het opnieuw"),
  })

  const pickPhoto = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > PHOTO_MAX_BYTES) {
      setActionError("foto is te groot (max 10 MB)")
      return
    }
    setActionError("")
    setPhoto(file)
  }

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if ((!body && !photo) || addComment.isPending) return
    if (!isLoggedIn()) {
      setPending("comment")
      return
    }
    addComment.mutate({ body, file: photo })
  }

  const onHonk = () => {
    if (toggleHonk.isPending) return
    if (!isLoggedIn()) {
      setPending("toeteren")
      return
    }
    toggleHonk.mutate()
  }

  const onCommentHonk = (commentId: string) => {
    if (toggleCommentHonk.isPending) return
    if (!isLoggedIn()) {
      setPending({ commentToeter: commentId })
      return
    }
    toggleCommentHonk.mutate(commentId)
  }

  const onLoggedIn = () => {
    const action = pending
    setPending(null)
    if (action === "toeteren") toggleHonk.mutate()
    if (action === "comment") {
      const body = draft.trim()
      if (body || photo) addComment.mutate({ body, file: photo })
    }
    if (action !== null && typeof action === "object") {
      toggleCommentHonk.mutate(action.commentToeter)
    }
    // Refetch personalised bits so is_mine / honked_by_me update.
    qc.invalidateQueries({ queryKey: ["stops", stopId, "comments"] })
    qc.invalidateQueries({ queryKey: ["stops", stopId, "honks"] })
  }

  const honks = honksQ.data
  const honked = honks?.honked_by_me ?? false
  const honkCount = honks?.count ?? 0
  const honkers = honks?.honkers ?? []
  // Sort the current viewer to the front — "jij en 4 anderen" reads
  // better than burying them somewhere in the middle.
  const orderedHonkers = [...honkers].sort((a, b) =>
    a.is_mine === b.is_mine ? 0 : a.is_mine ? -1 : 1,
  )
  const VISIBLE = 6
  const shownHonkers = showAllHonkers
    ? orderedHonkers
    : orderedHonkers.slice(0, VISIBLE)
  const hiddenTruncated = honkCount - orderedHonkers.length
  const hiddenCollapsed = orderedHonkers.length - shownHonkers.length

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

      {actionError && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.red,
            marginBottom: 14,
          }}
        >
          {actionError}
        </div>
      )}

      {honkCount > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginBottom: 18,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.sepia,
          }}
        >
          <span
            style={{
              letterSpacing: 1,
              color: C.ochreDeep,
              textTransform: "uppercase",
              marginRight: 2,
            }}
          >
            getoeterd door
          </span>
          {shownHonkers.map((h) => (
            <span
              key={h.user_id}
              title={h.created_at ? dateLabelNL(h.created_at) : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 9px",
                borderRadius: 12,
                border: `1px solid ${h.is_mine ? C.red : C.borderSoft}`,
                background: h.is_mine ? "#f7edd6" : C.paperLight,
                color: h.is_mine ? C.red : C.ink,
              }}
            >
              <span aria-hidden style={{ fontSize: 11 }}>
                📯
              </span>
              {h.is_mine ? "jij" : h.name}
            </span>
          ))}
          {hiddenCollapsed > 0 && (
            <button
              type="button"
              onClick={() => setShowAllHonkers(true)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.ochreDeep,
                textDecoration: "underline",
                padding: 0,
              }}
            >
              +{hiddenCollapsed} meer
            </button>
          )}
          {showAllHonkers && orderedHonkers.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setShowAllHonkers(false)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.ochreDeep,
                textDecoration: "underline",
                padding: 0,
              }}
            >
              minder
            </button>
          )}
          {hiddenTruncated > 0 && (
            <span style={{ color: C.sepia, opacity: 0.8 }}>
              +{hiddenTruncated} eerdere toeters
            </span>
          )}
        </div>
      )}

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
        {photoPreview && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <img
              src={photoPreview}
              alt="gekozen foto"
              style={{
                maxWidth: 120,
                maxHeight: 120,
                borderRadius: 6,
                border: `1px solid ${C.borderSoft}`,
                display: "block",
              }}
            />
            <button
              type="button"
              onClick={() => setPhoto(null)}
              aria-label="foto verwijderen"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.red,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ✕ weg
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              pickPhoto(e.target.files)
              // Allow re-picking the same file after removing it.
              e.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 18,
              border: `1.5px solid ${C.ochre}`,
              background: C.paperLight,
              color: C.ink,
              cursor: "pointer",
            }}
          >
            📷 {photo ? "andere foto" : "foto erbij"}
          </button>
          <button
            type="submit"
            disabled={(!draft.trim() && !photo) || addComment.isPending}
            style={{
              marginLeft: "auto",
              fontFamily: FONT_MONO,
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 18,
              border: `1.5px solid ${C.ochreDeep}`,
              background: C.ochreDeep,
              color: C.cream,
              cursor: "pointer",
              opacity:
                (!draft.trim() && !photo) || addComment.isPending ? 0.55 : 1,
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
              {(c.is_mine || isAdmin) && (
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
            {c.body && (
              <div
                style={{
                  fontSize: 14,
                  color: C.inkSoft,
                  whiteSpace: "pre-wrap",
                }}
              >
                {c.body}
              </div>
            )}
            {c.photo && (
              <button
                type="button"
                onClick={() => setLightboxComment(c)}
                aria-label="foto groter bekijken"
                style={{
                  display: "block",
                  padding: 0,
                  marginTop: c.body ? 8 : 0,
                  border: `1px solid ${C.borderSoft}`,
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                  lineHeight: 0,
                  overflow: "hidden",
                }}
              >
                <img
                  src={mediaSrc(c.photo_thumb ?? c.photo)}
                  alt={`foto bij reactie van ${c.author_name}`}
                  loading="lazy"
                  style={{
                    maxWidth: "min(240px, 100%)",
                    maxHeight: 240,
                    display: "block",
                  }}
                />
              </button>
            )}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => onCommentHonk(c.id)}
                aria-pressed={c.honked_by_me}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 10px",
                  borderRadius: 14,
                  border: `1px solid ${c.honked_by_me ? C.red : C.borderSoft}`,
                  background: c.honked_by_me ? "#f7edd6" : "transparent",
                  color: c.honked_by_me ? C.red : C.sepia,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <span aria-hidden style={{ fontSize: 12 }}>
                  📯
                </span>
                <span>{c.honked_by_me ? "getoeterd" : "toeter"}</span>
                {c.honk_count > 0 && (
                  <span style={{ opacity: 0.75 }}>· {c.honk_count}</span>
                )}
              </button>
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

      {lightboxComment?.photo && (
        <Lightbox
          items={[
            {
              tone: "",
              cap: "",
              kind: "image",
              url: lightboxComment.photo,
              thumb: lightboxComment.photo_thumb,
            },
          ]}
          initialIndex={0}
          onClose={() => setLightboxComment(null)}
        />
      )}

      {pending && (
        <LoginPrompt
          intent={pending === "comment" ? "comment" : "toeteren"}
          onClose={() => setPending(null)}
          onSuccess={onLoggedIn}
        />
      )}
    </div>
  )
}
