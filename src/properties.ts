// Which Plex field fills which frontmatter property. No Obsidian imports, so it can be unit tested.
import { fileTagList, isSongTagsRow, unionTags } from './song-tags'
import { tagValue } from './id3'
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
  | 'text' | 'fileTag' | 'lyricsFile'

export interface PropertyMapping {
  /** Frontmatter property name. */
  name: string
  source: FieldSource
  /** For the 'text' source: the fixed value written to every note; for 'fileTag', the tag's name. */
  text?: string
  /** Also fill this property in on existing notes that match a Plex item, when it's empty there. */
  fill?: boolean
}

/** Dropdown labels, in the order they're listed. */
export const FIELD_SOURCES: Record<FieldSource, string> = {
  genres: 'Genres (Plex, Steam or Open Library; songs: the music file\'s, else Plex)',
  summary: 'Summary (Plex, Steam, Google Books or Open Library)',
  tagline: 'Tagline (Plex)',
  title: 'Title',
  originalTitle: 'Original title (Plex)',
  releaseDate: 'Release date (first aired for shows, the album\'s for songs)',
  year: 'Year released',
  durationMinutes: 'Length in minutes (Plex; games: HowLongToBeat main story)',
  durationText: 'Length as text, 1h 52m',
  durationClock: 'Length as a clock, 3:45',
  status: 'Status: watched, started or not (games: playtime or Steam collections)',
  plexLink: 'Link to the item (Plex, Steam Store, Open Library or HowLongToBeat page)',
  poster: 'Cover image (Plex poster, downloaded; game and book covers, linked)',
  typeTag: 'Type tag (set under property values below)',
  contentRating: 'Content rating (Plex)',
  studio: 'Studio, network or record label (Plex)',
  directors: 'Directors (Plex)',
  writers: 'Writers (Plex)',
  castTop5: 'Cast, top 5 (Plex)',
  castAll: 'Cast, everyone (Plex)',
  countries: 'Countries (Plex)',
  collections: 'Plex collections',
  labels: 'Plex labels',
  criticRating: 'Critic rating, 0–10 (Plex)',
  audienceRating: 'Audience rating, 0–10 (Plex)',
  userRating: 'Your rating as a number, 0–5 (Plex)',
  userRatingEmoji: 'Your rating, 💣 ⭐ 🩷 (Plex)',
  addedAt: 'Date added to Plex',
  lastViewedAt: 'Date last watched or played (Plex)',
  viewCount: 'Play count (Plex; songs also Last.fm)',
  seasons: 'Number of seasons (Plex)',
  episodes: 'Number of episodes (Plex)',
  imdbId: 'IMDb ID',
  tmdbId: 'TMDB ID',
  tvdbId: 'TVDB ID',
  artist: 'Song: artist (Plex)',
  albumArtist: 'Song: album artist (Plex)',
  album: 'Song: album (Plex)',
  trackNumber: 'Song: track number (Plex)',
  discNumber: 'Song: disc number (Plex)',
  styles: 'Song: styles (Plex)',
  moods: 'Song: moods (Plex)',
  fileTag: 'Song: a tag in the music file, by name (computer only)',
  lyricsFile: 'Song: lyrics from the music file (computer only)',
  playtime: 'Game: total playtime in hours (Steam)',
  recentPlaytime: 'Game: playtime in the last 2 weeks (Steam)',
  developers: 'Game: developers (Steam)',
  publishers: 'Game: publishers (Steam)',
  platforms: 'Game: platforms (Steam)',
  metacritic: 'Game: Metacritic score (Steam)',
  wideImage: 'Game: wide header image (Steam)',
  hltbMain: 'Game: HowLongToBeat main story, in minutes',
  steamCollections: 'Game: your Steam collections (computer only)',
  hltbLink: 'Game: HowLongToBeat page',
  authors: 'Book: authors (Open Library)',
  pages: 'Book: number of pages (Open Library)',
  isbn: 'Book: ISBN (Open Library)',
  text: 'Fixed text (typed in the box beside it)',
}

