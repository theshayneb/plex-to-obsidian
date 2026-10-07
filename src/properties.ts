// Which Plex field fills which frontmatter property. No Obsidian imports, so it can be unit tested.
import { genresOf, isDocumentaryGenre, isStarted, isWatched, trackArtist, yearOf, type MediaKind, type PlexItem, type PlexTag } from './notes'

export type FieldSource =
  | 'genres' | 'summary' | 'tagline' | 'title' | 'originalTitle'
  | 'releaseDate' | 'year' | 'durationMinutes' | 'durationText'
  | 'status' | 'plexLink' | 'poster' | 'typeTag'
  | 'contentRating' | 'studio' | 'directors' | 'writers' | 'castTop5' | 'castAll'
  | 'countries' | 'collections' | 'labels'
  | 'criticRating' | 'audienceRating' | 'userRating' | 'userRatingEmoji'
  | 'addedAt' | 'lastViewedAt' | 'viewCount' | 'seasons' | 'episodes'
  | 'imdbId' | 'tmdbId' | 'tvdbId'
  | 'artist' | 'albumArtist' | 'album' | 'trackNumber' | 'discNumber' | 'durationClock' | 'styles' | 'moods'
  | 'playtime' | 'recentPlaytime' | 'developers' | 'publishers' | 'platforms' | 'metacritic' | 'wideImage'
  | 'hltbMain' | 'hltbLink'
  | 'authors' | 'pages' | 'isbn'
  | 'text'

export interface PropertyMapping {
  /** Frontmatter property name. */
  name: string
  source: FieldSource
  /** Only for the 'text' source: the fixed value written to every note. */
  text?: string
  /** Also fill this property in on existing notes that match a Plex item, when it's empty there. */
  fill?: boolean
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
  durationClock: 'Duration as a clock (3:45)',
  status: 'Watched or played status',
  plexLink: 'Link (Plex, Steam Store, IMDb, Open Library or HowLongToBeat page)',
  poster: 'Poster image (portrait cover for games)',
  typeTag: 'Type tag (set under property values)',
  contentRating: 'Content rating (PG-13, TV-MA…)',
  studio: 'Studio, network or record label',
  directors: 'Directors',
  writers: 'Writers',
  castTop5: 'Cast (top 5)',
  castAll: 'Cast (everyone)',
  countries: 'Countries',
  collections: 'Plex collections',
  labels: 'Plex labels',
  criticRating: 'Critic rating (0–10)',
  audienceRating: 'Audience rating (0–10)',
  userRating: 'Your rating (stars, 0–5)',
  userRatingEmoji: 'Your rating (⭐ emoji, 🩷 for 5 stars)',
  addedAt: 'Date added to Plex',
  lastViewedAt: 'Date last watched or played',
  viewCount: 'Play count',
  seasons: 'Number of seasons',
  episodes: 'Number of episodes',
  imdbId: 'IMDb ID',
  tmdbId: 'TMDB ID',
  tvdbId: 'TVDB ID',
  artist: 'Music: artist',
  albumArtist: 'Music: album artist',
  album: 'Music: album',
  trackNumber: 'Music: track number',
  discNumber: 'Music: disc number',
  styles: 'Music: styles',
  moods: 'Music: moods',
  playtime: 'Games: total playtime (hours)',
  recentPlaytime: 'Games: playtime in the last 2 weeks (hours)',
  developers: 'Games: developers',
  publishers: 'Games: publishers',
  platforms: 'Games: platforms',
  metacritic: 'Games: Metacritic score',
  wideImage: 'Games: wide image (landscape header)',
  hltbMain: 'Games: HowLongToBeat main story (minutes)',
  hltbLink: 'Games: HowLongToBeat page',
  authors: 'Books: authors',
  pages: 'Books: number of pages',
  isbn: 'Books: ISBN',
  text: 'Fixed text',
}

export const DEFAULT_PROPERTIES: PropertyMapping[] = [
  { name: 'Genre', source: 'genres' },
  { name: 'Summary', source: 'summary', fill: true },
  { name: 'Date', source: 'releaseDate' },
  { name: 'Duration', source: 'durationMinutes' },
  { name: 'Status', source: 'status' },
  { name: 'Link', source: 'plexLink', fill: true },
  { name: 'Image', source: 'poster' },
  { name: 'tags', source: 'typeTag' },
]

