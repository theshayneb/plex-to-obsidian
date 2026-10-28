// Last.fm's similar tracks, turned into music suggestions. No Obsidian imports, so it
// can be unit tested; the requests are in lastfm.ts.

import { compareTitles, firstArtist, withoutFeatured } from './notes'

export interface SimilarTrack { artist: string, title: string, match: number, url: string }

/** Last.fm's error message in a response, if it is one (it answers errors as JSON `{error, message}`). */
export function lastfmError(body: unknown): { code: number, message: string } | null {
  if (!body || typeof body !== 'object' || !('error' in body)) return null
  const { error, message } = body as { error: unknown, message?: unknown }
  return { code: Number(error), message: typeof message === 'string' ? message : `error ${String(error)}` }
}

/** Last.fm sends one result as an object and several as a list. */
const listOf = (value: unknown): unknown[] => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : parseFloat(text(value))
  return Number.isFinite(n) ? n : 0
}

/** `track.getSimilar`'s answer. */
export function parseSimilarTracks(body: unknown): SimilarTrack[] {
  const tracks = (body as { similartracks?: { track?: unknown } } | null)?.similartracks?.track
  return listOf(tracks).map(raw => {
    const t = raw as { name?: unknown, match?: unknown, url?: unknown, artist?: { name?: unknown } | string }
    const artist = typeof t.artist === 'string' ? t.artist : text(t.artist?.name)
    return { artist: artist.trim(), title: text(t.name), match: num(t.match), url: text(t.url) }
  }).filter(t => t.artist && t.title)
}

/** An artist's name for comparing: lower case, letters and digits only ("The" kept). */
export const artistKey = (artist: string): string =>
  firstArtist(artist).normalize('NFKD').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * A song for comparing across Plex and Last.fm: its first artist, and its title without featured
 * artists, versions in brackets or after a dash ("- Remastered 2011", "(Radio Edit)").
 */
export function songKey(artist: string, title: string): string {
  const bare = withoutFeatured(title)
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim() || title
  return `${artistKey(artist)}|${bare.normalize('NFKD').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '')}`
}

/** A song of yours Last.fm is asked about: how it's shown, and how much it counts (`seedWeight`). */
export interface Seed { title: string, artist: string, track: string, weight: number }

/**
 * How much a song of yours counts towards suggestions: more the higher you rated it (🩷 3,
 * ⭐⭐⭐⭐ 2, ⭐⭐⭐ 1.5, else 1; `level` in the star scale, 0 unrated) and the more you've played it.
 */
export function seedWeight(level: number, plays: number): number {
  const rating = level >= 5 ? 3 : level === 4 ? 2 : level === 3 ? 1.5 : 1
  return rating * Math.log2(2 + Math.max(0, plays))
}

export interface LastfmSuggestion {
  /** `lastfm:track:<artist> – <title>`, for "Not interested". */
  id: string
  artist: string
  track: string
  /** How many of your songs it's like. */
  seeds: number
  /** "<artist> – <title>". */
  title: string
  url: string
  score: number
  /** The loved songs it came from, best first. */
  because: string[]
}

/**
 * The songs you don't have (`owned`: song keys) that Last.fm finds most like your songs, by any
 * artist: first those like the most of your songs, then by their match with each, times its weight.
 */
export function lastfmSuggestions(
  tracks: { seed: Seed, similar: SimilarTrack[] }[],
  owned: Set<string>,
  notInterested: Set<string>,
  count = 15,
): LastfmSuggestion[] {
  const found = new Map<string, LastfmSuggestion & { from: Map<string, number> }>()
  for (const { seed, similar } of tracks) {
    for (const t of similar) {
      const key = songKey(t.artist, t.title)
      const title = `${t.artist} – ${t.title}`
      const id = `lastfm:track:${title}`
      if (owned.has(key) || notInterested.has(id)) continue
      const value = t.match * seed.weight
      const entry = found.get(key) ?? { id, artist: t.artist, track: t.title, seeds: 0, title, url: t.url, score: 0, because: [], from: new Map<string, number>() }
      entry.score += value
      entry.from.set(seed.title, (entry.from.get(seed.title) ?? 0) + value)
      found.set(key, entry)
    }
  }
  return [...found.values()]
    .map(({ from, ...s }) => ({ ...s, seeds: from.size, because: [...from.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name) }))
    .sort((a, b) => b.seeds - a.seeds || b.score - a.score || compareTitles(a.title, b.title))
    .slice(0, count)
}

/**
 * Up to `count` seeds drawn from your whole library, each as likely as its weight (a loved, much
 * played song far more than one you rarely play, but every song can be drawn), so a refresh tries others.
 */
export function pickSeeds(seeds: Seed[], count: number, random: () => number = Math.random): Seed[] {
  // Weighted sampling without replacement: each song's key is random^(1/weight), the highest drawn.
  const keyed = seeds.map(seed => ({ seed, key: Math.pow(Math.max(random(), 1e-12), 1 / Math.max(seed.weight, 1e-6)) }))
  return keyed.sort((a, b) => b.key - a.key).slice(0, count).map(s => s.seed)
}

/** One page of `user.getTopTracks`: each song's play count, and how many pages there are. */
export function parseTopTracks(body: unknown): { tracks: { artist: string, title: string, plays: number }[], pages: number } {
  const top = (body as { toptracks?: { track?: unknown, '@attr'?: { totalPages?: unknown } } } | null)?.toptracks
  const tracks = listOf(top?.track).map(t => {
    const track = t as { name?: unknown, playcount?: unknown, artist?: unknown }
    const artist = track.artist && typeof track.artist === 'object' ? text((track.artist as { name?: unknown }).name) : text(track.artist)
    return { artist, title: text(track.name), plays: Number(text(track.playcount)) || 0 }
  }).filter(t => t.artist && t.title)
  return { tracks, pages: Number(text(top?.['@attr']?.totalPages)) || 1 }
}

/**
 * Last.fm play counts by song (`songKey`), the versions Last.fm lists apart ("- Remastered",
 * "(Live)") added together, as Plex's songs are compared without them.
 */
export function playCountsByKey(tracks: { artist: string, title: string, plays: number }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tracks) {
    const key = songKey(t.artist, t.title)
    counts.set(key, (counts.get(key) ?? 0) + t.plays)
  }
  return counts
}
