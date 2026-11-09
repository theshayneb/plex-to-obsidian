// Reactions: how you felt about something when you finished it, kept in its note. No Obsidian
// imports, so it can be unit tested; the pop-ups are in reaction-modal.ts and the vault work in sync.ts.

/** The feelings offered to begin with (Settings → Reactions changes them). */
export const DEFAULT_FEELINGS = ['confused', 'unsettled', 'bored', 'annoyed', 'moved', 'surprised', 'thoughtful', 'sad', 'happy']

/** The themes offered to begin with: the ones in your note templates. */
export const DEFAULT_REACTION_THEMES = ['bravery', 'chosen family', 'finding peace', 'forgiveness', 'loyalty', 'non-conformity', 'questioning authority', 'self-discovery/self-acceptance', 'true love', 'what is a "good" person?', 'what is it to be "human?"', 'what is reality?']

/** Your own tags (also used for quotes and memes) offered with them. */
export const DEFAULT_REACTION_TAGS = ['insightful', 'inspirational', 'feminism', 'atheism', 'comfort', 'funny', 'relatable', 'holiday']

/** One reaction, as given in the pop-up. */
export interface Reaction {
  /** The day it was finished (YYYY-MM-DD). */
  date: string
  /** In the star scale (💣 ⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐ 🩷), when one was picked. */
  rating?: string
  feelings: string[]
  themes: string[]
  tags: string[]
  /** A few words of your own. */
  text?: string
  /**
   * For a TV show (a note tagged tv_show): the episodes watched that day ("S02E01 – Title, …",
   * possibly empty). Set, the line names them in place of the rating, which is the show's, not
   * the episodes': it still goes in the note's rating property.
   */
  episodes?: string
}

/** Where a reaction goes in a note's properties. */
export interface ReactionProperties {
  reactions: string
  feelings: string
  themes: string
  /** The note's rating property, which takes the reaction's rating. */
  rating: string
}

/**
 * A reaction as one line of the Reactions list: "2026-10-16 · 🩷 · moved, happy · cried at the end";
 * for a TV show, "2026-11-04 · S02E01 – Title · entertained, happy · words" (no rating).
 */
export function reactionLine(r: Reaction): string {
  const oneLine = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim()
  const middle = r.episodes !== undefined ? oneLine(r.episodes) : r.rating
  return [r.date, middle, r.feelings.join(', '), oneLine(r.text)].filter(Boolean).join(' · ')
}

const listOf = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]

/** A list with `more` added (each once, any case), keeping what's there and its order. */
function withAll(existing: unknown, more: string[]): unknown[] {
  const out = listOf(existing)
  for (const value of more) {
    if (!out.some(v => String(v).trim().toLowerCase() === value.trim().toLowerCase())) out.push(value)
  }
  return out
}

/**
 * A note's frontmatter with a reaction added: its line at the end of Reactions, its feelings,
 * themes and tags added to those already there (nothing is removed), and its rating, if one was
 * picked, as the note's rating. Changes `fm` in place, as `processFrontMatter` wants.
 */
export function addReaction(fm: Record<string, unknown>, r: Reaction, names: ReactionProperties): void {
  fm[names.reactions] = [...listOf(fm[names.reactions]), reactionLine(r)]
  if (r.feelings.length) fm[names.feelings] = withAll(fm[names.feelings], r.feelings)
  if (r.themes.length) fm[names.themes] = withAll(fm[names.themes], r.themes)
  if (r.tags.length) fm.tags = withAll(fm.tags, r.tags.map(t => t.replace(/^#/, '')))
  if (r.rating) fm[names.rating] = r.rating
}

/** A list of words from the settings' box: one per line or comma, trimmed, each once. */
export function wordList(text: string): string[] {
  const out: string[] = []
  for (const word of text.split(/[\n,]/).map(w => w.trim()).filter(Boolean)) {
    if (!out.some(w => w.toLowerCase() === word.toLowerCase())) out.push(word)
  }
  return out
}

/** Something you finished in Plex, to react to. */
export interface Finished {
  key: string
  title: string
  kind: 'movie' | 'show' | 'game'
  /** When it was finished (seconds since 1970); for a game, when it was seen in a finishing Steam collection. */
  viewedAt: number
  /** Its note's path. */
  path: string
  /** A game's status from its Steam collection (completed, abandoned…). */
  status?: string
  /** A game's playtime, in minutes, when known. */
  playtime?: number
}

/** When a game was first seen in a Steam collection that finishes it, and with which status. */
export interface FinishSeen {
  status: string
  /** When it was first seen there (seconds since 1970). */
  at: number
  /** Already there at the very first look (offered only if its note has no reaction yet). */
  existing?: boolean
}

/**
 * Which games are in a finishing Steam collection now (`now` by `steam-<appid>`, their status),
 * remembered with when each was first seen there: a game still there keeps its date, one moved in
 * (or moved to another finishing collection) gets `at`, one taken out is forgotten. Before the first
 * look (`seen` null), the games already there are marked `existing`.
 */
export function finishSeen(now: Record<string, string>, seen: Record<string, FinishSeen> | null, at: number): Record<string, FinishSeen> {
  const out: Record<string, FinishSeen> = {}
  for (const [key, status] of Object.entries(now)) {
    const before = seen?.[key]
    out[key] = before && before.status.toLowerCase() === status.toLowerCase() ? before : { status, at, ...seen === null ? { existing: true } : {} }
  }
  return out
}

/**
 * Whether a note's Reactions already have one from that day or later (reaction lines start with
 * their date), so a finishing it reacts to needn't be asked about.
 */
export function reactedSince(reactions: unknown, day: string): boolean {
  return listOf(reactions).some(line => {
    const date = /^(\d{4}-\d{2}-\d{2})\b/.exec(String(line).trim())?.[1]
    return !!date && date >= day
  })
}

/** What a finishing is remembered as once answered or set aside: the item and the day, so a rewatch is asked about again. */
export const finishedKey = (key: string, day: string): string => `${key}@${day}`
