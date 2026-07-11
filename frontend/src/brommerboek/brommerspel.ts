// Pure game math for "Brommersprong", the Chrome-dino-style minigame where
// the cub jumps over roadside obstacles. Everything runs in a fixed logical
// world (WORLD_H units tall) that the canvas scales up, so physics behaves
// the same on every screen and vitest can exercise it directly.

// Logical world height; the canvas maps this to its CSS height.
export const WORLD_H = 240
// Top of the road surface, in world units from the top.
export const GROUND_Y = 196

export const GRAVITY = 2200 // world units / s²
export const JUMP_VELOCITY = -700 // world units / s, upward
export const BASE_SPEED = 300 // world units / s
export const MAX_SPEED = 620
export const SPEED_RAMP = 8 // extra speed per second survived

// The cub sprite (/cub50.svg is 1518×2048) drawn at this world size.
export const CUB_H = 54
export const CUB_W = Math.round((CUB_H * 1518) / 2048)
export const CUB_X = 38 // left edge of the cub, fixed

// Collision boxes shrink by this much on every side so grazing a cone with
// the paper margin of the sprite doesn't kill the run.
export const HIT_PAD = 5

export interface JumpState {
  // Offset above the ground; 0 = riding, negative = airborne (y axis down).
  y: number
  vy: number
  airborne: boolean
}

export const RIDING: JumpState = { y: 0, vy: 0, airborne: false }

export function startJump(s: JumpState): JumpState {
  return s.airborne ? s : { y: 0, vy: JUMP_VELOCITY, airborne: true }
}

// One physics tick. Lands exactly on the ground instead of sinking past it.
export function stepJump(s: JumpState, dt: number): JumpState {
  if (!s.airborne) return s
  const vy = s.vy + GRAVITY * dt
  const y = s.y + s.vy * dt + 0.5 * GRAVITY * dt * dt
  if (y >= 0) return RIDING
  return { y, vy, airborne: true }
}

export function speedAt(elapsedSeconds: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * elapsedSeconds)
}

// World-distance until the next obstacle spawns. Scales with speed so the
// jump window stays fair, with a random stretch for rhythm; never closer
// than a full jump's travel.
export function nextGap(speed: number, rand: number): number {
  return Math.max(260, speed * (0.8 + rand * 0.9))
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function overlaps(a: Box, b: Box, pad = HIT_PAD): boolean {
  return (
    a.x + pad < b.x + b.w - pad &&
    a.x + a.w - pad > b.x + pad &&
    a.y + pad < b.y + b.h - pad &&
    a.y + a.h - pad > b.y + pad
  )
}

export type ObstacleKind = "kegel" | "kegels" | "vat" | "koffer"

export interface ObstacleSpec {
  kind: ObstacleKind
  w: number
  h: number
}

// Roadside obstacles instead of cacti: traffic cones, an oil drum and a
// strapped suitcase that fell off someone's rack.
export const OBSTACLES: readonly ObstacleSpec[] = [
  { kind: "kegel", w: 20, h: 27 },
  { kind: "kegels", w: 44, h: 27 },
  { kind: "vat", w: 26, h: 36 },
  { kind: "koffer", w: 36, h: 22 },
] as const

export function pickObstacle(rand: number): ObstacleSpec {
  const i = Math.min(OBSTACLES.length - 1, Math.floor(rand * OBSTACLES.length))
  return OBSTACLES[Math.max(0, i)]
}

// Distance → score, and the dino-style zero-padded label.
export function scoreFor(distance: number): number {
  return Math.floor(distance / 20)
}

export function scoreLabel(score: number): string {
  return String(Math.max(0, Math.floor(score))).padStart(5, "0")
}
