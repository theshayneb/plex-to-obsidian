// Plex collections made from notes: the ones you name in a note's Collections property, and
// automatic ones holding every note with a tag ("Comfort: comfort"). No Obsidian imports, so it
// can be unit tested; the requests are in plex-collections.ts.
import { compareTitles } from './notes'

/** An automatic collection: every movie (or show) note with this tag. */
export interface CollectionRule { name: string, tag: string }

/** The owner's to start with. */
export const DEFAULT_COLLECTION_RULES = 'Comfort: comfort\nHoliday: holiday'

/** "Name: tag" lines (a "#" before the tag is fine; a line without a colon uses its words for both). */
export function parseCollectionRules(text: string): CollectionRule[] {
  const rules: CollectionRule[] = []
  for (const line of text.split('\n')) {
    const at = line.lastIndexOf(':')
    const name = (at >= 0 ? line.slice(0, at) : line).trim()
    const tag = (at >= 0 ? line.slice(at + 1) : line).trim().replace(/^#/, '')
    if (name && tag && !rules.some(r => same(r.name, name))) rules.push({ name, tag })
  }
  return rules
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A note that can go in a collection: its Plex item, the library it's in, its Collections and tags. */
export interface CollectionNote {
  path: string
  title: string
  /** The Plex item's rating key. */
  key: string
  /** The Plex library (section) it's in. */
  section: string
  collections: string[]
  tags: string[]
}

/** What a collection should hold, by library: its name, the items, and whether a rule made it. */
export interface WantedCollection {
  section: string
  name: string
  keys: string[]
  titles: Map<string, string>
  auto: boolean
}

/**
 * The collections the notes ask for: each name in a note's Collections (`manual`), and each rule's
 * tag (`auto`), per library; a name in both gets both kinds' notes. Names match in any case, the
 * first spelling kept.
 */
export function wantedCollections(notes: CollectionNote[], rules: CollectionRule[], manual = true, auto = true): WantedCollection[] {
  const found = new Map<string, WantedCollection>()
  const add = (note: CollectionNote, name: string, byRule: boolean) => {
    const id = `${note.section}|${name.trim().toLowerCase()}`
    const entry = found.get(id) ?? { section: note.section, name: name.trim(), keys: [], titles: new Map<string, string>(), auto: false }
    entry.auto ||= byRule
    if (!entry.keys.includes(note.key)) entry.keys.push(note.key)
    entry.titles.set(note.key, note.title)
    found.set(id, entry)
  }
  for (const note of notes) {
    if (manual) for (const name of note.collections) if (name.trim()) add(note, name, false)
    if (auto) {
      for (const rule of rules) {
        if (note.tags.some(t => same(t.replace(/^#/, ''), rule.tag))) add(note, rule.name, true)
      }
    }
  }
  return [...found.values()].sort((a, b) => compareTitles(a.name, b.name))
}

/** What to send to make a collection hold just `want`, given it holds `have` now. */
export function collectionChanges(want: string[], have: string[]): { add: string[], remove: string[] } {
  const now = new Set(have)
  const wanted = new Set(want)
  return { add: want.filter(k => !now.has(k)), remove: have.filter(k => !wanted.has(k)) }
}
