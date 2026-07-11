// "Brommersprong" — the Chrome-offline-dino game in the Brommerboek idiom:
// the cub races a paper road and jumps over roadside obstacles (cones, an
// oil drum, a fallen suitcase). All rendering is canvas; the physics and
// spawning math live in brommerspel.ts so they stay testable.

import { useEffect, useRef, useState } from "react"
import {
  BASE_SPEED,
  CUB_H,
  CUB_W,
  CUB_X,
  GROUND_Y,
  nextGap,
  type ObstacleSpec,
  overlaps,
  pickObstacle,
  RIDING,
  scoreFor,
  scoreLabel,
  speedAt,
  startJump,
  stepJump,
  WORLD_H,
} from "./brommerspel"
import { C, FONT_MONO, FONT_SERIF } from "./theme"

const HI_KEY = "bb-brommersprong-hi"

function loadHi(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(HI_KEY)) || 0)
  } catch {
    return 0
  }
}

function saveHi(hi: number) {
  try {
    localStorage.setItem(HI_KEY, String(hi))
  } catch {
    // Private-mode storage failures just mean the record isn't kept.
  }
}

interface LiveObstacle extends ObstacleSpec {
  x: number
}

type Phase = "ready" | "running" | "dead"

function drawCone(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  w: number,
  h: number,
) {
  const cx = x + w / 2
  ctx.fillStyle = C.redBright
  ctx.beginPath()
  ctx.moveTo(cx, groundY - h)
  ctx.lineTo(x + w * 0.85, groundY - 3)
  ctx.lineTo(x + w * 0.15, groundY - 3)
  ctx.closePath()
  ctx.fill()
  // reflective band
  ctx.fillStyle = C.paperLight
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.18, groundY - h * 0.62)
  ctx.lineTo(cx + w * 0.18, groundY - h * 0.62)
  ctx.lineTo(cx + w * 0.26, groundY - h * 0.42)
  ctx.lineTo(cx - w * 0.26, groundY - h * 0.42)
  ctx.closePath()
  ctx.fill()
  // foot
  ctx.fillStyle = C.redBright
  ctx.fillRect(x, groundY - 4, w, 4)
}

function drawBarrel(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = C.teal
  ctx.beginPath()
  ctx.roundRect(x, groundY - h, w, h, 3)
  ctx.fill()
  ctx.fillStyle = "rgba(243,231,201,.55)"
  ctx.fillRect(x, groundY - h * 0.72, w, 3)
  ctx.fillRect(x, groundY - h * 0.38, w, 3)
}

function drawSuitcase(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = C.ochre
  ctx.beginPath()
  ctx.roundRect(x, groundY - h, w, h, 4)
  ctx.fill()
  // straps + handle
  ctx.fillStyle = C.ochreDeep
  ctx.fillRect(x + w * 0.22, groundY - h, 4, h)
  ctx.fillRect(x + w * 0.68, groundY - h, 4, h)
  ctx.beginPath()
  ctx.roundRect(x + w / 2 - 6, groundY - h - 5, 12, 6, 3)
  ctx.fill()
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  o: LiveObstacle,
  groundY: number,
) {
  if (o.kind === "kegel") drawCone(ctx, o.x, groundY, o.w, o.h)
  else if (o.kind === "kegels") {
    const w = (o.w - 4) / 2
    drawCone(ctx, o.x, groundY, w, o.h)
    drawCone(ctx, o.x + w + 4, groundY, w, o.h)
  } else if (o.kind === "vat") drawBarrel(ctx, o.x, groundY, o.w, o.h)
  else drawSuitcase(ctx, o.x, groundY, o.w, o.h)
}

