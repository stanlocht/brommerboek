// The Honda Super Cub 50 side-profile and the repair wrench. The Cub is a
// static SVG asset served from /cub50.svg so the same art backs both React
// screens and the imperatively-created MapLibre markers.

import type { CSSProperties } from "react"

const CUB_SRC = "/cub50.svg"

export const WRENCH_INNER = `<path d="M15.5 5.5a3.6 3.6 0 0 0-4.7 4.4L4 16.7 7.3 20l6.8-6.8a3.6 3.6 0 0 0 4.4-4.7l-2.2 2.2-2.1-.6-.6-2.1 2.2-2.2Z" fill="currentColor"></path>`

const SHARE_INNER = `<circle cx="18" cy="5.5" r="2.6" fill="currentColor"></circle><circle cx="6" cy="12" r="2.6" fill="currentColor"></circle><circle cx="18" cy="18.5" r="2.6" fill="currentColor"></circle><path d="m8.3 10.7 7.4-4M8.3 13.3l7.4 4" stroke="currentColor" stroke-width="1.8"></path>`

// HTML string for a cub at a given pixel size (imperative markers).
export function cubSvgString(width: number, height: number): string {
  return `<img src="${CUB_SRC}" width="${width}" height="${height}" alt="" draggable="false" style="display:block" />`
}

export function CubIcon({
  width = 70,
  height = 94,
  style,
}: {
  width?: number
  height?: number
  style?: CSSProperties
}) {
  return (
    <img
      src={CUB_SRC}
      width={width}
      height={height}
      alt=""
      draggable={false}
      style={{ display: "block", ...style }}
    />
  )
}

export function ShareIcon({
  size = 16,
  color = "currentColor",
  style,
}: {
  size?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ color, ...style }}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static local art
      dangerouslySetInnerHTML={{ __html: SHARE_INNER }}
    />
  )
}

export function WrenchIcon({
  size = 16,
  color = "currentColor",
  style,
}: {
  size?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ color, ...style }}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static local art
      dangerouslySetInnerHTML={{ __html: WRENCH_INNER }}
    />
  )
}
