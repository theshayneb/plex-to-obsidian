import { requestUrl } from 'obsidian'
import {
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
  if (res.status >= 400) throw new Error(`${new URL(url).hostname} returned ${res.status}`)
  return res.json as unknown
}

/** Searches the databases for a kind of item. */
export async function findItems(kind: FindKind, query: string, omdbKey: string): Promise<Found[]> {
  if (kind === 'movie' || kind === 'show') {
    if (!omdbKey) throw new Error('Add an OMDb API key in the settings first (Other sources)')
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
    const body = await getJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${encodeURIComponent(id)}&plot=full`) as OmdbDetails & { Response?: string, Error?: string }
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
