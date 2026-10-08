// Turning search results from OMDb, Open Library, the Steam Store and HowLongToBeat into items, for
// "Add something new". No Obsidian imports, so it can be unit tested.
import { hltbTimes, type HltbGame } from './hltb-data'
import type { PlexItem } from './notes'
import { parseSteamDate } from './steam-data'

/** One search result to pick from. */
export interface Found {
  item: PlexItem
  /** Shown under the title, e.g. "Movie · 2010" or "Frank Herbert · 1965". */
  detail: string
  thumb?: string
  source: string
}

/** OMDb writes "N/A" for anything it doesn't have. */
function given(value: string | undefined): string | undefined {
  return value && value !== 'N/A' ? value : undefined
}

function list(value: string | undefined): string[] {
  return given(value)?.split(',').map(v => v.trim()).filter(Boolean) ?? []
}

const tags = (values: string[]) => values.map(tag => ({ tag }))

export interface OmdbSearchResult {
  Title: string
  Year: string
  imdbID: string
  Type: string
  Poster?: string
}

export interface OmdbDetails extends OmdbSearchResult {
  Rated?: string
  Released?: string
  Runtime?: string
  Genre?: string
  Director?: string
  Writer?: string
  Actors?: string
  Plot?: string
  Country?: string
  imdbRating?: string
  totalSeasons?: string
}

/** OMDb's posters are 300 wide; the same address serves a 600 wide one. */
function omdbPoster(poster: string | undefined): string | undefined {
  return given(poster)?.replace('_SX300', '_SX600')
}

function firstYear(year: string | undefined): number | undefined {
  const match = /\d{4}/.exec(year ?? '')
  return match ? Number(match[0]) : undefined
}

/**
 * The OMDb key in what was pasted: the key itself, or the link from OMDb's email (which has
 * `apikey=` in it). OMDb keys are letters and digits, so anything else (spaces, invisible
 * characters picked up when copying) is dropped.
 */
export function cleanOmdbKey(pasted: string | undefined): string {
  const text = pasted ?? ''
  const fromLink = /apikey=([^&\s]+)/i.exec(text)
  return (fromLink ? fromLink[1] : text).replace(/[^A-Za-z0-9]/g, '')
}

export function omdbFound(result: OmdbSearchResult): Found {
  const show = result.Type === 'series'
  return {
    item: {
      ratingKey: `imdb-${result.imdbID}`,
      type: show ? 'show' : 'movie',
      title: result.Title,
      year: firstYear(result.Year),
      webLink: `https://www.imdb.com/title/${result.imdbID}/`,
      Guid: [{ id: `imdb://${result.imdbID}` }],
    },
    detail: `${show ? 'TV show' : 'Movie'} · ${result.Year}`,
    thumb: given(result.Poster),
    source: 'OMDb',
  }
}

/** Runtimes like "148 min" or "1 h 55 min", as minutes. */
export function parseMinutes(text: string | undefined): number | undefined {
  const value = given(text)?.toLowerCase()
  if (!value) return undefined
  const hours = /(\d+)\s*h/.exec(value)
  const minutes = /(\d+)\s*m/.exec(value)
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
  return total || undefined
}

export function omdbItem(details: OmdbDetails): PlexItem {
  const base = omdbFound(details).item
  const minutes = parseMinutes(details.Runtime)
  const rating = Number(given(details.imdbRating))
  const seasons = Number(given(details.totalSeasons))
  return {
    ...base,
    summary: given(details.Plot),
    originallyAvailableAt: parseSteamDate(given(details.Released)).date,
    duration: minutes ? minutes * 60_000 : undefined,
    contentRating: given(details.Rated),
    Genre: tags(list(details.Genre)),
    Director: tags(list(details.Director)),
    Writer: tags(list(details.Writer)),
    Role: tags(list(details.Actors)),
    Country: tags(list(details.Country)),
    audienceRating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    childCount: Number.isFinite(seasons) && seasons > 0 ? seasons : undefined,
    portrait: omdbPoster(details.Poster),
  }
}

/** A book in Open Library's search.json results. */
export interface OpenLibraryDoc {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  subject?: string[]
  number_of_pages_median?: number
  isbn?: string[]
}

export const OPEN_LIBRARY_FIELDS = 'key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median,isbn'

/** Open Library's subjects run long and loose; the first few are the useful ones. */
const BOOK_GENRES = 5

/**
 * Open Library mixes tags into its subjects: "genre:Fiction" becomes "Fiction", and other tagged
 * ones ("nyt:hardcover-fiction=2009-10-04", "series:…") are left out. Repeats are dropped.
 */
export function bookGenres(subjects: string[] | undefined, limit = BOOK_GENRES): string[] {
  const genres: string[] = []
  for (const subject of subjects ?? []) {
    const named = /^\s*genre\s*:\s*(.*)$/i.exec(subject)
    // Other tags look like "nyt:…" (no space after the colon), unlike subjects such as "History: 1900s".
    const genre = (named ? named[1] : /^\s*[a-z_]+:\S/i.test(subject) ? '' : subject).trim()
    if (genre && !genres.some(g => g.toLowerCase() === genre.toLowerCase())) genres.push(genre)
    if (genres.length === limit) break
  }
  return genres
}

export function openLibraryFound(doc: OpenLibraryDoc): Found | null {
  const work = /\/works\/(OL\d+W)/.exec(doc.key ?? '')?.[1]
  if (!work || !doc.title) return null
  const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined
  const authors = doc.author_name ?? []
  return {
    item: {
      ratingKey: `ol-${work}`,
      type: 'book',
      title: doc.title,
      year: doc.first_publish_year,
      authors,
      pages: doc.number_of_pages_median,
      isbn: doc.isbn?.find(isbn => isbn.length === 13) ?? doc.isbn?.[0],
      Genre: tags(bookGenres(doc.subject)),
      portrait: cover,
      webLink: `https://openlibrary.org/works/${work}`,
    },
    detail: [authors.join(', '), doc.first_publish_year].filter(Boolean).join(' · '),
    thumb: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
    source: 'Open Library',
  }
}

/** A work's description is a string or { value }. */
export function openLibraryDescription(work: { description?: string | { value?: string } } | null): string | undefined {
  const text = typeof work?.description === 'string' ? work.description : work?.description?.value
  // Descriptions often end with a source line or a list of links after a rule.
  return text?.split(/\r?\n-{3,}/)[0].trim() || undefined
}

/** A game in the Steam Store's storesearch results. */
export interface SteamSearchResult {
  id: number
  name: string
  type?: string
  tiny_image?: string
}

export function steamFound(result: SteamSearchResult): Found | null {
  if (result.type && result.type !== 'app') return null
  return {
    item: { ratingKey: `steam-${result.id}`, type: 'game', title: result.name, steamAppId: result.id },
    detail: 'On Steam',
    thumb: result.tiny_image,
    source: 'Steam',
  }
}

/** A game found on HowLongToBeat: for games not on Steam (consoles, other stores). */
export function hltbFound(game: HltbGame): Found {
  const times = hltbTimes(game)
  const platforms = game.profile_platform?.split(',').map(p => p.trim()).filter(Boolean) ?? []
  return {
    item: {
      ratingKey: `hltb-${game.game_id}`,
      type: 'game',
      title: game.game_name,
      year: game.release_world || undefined,
      hltb: times,
      platforms,
      portrait: times.image,
      webLink: times.url,
    },
    detail: [platforms.join(', '), game.release_world].filter(Boolean).join(' · '),
    thumb: times.image,
    source: 'HowLongToBeat',
  }
}
