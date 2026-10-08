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
  | 'hltbMain' | 'hltbLink' | 'steamCollections'
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
  userRatingEmoji: 'Your rating (💣 ⭐ 🩷)',
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
  steamCollections: 'Games: your Steam collections (desktop only)',
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
  // A book's length is its page count, under the same name as other media's length.
  { name: 'Duration', source: 'pages' },
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
  /** The only genres to keep (the settings' "Genres to keep"); empty or missing keeps them all. */
  genres?: string[]
  /** Genres never written for this library ("Genres to leave out"). */
  leaveOut?: string[]
  /** How ratings are written in notes (see `RatingScale`). */
  ratingScale?: RatingScale
}

/** Other names sources use for a kept genre, or genres that are two in one ("Action & Adventure"). */
const GENRE_ALIASES: Record<string, string[]> = {
  'science fiction': ['Sci-Fi'],
  'science-fiction': ['Sci-Fi'],
  'sci-fi & fantasy': ['Sci-Fi', 'Fantasy'],
  'action & adventure': ['Action', 'Adventure'],
  'action/adventure': ['Action', 'Adventure'],
  'biographical': ['Biography'],
  'music': ['Musical'],
  'documentaries': ['Documentary'],
}

/** A book's "Fiction" only when it has no other kept genre: Fantasy or Mystery says it already. */
export function fictionOnlyAlone(genres: string[]): string[] {
  const others = genres.filter(g => g.trim().toLowerCase() !== 'fiction')
  return others.length ? others : genres
}

/** Drops the genres a library leaves out (case ignored). */
export function leaveOut(genres: string[], left: string[] | undefined): string[] {
  if (!left?.length) return genres
  const out = new Set(left.map(g => g.trim().toLowerCase()))
  return genres.filter(g => !out.has(g.trim().toLowerCase()))
}

/**
 * Keeps only the genres in `allowed` (case ignored), spelled as there, each once and in the
 * source's order; other names for them (Plex's "Science Fiction" for "Sci-Fi") count too.
 */