export const DEFAULT_MUSIC_PROPERTIES: PropertyMapping[] = [
  { name: 'Artist', source: 'artist' },
  { name: 'Album', source: 'album' },
  { name: 'Track', source: 'trackNumber' },
  { name: 'Genre', source: 'genres' },
  { name: 'Date', source: 'releaseDate' },
  { name: 'Duration', source: 'durationClock' },
  { name: 'Link', source: 'plexLink', fill: true },
  { name: 'Image', source: 'poster' },
  { name: 'tags', source: 'typeTag' },
]

export const DEFAULT_GAME_PROPERTIES: PropertyMapping[] = [
  { name: 'Genre', source: 'genres' },
  { name: 'Release Date', source: 'releaseDate' },
  { name: 'Total Playtime', source: 'playtime' },
  { name: 'Status', source: 'status' },
  { name: 'Link', source: 'plexLink', fill: true },
  { name: 'Image', source: 'poster' },
  { name: 'WideImage', source: 'wideImage' },
  { name: 'Main Story', source: 'hltbMain' },
  { name: 'tags', source: 'typeTag' },
]

export const DEFAULT_BOOK_PROPERTIES: PropertyMapping[] = [
  { name: 'Author', source: 'authors' },
  { name: 'Genre', source: 'genres' },
  { name: 'Year', source: 'year' },
  { name: 'Pages', source: 'pages' },
  { name: 'Summary', source: 'summary' },
  { name: 'Status', source: 'status' },
  { name: 'Link', source: 'plexLink', fill: true },
  { name: 'Image', source: 'poster' },
  { name: 'tags', source: 'typeTag' },
]

/** The game defaults of 0.0.19, before HowLongToBeat; a Steam library still using them is moved on. */
export function oldGameProperties(): PropertyMapping[] {
  return DEFAULT_GAME_PROPERTIES.filter(m => !HLTB_SOURCES.includes(m.source))
}

/** Fresh copy of the default properties for a kind of library. */
export function defaultProperties(kind: MediaKind): PropertyMapping[] {
  const defaults = kind === 'music' ? DEFAULT_MUSIC_PROPERTIES
    : kind === 'game' ? DEFAULT_GAME_PROPERTIES
      : kind === 'book' ? DEFAULT_BOOK_PROPERTIES
        : DEFAULT_PROPERTIES
  return structuredClone(defaults)
}

export interface PropertyValues {
  watched: string
  started: string
  unwatched: string
  /** For the "Type tag" source. */
  tag: string
}

export const DEFAULT_TAGS: Record<MediaKind, string> = {
  movie: 'movie',
  tv: 'tv_show',
  documentary: 'documentary',
  music: 'music',
  game: 'video_game',
  book: 'book',
}

