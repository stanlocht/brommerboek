import { useCallback, useEffect, useRef, useState } from "react"
import { mediaSrc } from "./api"
import {
  panBy,
  pinchScale,
  toggleZoom,
  ZOOM_RESET,
  type ZoomState,
  zoomAt,
} from "./lightboxZoom"
import { FONT_MONO } from "./theme"
import type { MediaItem } from "./types"

const SWIPE_THRESHOLD = 60
const TAP_SLOP = 8
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 32

type Gesture =
  | {
      mode: "swipe"
      startX: number
      startY: number
      dx: number
      dy: number
      moved: boolean
      onBackdrop: boolean
    }
  | { mode: "pan"; lastX: number; lastY: number; moved: boolean }
  | { mode: "pinch"; startDist: number; startScale: number }

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const chromeBtn: React.CSSProperties = {
  border: "none",
  borderRadius: "50%",
  width: 40,
  height: 40,
  background: "rgba(255,255,255,.12)",
  color: "#f1e6cd",
  fontSize: 20,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}

// Full-screen media viewer: swipe/arrows between a stop's media, pinch and
// double-tap zoom on photos, native controls on video. Near-black on purpose
// — the photos come first here, not the paper.
export default function Lightbox({
  items,
  initialIndex,
  onClose,
}: {
  items: MediaItem[]
  initialIndex: number
  onClose: () => void
}) {
  const count = items.length
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), count - 1),
  )
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_RESET)
  // Horizontal finger-follow while swiping between items (scale 1 only).
  const [dragX, setDragX] = useState(0)
  const [gesturing, setGesturing] = useState(false)
  const item = items[index]
  const src = mediaSrc(item?.url)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  const navigate = useCallback(
    (dir: -1 | 1) => {
      setIndex((i) => (i + dir + count) % count)
      setZoom(ZOOM_RESET)
      setDragX(0)
    },
    [count],
  )

  // Focus the dialog on open, restore afterwards; lock body scroll while up.
  useEffect(() => {
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeBtnRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      if (prevFocus instanceof HTMLElement) prevFocus.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft" && count > 1) navigate(-1)
      else if (e.key === "ArrowRight" && count > 1) navigate(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, navigate, count])

  const stageMetrics = () => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ?? new DOMRect(0, 0, 1, 1)
  }
  const focalOf = (clientX: number, clientY: number) => {
    const rect = stageMetrics()
    return {
      fx: clientX - rect.left - rect.width / 2,
      fy: clientY - rect.top - rect.height / 2,
      w: rect.width,
      h: rect.height,
    }
  }

  const endTap = (e: React.PointerEvent, onBackdrop: boolean) => {
    if (onBackdrop) {
      onClose()
      return
    }
    const prev = lastTap.current
    if (
      prev &&
      e.timeStamp - prev.t < DOUBLE_TAP_MS &&
      Math.abs(e.clientX - prev.x) < DOUBLE_TAP_SLOP &&
      Math.abs(e.clientY - prev.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null
      const { fx, fy, w, h } = focalOf(e.clientX, e.clientY)
      setZoom((z) => toggleZoom(z, fx, fy, w, h))
    } else {
      lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    stageRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setGesturing(true)
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()]
      setDragX(0)
      gesture.current = {
        mode: "pinch",
        startDist: dist(p1, p2),
        startScale: zoom.scale,
      }
    } else if (pointers.current.size === 1) {
      gesture.current =
        zoom.scale > 1
          ? { mode: "pan", lastX: e.clientX, lastY: e.clientY, moved: false }
          : {
              mode: "swipe",
              startX: e.clientX,
              startY: e.clientY,
              dx: 0,
              dy: 0,
              moved: false,
              onBackdrop: e.target === stageRef.current,
            }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()]
      const scale = pinchScale(g.startScale, g.startDist, dist(p1, p2))
      const { fx, fy, w, h } = focalOf((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
      setZoom((z) => zoomAt(z, fx, fy, scale, w, h))
    } else if (g.mode === "pan") {
      const dx = e.clientX - g.lastX
      const dy = e.clientY - g.lastY
      g.lastX = e.clientX
      g.lastY = e.clientY
      if (dx !== 0 || dy !== 0) g.moved = true
      const rect = stageMetrics()
      setZoom((z) => panBy(z, dx, dy, rect.width, rect.height))
    } else if (g.mode === "swipe") {
      g.dx = e.clientX - g.startX
      g.dy = e.clientY - g.startY
      if (Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP) {
        g.moved = true
      }
      if (count > 1) setDragX(g.dx)
    }
  }

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) setGesturing(false)
    const g = gesture.current
    if (!g) return
    if (g.mode === "pinch") {
      if (pointers.current.size === 1) {
        const [p] = [...pointers.current.values()]
        gesture.current = { mode: "pan", lastX: p.x, lastY: p.y, moved: true }
      } else if (pointers.current.size === 0) {
        gesture.current = null
        // Pinched back out to (nearly) 1:1 — settle exactly on rest.
        setZoom((z) => (z.scale <= 1.02 ? ZOOM_RESET : z))
      }
      return
    }
    gesture.current = null
    const cancelled = e.type === "pointercancel"
    if (g.mode === "swipe") {
      setDragX(0)
      if (cancelled) return
      if (
        g.moved &&
        Math.abs(g.dx) > SWIPE_THRESHOLD &&
        Math.abs(g.dx) > Math.abs(g.dy) &&
        count > 1
      ) {
        navigate(g.dx < 0 ? 1 : -1)
      } else if (!g.moved) {
        endTap(e, g.onBackdrop)
      }
    } else if (g.mode === "pan" && !g.moved && !cancelled) {
      endTap(e, false)
    }
  }

  if (!item) return null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes via the window keydown listener
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`media ${index + 1} van ${count}`}
      className="bb-fadein"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(14,11,8,.97)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => {
        // Backdrop tap outside the pointer-handled stage: the chrome rows
        // and the letterbox around a video (marked data-backdrop).
        const target = e.target as HTMLElement
        if (target === e.currentTarget || target.dataset.backdrop) onClose()
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding:
            "calc(env(safe-area-inset-top, 0px) + 12px) 14px 8px calc(env(safe-area-inset-left, 0px) + 16px)",
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            letterSpacing: 2,
            color: "rgba(241,230,205,.75)",
          }}
        >
          {index + 1} / {count}
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Sluit"
          style={chromeBtn}
        >
          ✕
        </button>
      </div>

      {item.kind === "video" && src ? (
        <div
          data-backdrop="true"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 8px",
          }}
        >
          {/* biome-ignore lint/a11y/useMediaCaption: caption renders below the player */}
          <video
            key={src}
            src={src}
            controls
            playsInline
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      ) : (
        <div
          ref={stageRef}
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {src ? (
            <img
              src={src}
              alt={item.cap}
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transform: `translate(${zoom.x + dragX}px, ${zoom.y}px) scale(${zoom.scale})`,
                transition: gesturing ? "none" : "transform .18s ease-out",
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: `linear-gradient(150deg,rgba(255,255,255,.25),rgba(0,0,0,.32)),${item.tone || "#c9a24e"}`,
              }}
            />
          )}
        </div>
      )}

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Vorige"
            style={{
              ...chromeBtn,
              position: "absolute",
              left: "calc(env(safe-area-inset-left, 0px) + 10px)",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Volgende"
            style={{
              ...chromeBtn,
              position: "absolute",
              right: "calc(env(safe-area-inset-right, 0px) + 10px)",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            ›
          </button>
        </>
      )}

      <div
        style={{
          padding: "10px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 12,
          lineHeight: 1.5,
          color: "#f1e6cd",
          textShadow: "0 1px 2px rgba(0,0,0,.6)",
          minHeight: 20,
        }}
      >
        {item.cap}
      </div>
    </div>
  )
}
