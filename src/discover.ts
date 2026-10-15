import { requestUrl } from 'obsidian'
import {
  bookGenres,
  googleDate,
  googleDescription,
  googleFound,
  googleSameBooks,
  cleanOmdbKey,
  hltbFound,
  omdbFound,
  omdbItem,
  omdbRatings,
  steamReviews,
  earliestYear,
  OPEN_LIBRARY_FIELDS,
  sameBooks,
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
const OPEN_LIBRARY_HEADERS = { 'User-Agent': 'MediaManager (Obsidian plugin; https://github.com/theshayneb/plex-to-obsidian)' }

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Open Library's answers while Obsidian runs (at most this many), so a book is only asked about once. */
const openLibraryAnswers = new Map<string, Promise<unknown>>()
const OPEN_LIBRARY_KEPT = 3000
/** Time between Open Library requests: a few a second, slowed down for good once it says it's busy. */
let openLibraryGap = 350
let openLibraryNext = 0

/** Forgets Open Library's answers and sets the time between requests (for tests). */
export function resetOpenLibrary(gap = 350): void {
  openLibraryAnswers.clear()
  openLibraryGap = gap
  openLibraryNext = 0
}

/**
 * An Open Library request. Several can run at once, but they start a little apart, and when Open
 * Library is busy or limiting requests (429, 5xx) it's asked again after 3 and 10 seconds, and
 * from then on more slowly.
 */
function openLibraryJson(url: string): Promise<unknown> {
  const cached = openLibraryAnswers.get(url)
  if (cached) return cached
  const answer = (async () => {
    let last = 0
    for (const wait of [0, 3000, 10000]) {
      if (wait) {
        openLibraryGap = Math.max(openLibraryGap, 1100)
        await sleep(wait)
      }
      const now = Date.now()
      const at = Math.max(now, openLibraryNext)
      openLibraryNext = at + openLibraryGap
      if (at > now) await sleep(at - now)
      const res = await requestUrl({ url, headers: OPEN_LIBRARY_HEADERS, throw: false })
      if (res.status === 429 || res.status >= 500) {
        last = res.status
        continue
      }
      if (res.status >= 400) throw new Error(`openlibrary.org returned ${res.status}`)
      return res.json as unknown
    }
    throw new Error(`Open Library is busy or limiting requests (${last}); try again in a few minutes`)
  })()
  openLibraryAnswers.set(url, answer)
  answer.catch(() => { openLibraryAnswers.delete(url) })
  if (openLibraryAnswers.size > OPEN_LIBRARY_KEPT) openLibraryAnswers.delete(openLibraryAnswers.keys().next().value!)
  return answer
}

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
export async function findItems(kind: FindKind, query: string, omdbKey: string, googleKey = ''): Promise<Found[]> {
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
    // Open Library first; Google Books after it, for books Open Library doesn't have.
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=${OPEN_LIBRARY_FIELDS}`
    const [open, google] = await Promise.allSettled([
      openLibraryJson(url) as Promise<{ docs?: OpenLibraryDoc[] }>,
      googleVolumes(query, googleKey),
    ])
    const found = open.status === 'fulfilled' ? (open.value.docs ?? []).map(openLibraryFound).filter((f): f is Found => f !== null) : []
    const known = new Set(found.map(f => bookKey(f.item)))
    if (google.status === 'fulfilled') {
      for (const f of google.value.map(googleFound)) {
        if (f && !known.has(bookKey(f.item))) {
          known.add(bookKey(f.item))
          found.push(f)
        }
      }
    }
    if (!found.length && open.status === 'rejected') throw open.reason
    return found
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

/** OMDb's full details of a title, asked once while Obsidian runs (for its ratings, then for its note). */
const omdbDetails = new Map<string, Promise<OmdbDetails>>()

function omdbDetailsOf(id: string, omdbKey: string): Promise<OmdbDetails> {
  let details = omdbDetails.get(id)
  if (!details) {
    details = (getJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(cleanOmdbKey(omdbKey))}&i=${encodeURIComponent(id)}&plot=full`) as Promise<OmdbDetails & { Response?: string, Error?: string }>)
      .then(body => {
        if (body.Response === 'False') throw new Error(`OMDb: ${body.Error ?? 'not found'}`)
        return body
      })
    details.catch(() => { omdbDetails.delete(id) })
    omdbDetails.set(id, details)
  }
  return details
}

