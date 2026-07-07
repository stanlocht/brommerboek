// Per-stop share links. The backend serves /s/<id> with Open Graph tags so
// pasted links unfurl in chat apps; humans get bounced to /?stop=<id>, which
// the SPA reads on load to restore that stop's sheet.

export function shareUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/s/${id}`
}

// The ?stop=<id> query param from a location.search string, or null.
export function stopIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("stop")
}

// The same href with the stop param removed, for history.replaceState — a
// refresh or copied address bar URL shouldn't re-open the sheet.
export function withoutStopParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete("stop")
  return url.href
}
