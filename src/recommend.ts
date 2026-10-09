// Recommendations from your own library: what you loved, set against what you haven't rated or
// watched yet. No Obsidian imports, so it can be unit tested.

/** Media are only recommended against their own kind: movies, shows and documentaries together. */
export type RecGroup = 'video' | 'music' | 'game' | 'book'

export interface RecEntry {
  /** `note:<path>` for a note, `item:<rating key>` for a Plex item with no note yet. */
  id: string
  title: string
  group: RecGroup
  /** Genres, styles and moods. */
  genres: string[]
  /** Directors, writers, cast, studios, authors, artists, developers and publishers. */
  people: string[]
  /** Your rating, 1–5 in the star scale (🩷 is 5), or null for none. */
  level: number | null
  /** Not watched, read or played yet. */
  unseen: boolean
}

export interface Recommendation {
  entry: RecEntry
  score: number
  /** The loved titles it's most like, best first. */
  because: string[]
  /** What it shares with them, people first. */
  shared: string[]
}

/** Loved: four stars or 🩷. */
export const isLoved = (entry: RecEntry): boolean => (entry.level ?? 0) >= 4

/** Something to recommend: no rating, or not watched (read, played) yet, and not loved. */
export const isOpen = (entry: RecEntry): boolean => !isLoved(entry) && (entry.level === null || entry.unseen)

const key = (text: string): string => text.trim().toLowerCase()

/**
 * The open entries most like the ones you loved, per group, best first. A loved 🩷 counts twice a
 * four-star one; a shared person (director, author, artist…) counts three times a genre, and genre
 * overlap is scaled by how many genres both have, so a long genre list doesn't win on its own.
 */
export function recommend(entries: RecEntry[], notInterested: Set<string>, perGroup = 10): Record<RecGroup, Recommendation[]> {
  const out: Record<RecGroup, Recommendation[]> = { video: [], music: [], game: [], book: [] }
  const loved = entries.filter(isLoved)
  for (const candidate of entries) {
    if (!isOpen(candidate) || notInterested.has(candidate.id)) continue
    const genres = new Set(candidate.genres.map(key))
    const people = new Set(candidate.people.map(key))
    if (!genres.size && !people.size) continue
    let score = 0
    const likeness: { title: string, value: number }[] = []
    const sharedCount = new Map<string, { name: string, count: number, person: boolean }>()
    for (const fav of loved) {
      if (fav.group !== candidate.group || fav.id === candidate.id) continue
      const sameGenres = fav.genres.filter(g => genres.has(key(g)))
      const samePeople = fav.people.filter(p => people.has(key(p)))
      if (!sameGenres.length && !samePeople.length) continue
      const genreScore = sameGenres.length / Math.sqrt(Math.max(1, genres.size) * Math.max(1, fav.genres.length))
      const value = (fav.level === 5 ? 2 : 1) * (genreScore + 3 * samePeople.length)
      score += value
      likeness.push({ title: fav.title, value })
      for (const [names, person] of [[samePeople, true], [sameGenres, false]] as const) {
        for (const name of names) {
          const found = sharedCount.get(key(name)) ?? { name, count: 0, person }
          found.count++
          sharedCount.set(key(name), found)
        }
      }
    }
    if (!score) continue
    out[candidate.group].push({
      entry: candidate,
      score,
      because: likeness.sort((a, b) => b.value - a.value).slice(0, 2).map(l => l.title),
      shared: [...sharedCount.values()]
        .sort((a, b) => Number(b.person) - Number(a.person) || b.count - a.count)
        .slice(0, 3).map(s => s.name),
    })
  }
  for (const group of Object.keys(out) as RecGroup[]) {
    out[group] = out[group].sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title)).slice(0, perGroup)
  }
  return out
}
