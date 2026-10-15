import { requestUrl } from 'obsidian'
import { lastfmError, parseSimilarTracks, parseTopTracks, playCountsByKey, type SimilarTrack } from './lastfm-data'

const API = 'https://ws.audioscrobbler.com/2.0/'

/** Last.fm allows about five requests a second; stay well under it. */
const GAP_MS = 250

/** Answers kept while Obsidian runs, for a day, so reopening the dashboard doesn't ask again. */
const cache = new Map<string, { at: number, body: unknown }>()
const CACHE_MS = 24 * 60 * 60 * 1000
let last = 0

/** Last.fm's error codes for something it doesn't know (not a failure). */
const NOT_FOUND = 6

async function call(key: string, params: Record<string, string>, keepFor = CACHE_MS): Promise<unknown> {
  const query = new URLSearchParams({ ...params, api_key: key.trim(), format: 'json' }).toString()
  const cached = cache.get(query)
  if (cached && Date.now() - cached.at < keepFor) return cached.body
  const wait = last + GAP_MS - Date.now()
  if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait))
  last = Date.now()
  const res = await requestUrl({ url: `${API}?${query}`, headers: { 'User-Agent': 'MediaManager (Obsidian plugin)' }, throw: false })
  let body: unknown = null
  try {
    body = res.json
  } catch {
    // not JSON
  }
  const error = lastfmError(body)
  if (error?.code === NOT_FOUND) return null
  if (error) throw new Error(`Last.fm: ${error.message}`)
  if (res.status >= 400) throw new Error(`Last.fm returned ${res.status}`)
  cache.set(query, { at: Date.now(), body })
  return body
}

/** Songs Last.fm finds like this one (none if it doesn't know it). */
export async function similarTracks(key: string, artist: string, track: string, limit = 30): Promise<SimilarTrack[]> {
  return parseSimilarTracks(await call(key, { method: 'track.getsimilar', artist, track, limit: String(limit), autocorrect: '1' }))
}

/** Play counts change, so they're only kept ten minutes. */
const COUNTS_MS = 10 * 60 * 1000

/**
 * Every song's play count in a Last.fm user's scrobbles (`user.getTopTracks`, all time, 1000 a
 * page), by `songKey`. Null when Last.fm doesn't know the user.
 */
export async function userPlayCounts(key: string, user: string): Promise<Map<string, number> | null> {
  const tracks: { artist: string, title: string, plays: number }[] = []
  for (let page = 1; page <= 200; page++) {
    const body = await call(key, { method: 'user.gettoptracks', user: user.trim(), period: 'overall', limit: '1000', page: String(page) }, COUNTS_MS)
    if (!body) return page === 1 ? null : playCountsByKey(tracks)
    const { tracks: found, pages } = parseTopTracks(body)
    tracks.push(...found)
    if (page >= pages || !found.length) break
  }
  return playCountsByKey(tracks)
}

/** Tries the key, for the Test button in the settings. */
export async function testLastfmKey(key: string): Promise<string> {
  if (!key.trim()) return 'Add a Last.fm API key first.'
  try {
    const found = await similarTracks(key, 'Radiohead', 'Karma Police', 3)
    return found.length ? `Last.fm works with the key: it found ${found.map(t => `${t.artist} – ${t.title}`).join(', ')}.` : 'Last.fm answered, but found nothing for a test song.'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