export function defaultValues(kind: MediaKind): PropertyValues {
  return { watched: 'completed', started: 'started', unwatched: 'pending', tag: DEFAULT_TAGS[kind] }
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

function durationClock(ms: number | undefined): string | undefined {
  if (!ms) return undefined
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Tracks carry little themselves; genres, styles, moods, label and dates come from their album. */
function orAlbum<T>(item: PlexItem, pick: (i: PlexItem) => T | undefined, empty: (v: T) => boolean = v => !v): T | undefined {
  const own = pick(item)
  if (own !== undefined && !empty(own)) return own
  return item.album ? pick(item.album) : own
}

const noTags = (v: string[]) => v.length === 0

function durationText(ms: number | undefined): string | undefined {
  if (!ms) return undefined
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** Plex stores your rating as 0–10 (2 per star); half stars round up to the next whole star. */
function userStars(item: PlexItem): number | undefined {
  return item.userRating ? Math.min(5, Math.ceil(item.userRating / 2)) : undefined
}

function starEmoji(stars: number | undefined): string | undefined {
  if (!stars) return undefined
  return stars >= 5 ? '🩷' : '⭐'.repeat(stars)
}

/** Times played; for a show, Plex's total episode plays, or failing that the episodes watched. */
/** Minutes as hours, to one decimal place. */
function hours(minutes: number | undefined): number {
  return Math.round((minutes ?? 0) / 6) / 10
}

/** Sources that need a HowLongToBeat lookup. */
export const HLTB_SOURCES: FieldSource[] = ['hltbMain', 'hltbLink']

/** Sources kept up to date by "Keep play counts up to date": plays, and a game's playtime. */
export const PLAY_SOURCES: FieldSource[] = ['viewCount', 'playtime']

export function playCount(item: PlexItem): number {
  return item.viewCount ?? (item.type === 'show' ? item.viewedLeafCount : undefined) ?? 0
}

function externalId(item: PlexItem, scheme: string): string | undefined {
  const guid = (item.Guid ?? []).find(g => g.id.startsWith(`${scheme}://`))
  return guid?.id.slice(scheme.length + 3)
}

export function sourceValue(source: FieldSource, item: PlexItem, ctx: NoteContext, text?: string): Value {
  switch (source) {
    case 'genres': {
      const genres = orAlbum(item, genresOf, noTags) ?? []
      // A documentary's note already says it's a documentary; don't repeat it as a genre.
      return ctx.kind === 'documentary' ? genres.filter(g => !isDocumentaryGenre(g)) : genres
    }
    case 'summary': return item.summary
    case 'tagline': return item.tagline
    case 'title': return item.title
    case 'originalTitle': return item.type === 'track' ? undefined : item.originalTitle
    case 'releaseDate': return orAlbum(item, i => i.originallyAvailableAt)
    case 'year': return yearOf(item)
    case 'durationMinutes': return item.duration ? Math.round(item.duration / 60000) : undefined
    case 'durationText': return durationText(item.duration)
    case 'durationClock': return durationClock(item.duration)
    case 'status': return isWatched(item) ? ctx.values.watched : isStarted(item) ? ctx.values.started : ctx.values.unwatched
    case 'plexLink': return ctx.link
    case 'poster': return ctx.image ?? undefined
    case 'typeTag': return ctx.values.tag ? [ctx.values.tag] : undefined
    case 'contentRating': return item.contentRating
    case 'studio': return orAlbum(item, i => i.studio)
    case 'directors': return tags(item.Director)
    case 'writers': return tags(item.Writer)
    case 'castTop5': return tags(item.Role).slice(0, 5)
    case 'castAll': return tags(item.Role)
    case 'countries': return tags(item.Country)
    case 'collections': return tags(item.Collection)
    case 'labels': return tags(item.Label)
    case 'criticRating': return item.rating
    case 'audienceRating': return item.audienceRating
    case 'userRating': return userStars(item)
    case 'userRatingEmoji': return starEmoji(userStars(item))
    case 'addedAt': return localDate(item.addedAt)
    case 'lastViewedAt': return localDate(item.lastViewedAt)
    case 'viewCount': return playCount(item)
    case 'seasons': return item.type === 'show' ? item.childCount : undefined
    case 'episodes': return item.type === 'show' ? item.leafCount : undefined
    case 'imdbId': return externalId(item, 'imdb')
    case 'tmdbId': return externalId(item, 'tmdb')
    case 'tvdbId': return externalId(item, 'tvdb')
    case 'artist': return trackArtist(item)
    case 'albumArtist': return item.type === 'track' ? item.grandparentTitle : undefined
    case 'album': return item.type === 'track' ? item.parentTitle : undefined
    case 'trackNumber': return item.type === 'track' ? item.index : undefined
    case 'discNumber': return item.type === 'track' ? item.parentIndex : undefined
    case 'styles': return orAlbum(item, i => tags(i.Style), noTags) ?? []
    case 'moods': return orAlbum(item, i => tags(i.Mood), noTags) ?? []
    case 'playtime': return item.type === 'game' ? hours(item.playtimeMinutes) : undefined
    case 'recentPlaytime': return item.type === 'game' ? hours(item.recentMinutes) : undefined
    case 'developers': return item.developers ?? []
    case 'publishers': return item.publishers ?? []
    case 'platforms': return item.platforms ?? []
    case 'metacritic': return item.metacritic
    case 'wideImage': return item.wideImage
    case 'hltbMain': return item.hltb?.main
    case 'hltbLink': return item.hltb?.url
    case 'authors': return item.authors ?? []
    case 'pages': return item.pages
    case 'isbn': return item.isbn
    case 'text': return text
  }
}

const LIST_SOURCES = new Set<FieldSource>([
  'genres', 'typeTag', 'directors', 'writers', 'castTop5', 'castAll', 'countries', 'collections', 'labels',
  'styles', 'moods', 'developers', 'publishers', 'platforms', 'authors',
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
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) fm[key] = LIST_SOURCES.has(source) ? [] : null
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
