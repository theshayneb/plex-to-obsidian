import { requestUrl } from 'obsidian'
import { lastfmError, parseSimilarArtists, parseSimilarTracks, type SimilarArtist, type SimilarTrack } from './lastfm-data'

const API = 'https://ws.audioscrobbler.com/2.0/'

/** Last.fm allows about five requests a second; stay well under it. */
const GAP_MS = 250

/** Answers kept while Obsidian runs, for a day, so reopening the dashboard doesn't ask again. */
const cache = new Map<string, { at: number, body: unknown }>()
const CACHE_MS = 24 * 60 * 60 * 1000
let last = 0

/** Last.fm's error codes for something it doesn't know (not a failure). */
const NOT_FOUND = 6

async function call(key: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ ...params, api_key: key.trim(), format: 'json' }).toString()
  const cached = cache.get(query)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body
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

/** Artists Last.fm finds like this one. */
export async function similarArtists(key: string, artist: string, limit = 20): Promise<SimilarArtist[]> {
  return parseSimilarArtists(await call(key, { method: 'artist.getsimilar', artist, limit: String(limit), autocorrect: '1' }))
}

/** Tries the key, for the Test button in the settings. */
export async function testLastfmKey(key: string): Promise<string> {
  if (!key.trim()) return 'Add a Last.fm API key first.'
  try {
    const found = await similarArtists(key, 'Radiohead', 3)
    return found.length ? `Last.fm works with the key: it found ${found.map(a => a.name).join(', ')}.` : 'Last.fm answered, but found nothing for a test artist.'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
