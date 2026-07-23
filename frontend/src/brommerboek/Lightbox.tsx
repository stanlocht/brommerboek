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
// Breathing room between slides while swiping between them.
const SLIDE_GAP = 12

// Full-res URLs the browser has finished fetching, and the natural pixel
// sizes of everything we've shown. Module-level so re-opening the lightbox
// (or coming back to a photo) doesn't re-show placeholders and spinners for
// images that are already in the HTTP cache.
const loadedFull = new Set<string>()
const naturalSizes = new Map<string, { w: number; h: number }>()

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
//
// Perceived speed comes from three tricks: the (already cached) gallery
// thumbnail paints immediately while the full-res photo loads on top of it,
// the neighbours' full-res files are preloaded so the next swipe is usually
// instant, and the adjacent slide follows your finger during the swipe so
// the gesture always gives feedback even on a slow connection.
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
  // Bumped when a full-res image finishes loading, so the spinner clears
  // and the sharp version fades in over the thumbnail.
  const [, setLoadTick] = useState(0)
  const item = items[index]
  const src = mediaSrc(item?.url ?? null)
  const thumbSrc = mediaSrc(item?.thumb ?? null)

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

  // Warm the neighbours: fetch the full-res files for the previous and next
  // photo so a swipe usually lands on an already-decoded image.
  useEffect(() => {
    if (count < 2) return
    for (const dir of [1, -1]) {
      const neighbor = items[(index + dir + count) % count]
      if (neighbor?.kind !== "image") continue
      const url = mediaSrc(neighbor.url)
      if (!url || loadedFull.has(url)) continue
      const img = new Image()
      img.onload = () => {
        loadedFull.add(url)
        naturalSizes.set(url, { w: img.naturalWidth, h: img.naturalHeight })
      }
      img.src = url
    }
  }, [index, items, count])

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

  // Whether a tap at (clientX, clientY) lands on the photo itself rather
  // than the letterbox around it. Only called at scale 1, where the image
  // sits untransformed and object-fit: contain centred in the stage. Falls
  // back to the thumbnail's dimensions (same aspect) while the full-res
  // file is still loading.
  const withinPhoto = (clientX: number, clientY: number) => {
    if (!src) return false
    const n =
      naturalSizes.get(src) ?? (thumbSrc ? naturalSizes.get(thumbSrc) : null)
    if (!n || !n.w || !n.h) return true
    const rect = stageMetrics()
    const s = Math.min(rect.width / n.w, rect.height / n.h)
    const w = n.w * s
    const h = n.h * s
    const left = rect.left + (rect.width - w) / 2
    const top = rect.top + (rect.height - h) / 2
    return (
      clientX >= left &&
      clientX <= left + w &&
      clientY >= top &&
      clientY <= top + h
    )
  }

  const endTap = (e: React.PointerEvent, onBackdrop: boolean) => {
    // A tap on the letterbox closes; a tap on the photo starts the
    // double-tap-to-zoom window instead of surprise-closing the viewer.
    if (onBackdrop && !withinPhoto(e.clientX, e.clientY)) {
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

  // One slide per media item, keyed by media index so the DOM node (and its
  // already-painted thumbnail) survives a neighbour becoming the current
  // photo — swiping never starts from a black frame. Wrappers slide, the
  // inner <img> carries the zoom transform.
  const slideTransition = gesturing ? "none" : "transform .18s ease-out"
  const slideAt = (offset: number): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    transform:
      offset === 0
        ? `translateX(${dragX}px)`
        : `translateX(calc(${offset * 100}% + ${offset * SLIDE_GAP + dragX}px))`,
    transition: slideTransition,
    willChange: "transform",
  })

  const renderSlide = (i: number, offset: -1 | 0 | 1) => {
    const it = items[i]
    if (!it) return null
    const isCurrent = offset === 0
    const full = it.kind === "image" ? mediaSrc(it.url) : undefined
    const thumb = it.kind === "image" ? mediaSrc(it.thumb ?? null) : undefined
    const fullReady = !!full && loadedFull.has(full)
    const imgStyle: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "contain",
      transform: isCurrent
        ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`
        : undefined,
      transition: gesturing ? "none" : "transform .18s ease-out",
      userSelect: "none",
      pointerEvents: "none",
    }
    return (
      <div key={i} aria-hidden={!isCurrent} style={slideAt(offset)}>
        {it.kind === "video" ? (
          // Neighbour peek of a video: dark card with a play glyph; the
          // real player renders once it becomes the current item.
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(241,230,205,.7)",
              fontSize: 42,
            }}
          >
            ▶
          </div>
        ) : full || thumb ? (
          <>
            {thumb && (
              <img src={thumb} alt="" draggable={false} style={imgStyle} />
            )}
            {full && (isCurrent || fullReady) && (
              <img
                src={full}
                alt={isCurrent ? it.cap : ""}
                draggable={false}
                decoding="async"
                onLoad={(e) => {
                  const el = e.currentTarget
                  naturalSizes.set(full, {
                    w: el.naturalWidth,
                    h: el.naturalHeight,
                  })
                  loadedFull.add(full)
                  setLoadTick((t) => t + 1)
                }}
                style={{
                  ...imgStyle,
                  opacity: fullReady ? 1 : 0,
                  transition: gesturing
                    ? "opacity .15s ease"
                    : "transform .18s ease-out, opacity .15s ease",
                }}
              />
            )}
          </>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(150deg,rgba(255,255,255,.25),rgba(0,0,0,.32)),${it.tone || "#c9a24e"}`,
            }}
          />
        )}
      </div>
    )
  }

  // Adjacent slides so a swipe drags the next photo into view. With two
  // items the single neighbour is only mounted mid-drag, on the side the
  // finger is pulling from, so it can't sit parked on the wrong side.
  const slides = [renderSlide(index, 0)]
  if (count >= 3 && zoom.scale === 1) {
    slides.unshift(renderSlide((index - 1 + count) % count, -1))
    slides.push(renderSlide((index + 1) % count, 1))
  } else if (count === 2 && zoom.scale === 1 && dragX !== 0) {
    slides.push(renderSlide((index + 1) % count, dragX < 0 ? 1 : -1))
  }

  const fullLoading = item.kind === "image" && !!src && !loadedFull.has(src)

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
            display: "flex",
            alignItems: "center",
            gap: 8,
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
          {slides}
          {fullLoading && (
            // Sharp version still on its way — thumbnail is already showing
            // underneath. Delayed fade-in so fast loads never flash a ring.
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                animation: "bb-fadeIn .25s ease .35s both",
              }}
            >
              <output
                aria-label="Foto laadt"
                style={{
                  display: "block",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "3px solid rgba(241,230,205,.25)",
                  borderTopColor: "rgba(241,230,205,.9)",
                  animation: "bb-spin .8s linear infinite",
                }}
              />
            </div>
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
