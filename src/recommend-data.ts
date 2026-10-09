import { normalizePath, type App } from 'obsidian'
import type { PlexNotesSettings } from './config'
import { displayName, isStarted, isWatched, ratingKeyFromLink, type MediaKind, type PlexItem } from './notes'
import { linkPropertyNames, listOf, noteStars, type FieldSource } from './properties'
import type { RecEntry, RecGroup } from './recommend'

const GENRE_SOURCES: FieldSource[] = ['genres', 'styles', 'moods']
const PEOPLE_SOURCES: FieldSource[] = ['directors', 'writers', 'castTop5', 'castAll', 'studio', 'authors', 'artist', 'albumArtist', 'developers', 'publishers']
const RATING_SOURCES: FieldSource[] = ['userRatingEmoji', 'userRating']

export const groupOf = (kind: MediaKind): RecGroup =>
  kind === 'music' || kind === 'game' || kind === 'book' ? kind : 'video'

/** A list property's values, with [[links]] turned back into their names. */
function names(value: unknown): string[] {
  return listOf(value).map(v => v.replace(/^\[\[(?:[^\]|]*\|)?([^\]]*)\]\]$/, '$1').trim()).filter(Boolean)
}

/** Every note in the libraries' folders, as something to learn from or recommend. */
export function noteEntries(app: App, settings: PlexNotesSettings): (RecEntry & { path: string })[] {
  const out: (RecEntry & { path: string })[] = []
  const seen = new Set<string>()
  const files = app.vault.getMarkdownFiles()
  for (const lib of Object.values(settings.libraries)) {
    if (lib.target === 'skip') continue
    const kind = lib.target
    const folder = normalizePath(lib.folder)
    const of = (sources: FieldSource[]) => lib.properties.filter(m => sources.includes(m.source) && m.name.trim()).map(m => m.name.trim())
    const genreProps = of(GENRE_SOURCES)
    const peopleProps = of(PEOPLE_SOURCES)
    const ratingProps = lib.properties.filter(m => RATING_SOURCES.includes(m.source) && m.name.trim())
    const statusProps = of(['status'])
    const links = linkPropertyNames(lib.properties)
    for (const file of files) {
      if (!file.path.startsWith(`${folder}/`) || seen.has(file.path)) continue
      seen.add(file.path)
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      // A rating not yet reviewed is still in the library's old scale.
      const noteKey = kind === 'book' ? `book:${file.path}` : links.map(name => ratingKeyFromLink(fm[name])).find(Boolean) ?? ''
      const scale = settings.ratingsReviewed[noteKey] ? 'stars' : kind === 'music' ? 'plain' : 'emoji'
      const level = ratingProps.map(m => noteStars(fm[m.name.trim()], m.source === 'userRating' ? 'stars' : scale)).find(l => l !== null) ?? null
      const unwatched = lib.values.unwatched.trim().toLowerCase()
      const unseen = statusProps.some(name => typeof fm[name] === 'string' && fm[name].trim().toLowerCase() === unwatched)
      const people = peopleProps.flatMap(name => names(fm[name]))
      // A book named "Title by Author" has its author even without an author property.
      const byAuthor = kind === 'book' && !people.length ? / by (.+)$/.exec(file.basename)?.[1] : undefined
      out.push({
        id: `note:${file.path}`,
        path: file.path,
        title: file.basename,
        group: groupOf(kind),
        genres: genreProps.flatMap(name => names(fm[name])),
        people: byAuthor ? [byAuthor] : people,
        level,
        unseen,
      })
    }
  }
  return out
}

/** A Plex or Steam item with no note yet, as something to recommend (or learn from, if you rated it in Plex). */
export function itemEntry(item: PlexItem, kind: MediaKind): RecEntry {
  const tags = (list?: { tag: string }[]) => (list ?? []).map(t => t.tag)
  const artist = item.type === 'track' ? [item.originalTitle, item.grandparentTitle].filter((a): a is string => Boolean(a)) : []
  return {
    id: `item:${item.ratingKey}`,
    title: displayName(item),
    group: groupOf(kind),
    genres: [...tags(item.Genre), ...tags(item.Style), ...tags(item.Mood)],
    people: [...tags(item.Director), ...tags(item.Writer), ...tags(item.Role).slice(0, 5), ...item.studio ? [item.studio] : [], ...artist],
    level: item.userRating ? Math.min(5, Math.ceil(item.userRating / 2)) : null,
    unseen: !isWatched(item) && !isStarted(item),
  }
}

/**
 * A note with what its Plex or Steam item knows added (genres, and people such as the director,
 * writers, main cast and studio), for ranking only: nothing is written to the note.
 */
export function withItem(note: RecEntry, item: RecEntry): RecEntry {
  const union = (a: string[], b: string[]) => [...new Map([...a, ...b].map(v => [v.toLowerCase(), v])).values()]
  return { ...note, genres: union(note.genres, item.genres), people: union(note.people, item.people) }
}