/**
 * A search result's ratings, for deciding whether to add it: what the search gave, plus, for
 * movies and shows, OMDb's (IMDb, Rotten Tomatoes, Metacritic) and, for Steam games, what Steam's
 * players say. Never throws: a rating that can't be had is left out.
 */
export async function moreRatings(found: Found, omdbKey: string): Promise<string[]> {
  const key = found.item.ratingKey
  const known = found.ratings ?? []
  try {
    if (key.startsWith('imdb-')) return [...omdbRatings(await omdbDetailsOf(key.slice(5), omdbKey)), ...known]
    if (key.startsWith('steam-')) {
      const body = await getJson(`https://store.steampowered.com/appreviews/${key.slice(6)}?json=1&language=all&purchase_type=all&num_per_page=0`) as
        { query_summary?: { review_score_desc?: string, total_positive?: number, total_reviews?: number } }
      return [...steamReviews(body.query_summary), ...known]
    }
  } catch (err) {
    console.warn('Media Manager: ratings not found for', found.item.title, err)
  }
  return known
}

/** The full details of a picked result (OMDb and Open Library need a second request). */
export async function itemDetails(found: Found, omdbKey: string, googleKey = ''): Promise<PlexItem> {
  const { item } = found
  if (item.ratingKey.startsWith('imdb-')) return omdbItem(await omdbDetailsOf(item.ratingKey.slice(5), omdbKey))
  if (item.ratingKey.startsWith('ol-')) {
    const work = item.ratingKey.slice(3)
    const body = await openLibraryJson(`https://openlibrary.org/works/${work}.json`).catch(() => null) as
      { description?: string | { value?: string } } | null
    return withGoogle(item, googleKey, openLibraryDescription(body))
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

async function searchBooks(query: string, limit = 5): Promise<OpenLibraryDoc[]> {
  const body = await openLibraryJson(`https://openlibrary.org/search.json?${query}&limit=${limit}&fields=${OPEN_LIBRARY_FIELDS}`) as { docs?: OpenLibraryDoc[] }
  return body.docs ?? []
}

function bookQuery(title: string, author?: string): string {
  return `title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`
}

/**
 * A book's Open Library details, for checking a book note: by its work (from the note's Open
 * Library link), its Google Books volume (from a Google Books link) or, failing those, the likeliest
 * Open Library match for its title and author, and then Google Books' (for books Open Library
 * doesn't have). Its genres are all the work's subjects (cleaned of tags) and its summary the work's
 * description. Null when nothing is found.
 */
export async function lookUpBook(by: { work?: string | null, volume?: string | null, title?: string, author?: string, googleInfo?: boolean }, googleKey = ''): Promise<PlexItem | null> {
  // Google Books' summary and exact date are only asked for when they're wanted (it has a daily allowance).
  const google = (book: PlexItem, fallback: string | undefined): Promise<PlexItem> =>
    by.googleInfo === false ? Promise.resolve({ ...book, summary: fallback }) : withGoogle(book, googleKey, fallback)
  type Work = { title?: string, subjects?: string[], description?: string | { value?: string } }
  const workJson = (work: string) => openLibraryJson(`https://openlibrary.org/works/${work}.json`) as Promise<Work>
  if (by.work) {
    // The note's own link decides the book: only that work's search entry counts, and failing
    // that, the work's own page (which has no authors or pages).
    // Asked all at once: the work's search entry, its page, and (by the note's title and author)
    // the same book's other records, which may know an earlier first edition than the linked one.
    const othersOf = (title: string, author?: string) => searchBooks(bookQuery(title, author), 20).catch(() => [] as OpenLibraryDoc[])
    const early = by.title ? othersOf(by.title, by.author) : null
    const [docs, body] = await Promise.all([searchBooks(`q=${encodeURIComponent(`key:/works/${by.work}`)}`), workJson(by.work).catch(() => null)])
    const doc = docs.find(d => d.key === `/works/${by.work}`)
    const found = doc ? openLibraryFound(doc) : null
    if (!found && !body) return null
    const book: PlexItem = found?.item ?? { ratingKey: `ol-${by.work}`, type: 'book', title: body?.title ?? '', webLink: `https://openlibrary.org/works/${by.work}` }
    const title = book.title || by.title
    const author = book.authors?.[0] ?? by.author
    if (title) {
      // Searched by the note's name when it has one (asked alongside the rest), else by the work's.
      const others = sameBooks(await (early ?? othersOf(title, author)), title, author)
      book.year = earliestYear([...doc ? [doc] : [], ...others]) ?? book.year
    }
    const genres = bookGenres(body?.subjects ?? doc?.subject, Infinity).map(tag => ({ tag }))
    return google({ ...book, Genre: genres }, openLibraryDescription(body) ?? found?.item.summary)
  }
  if (by.volume) {
    // Linked to Google Books: that volume.
    const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(by.volume)}${googleKey.trim() ? `?key=${encodeURIComponent(googleKey.trim())}` : ''}`)
    if (res.status === 404) return null
    if (res.status === 429 || res.status === 503) throw new Error(googleRefusal(res, googleKey))
    if (res.status >= 400) throw new Error(`Google Books returned ${res.status}${googleReason(res) ? `: ${googleReason(res)}` : ''}`)
    return googleFound(res.json as GoogleVolume)?.item ?? null
  }
  if (!by.title) return null
  const docs = await searchBooks(bookQuery(by.title, by.author), 20)
  // The record with the most editions is the book itself; the earliest year among all its records counts.
  const same = sameBooks(docs, by.title, by.author)
  const found = [...same, ...docs].map(openLibraryFound).find((f): f is Found => f !== null)
  if (!found) {
    // Not on Open Library (say, a new book): Google Books, only the same title by the same author.
    const volumes = await googleVolumes(`intitle:"${by.title}"${by.author ? ` inauthor:"${by.author}"` : ''}`, googleKey)
    const volume = googleSameBooks(volumes, by.title, by.author)[0]
    return volume ? googleFound(volume)?.item ?? null : null
  }
  if (same.length) found.item.year = earliestYear(same) ?? found.item.year
  const work = found.item.ratingKey.slice(3)
  const body = await workJson(work).catch(() => null)
  const doc = docs.find(d => d.key === `/works/${work}`)
  const genres = bookGenres(body?.subjects ?? doc?.subject, Infinity).map(tag => ({ tag }))
  return google({ ...found.item, Genre: genres }, openLibraryDescription(body) ?? found.item.summary)
}

/**
 * A book's summary from Google Books (the publisher's blurb, far better than Open Library's
 * descriptions) and its full publication date (Open Library only has the year): looked up by
 * ISBN, then by title and author. Either is undefined when Google Books has none or can't be
 * reached, so Open Library's is used instead. `key` (optional) raises Google's daily limit.
 */
export async function googleBooksInfo(book: PlexItem, key = ''): Promise<{ summary?: string, date?: string }> {
  const withKey = key.trim() ? `&key=${encodeURIComponent(key.trim())}` : ''
  const out: { summary?: string, date?: string } = {}
  const search = async (q: string, byIsbn: boolean) => {
    const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books${withKey}`)
    if (res.status >= 400) throw new Error(`Google Books returned ${res.status}`)
    const volumes = (res.json as { items?: GoogleVolume[] }).items
    out.summary ??= googleDescription(volumes, book.title, byIsbn)
    out.date ??= googleDate(volumes, book.title, book.year, byIsbn)
  }
  try {
    const isbn = book.isbn?.replace(/[^0-9X]/gi, '')
    if (isbn) await search(`isbn:${isbn}`, true)
    if ((!out.summary || !out.date) && book.title) {
      const author = book.authors?.[0]
      await search(`intitle:"${book.title}"${author ? ` inauthor:"${author}"` : ''}`, false)
    }
  } catch (err) {
    console.warn('Media Manager: Google Books lookup failed', err)
  }
  return out
}

