import type { LibrarySetting } from './config'

/** The kinds of media, in the order "Remembered choices" lists them. */
export const KIND_ORDER: [string, string][] = [
  ['movie', 'Movies'], ['tv', 'TV shows'], ['documentary', 'Documentaries'], ['music', 'Music'], ['game', 'Games'], ['book', 'Books'],
]

/** Where a remembered choice can't be put under a kind of media (its library or note is gone). */
export const OTHER_KIND = 'Other'

const kindName = (target: string): string => KIND_ORDER.find(([kind]) => kind === target)?.[1] ?? OTHER_KIND

/** The kind of media of the library a note is in (the deepest library folder holding it). */
export function kindOfPath(libraries: Record<string, LibrarySetting>, path: string): string {
  let best: LibrarySetting | null = null
  for (const lib of Object.values(libraries)) {
    const folder = lib.folder.replace(/^\/+|\/+$/g, '')
    if (lib.target === 'skip' || !folder || !path.startsWith(`${folder}/`)) continue
    if (!best || folder.length > best.folder.replace(/^\/+|\/+$/g, '').length) best = lib
  }
  return best ? kindName(best.target) : OTHER_KIND
}

/** The kind of media of a library, by its settings key or, failing that, its title. */
export function kindOfLibrary(libraries: Record<string, LibrarySetting>, key: string | undefined, title: string): string {
  const lib = (key ? libraries[key] : undefined) ?? Object.values(libraries).find(l => l.title === title)
  return lib ? kindName(lib.target) : OTHER_KIND
}

/**
 * Entries under their kind of media, in `KIND_ORDER` (then anything else), each kind's entries
 * in alphabetical order of their names (then of `then`, for entries with the same name).
 */
export function groupByKind<T>(entries: T[], kindOf: (entry: T) => string, nameOf: (entry: T) => string, then: (entry: T) => string = () => ''): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    const kind = kindOf(entry)
    groups.set(kind, [...groups.get(kind) ?? [], entry])
  }
  const order = [...KIND_ORDER.map(([, name]) => name), OTHER_KIND]
  const rank = (kind: string) => order.includes(kind) ? order.indexOf(kind) : order.length
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([kind, list]) => [kind, [...list].sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base', numeric: true }) || then(a).localeCompare(then(b)))])
}

/** One value or link kept in a pop-up: the note (or item) it's for, the property and what was kept. */
export interface KeptEntry {
  /** The settings key, to forget it. */
  key: string
  links: boolean
  /** A rating key (Plex, `steam-…`), or `book:<path>` for a book note. */
  item: string
  property: string
  kept: string
  offered: string | null
}

/**
 * `settings.keptValues` (`<item>|<property>`, the value as JSON `{kept, offered}` or plain) and
 * `settings.keptLinks` (by item), as a list.
 */
export function keptEntries(keptValues: Record<string, string>, keptLinks: Record<string, string>): KeptEntry[] {
  const values = Object.entries(keptValues).map(([key, raw]): KeptEntry => {
    const at = key.lastIndexOf('|')
    const item = at < 0 ? key : key.slice(0, at)
    const name = at < 0 ? '' : key.slice(at + 1)
    let kept = raw
    let offered: string | null = null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && 'kept' in parsed) {
        kept = String((parsed as { kept: unknown }).kept)
        const offer = (parsed as { offered?: unknown }).offered
        offered = typeof offer === 'string' || typeof offer === 'number' ? String(offer) : null
      }
    } catch {
      // An older plain entry: the note's value alone.
    }
    return { key, links: false, item, property: name === 'plexRating' ? 'Rating sent to Plex' : name, kept, offered }
  })
  const links = Object.entries(keptLinks).map(([item, kept]): KeptEntry => ({ key: item, links: true, item, property: 'Link', kept, offered: null }))
  return [...values, ...links]
}
