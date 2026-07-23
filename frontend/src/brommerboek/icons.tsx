// The Honda Super Cub 50 side-profile and the repair wrench. The Cub is a
// static SVG asset served from /cub50.svg so the same art backs both React
// screens and the imperatively-created MapLibre markers.

import type { CSSProperties } from "react"
import { C } from "./theme"

const CUB_SRC = "/cub50.svg"

export const WRENCH_INNER = `<path d="M15.5 5.5a3.6 3.6 0 0 0-4.7 4.4L4 16.7 7.3 20l6.8-6.8a3.6 3.6 0 0 0 4.4-4.7l-2.2 2.2-2.1-.6-.6-2.1 2.2-2.2Z" fill="currentColor"></path>`

const SHARE_INNER = `<circle cx="18" cy="5.5" r="2.6" fill="currentColor"></circle><circle cx="6" cy="12" r="2.6" fill="currentColor"></circle><circle cx="18" cy="18.5" r="2.6" fill="currentColor"></circle><path d="m8.3 10.7 7.4-4M8.3 13.3l7.4 4" stroke="currentColor" stroke-width="1.8"></path>`

// HTML string for the start/finish flag markers (imperative markers). The
// pole base sits at x=4, y=36 in the 30×38 viewBox — VintageMap anchors the
// marker so that point lands on the flag's coordinate. Start is a teal
// pennant; finish is the checkered flag.
export function flagSvgString(kind: "start" | "finish"): string {
  const cloth =
    kind === "start"
      ? `<path d="M6 5 25 10.5 6 16 Z" fill="${C.teal}" stroke="${C.cream}" stroke-width="1.4" stroke-linejoin="round"/>`
      : `<g stroke="${C.ink}" stroke-width="1">
           <rect x="5" y="4" width="21" height="12" fill="${C.cream}"/>
           <g fill="${C.ink}" stroke="none">
             <rect x="5" y="4" width="7" height="6"/><rect x="19" y="4" width="7" height="6"/>
             <rect x="12" y="10" width="7" height="6"/>
           </g>
           <rect x="5" y="4" width="21" height="12" fill="none"/>
         </g>`
  return `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
    <ellipse cx="4" cy="36" rx="3.4" ry="1.4" fill="rgba(58,51,42,.28)"/>
    <path d="M4 36 V3" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>
    ${cloth}
  </svg>`
}

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
