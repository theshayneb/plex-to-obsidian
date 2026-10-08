import { requestUrl } from 'obsidian'
import {
  bookGenres,
  cleanOmdbKey,
  hltbFound,
  omdbFound,
  omdbItem,
  OPEN_LIBRARY_FIELDS,
  openLibraryDescription,
  openLibraryFound,
  steamFound,
  type Found,
  type OmdbDetails,
  type OmdbSearchResult,
  type OpenLibraryDoc,
  type SteamSearchResult,
} from './discover-data'
import { HltbClient } from './hltb'
import type { PlexItem } from './notes'

/** What "Add something new" can look for. */
export type FindKind = 'movie' | 'show' | 'game' | 'book'

/** Open Library asks apps to say who they are. */
const OPEN_LIBRARY_HEADERS = { 'User-Agent': 'MediaImportAndSync (Obsidian plugin)' }

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await requestUrl({ url, headers, throw: false })
  if (res.status >= 400) {
    // OMDb explains a 401 in its JSON ("Invalid API key!", "Request limit reached!").
    let reason = ''
    try {
      reason = (res.json as { Error?: string } | null)?.Error ?? ''
    } catch {
      // not JSON
    }
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'omdbapi.com' && res.status === 401) {
      throw new Error(`OMDb refused the key${reason ? ` (${reason})` : ''}. Check the OMDb API key in the settings (the Test button there tries it); new keys only work after you click the link in OMDb's email.`)
    }
    throw new Error(`${host} returned ${res.status}${reason ? `: ${reason}` : ''}`)
  }
  return res.json as unknown
}

/** Searches the databases for a kind of item. */
export async function findItems(kind: FindKind, query: string, omdbKey: string): Promise<Found[]> {
  if (kind === 'movie' || kind === 'show') {
    omdbKey = cleanOmdbKey(omdbKey)
    if (!omdbKey) throw new Error('Add an OMDb API key in the settings first (Adding things not in Plex or Steam)')
    const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&type=${kind === 'show' ? 'series' : 'movie'}&s=${encodeURIComponent(query)}`
    const body = await getJson(url) as { Response?: string, Error?: string, Search?: OmdbSearchResult[] }
    if (body.Response === 'False') {
      if (body.Error && !/not found/i.test(body.Error)) throw new Error(`OMDb: ${body.Error}`)
      return []
    }
    return (body.Search ?? []).map(omdbFound)
  }
  if (kind === 'book') {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=${OPEN_LIBRARY_FIELDS}`
    const body = await getJson(url, OPEN_LIBRARY_HEADERS) as { docs?: OpenLibraryDoc[] }
    return (body.docs ?? []).map(openLibraryFound).filter((f): f is Found => f !== null)
  }
  // Games: Steam first, then HowLongToBeat for games on other platforms.
  const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`
  const [steam, hltb] = await Promise.allSettled([
    getJson(steamUrl) as Promise<{ items?: SteamSearchResult[] }>,
    new HltbClient().searchGames(query),
  ])
  const found: Found[] = []
  if (steam.status === 'fulfilled') found.push(...(steam.value.items ?? []).map(steamFound).filter((f): f is Found => f !== null))
  if (hltb.status === 'fulfilled') found.push(...hltb.value.map(hltbFound))
  if (!found.length && steam.status === 'rejected' && hltb.status === 'rejected') throw steam.reason
  return found
}

/** The full details of a picked result (OMDb and Open Library need a second request). */
export async function itemDetails(found: Found, omdbKey: string): Promise<PlexItem> {
  const { item } = found
  if (item.ratingKey.startsWith('imdb-')) {
    const id = item.ratingKey.slice(5)
    const body = await getJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(cleanOmdbKey(omdbKey))}&i=${encodeURIComponent(id)}&plot=full`) as OmdbDetails & { Response?: string, Error?: string }
    if (body.Response === 'False') throw new Error(`OMDb: ${body.Error ?? 'not found'}`)
    return omdbItem(body)
  }
  if (item.ratingKey.startsWith('ol-')) {
    const work = item.ratingKey.slice(3)
    const body = await getJson(`https://openlibrary.org/works/${work}.json`, OPEN_LIBRARY_HEADERS).catch(() => null) as
      { description?: string | { value?: string } } | null
    return { ...item, summary: openLibraryDescription(body) }
  }
  return item
}

/** Tries an OMDb key with one search, for the settings' Test button. Returns what to tell the user. */
export async function testOmdbKey(pasted: string): Promise<string> {
  const key = cleanOmdbKey(pasted)
  if (!key) return 'Paste your OMDb API key first.'
  try {
    const found = await findItems('movie', 'Heat', key)
    return `The key ${key} works (${found.length} results for "Heat").`
  } catch (err) {
    return `The key ${key} didn't work: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * The likeliest Open Library match for a book by its title (and author, when known), for books
 * whose note has no Open Library link. Null when nothing is found.
 */
export async function findBook(title: string, author?: string): Promise<Found | null> {
  const query = `title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`
  const body = await getJson(`https://openlibrary.org/search.json?${query}&limit=5&fields=${OPEN_LIBRARY_FIELDS}`, OPEN_LIBRARY_HEADERS) as { docs?: OpenLibraryDoc[] }
  for (const doc of body.docs ?? []) {
    const found = openLibraryFound(doc)
    if (found) return found
  }
  return null
}

/** All of an Open Library work's subjects, cleaned of tags ("genre:Fiction" becomes "Fiction"). */
export async function bookSubjects(work: string): Promise<string[]> {
  const body = await getJson(`https://openlibrary.org/works/${work}.json`, OPEN_LIBRARY_HEADERS) as { subjects?: string[] }
  return bookGenres(body.subjects, Infinity)
}