/** Sources left out of the property dropdown at the owner's request (a row already using one keeps it). */
export const HIDDEN_SOURCES = new Set<FieldSource>([
  'durationText', 'durationClock', 'userRating', 'addedAt', 'tagline', 'originalTitle', 'contentRating', 'studio',
  'directors', 'writers', 'castTop5', 'castAll', 'countries', 'criticRating', 'audienceRating', 'seasons', 'episodes',
  'imdbId', 'tmdbId', 'tvdbId', 'styles', 'moods', 'recentPlaytime', 'developers', 'publishers', 'metacritic', 'isbn',
])

/** Sources only one kind of library has a use for; the rest are for every library. */
const SOURCE_KINDS: Partial<Record<FieldSource, MediaKind>> = {
  artist: 'music', albumArtist: 'music', album: 'music', trackNumber: 'music', discNumber: 'music', styles: 'music', moods: 'music', fileTag: 'music', lyricsFile: 'music',
  playtime: 'game', recentPlaytime: 'game', developers: 'game', publishers: 'game', platforms: 'game', metacritic: 'game', wideImage: 'game', hltbMain: 'game', steamCollections: 'game', hltbLink: 'game',
  authors: 'book', pages: 'book', isbn: 'book',
}

/**
 * The property dropdown's choices for a library of this kind, A–Z by label: every source for all
 * libraries plus its kind's own, leaving out hidden ones, except `current` (a row's own) always.
 */
export function sourcesFor(kind: string, current?: FieldSource): [FieldSource, string][] {
  return (Object.entries(FIELD_SOURCES) as [FieldSource, string][])
    .filter(([source]) => source === current || (!HIDDEN_SOURCES.has(source) && (!SOURCE_KINDS[source] || SOURCE_KINDS[source] === kind)))
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
}

/**
 * The genres in a music file's genre tag (ID3 TCON): several values, or one with ";" or "/"
 * between them; old-style numbers ("(17)") left out. Each once, as written.
 */
export function fileGenres(values: string[] | undefined): string[] {
  const out: string[] = []
  for (const g of (values ?? []).flatMap(v => v.split(/[;/]/)).map(v => v.replace(/^\(\d+\)/, '').trim()).filter(v => v && !/^\d+$/.test(v))) {
    if (!out.some(x => x.toLowerCase() === g.toLowerCase())) out.push(g)
  }
  return out
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
  { name: 'Progress', source: 'viewCount' },
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
  /** Games: the status a game in each Steam collection gets, the first that applies winning (over playtime too). */
  collectionStatus?: CollectionStatus[]
}

/**
 * A Steam collection and the status its games get. `untilStarted`: only for a game not started yet
 * (no playtime, and the note's status empty or not played), such as "planned".
 */
export interface CollectionStatus { collection: string, status: string, untilStarted?: boolean }

/** The owner's: these collections set a game's status, in this order. */
export const DEFAULT_COLLECTION_STATUS: CollectionStatus[] = [
  { collection: 'revisit', status: 'revisit' },
  { collection: 'pending', status: 'pending' },
  { collection: 'abandoned', status: 'abandoned' },
  { collection: 'completed', status: 'completed' },
  { collection: 'Right Now', status: 'planned', untilStarted: true },
]

/**
 * The status a game's Steam collections give it: the first pair whose collection it's in (any
 * case), passing over "until started" pairs once it's `started`; undefined when none applies or
 * its collections couldn't be read.
 */
export function collectionStatus(collections: string[] | undefined, pairs: CollectionStatus[] | undefined, started = false): string | undefined {
  if (!collections?.length || !pairs?.length) return undefined
  const mine = new Set(collections.map(c => c.trim().toLowerCase()))
  return pairs.find(p => p.status.trim() && mine.has(p.collection.trim().toLowerCase()) && !(started && p.untilStarted))?.status.trim()
}

/**
 * Whether a game counts as started: it has playtime, or its note's status is past not played
 * (anything but empty, the not-played value or an "until started" status, such as "planned").
 */
export function gameStarted(item: PlexItem, values: PropertyValues, noteStatus?: unknown): boolean {
  if (isStarted(item) || isWatched(item)) return true
  if (typeof noteStatus !== 'string' || !noteStatus.trim()) return false
  const status = noteStatus.trim().toLowerCase()
  const before = [values.unwatched, ...(values.collectionStatus ?? []).filter(p => p.untilStarted).map(p => p.status)]
  return !before.some(v => v.trim().toLowerCase() === status)
}