/** Google Books' search results (the whole volumes). Throws when Google Books is busy or limiting requests, so a book isn't called missing when it couldn't be looked for. */
async function googleVolumes(query: string, key: string): Promise<GoogleVolume[]> {
  const withKey = key.trim() ? `&key=${encodeURIComponent(key.trim())}` : ''
  const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books${withKey}`)
  if (res.status === 429 || res.status === 503) throw new Error(googleRefusal(res, key))
  if (res.status >= 400) {
    console.warn(`Media Manager: Google Books returned ${res.status} for`, query)
    return []
  }
  return (res.json as { items?: GoogleVolume[] } | null)?.items ?? []
}

/** A book's title and first author, for not listing the same book from both sources. */
const bookKey = (item: PlexItem): string =>
  `${item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}|${(item.authors?.[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`

/** A book with what Google Books adds: its summary (else `fallback`) and its full publication date. */
async function withGoogle(book: PlexItem, key: string, fallback: string | undefined): Promise<PlexItem> {
  const { summary, date } = await googleBooksInfo(book, key)
  return { ...book, summary: summary ?? fallback, ...date ? { originallyAvailableAt: date } : {} }
}

/** Google's own reason for refusing a request ("Quota exceeded for quota metric 'Queries' and limit 'Queries per day'…"). */
function googleReason(res: { json: unknown }): string | undefined {
  try {
    return (res.json as { error?: { message?: string } } | null)?.error?.message
  } catch {
    return undefined
  }
}

/** Google Books' answers while Obsidian runs, so checking again doesn't use up the daily allowance. */
const googleAnswers = new Map<string, { status: number, json: unknown }>()
/** After Google says the day's allowance is used up, no more requests for an hour (they'd only be refused). */
let googleOut: { until: number, reason: string } | null = null

/**
 * A Google Books request, tried again (after 2, 6 and 15 seconds) when Google says it's busy
 * (503) or limiting requests per minute (429). Once the day's allowance is used up, requests stop
 * for an hour and get that answer straight away.
 */
async function googleBooksGet(url: string, fresh = false): Promise<{ status: number, json: unknown }> {
  const cached = googleAnswers.get(url)
  if (cached && !fresh) return cached
  if (googleOut && !fresh && Date.now() < googleOut.until) return { status: 429, json: { error: { message: googleOut.reason } } }
  let res = await requestUrl({ url, throw: false }) as { status: number, json: unknown }
  for (const wait of [2000, 6000, 15000]) {
    if (res.status !== 503 && res.status !== 429) break
    if (/per day/i.test(googleReason(res) ?? '')) break
    await new Promise(resolve => window.setTimeout(resolve, wait))
    res = await requestUrl({ url, throw: false }) as { status: number, json: unknown }
  }
  if (res.status === 429 && /per day/i.test(googleReason(res) ?? '')) googleOut = { until: Date.now() + 60 * 60 * 1000, reason: googleReason(res)! }
  if (res.status === 200) {
    googleOut = null
    googleAnswers.set(url, { status: res.status, json: res.json })
  }
  return res
}

/** Why Google Books refused, for the user. */
function googleRefusal(res: { status: number, json: unknown }, key: string): string {
  const reason = googleReason(res)
  if (reason && /per day/i.test(reason)) {
    return `Google Books' daily allowance${key.trim() ? ' for your key' : ''} is used up (it resets at midnight Pacific time)${key.trim() ? '' : '; a free Google Books API key (in the settings) gives you your own'}`
  }
  return `Google Books is busy or limiting requests (${res.status}${reason ? `: ${reason}` : ''})${key.trim() ? '' : '; a free Google Books API key (in the settings) raises the limit'}`
}

/** Tries Google Books (with the key, if one is given) for the settings' Test button. Returns what to tell the user. */
export async function testGoogleBooks(key: string): Promise<string> {
  const withKey = key.trim() ? `&key=${encodeURIComponent(key.trim())}` : ''
  try {
    const res = await googleBooksGet(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent('isbn:9780441172719')}${withKey}`, true)
    if (res.status === 503 || res.status === 429) return `${googleRefusal(res, key)}. Until then book summaries come from Open Library.`
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
