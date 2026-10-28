import { requestUrl } from 'obsidian'
import { parseRecommended, parseRecordings, type Recommended } from './listenbrainz-data'

const API = 'https://api.listenbrainz.org/1'

/** Answers kept while Obsidian runs, for a day (ListenBrainz makes new recommendations about weekly). */
const cache = new Map<string, { at: number, body: unknown }>()
const CACHE_MS = 24 * 60 * 60 * 1000

async function call(path: string, body?: unknown): Promise<unknown> {
  const id = `${path}|${JSON.stringify(body ?? null)}`
  const cached = cache.get(id)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body
  const res = await requestUrl({
    url: `${API}${path}`,
    method: body ? 'POST' : 'GET',
    contentType: body ? 'application/json' : undefined,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'User-Agent': 'MediaManager (Obsidian plugin)' },
    throw: false,
  })
  // 204: no recommendations made for this user yet.
  if (res.status === 204) return null
  let json: unknown = null
  try {
    json = res.json
  } catch {
    // not JSON
  }
  if (res.status === 404) throw new Error('ListenBrainz doesn\'t know that username')
  if (res.status === 429) throw new Error('ListenBrainz is busy (too many requests); try again in a minute')
  if (res.status >= 400) {
    const message = (json as { error?: unknown } | null)?.error
    throw new Error(`ListenBrainz: ${typeof message === 'string' ? message : `returned ${res.status}`}`)
  }
  cache.set(id, { at: Date.now(), body: json })
  return json
}

/**
 * The songs ListenBrainz recommends for you (from listeners with similar taste), with their
 * artists and titles; none when it hasn't made any for you yet.
 */
export async function recommendedSongs(user: string): Promise<{ recommended: Recommended[], recordings: Map<string, { artist: string, title: string }> }> {
  const recommended = parseRecommended(await call(`/cf/recommendation/user/${encodeURIComponent(user.trim())}/recording?count=200`))
  if (!recommended.length) return { recommended, recordings: new Map() }
  const recordings = parseRecordings(await call('/metadata/recording/', { recording_mbids: recommended.map(r => r.mbid), inc: 'artist' }))
  return { recommended, recordings }
}
