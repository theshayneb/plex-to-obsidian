// The dashboard's Randomizer: your notes of one kind, narrowed by genre, status, length and tag,
// and one picked at random. No Obsidian imports, so it can be unit tested; the notes are read in
// recommend-data.ts and shown in recommend-view.ts.
import type { MediaKind } from './notes'

/** The kinds the Randomizer offers (music is left out: songs aren't picked for an evening). */
export const PICK_KINDS: [MediaKind, string][] = [['movie', 'Movies'], ['tv', 'TV shows'], ['documentary', 'Documentaries'], ['book', 'Books'], ['game', 'Games']]

/** One note to choose from. */
export interface PickEntry {
  path: string
  title: string
  kind: MediaKind
  genres: string[]
  /** Its status as written (say, "pending"), or '' for none. */
  status: string
  /** Minutes (a game's or a movie's, a show's episodes'), or pages for a book; undefined when unknown. */
  length?: number
  tags: string[]
}

/** What the Randomizer is narrowed to; '' is "any". */
export interface PickFilter {
  genre: string
  status: string
  length: string
  tag: string
}

export const ANY_FILTER: PickFilter = { genre: '', status: '', length: '', tag: '' }

/** The length choices for each kind: at most this many minutes (pages for books). */
export const LENGTH_CHOICES: Record<string, { id: string, label: string, max: number }[]> = {
  movie: [{ id: '90', label: 'Under 90 minutes', max: 89 }, { id: '120', label: 'Under 2 hours', max: 119 }, { id: '150', label: 'Under 2½ hours', max: 149 }],
  documentary: [{ id: '60', label: 'Under an hour', max: 59 }, { id: '90', label: 'Under 90 minutes', max: 89 }, { id: '120', label: 'Under 2 hours', max: 119 }],
  tv: [{ id: '30', label: 'Episodes under 30 minutes', max: 30 }, { id: '60', label: 'Episodes under an hour', max: 60 }],
  book: [{ id: '200', label: 'Under 200 pages', max: 199 }, { id: '300', label: 'Under 300 pages', max: 299 }, { id: '400', label: 'Under 400 pages', max: 399 }],
  game: [{ id: '300', label: 'Under 5 hours', max: 299 }, { id: '600', label: 'Under 10 hours', max: 599 }, { id: '1200', label: 'Under 20 hours', max: 1199 }, { id: '2400', label: 'Under 40 hours', max: 2399 }],
}

/**
 * A length from a note: a number (minutes, or pages), "1h 52m", "1 hr 45 min", "2 hours",
 * "105 min", "1:45" (hours and minutes; with seconds, "1:45:00"). Undefined when it isn't one.
 */
export function parseLength(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) || undefined
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(text)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) || undefined
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/.exec(text)
  const minutes = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/.exec(text)
  if (!hours && !minutes) return undefined
  return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)) || undefined
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether a note fits the filter. One whose length isn't known never fits a length choice. */
export function fits(entry: PickEntry, filter: PickFilter): boolean {
  if (filter.genre && !entry.genres.some(g => same(g, filter.genre))) return false
  if (filter.status && !same(entry.status, filter.status)) return false
  if (filter.tag && !entry.tags.some(t => same(t, filter.tag))) return false
  if (filter.length) {
    const choice = (LENGTH_CHOICES[entry.kind] ?? []).find(c => c.id === filter.length)
    if (choice && (entry.length === undefined || entry.length > choice.max)) return false
  }
  return true
}

/** Each value a list has across the notes, most common first (then alphabetically), each once in any case. */
function tally(lists: string[][]): string[] {
  const counts = new Map<string, { name: string, n: number }>()
  for (const value of lists.flat()) {
    const key = value.trim().toLowerCase()
    if (!key) continue
    const got = counts.get(key) ?? { name: value.trim(), n: 0 }
    got.n++
    counts.set(key, got)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map(c => c.name)
}

/** The genres, statuses and tags a kind's notes have, to choose from. */
export function pickChoices(entries: PickEntry[]): { genres: string[], statuses: string[], tags: string[] } {
  return {
    genres: tally(entries.map(e => e.genres)),
    statuses: tally(entries.map(e => e.status ? [e.status] : [])),
    tags: tally(entries.map(e => e.tags)),
  }
}

/** One of the notes at random, never `not` (the last pick) when there's another; undefined when there are none. */
export function pickOne(entries: PickEntry[], not?: string, random = Math.random): PickEntry | undefined {
  const from = entries.length > 1 && not ? entries.filter(e => e.path !== not) : entries
  return from[Math.floor(random() * from.length)]
}