const UNTIL_STARTED = /\s*\(until started\)\s*$/i

/** Pairs as written in the settings, one per line: "collection: status", with "(until started)" after the status for a pair only for games not started yet. */
export function parseCollectionStatus(text: string): CollectionStatus[] {
  return text.split('\n').map((line): CollectionStatus | null => {
    const untilStarted = UNTIL_STARTED.test(line)
    const plain = line.replace(UNTIL_STARTED, '')
    const at = plain.lastIndexOf(':')
    return at < 0 ? null : { collection: plain.slice(0, at).trim(), status: plain.slice(at + 1).trim(), ...untilStarted ? { untilStarted } : {} }
  }).filter((p): p is CollectionStatus => Boolean(p?.collection && p.status))
}

/** Pairs as the settings show them. */
export function collectionStatusText(pairs: CollectionStatus[] | undefined): string {
  return (pairs ?? []).map(p => `${p.collection}: ${p.status}${p.untilStarted ? ' (until started)' : ''}`).join('\n')
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
  return {
    watched: 'completed', started: 'started', unwatched: 'pending', tag: DEFAULT_TAGS[kind],
    ...kind === 'game' ? { collectionStatus: DEFAULT_COLLECTION_STATUS.map(p => ({ ...p })) } : {},
  }
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

/** How long an item is, in milliseconds: Plex's length, or for a game its HowLongToBeat main story. */
function lengthOf(item: PlexItem): number | undefined {
  if (item.duration) return item.duration
  return item.type === 'game' && item.hltb?.main ? item.hltb.main * 60000 : undefined
}

/** Sources of a length, which for a game come from HowLongToBeat. */
export const LENGTH_SOURCES: FieldSource[] = ['durationMinutes', 'durationText', 'durationClock']

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

/**
 * A date Obsidian can read (YYYY-MM-DD): a year alone becomes the 1st of January ("2024" →
 * "2024-01-01"), a year and month the 1st of the month; with no date at all, the year (if known)
 * is used the same way.
 */
export function fullDate(date: string | undefined, year?: number): string | undefined {
  const text = date?.trim()
  if (text) {
    if (/^\d{4}$/.test(text)) return `${text}-01-01`
    if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`
    return text
  }
  return year ? `${year}-01-01` : undefined
}

/** A date that's only a year: "2024", 2024, or "2024-01-01" (what a year alone becomes). */
export function vagueDate(value: unknown): boolean {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  return /^\d{4}(-01-01)?$/.test(text)
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
 * collections and songs' lyrics from their music files (on the desktop; a source with nothing to
 * say leaves the note alone).
 */
export const MIRRORED_SOURCES: FieldSource[] = ['steamCollections', 'lyricsFile']

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

/**
 * Whether a length or page count from a source is too close to the note's to be worth offering:
 * within 10% (at least 15 minutes, or 10 pages), in the same form. HowLongToBeat's times and Open
 * Library's page counts drift a little as people add to them, which otherwise asks about the same
 * notes at every check. A note's length in another form (hours for minutes) is still offered.
 */
export function nearlySame(source: FieldSource, current: unknown, value: unknown): boolean {
  const plain = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null
  let a: number | null, b: number | null, floor: number
  if (source === 'pages') {
    a = plain(current); b = plain(value); floor = 10
  } else if (source === 'durationMinutes' || source === 'hltbMain') {
    a = plain(current); b = plain(value); floor = 15
  } else if (source === 'durationText' || source === 'durationClock') {
    a = typeof current === 'string' && plain(current) === null ? noteMinutes(current) : null
    b = noteMinutes(value); floor = 15
  } else return false
  if (a === null || b === null) return false
  return Math.abs(a - b) <= Math.max(floor, Math.max(a, b) * 0.1)
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
      // A song's genres are its music file's own (as you set them), else Plex's for it or its album.
      const fromFile = item.type === 'track' ? fileGenres(item.fileTags?.TCON) : []
      const kept = leaveOut(keepGenres([...fromFile.length ? fromFile : orAlbum(item, genresOf, noTags) ?? [], ...tagged], ctx.genres), ctx.leaveOut)
      const genres = ctx.kind === 'book' && ctx.genres?.length ? fictionOnlyAlone(kept) : kept
      // A documentary's note already says it's a documentary; don't repeat it as a genre.
      return ctx.kind === 'documentary' ? genres.filter(g => !isDocumentaryGenre(g)) : genres
    }
    case 'summary': return item.summary
    case 'tagline': return item.tagline
    case 'title': return item.title
    case 'originalTitle': return item.type === 'track' ? undefined : item.originalTitle
    case 'releaseDate': return fullDate(orAlbum(item, i => i.originallyAvailableAt), yearOf(item))
    case 'year': return yearOf(item)
    case 'durationMinutes': { const ms = lengthOf(item); return ms ? Math.round(ms / 60000) : undefined }
    case 'durationText': return durationText(lengthOf(item))
    case 'durationClock': return durationClock(lengthOf(item))
    case 'status': return collectionStatus(item.steamCollections, ctx.values.collectionStatus, gameStarted(item, ctx.values))
      ?? (isWatched(item) ? ctx.values.watched : isStarted(item) ? ctx.values.started : ctx.values.unwatched)
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
    case 'fileTag': return item.fileTags && text ? tagValue(item.fileTags, text) : undefined
    case 'lyricsFile': return item.lyrics
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
    // A song's tags from its music file are a list of tags, like the type tag beside them.
    const songTags = isSongTagsRow({ name, source, text })
    // A song's tags from its file come with the library's type tag (song), even without a row of its own for it.
    const value = songTags ? unionTags(ctx.values.tag ? [ctx.values.tag] : [], fileTagList(sourceValue(source, item, ctx, text))) : sourceValue(source, item, ctx, text)
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    // Two rows for one property (the type tag and the file's tags, both "tags") add up as one list.
    if (Array.isArray(fm[key]) && (Array.isArray(value) || empty || songTags)) {
      if (!empty) fm[key] = unionTags(fm[key], value)
      continue
    }
    if (empty) fm[key] = LIST_SOURCES.has(source) || songTags ? [] : null
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
/** Whether two lyrics are the same, apart from line endings, spaces at line ends and blank lines at the end. */
export function sameLyrics(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '').replace(/^\n+/, '')
  return norm(a) === norm(b)
}

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
/**
 * Whether a playtime from Steam would make the note's smaller: the note's (hours, as a number or
 * text such as "12.5") is more than Steam's, so it's kept (time played elsewhere, say).
 */
export function playtimeShrinks(current: unknown, value: unknown): boolean {
  const mine = typeof current === 'number' ? current : typeof current === 'string' ? parseFloat(current.replace(',', '.')) : NaN
  return typeof value === 'number' && Number.isFinite(mine) && mine > value
}

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
  // Lyrics are compared line by line, capitals and all (only line endings and spaces at line ends
  // don't count), so an edit to one word or one line break shows.
  if (source === 'lyricsFile') return sameLyrics(current, value) ? null : { to: value, ticked: false }
  if (sameValue(current, value)) return null
  if (nearlySame(source, current, value)) return null
  // A longer playtime in the note than Steam's stays.
  if (source === 'playtime' && playtimeShrinks(current, value)) return null
  // Nor does a song's play count (it may be Last.fm's, which counts plays elsewhere too).
  if (source === 'viewCount' && kind === 'music' && playtimeShrinks(current, value)) return null
  // A date of yours is never made vaguer: the source's year alone (or the 1st of January standing
  // in for one, as with every Open Library book) doesn't replace a full date from that year.
  if (source === 'releaseDate' && vagueDate(value) && !vagueDate(current) && String(current).trim().startsWith(String(value).slice(0, 4))) return null
  // A year alone (or the 1st of January standing in for one) gives way to the source's date.
  if (source === 'releaseDate' && vagueDate(current) && String(value).startsWith(String(current).trim().slice(0, 4))) return { to: value, ticked: true }
  if (source === 'durationMinutes' && typeof value === 'number') return { to: value, ticked: sameLengthOtherForm(current, value) }
  return { to: value, ticked: false }
}
