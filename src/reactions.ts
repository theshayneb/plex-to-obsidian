// Reactions: how you felt about something when you finished it, kept in its note. No Obsidian
// imports, so it can be unit tested; the pop-ups are in reaction-modal.ts and the vault work in sync.ts.

/** The feelings offered to begin with (Settings → Reactions changes them). */
export const DEFAULT_FEELINGS = ['confused', 'unsettled', 'bored', 'annoyed', 'moved', 'surprised', 'thoughtful', 'sad', 'happy']

/** The themes offered to begin with: the ones in your note templates. */
export const DEFAULT_REACTION_THEMES = ['bravery', 'chosen family', 'finding peace', 'forgiveness', 'loyalty', 'non-conformity', 'questioning authority', 'self-discovery/self-acceptance', 'true love', 'what is a "good" person?', 'what is it to be "human?"', 'what is reality?']

/** Your own tags (also used for quotes and memes) offered with them. */
export const DEFAULT_REACTION_TAGS = ['insightful', 'inspirational', 'feminism', 'atheism', 'comfort', 'funny', 'relatable']

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
}

/** Where a reaction goes in a note's properties. */
export interface ReactionProperties {
  reactions: string
  feelings: string
  themes: string
  /** The note's rating property, which takes the reaction's rating. */
  rating: string
}

/** A reaction as one line of the Reactions list: "2026-10-16 · 🩷 · moved, happy · cried at the end". */
export function reactionLine(r: Reaction): string {
  return [r.date, r.rating, r.feelings.join(', '), r.text?.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ')
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
  kind: 'movie' | 'show'
  /** When it was finished (seconds since 1970). */
  viewedAt: number
  /** Its note's path. */
  path: string
}

/** What a finishing is remembered as once answered or set aside: the item and the day, so a rewatch is asked about again. */
export const finishedKey = (key: string, day: string): string => `${key}@${day}`
