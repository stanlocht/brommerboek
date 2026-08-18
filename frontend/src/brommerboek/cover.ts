// Which picture stands for a stop — on the map card, in the replay and in
// share unfurls. The rider can flag one item as the cover so the choice no
// longer depends on which file happened to upload first; nothing flagged
// falls back to the first item, which is what every older stop expects.

import type { MediaItem } from "./types"

export function coverItem(
  media: MediaItem[] | undefined,
): MediaItem | undefined {
  if (!media || media.length === 0) return undefined
  // A real file beats a tone swatch, but only among unflagged items: an
  // explicit flag is the rider's choice and always wins.
  return media.find((m) => m.cover) ?? media.find((m) => m.url) ?? media[0]
}

// Index of the cover item, for UIs that highlight the tile the rider picked.
// -1 when there is no media at all.
export function coverIndex(media: MediaItem[] | undefined): number {
  const item = coverItem(media)
  return item ? (media?.indexOf(item) ?? -1) : -1
}
