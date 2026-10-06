// Which Plex field fills which frontmatter property. No Obsidian imports, so it can be unit tested.
import { genresOf, isDocumentaryGenre, isStarted, isWatched, type MediaKind, type PlexItem, type PlexTag } from './notes'

export type FieldSource =
  | 'genres' | 'summary' | 'tagline' | 'title' | 'originalTitle'
  | 'releaseDate' | 'year' | 'durationMinutes' | 'durationText'
  | 'status' | 'plexLink' | 'poster' | 'typeTag'
  | 'contentRating' | 'studio' | 'directors' | 'writers' | 'castTop5' | 'castAll'
  | 'countries' | 'collections' | 'labels'
  | 'criticRating' | 'audienceRating' | 'userRating'
  | 'addedAt' | 'lastViewedAt' | 'viewCount' | 'seasons' | 'episodes'
  | 'imdbId' | 'tmdbId' | 'tvdbId' | 'text'

export interface PropertyMapping {
  /** Frontmatter property name. */
  name: string
  source: FieldSource
  /** Only for the 'text' source: the fixed value written to every note. */
  text?: string
}

/** Dropdown labels, in the order they're listed. */
export const FIELD_SOURCES: Record<FieldSource, string> = {
  genres: 'Genres',
  summary: 'Summary',
  tagline: 'Tagline',
  title: 'Title',
  originalTitle: 'Original title',
  releaseDate: 'Release date (first aired for shows)',
  year: 'Year',
  durationMinutes: 'Duration in minutes',
  durationText: 'Duration as text (1h 52m)',
  status: 'Watched status',
  plexLink: 'Link to the item in Plex',
  poster: 'Poster image',
  typeTag: 'Type tag (movie, TV show or documentary)',
  contentRating: 'Content rating (PG-13, TV-MA…)',
  studio: 'Studio or network',
  directors: 'Directors',
  writers: 'Writers',
  castTop5: 'Cast (top 5)',
  castAll: 'Cast (everyone)',
  countries: 'Countries',
  collections: 'Plex collections',
  labels: 'Plex labels',
  criticRating: 'Critic rating (0–10)',
  audienceRating: 'Audience rating (0–10)',
  userRating: 'Your rating (0–10)',
  addedAt: 'Date added to Plex',
  lastViewedAt: 'Date last watched',
  viewCount: 'Play count',
  seasons: 'Number of seasons',
  episodes: 'Number of episodes',
  imdbId: 'IMDb ID',
  tmdbId: 'TMDB ID',
  tvdbId: 'TVDB ID',
  text: 'Fixed text',
}

export const DEFAULT_PROPERTIES: PropertyMapping[] = [
  { name: 'Genre', source: 'genres' },
  { name: 'Summary', source: 'summary' },
  { name: 'Date', source: 'releaseDate' },
  { name: 'Duration', source: 'durationMinutes' },
  { name: 'Status', source: 'status' },
  { name: 'Link', source: 'plexLink' },
  { name: 'Image', source: 'poster' },
  { name: 'tags', source: 'typeTag' },
]

export interface PropertyValues {
  watched: string
  started: string
  unwatched: string
  tags: Record<MediaKind, string>
}

export const DEFAULT_VALUES: PropertyValues = {
  watched: 'completed',
  started: 'started',
  unwatched: 'pending',
  tags: { movie: 'movie', tv: 'tv_show', documentary: 'documentary' },
}

/** Per-note values that come from outside the Plex item itself. */
export interface NoteContext {
  kind: MediaKind
  link: string
  image: string | null
  values: PropertyValues
}

type Value = string | number | string[] | undefined

const tags = (list: PlexTag[] | undefined): string[] => (list ?? []).map(t => t.tag).filter(Boolean)

function localDate(epochSeconds: number | undefined): string | undefined {
  if (!epochSeconds) return undefined
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function durationText(ms: number | undefined): string | undefined {
  if (!ms) return undefined
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

function externalId(item: PlexItem, scheme: string): string | undefined {
  const guid = (item.Guid ?? []).find(g => g.id.startsWith(`${scheme}://`))
  return guid?.id.slice(scheme.length + 3)
}

export function sourceValue(source: FieldSource, item: PlexItem, ctx: NoteContext, text?: string): Value {
  switch (source) {
    case 'genres': {
      const genres = genresOf(item)
      // A documentary's note already says it's a documentary; don't repeat it as a genre.
      return ctx.kind === 'documentary' ? genres.filter(g => !isDocumentaryGenre(g)) : genres
    }
    case 'summary': return item.summary
    case 'tagline': return item.tagline
    case 'title': return item.title
    case 'originalTitle': return item.originalTitle
    case 'releaseDate': return item.originallyAvailableAt
    case 'year': return item.year
    case 'durationMinutes': return item.duration ? Math.round(item.duration / 60000) : undefined
    case 'durationText': return durationText(item.duration)
    case 'status': return isWatched(item) ? ctx.values.watched : isStarted(item) ? ctx.values.started : ctx.values.unwatched
    case 'plexLink': return ctx.link
    case 'poster': return ctx.image ?? undefined
    case 'typeTag': return [ctx.values.tags[ctx.kind]]
    case 'contentRating': return item.contentRating
    case 'studio': return item.studio
    case 'directors': return tags(item.Director)
    case 'writers': return tags(item.Writer)
    case 'castTop5': return tags(item.Role).slice(0, 5)
    case 'castAll': return tags(item.Role)
    case 'countries': return tags(item.Country)
    case 'collections': return tags(item.Collection)
    case 'labels': return tags(item.Label)
    case 'criticRating': return item.rating
    case 'audienceRating': return item.audienceRating
    case 'userRating': return item.userRating
    case 'addedAt': return localDate(item.addedAt)
    case 'lastViewedAt': return localDate(item.lastViewedAt)
    case 'viewCount': return item.viewCount ?? 0
    case 'seasons': return item.type === 'show' ? item.childCount : undefined
    case 'episodes': return item.type === 'show' ? item.leafCount : undefined
    case 'imdbId': return externalId(item, 'imdb')
    case 'tmdbId': return externalId(item, 'tmdb')
    case 'tvdbId': return externalId(item, 'tvdb')
    case 'text': return text
  }
}

const LIST_SOURCES = new Set<FieldSource>([
  'genres', 'typeTag', 'directors', 'writers', 'castTop5', 'castAll', 'countries', 'collections', 'labels',
])

/**
 * Frontmatter for a new note, in the configured order. Properties Plex has no value for are still
 * written, empty (an empty list for list properties), so they can be filled in by hand.
 */
export function buildFrontmatter(item: PlexItem, mappings: PropertyMapping[], ctx: NoteContext): Record<string, unknown> {
  const fm: Record<string, unknown> = {}
  for (const { name, source, text } of mappings) {
    const key = name.trim()
    if (!key) continue
    const value = sourceValue(source, item, ctx, text)
    if (value === undefined || value === '') fm[key] = LIST_SOURCES.has(source) ? [] : null
    else fm[key] = value
  }
  return fm
}

export function usesSource(mappings: PropertyMapping[], source: FieldSource): boolean {
  return mappings.some(m => m.source === source && m.name.trim())
}

/** Property names that hold the Plex link, used to recognise notes that already exist. */
export function linkPropertyNames(mappings: PropertyMapping[]): string[] {
  const names = mappings.filter(m => m.source === 'plexLink').map(m => m.name.trim()).filter(Boolean)
  return names.includes('Link') ? names : [...names, 'Link']
}
