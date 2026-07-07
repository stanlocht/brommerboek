// Vintage road-atlas palette + typographic constants, shared across screens.

export const C = {
  paper: "#e9dcbf",
  paperCard: "#f4ecd6",
  paperLight: "#efe4c9",
  cream: "#f1e6cd",
  ink: "#3a332a",
  inkSoft: "#413a2c",
  sepia: "#7a6f5a",
  ochre: "#b98f4e",
  ochreDeep: "#9c6b3a",
  red: "#a3302a",
  redBright: "#c0362c",
  routeRed: "#c0362c",
  teal: "#2e6d7a",
  sea: "#a9c6cb",
  seaInk: "#5f8b93",
  border: "#cbb187",
  borderSoft: "#d8c79c",
  wrappedInk: "#f3e7c9",
} as const

export const FONT_SERIF = "'Zilla Slab', Georgia, serif"
export const FONT_MONO = "'Special Elite', 'Courier New', monospace"

const MONTHS_NL = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
]

// "4 mei 2024" — matches the design's dfmt.
export function dateLabelNL(iso: string, withYear = true): string {
  const d = new Date(iso)
  const s = `${d.getUTCDate()} ${MONTHS_NL[d.getUTCMonth()]}`
  return withYear ? `${s} ${d.getUTCFullYear()}` : s
}

export function kmLabel(km: number): string {
  return km.toLocaleString("nl-NL")
}

// Slight hand-placed rotations reused for pins and gallery cards.
export const PIN_ROTS = [-6, 4, -3, 5, -2, 6, -4, 3, -5, 2]
export const GALLERY_ROTS = ["-1.5deg", "1.5deg", "-1deg", "1deg"]
export const STAMP_ROTS = [
  "-2deg",
  "1.6deg",
  "-1.2deg",
  "2.2deg",
  "-1.8deg",
  "1.4deg",
]