export function keepGenres(genres: string[], allowed: string[] | undefined): string[] {
  const wanted = (allowed ?? []).map(g => g.trim()).filter(Boolean)
  if (!wanted.length) return genres
  const byName = new Map(wanted.map(g => [g.toLowerCase(), g]))
  const kept: string[] = []
  for (const genre of genres) {
    const name = genre.trim().toLowerCase()
    const matches = byName.has(name) ? [byName.get(name)!] : (GENRE_ALIASES[name] ?? []).map(g => byName.get(g.toLowerCase())).filter((g): g is string => Boolean(g))
    for (const match of matches) if (!kept.includes(match)) kept.push(match)
  }
  return kept
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
export function userStars(item: PlexItem): number | undefined {
  return item.userRating ? Math.min(5, Math.ceil(item.userRating / 2)) : undefined
}

/**
 * How ratings are written in notes, by level (Plex's stars, 1–5; its 1–10 in pairs):
 * - 'stars': 💣 ⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐ 🩷, matching Plex's stars (a bomb for one, a heart for five), everywhere;
 * - 'emoji': the earlier scale, 💣 ⭐ ⭐⭐ ⭐⭐⭐ 🩷;
 * - 'plain': the earlier music scale, ⭐ to ⭐⭐⭐⭐⭐.
 * No rating is left empty.
 */
export type RatingScale = 'stars' | 'emoji' | 'plain'

const RATING_EMOJI = ['', '💣', '⭐', '⭐⭐', '⭐⭐⭐', '🩷']

/**
 * A rating for the approval pop-up: as written in notes, and the stars Plex shows for it (out of
 * five, halves included). `plexStars` is Plex's own when it differs from the level's (say, 3.5).
 */
export function ratingLabel(level: number, scale: RatingScale = 'stars', plexStars = Math.min(5, level)): string {
  return `${starEmoji(level, scale) ?? level} (${plexStars} star${plexStars === 1 ? '' : 's'} in Plex)`
}

/** A rating level as written in notes, on the given scale. */
export function starEmoji(stars: number | undefined, scale: RatingScale = 'stars'): string | undefined {
  if (!stars) return undefined
  const level = Math.min(5, stars)
  if (scale === 'emoji') return RATING_EMOJI[level]
  if (scale === 'plain') return '⭐'.repeat(level)
  return level === 5 ? '🩷' : level === 1 ? '💣' : '⭐'.repeat(level)
}

/** Times played; for a show, Plex's total episode plays, or failing that the episodes watched. */
/** Minutes as hours, to one decimal place. */
function hours(minutes: number | undefined): number {
  return Math.round((minutes ?? 0) / 6) / 10
}

/**
 * A rating as written in a note, in levels (1–5), on the given scale: a number, 🩷 (five), 💣 (one)
 * or stars. Null when there's none.
 */
export function noteStars(value: unknown, scale: RatingScale = 'stars'): number | null {
  if (typeof value === 'number') return value > 0 ? Math.min(5, Math.round(value)) : null
  if (typeof value !== 'string' || !value.trim()) return null
  if (value.includes('🩷')) return 5
  if (value.includes('💣')) return 1
  const stars = [...value].filter(c => c === '⭐').length
  if (stars) {
    // The earlier emoji scale: ⭐ is level 2, ⭐⭐ 3, ⭐⭐⭐ 4 (and five stars, from song notes, 5).
    if (scale === 'emoji') return stars >= 5 ? 5 : Math.min(4, stars + 1)
    return Math.min(5, stars)
  }
  const n = Number(value.trim())
  return Number.isFinite(n) && n > 0 ? Math.min(5, Math.round(n)) : null
}

/**
 * Which way a rating should go, given the note's stars, Plex's (0: none) and the rating both last
 * agreed on (undefined: never): 'toNote' when Plex's changed since (or, never having agreed, when
 * Plex has one), 'toPlex' when only the note's did (or, never having agreed, when only the note
 * has one), else null. A rating removed in Plex leaves the note's alone.
 */
export function ratingDirection(note: number | null, plex: number, lastSeen: number | undefined): 'toNote' | 'toPlex' | null {
  if ((note ?? 0) === plex) return null
  if (lastSeen === undefined) return plex > 0 ? 'toNote' : note ? 'toPlex' : null
  // Plex's changed: it wins (a rating removed in Plex leaves the note's alone).
  if (plex !== lastSeen) return plex > 0 ? 'toNote' : null
  return note ? 'toPlex' : null
}

/**
 * Sources every sync keeps up to date whenever they can be read, mirroring their source: your Steam
 * collections (on the desktop).
 */
export const MIRRORED_SOURCES: FieldSource[] = ['steamCollections']

/** Sources kept up to date by "Keep status up to date", only ever moving forward. */
export const STATUS_SOURCES: FieldSource[] = ['status']

/**
 * Whether a note's status may become `next`: only forward (not watched → started → watched, as
 * set under the library's property values), from empty, and never from a status of your own
 * ("revisit", "abandoned") that isn't one of those three.
 */
export function statusMovesForward(current: unknown, next: unknown, values: PropertyValues): boolean {
  const order = [values.unwatched, values.started, values.watched].map(v => (v ?? '').trim().toLowerCase())
  const rank = (v: unknown) => typeof v === 'string' && v.trim() ? order.indexOf(v.trim().toLowerCase()) : -1
  const to = rank(next)
  if (to < 0) return false
  if (current === undefined || current === null || (typeof current === 'string' && !current.trim())) return true
  const from = rank(current)
  return from >= 0 && to > from
}

/** Sources checked against existing notes, offering a fix when the note's value differs (minutes). */
export const CHECKED_SOURCES: FieldSource[] = ['durationMinutes']

/**
 * A duration as written in a note, in minutes: a number (taken as minutes), or text such as
 * "2h 18m", "2 hr", "138 min" or "2:18". Null when it can't be read.
 */
export function noteMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const clock = /^(\d+):(\d{2})$/.exec(text)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(text)
  const m = /(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(text)
  if (!h && !m) return null
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0))
}

/**
 * Whether a note's duration is plainly the same length in another form: hours (2.3 for 138
 * minutes) or text ("2h 18m"), rather than a different length.
 */
export function sameLengthOtherForm(value: unknown, minutes: number): boolean {
  if (typeof value === 'string' && !/^\s*\d+(\.\d+)?\s*$/.test(value)) {
    const read = noteMinutes(value)
    return read !== null && Math.abs(read - minutes) <= Math.max(2, minutes * 0.05)
  }
  const n = noteMinutes(value)
  return n !== null && n < 24 && Math.abs(n * 60 - minutes) <= Math.max(6, minutes * 0.05)
}

