// ListenBrainz's recommendations for you, turned into music suggestions. No Obsidian imports, so
// it can be unit tested; the requests are in listenbrainz.ts.
import { compareTitles } from './notes'
import { songKey } from './lastfm-data'

/** One recommended recording: its MusicBrainz id and ListenBrainz's score. */
export interface Recommended { mbid: string, score: number }

/** `/1/cf/recommendation/user/<name>/recording`'s answer. */
export function parseRecommended(body: unknown): Recommended[] {
  const mbids = (body as { payload?: { mbids?: unknown } } | null)?.payload?.mbids
  if (!Array.isArray(mbids)) return []
  return mbids.map(raw => {
    const m = raw as { recording_mbid?: unknown, score?: unknown }
    return { mbid: typeof m.recording_mbid === 'string' ? m.recording_mbid : '', score: typeof m.score === 'number' ? m.score : Number(m.score) || 0 }
  }).filter(m => m.mbid)
}

/** `/1/metadata/recording/`'s answer (with `inc: artist`): each recording's artist and title, by id. */
export function parseRecordings(body: unknown): Map<string, { artist: string, title: string }> {
  const found = new Map<string, { artist: string, title: string }>()
  if (!body || typeof body !== 'object') return found
  for (const [mbid, raw] of Object.entries(body as Record<string, unknown>)) {
    const r = raw as { recording?: { name?: unknown }, artist?: { name?: unknown } } | null
    const title = typeof r?.recording?.name === 'string' ? r.recording.name.trim() : ''
    const artist = typeof r?.artist?.name === 'string' ? r.artist.name.trim() : ''
    if (title && artist) found.set(mbid, { artist, title })
  }
  return found
}

export interface ListenBrainzSuggestion {
  /** `listenbrainz:track:<artist> – <title>`, for "Not interested". */
  id: string
  artist: string
  track: string
  /** "<artist> – <title>". */
  title: string
  /** The recording's ListenBrainz page. */
  url: string
  score: number
}

/** The recommended songs you don't have (`owned`: song keys) and haven't turned down, best first. */
export function listenbrainzSuggestions(
  recommended: Recommended[],
  recordings: Map<string, { artist: string, title: string }>,
  owned: Set<string>,
  notInterested: Set<string>,
  count = 15,
): ListenBrainzSuggestion[] {
  const seen = new Set<string>()
  const out: ListenBrainzSuggestion[] = []
  for (const { mbid, score } of [...recommended].sort((a, b) => b.score - a.score)) {
    const r = recordings.get(mbid)
    if (!r) continue
    const key = songKey(r.artist, r.title)
    const title = `${r.artist} – ${r.title}`
    const id = `listenbrainz:track:${title}`
    if (owned.has(key) || notInterested.has(id) || seen.has(key)) continue
    seen.add(key)
    out.push({ id, artist: r.artist, track: r.title, title, url: `https://listenbrainz.org/track/${mbid}/`, score })
  }
  return out.slice(0, count).sort((a, b) => b.score - a.score || compareTitles(a.title, b.title))
}

/** A Spotify search for a song, to listen to it (and add it to a playlist there). */
export function spotifySearch(artist: string, title: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`
}
