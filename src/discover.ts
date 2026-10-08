import { requestUrl } from 'obsidian'
import {
  bookGenres,
  googleDescription,
  cleanOmdbKey,
  hltbFound,
  omdbFound,
  omdbItem,
  OPEN_LIBRARY_FIELDS,
  openLibraryDescription,
  openLibraryFound,
  steamFound,
  type Found,
  type GoogleVolume,
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
export async function itemDetails(found: Found, omdbKey: string, googleKey = ''): Promise<PlexItem> {
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
    return { ...item, summary: (await googleBooksSummary(item, googleKey)) ?? openLibraryDescription(body) }
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

async function searchBooks(query: string): Promise<OpenLibraryDoc[]> {
  const body = await getJson(`https://openlibrary.org/search.json?${query}&limit=5&fields=${OPEN_LIBRARY_FIELDS}`, OPEN_LIBRARY_HEADERS) as { docs?: OpenLibraryDoc[] }
  return body.docs ?? []
}

/**
 * A book's Open Library details, for checking a book note: by its work (from the note's Open
 * Library link) or, failing that, the likeliest match for its title and author. Its genres are all
 * the work's subjects (cleaned of tags) and its summary the work's description. Null when nothing
 * is found.
 */
export async function lookUpBook(by: { work?: string | null, title?: string, author?: string }, googleKey = ''): Promise<PlexItem | null> {
  type Work = { title?: string, subjects?: string[], description?: string | { value?: string } }
  const workJson = (work: string) => getJson(`https://openlibrary.org/works/${work}.json`, OPEN_LIBRARY_HEADERS) as Promise<Work>
  if (by.work) {
    // The note's own link decides the book: only that work's search entry counts, and failing
    // that, the work's own page (which has no authors or pages).
    const docs = await searchBooks(`q=${encodeURIComponent(`key:/works/${by.work}`)}`)
    const doc = docs.find(d => d.key === `/works/${by.work}`)
    const found = doc ? openLibraryFound(doc) : null
    const body = await workJson(by.work).catch(() => null)
    if (!found && !body) return null
    const book: PlexItem = found?.item ?? { ratingKey: `ol-${by.work}`, type: 'book', title: body?.title ?? '', webLink: `https://openlibrary.org/works/${by.work}` }
    return {
      ...book,
      Genre: bookGenres(body?.subjects ?? doc?.subject, Infinity).map(tag => ({ tag })),
      summary: (await googleBooksSummary(book, googleKey)) ?? openLibraryDescription(body) ?? found?.item.summary,
    }
  }
  if (!by.title) return null
  const docs = await searchBooks(`title=${encodeURIComponent(by.title)}${by.author ? `&author=${encodeURIComponent(by.author)}` : ''}`)
  const found = docs.map(openLibraryFound).find((f): f is Found => f !== null)
  if (!found) return null
  const work = found.item.ratingKey.slice(3)
  const body = await workJson(work).catch(() => null)
  const doc = docs.find(d => d.key === `/works/${work}`)
  return {
    ...found.item,
    Genre: bookGenres(body?.subjects ?? doc?.subject, Infinity).map(tag => ({ tag })),
    summary: (await googleBooksSummary(found.item, googleKey)) ?? openLibraryDescription(body) ?? found.item.summary,
  }
}

/**
 * A book's summary from Google Books (the publisher's blurb, far better than Open Library's
 * descriptions): looked up by ISBN, then by title and author. Undefined when Google Books has none
 * or can't be reached, so Open Library's is used instead. `key` (optional) raises Google's daily limit.
 */
export async function googleBooksSummary(book: PlexItem, key = ''): Promise<string | undefined> {
  const withKey = key.trim() ? `&key=${encodeURIComponent(key.trim())}` : ''
  const search = async (q: string, byIsbn: boolean) => {
    const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books${withKey}`)
    if (res.status >= 400) throw new Error(`Google Books returned ${res.status}`)
    const body = res.json as { items?: GoogleVolume[] }
    return googleDescription(body.items, book.title, byIsbn)
  }
  try {
    const isbn = book.isbn?.replace(/[^0-9X]/gi, '')
    if (isbn) {
      const found = await search(`isbn:${isbn}`, true)
      if (found) return found
    }
    if (!book.title) return undefined
    const author = book.authors?.[0]
    return await search(`intitle:"${book.title}"${author ? ` inauthor:"${author}"` : ''}`, false)
  } catch (err) {
    console.warn('Media import and sync: Google Books lookup failed', err)
    return undefined
  }
}

/**
 * A Google Books request, tried again (after 1.5 and 4 seconds) when Google says it's busy (503)
 * or limiting requests (429), which happens most to requests without a key.
 */
async function googleBooksGet(url: string): Promise<{ status: number, json: unknown }> {
  let res = await requestUrl({ url, throw: false })
  for (const wait of [1500, 4000]) {
    if (res.status !== 503 && res.status !== 429) break
    await new Promise(resolve => window.setTimeout(resolve, wait))
    res = await requestUrl({ url, throw: false })
  }
  return res as { status: number, json: unknown }
}

/** Tries Google Books (with the key, if one is given) for the settings' Test button. Returns what to tell the user. */
export async function testGoogleBooks(key: string): Promise<string> {
  const withKey = key.trim() ? `&key=${encodeURIComponent(key.trim())}` : ''
  try {
    const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent('isbn:9780441172719')}${withKey}`)
    if (res.status === 503 || res.status === 429) {
      return key.trim()
        ? `Google Books is busy (${res.status}), even after trying again. Try again in a few minutes; until then book summaries come from Open Library.`
        : `Google Books is busy (${res.status}), even after trying again. Without a key, everyone shares a small allowance, so this happens often: add a free API key (Google Cloud console, with the Books API enabled) and test again. Until then book summaries come from Open Library.`
    }
    if (res.status >= 400) {
      let reason: string | undefined
      try {
        reason = (res.json as { error?: { message?: string } } | null)?.error?.message
      } catch {
        // not JSON
      }
      return `Google Books refused${key.trim() ? ' the key' : ''} (${res.status}${reason ? `: ${reason}` : ''}).`
    }
    const found = ((res.json as { items?: unknown[] } | null)?.items ?? []).length
    return `Google Books works${key.trim() ? ' with the key' : ' (no key)'}: ${found ? 'found a test book' : 'it answered, but found nothing for a test book'}.`
  } catch (err) {
    return `Couldn't reach Google Books: ${err instanceof Error ? err.message : String(err)}`
  }
}