/** Sources that need a HowLongToBeat lookup. */
export const HLTB_SOURCES: FieldSource[] = ['hltbMain', 'hltbLink']

/** Sources kept up to date by "Keep play counts up to date": plays, and a game's playtime. */
export const PLAY_SOURCES: FieldSource[] = ['viewCount', 'playtime']

/** Sources kept up to date by "Keep ratings up to date": your Plex rating, as stars or emoji. */
export const RATING_SOURCES: FieldSource[] = ['userRating', 'userRatingEmoji']

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
      // A game's store tags ("Mystery") count as genres too, but only those in "Genres to keep".
      const tagged = ctx.genres?.length ? item.steamTags ?? [] : []
      const kept = leaveOut(keepGenres([...orAlbum(item, genresOf, noTags) ?? [], ...tagged], ctx.genres), ctx.leaveOut)
      const genres = ctx.kind === 'book' && ctx.genres?.length ? fictionOnlyAlone(kept) : kept
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
    case 'userRatingEmoji': return starEmoji(userStars(item), ctx.ratingScale ?? 'stars')
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
    case 'steamCollections': return item.steamCollections
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
  'styles', 'moods', 'developers', 'publishers', 'platforms', 'authors', 'steamCollections',
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

/**
 * Sources "Check existing notes against sources" never compares. Nothing, now: statuses, ratings
 * and tags are compared too, with their own rules (in `checkValue` and `PlexSync.compareNote`).
 */
export const UNCHECKED_SOURCES: FieldSource[] = []

/** A property's value as a list: a list, or text separated by commas. */
export function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean)
  return []
}

/** Text compared loosely: links' brackets, case and spacing ignored ("[[Frank Herbert]]" is "frank herbert"). */
function loose(value: unknown): string {
  return String(value)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** The same genres (or any list), whatever the order or case. */
export function sameList(a: string[], b: string[]): boolean {
  const key = (list: string[]) => [...new Set(list.map(loose))].sort().join('|')
  return key(a) === key(b)
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)
}

/** Whether a note's value and the source's say the same thing (lists in any order, numbers as numbers, text loosely). */
export function sameValue(current: unknown, value: unknown): boolean {
  if (Array.isArray(value) || Array.isArray(current)) return sameList(listOf(current), listOf(value))
  if (typeof value === 'number') {
    const n = typeof current === 'number' ? current : Number(String(current).trim())
    return n === value
  }
  return loose(current) === loose(value)
}

/**
 * What "Check existing notes against sources" offers for one property: the value to write and
 * whether it starts ticked, or null when there's nothing to offer. Ticked: an empty value, the same
 * duration in hours or text, a search link, or genres (the note's kept ones plus the source's).
 * Any other difference starts unticked: it's yours unless you tick it.
 */
export function checkValue(source: FieldSource, current: unknown, value: unknown, allowedGenres: string[], kind: MediaKind, leftOut: string[] = []): { to: unknown, ticked: boolean } | null {
  if (blank(value)) return null
  if (source === 'genres') {
    const own = listOf(current)
    const proposed = allowedGenres.length ? keepGenres(own, allowedGenres) : [...own]
    for (const genre of listOf(value)) {
      if (!proposed.some(g => g.toLowerCase() === genre.toLowerCase())) proposed.push(genre)
    }
    const left = leaveOut(kind === 'documentary' ? proposed.filter(g => !isDocumentaryGenre(g)) : proposed, leftOut)
    const wanted = kind === 'book' && allowedGenres.length ? fictionOnlyAlone(left) : left
    if (!wanted.length || sameList(own, wanted)) return null
    return { to: wanted, ticked: true }
  }
  if (source === 'typeTag') {
    // The source's tag is added to yours; your own tags stay.
    const own = listOf(current)
    const missing = listOf(value).filter(tag => !own.some(t => t.toLowerCase() === tag.toLowerCase()))
    return missing.length ? { to: [...own, ...missing], ticked: true } : null
  }
  if (blank(current)) return { to: value, ticked: true }
  if (sameValue(current, value)) return null
  if (source === 'durationMinutes' && typeof value === 'number') return { to: value, ticked: sameLengthOtherForm(current, value) }
  return { to: value, ticked: false }
}
