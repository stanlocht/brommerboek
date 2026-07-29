// What a stop stores for the moped's odometer.
//
// Noting the reading is opt-in: on most days the rider doesn't walk over to
// read the dial, and the tracker measures the leg perfectly well without it.
// So the stop carries a reading only when the rider deliberately noted one,
// and that reading is then the fixed value for the stop — the odometer is
// ground truth in a way a GPS estimate never is.
//
// The one thing this must never do is invent a number. A blank or unparsable
// field means "not noted" (null), never 0: a 0 would read as a real reading
// and make the leg into it measure as an enormous ride.

export function notedKm(noted: boolean, raw: string): number | null {
  if (!noted) return null
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const value = Number.parseInt(trimmed, 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}
