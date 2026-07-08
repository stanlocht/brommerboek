// "🔔 volg de reis" — the follower entry point for Web Push. Self-contained
// (own state + toast + iOS install sheet) so dropping it into MapScreen costs
// a single line. Hidden entirely when the browser can't do push.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import IosInstallSheet from "./IosInstallSheet"
import {
  currentSubscription,
  isPushSupported,
  needsIosInstall,
  readIosEnv,
  subscribe,
  unsubscribe,
} from "./push"
import { C, FONT_MONO } from "./theme"

export default function FollowBell() {
  const supported = isPushSupported()
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState("")
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    currentSubscription().then((sub) => {
      if (!cancelled) setFollowing(sub !== null)
    })
    return () => {
      cancelled = true
    }
  }, [supported])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  if (!supported) return null

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(""), 2600)
  }

  const onClick = async () => {
    if (busy) return
    if (!following && needsIosInstall(readIosEnv())) {
      setSheetOpen(true)
      return
    }
    setBusy(true)
    try {
      if (following) {
        await unsubscribe()
        setFollowing(false)
        flash("melding uitgezet")
      } else {
        const result = await subscribe()
        if (result === "subscribed") {
          setFollowing(true)
          flash("je volgt de reis 🛵")
        } else if (result === "denied") {
          flash("meldingen geblokkeerd — zet ze aan in je browserinstellingen")
        }
      }
    } catch (err) {
      flash(
        err instanceof Error && err.message.includes("503")
          ? "meldingen staan nog niet aan op de server"
          : "dat lukte niet — probeer het straks nog eens",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={following}
        aria-label={
          following ? "Zet reismeldingen uit" : "Volg de reis met meldingen"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 8,
          border: `1.5px solid ${following ? C.red : C.border}`,
          background: following ? "#f7edd6" : C.paperCard,
          boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: following ? C.red : C.sepia,
          cursor: "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          🔔
        </span>
        {following ? "je volgt de reis" : "volg de reis"}
      </button>

      {sheetOpen && <IosInstallSheet onClose={() => setSheetOpen(false)} />}

      {toast &&
        createPortal(
          <div
            className="bb-toast"
            style={{
              position: "fixed",
              bottom: 32,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 210,
              background: "#332c22",
              color: C.wrappedInk,
              fontFamily: FONT_MONO,
              fontSize: 12,
              padding: "10px 18px",
              borderRadius: 20,
              boxShadow: "0 4px 12px rgba(0,0,0,.35)",
              maxWidth: "88vw",
              textAlign: "center",
            }}
          >
            {toast}
          </div>,
          document.body,
        )}
    </>
  )
}
