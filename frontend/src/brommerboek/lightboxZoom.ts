// Pure pinch/pan/double-tap math for the media lightbox. Kept free of DOM so
// it's unit-testable — Lightbox.tsx feeds it pointer coordinates and applies
// the resulting transform.

export const MIN_SCALE = 1
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5

// Transform applied to the image: translate(x, y) then scale(scale), both
// around the container centre. x/y are in screen pixels.
export interface ZoomState {
  scale: number
  x: number
  y: number
}

export const ZOOM_RESET: ZoomState = { scale: 1, x: 0, y: 0 }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

// Keep the (scaled) content covering the container: at scale s the content
// overflows by size·(s−1), so the centre may shift at most half of that in
// either direction.
export function clampPan(value: number, size: number, scale: number): number {
  const max = (size * (scale - 1)) / 2
  return Math.min(max, Math.max(-max, value))
}

export function clampZoomState(
  z: ZoomState,
  width: number,
  height: number,
): ZoomState {
  const scale = clampScale(z.scale)
  return {
    scale,
    x: clampPan(z.x, width, scale),
    y: clampPan(z.y, height, scale),
  }
}

// Rescale around a focal point (screen px, relative to the container centre)
// so whatever sits under the user's fingers stays put. A content point c maps
// to screen p = c·scale + offset; keeping p fixed under the new scale gives
// offset' = p − (p − offset)·(scale'/scale).
export function zoomAt(
  z: ZoomState,
  focalX: number,
  focalY: number,
  nextScale: number,
  width: number,
  height: number,
): ZoomState {
  const scale = clampScale(nextScale)
  const ratio = scale / z.scale
  return clampZoomState(
    {
      scale,
      x: focalX - (focalX - z.x) * ratio,
      y: focalY - (focalY - z.y) * ratio,
    },
    width,
    height,
  )
}

// Double-tap: zoom in on the tapped point, or reset when already zoomed.
export function toggleZoom(
  z: ZoomState,
  focalX: number,
  focalY: number,
  width: number,
  height: number,
): ZoomState {
  if (z.scale > 1) return ZOOM_RESET
  return zoomAt(z, focalX, focalY, DOUBLE_TAP_SCALE, width, height)
}

// One-finger drag while zoomed in.
export function panBy(
  z: ZoomState,
  dx: number,
  dy: number,
  width: number,
  height: number,
): ZoomState {
  return clampZoomState(
    { scale: z.scale, x: z.x + dx, y: z.y + dy },
    width,
    height,
  )
}

// Two-finger pinch: the scale grows with the distance between the pointers.
export function pinchScale(
  startScale: number,
  startDistance: number,
  distance: number,
): number {
  if (startDistance <= 0) return clampScale(startScale)
  return clampScale((startScale * distance) / startDistance)
}
