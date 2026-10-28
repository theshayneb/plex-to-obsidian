// The "Revisit" playlist: songs you have but haven't played in a long while, that sound like your
// favorites (Plex's sonic analysis). No Obsidian imports, so it can be unit tested; the requests
// are in playlist.ts.
import type { PlexItem } from './notes'

/** A song not played for this long (or never) counts as forgotten. */
export const FORGOTTEN_DAYS = 180
/** Songs in the playlist. */
export const REVISIT_SIZE = 50

/** A favorite: rated ⭐⭐⭐⭐ or 🩷 in Plex (8 or more out of 10). */
export const isFavorite = (track: PlexItem): boolean => (track.userRating ?? 0) >= 8

/** Not played in `FORGOTTEN_DAYS` (seconds since 1970 for `now`). */
export const isForgotten = (track: PlexItem, now: number): boolean =>
  !track.lastViewedAt || track.lastViewedAt < now - FORGOTTEN_DAYS * 86400

/** Up to `count` favorites to ask Plex about, at random (a new mix each time). */
export function revisitSeeds(tracks: PlexItem[], count: number, random: () => number = Math.random): PlexItem[] {
  return tracks.filter(isFavorite)
    .map(track => ({ track, order: random() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
    .map(t => t.track)
}

/**
 * The playlist's songs: forgotten songs that sound like the most favorites (each counts 1 − its
 * distance for every favorite it's near), with forgotten favorites themselves counting as near to
 * themselves; at most three songs by one artist, best first.
 */
export function revisitPicks(
  near: { seed: PlexItem, similar: (PlexItem & { distance?: number })[] }[],
  now: number,
  count = REVISIT_SIZE,
): PlexItem[] {
  const found = new Map<string, { track: PlexItem, score: number }>()
  const add = (track: PlexItem, value: number) => {
    if (track.type && track.type !== 'track') return
    if (!isForgotten(track, now)) return
    const entry = found.get(track.ratingKey) ?? { track, score: 0 }
    entry.score += value
    found.set(track.ratingKey, entry)
  }
  for (const { seed, similar } of near) {
    add(seed, 1)
    for (const track of similar) {
      if (track.ratingKey === seed.ratingKey) continue
      add(track, 1 - Math.min(1, Math.max(0, track.distance ?? 0.2)))
    }
  }
  const ranked = [...found.values()].sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
  // Not a wall of one artist: at most three songs by each.
  const perArtist = new Map<string, number>()
  const picks: PlexItem[] = []
  for (const { track } of ranked) {
    const artist = (track.originalTitle || track.grandparentTitle || '').toLowerCase()
    const n = perArtist.get(artist) ?? 0
    if (artist && n >= 3) continue
    perArtist.set(artist, n + 1)
    picks.push(track)
    if (picks.length >= count) break
  }
  return picks
}
