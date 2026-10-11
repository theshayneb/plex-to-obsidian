// Last.fm's similar tracks, turned into music suggestions. No Obsidian imports, so it
// can be unit tested; the requests are in lastfm.ts.

import { firstArtist, withoutFeatured } from './notes'

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

/** A loved song Last.fm is asked about: how it's shown, and how much it counts (🩷 twice ⭐⭐⭐⭐). */
export interface Seed { title: string, artist: string, track: string, weight: number }

export interface LastfmSuggestion {
  /** `lastfm:track:<artist> – <title>`, for "Not interested". */
  id: string
  /** "<artist> – <title>". */
  title: string
  url: string
  score: number
  /** The loved songs it came from, best first. */
  because: string[]
}

/**
 * The songs you don't have (`owned`: song keys) that Last.fm finds most like your loved ones, by
 * any artist: each counts its match with every loved song it came from, 🩷 ones twice.
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
      const entry = found.get(key) ?? { id, title, url: t.url, score: 0, because: [], from: new Map<string, number>() }
      entry.score += value
      entry.from.set(seed.title, (entry.from.get(seed.title) ?? 0) + value)
      found.set(key, entry)
    }
  }
  return [...found.values()]
    .map(({ from, ...s }) => ({ ...s, because: [...from.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, count)
}

/** Up to `count` seeds: every 🩷 song before any ⭐⭐⭐⭐ one, in a random order within each, so a refresh tries others. */
export function pickSeeds(seeds: Seed[], count: number, random: () => number = Math.random): Seed[] {
  const shuffled = seeds.map(seed => ({ seed, order: random() }))
    .sort((a, b) => b.seed.weight - a.seed.weight || a.order - b.order)
  return shuffled.slice(0, count).map(s => s.seed)
}