export default function BrommerGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hi, setHi] = useState(loadHi)
  const hiRef = useRef(hi)
  hiRef.current = hi

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const cub = new Image()
    cub.src = "/cub50.svg"

    let phase: Phase = "ready"
    let jump = RIDING
    let obstacles: LiveObstacle[] = []
    let distance = 0
    let elapsed = 0
    let untilSpawn = 0
    let roadPhase = 0
    let lastT: number | null = null
    let diedAt = 0
    let raf = 0

    // Canvas is sized to its CSS box; the world scales with height so the
    // road always sits at the same visual spot on any screen.
    let viewW = 0
    let scale = 1
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      scale = r.height / WORLD_H
      viewW = r.width / scale
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const reset = () => {
      jump = RIDING
      obstacles = []
      distance = 0
      elapsed = 0
      untilSpawn = nextGap(BASE_SPEED, Math.random())
      phase = "running"
    }

    const press = () => {
      if (phase === "running") {
        jump = startJump(jump)
        return
      }
      // A jump tapped just before the crash shouldn't instantly restart.
      if (phase === "dead" && performance.now() - diedAt < 350) return
      reset()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key === " " || e.key === "ArrowUp") {
        e.preventDefault()
        press()
      }
    }
    const onPointer = (e: PointerEvent) => {
      e.preventDefault()
      press()
    }
    window.addEventListener("keydown", onKey)
    canvas.addEventListener("pointerdown", onPointer)

    const die = () => {
      phase = "dead"
      diedAt = performance.now()
      const score = scoreFor(distance)
      if (score > hiRef.current) {
        setHi(score)
        saveHi(score)
      }
    }

    const draw = () => {
      const score = scoreFor(distance)
      ctx.clearRect(0, 0, viewW, WORLD_H)

      // sky + distant hills, in the atlas palette
      ctx.fillStyle = C.paperLight
      ctx.fillRect(0, 0, viewW, WORLD_H)
      ctx.fillStyle = "rgba(185,143,78,.18)"
      const hillShift = (distance * 0.25) % (viewW + 240)
      for (let hx = -hillShift; hx < viewW; hx += 240) {
        ctx.beginPath()
        ctx.ellipse(hx + 120, GROUND_Y + 6, 130, 34, 0, Math.PI, 0)
        ctx.fill()
      }

      // road: solid shoulder + dashed centre line like the route
      ctx.strokeStyle = C.border
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, GROUND_Y)
      ctx.lineTo(viewW, GROUND_Y)
      ctx.stroke()
      ctx.strokeStyle = C.redBright
      ctx.setLineDash([14, 10])
      ctx.lineDashOffset = -roadPhase
      ctx.beginPath()
      ctx.moveTo(0, GROUND_Y + 12)
      ctx.lineTo(viewW, GROUND_Y + 12)
      ctx.stroke()
      ctx.setLineDash([])

      for (const o of obstacles) drawObstacle(ctx, o, GROUND_Y)

      // the cub, tilting slightly into the jump
      const cy = GROUND_Y - CUB_H + jump.y
      if (cub.complete && cub.naturalWidth > 0) {
        ctx.save()
        ctx.translate(CUB_X + CUB_W / 2, cy + CUB_H / 2)
        ctx.rotate(jump.airborne ? -0.12 : 0)
        ctx.drawImage(cub, -CUB_W / 2, -CUB_H / 2, CUB_W, CUB_H)
        ctx.restore()
      } else {
        ctx.fillStyle = C.sepia
        ctx.fillRect(CUB_X, cy, CUB_W, CUB_H)
      }

      // dino-style score corner
      ctx.fillStyle = C.ochreDeep
      ctx.font = `11px ${FONT_MONO}`
      ctx.textAlign = "right"
      const hiNow = Math.max(hiRef.current, score)
      ctx.fillText(
        `HI ${scoreLabel(hiNow)}  ${scoreLabel(score)}`,
        viewW - 12,
        20,
      )

      if (phase !== "running") {
        ctx.textAlign = "center"
        if (phase === "dead") {
          ctx.fillStyle = C.red
          ctx.font = `700 24px ${FONT_SERIF}`
          ctx.fillText("MOTORPECH!", viewW / 2, WORLD_H / 2 - 18)
        }
        ctx.fillStyle = C.sepia
        ctx.font = `11px ${FONT_MONO}`
        ctx.fillText(
          phase === "dead"
            ? "tik om opnieuw te rijden"
            : "tik of spatie om te springen",
          viewW / 2,
          WORLD_H / 2 + 6,
        )
      }
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (lastT === null) {
        lastT = now
        draw()
        return
      }
      // Clamp huge gaps (backgrounded tab) so nobody dies while away.
      const dt = Math.min(0.05, (now - lastT) / 1000)
      lastT = now

      if (phase === "running") {
        elapsed += dt
        const speed = speedAt(elapsed)
        distance += speed * dt
        roadPhase = (roadPhase + speed * dt) % 24
        jump = stepJump(jump, dt)

        untilSpawn -= speed * dt
        if (untilSpawn <= 0) {
          const spec = pickObstacle(Math.random())
          obstacles.push({ ...spec, x: viewW + spec.w })
          untilSpawn = nextGap(speed, Math.random())
        }
        for (const o of obstacles) o.x -= speed * dt
        obstacles = obstacles.filter((o) => o.x + o.w > -10)

        const cubBox = {
          x: CUB_X,
          y: GROUND_Y - CUB_H + jump.y,
          w: CUB_W,
          h: CUB_H,
        }
        for (const o of obstacles) {
          if (overlaps(cubBox, { x: o.x, y: GROUND_Y - o.h, w: o.w, h: o.h })) {
            die()
            break
          }
        }
      }
      draw()
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("keydown", onKey)
      canvas.removeEventListener("pointerdown", onPointer)
    }
  }, [onClose])

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        background: C.paper,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 4px 10px",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.ochreDeep,
            }}
          >
            TUSSENSTOP · SPEL
          </div>
          <div
            style={{
              fontFamily: FONT_SERIF,
              fontWeight: 700,
              fontSize: 23,
              lineHeight: 1.1,
            }}
          >
            Brommersprong
          </div>
        </div>
        <div
          style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.ochreDeep }}
        >
          record {scoreLabel(hi)}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Brommersprong: spring met de brommer over obstakels op de weg"
        style={{
          width: "100%",
          height: "min(46vh, 340px)",
          display: "block",
          borderRadius: 12,
          border: `1.5px solid ${C.border}`,
          background: C.paperLight,
          boxShadow: "2px 4px 0 rgba(120,90,40,.28)",
          touchAction: "none",
          cursor: "pointer",
        }}
      />

      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: C.sepia,
          textAlign: "center",
          padding: "10px 0 0",
        }}
      >
        spring over kegels, olievaten en gevallen bagage
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Sluit het spel"
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `1.5px solid ${C.border}`,
          background: C.paperCard,
          color: C.sepia,
          fontSize: 16,
          fontFamily: FONT_MONO,
          cursor: "pointer",
          boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
        }}
      >
        ✕
      </button>
    </div>
  )
}
