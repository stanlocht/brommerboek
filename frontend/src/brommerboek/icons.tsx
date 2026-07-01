// The Honda Super Cub 50 side-profile and the repair wrench. Defined once as
// raw SVG inner-markup so the same art backs both React screens and the
// imperatively-created MapLibre markers.

import type { CSSProperties } from "react"

export const CUB_INNER = `
  <ellipse cx="68" cy="74" rx="44" ry="5" fill="rgba(58,50,36,.16)"></ellipse>
  <circle cx="32" cy="58" r="16" fill="none" stroke="#2a2620" stroke-width="6"></circle>
  <circle cx="104" cy="58" r="16" fill="none" stroke="#2a2620" stroke-width="6"></circle>
  <circle cx="32" cy="58" r="5" fill="#e9dcc0"></circle>
  <circle cx="104" cy="58" r="5" fill="#e9dcc0"></circle>
  <path d="M18 50 Q30 40 46 48" fill="none" stroke="#b23a30" stroke-width="5" stroke-linecap="round"></path>
  <path d="M90 50 Q104 39 118 49" fill="none" stroke="#b23a30" stroke-width="5" stroke-linecap="round"></path>
  <path d="M40 52 C36 38 52 33 72 35 L90 37 C96 42 95 50 88 52 Z" fill="#b23a30"></path>
  <path d="M92 54 C82 34 82 22 95 15 L104 15 C112 26 110 46 106 52 Z" fill="#f1e6cd" stroke="#b23a30" stroke-width="2.5"></path>
  <rect x="40" y="30" width="30" height="9" rx="4" fill="#332c22"></rect>
  <path d="M70 34 C82 30 90 30 95 34" fill="none" stroke="#332c22" stroke-width="4" stroke-linecap="round"></path>
  <rect x="44" y="50" width="46" height="4" rx="2" fill="#2a2620"></rect>
  <circle cx="99" cy="20" r="6.5" fill="#ffe6a8" stroke="#7a5a2e" stroke-width="2"></circle>
  <path d="M97 14 L112 7" stroke="#332c22" stroke-width="4" stroke-linecap="round"></path>
  <path d="M90 55 L112 55" stroke="#8a8175" stroke-width="3.5" stroke-linecap="round"></path>
  <rect x="38" y="26" width="26" height="6" rx="3" fill="#7a5a2e"></rect>
`

export const WRENCH_INNER = `<path d="M15.5 5.5a3.6 3.6 0 0 0-4.7 4.4L4 16.7 7.3 20l6.8-6.8a3.6 3.6 0 0 0 4.4-4.7l-2.2 2.2-2.1-.6-.6-2.1 2.2-2.2Z" fill="currentColor"></path>`

// Full <svg> string for a cub at a given pixel size (imperative markers).
export function cubSvgString(width: number, height: number): string {
  return `<svg viewBox="0 0 130 82" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${CUB_INNER}</svg>`
}

export function CubIcon({
  width = 60,
  height = 38,
  style,
}: {
  width?: number
  height?: number
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 130 82"
      width={width}
      height={height}
      style={style}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static local art
      dangerouslySetInnerHTML={{ __html: CUB_INNER }}
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
