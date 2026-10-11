// Last.fm's similar tracks and artists, turned into music suggestions. No Obsidian imports, so it
// can be unit tested; the requests are in lastfm.ts.

import { firstArtist, withoutFeatured } from './notes'

export interface SimilarTrack { artist: string, title: string, match: number, url: string }
export interface SimilarArtist { name: string, match: number, url: string }

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

/** `artist.getSimilar`'s answer. */
export function parseSimilarArtists(body: unknown): SimilarArtist[] {
  const artists = (body as { similarartists?: { artist?: unknown } } | null)?.similarartists?.artist
  return listOf(artists).map(raw => {
    const a = raw as { name?: unknown, match?: unknown, url?: unknown }
    return { name: text(a.name), match: num(a.match), url: text(a.url) }
  }).filter(a => a.name)
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
  /** The library entry's id for a song you have, else `lastfm:track:<artist> – <title>` or `lastfm:artist:<name>`. */
  id: string
  title: string
  url: string
  score: number
  /** The loved songs (or their artists) it came from, best first. */
  because: string[]
}

export interface LastfmSuggestions {
  /** Songs you have but haven't rated or played yet, most like your loved ones first. */
  owned: LastfmSuggestion[]
  /** Songs you don't have. */
  songs: LastfmSuggestion[]
  /** Artists you have nothing by. */
  artists: LastfmSuggestion[]
}

/** Adds what one seed says about one suggestion. */
function add(into: Map<string, LastfmSuggestion & { from: Map<string, number> }>, id: string, title: string, url: string, value: number, from: string): void {
  const found = into.get(id) ?? { id, title, url, score: 0, because: [], from: new Map<string, number>() }
  found.score += value
  found.from.set(from, (found.from.get(from) ?? 0) + value)
  into.set(id, found)
}

function ranked(from: Map<string, LastfmSuggestion & { from: Map<string, number> }>, count: number): LastfmSuggestion[] {
  return [...from.values()]
    .map(({ from: sources, ...s }) => ({ ...s, because: [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, count)
}

/**
 * Suggestions from what Last.fm finds similar to your loved songs and their artists. A similar
 * song you have counts only while it's open (no rating, or not played), under the id it has in
 * your library (`owned`: song key → id); one you don't have is a new song; a similar artist with
 * nothing in your library (`ownedArtists`, artist keys) is a new artist.
 */
export function lastfmSuggestions(
  tracks: { seed: Seed, similar: SimilarTrack[] }[],
  artists: { seed: Seed, similar: SimilarArtist[] }[],
  owned: Map<string, { id: string, title: string }>,
  ownedArtists: Set<string>,
  open: Set<string>,
  notInterested: Set<string>,
  perList = 10,
): LastfmSuggestions {
  const mine = new Map<string, LastfmSuggestion & { from: Map<string, number> }>()
  const songs = new Map<string, LastfmSuggestion & { from: Map<string, number> }>()
  const newArtists = new Map<string, LastfmSuggestion & { from: Map<string, number> }>()
  const loved = new Set(tracks.map(({ seed }) => songKey(seed.artist, seed.track)))
  for (const { seed, similar } of tracks) {
    for (const t of similar) {
      const key = songKey(t.artist, t.title)
      if (loved.has(key)) continue
      const have = owned.get(key)
      const value = t.match * seed.weight
      if (have) {
        if (open.has(have.id) && !notInterested.has(have.id)) add(mine, have.id, have.title, t.url, value, seed.title)
        continue
      }
      const id = `lastfm:track:${t.artist} – ${t.title}`
      if (!notInterested.has(id)) add(songs, key, `${t.artist} – ${t.title}`, t.url, value, seed.title)
    }
  }
  for (const { seed, similar } of artists) {
    for (const a of similar) {
      const key = artistKey(a.name)
      if (!key || ownedArtists.has(key)) continue
      const id = `lastfm:artist:${a.name}`
      if (!notInterested.has(id)) add(newArtists, key, a.name, a.url, a.match * seed.weight, seed.artist)
    }
  }
  const withIds = (list: LastfmSuggestion[], prefix: string) => list.map(s => ({ ...s, id: `${prefix}${s.title}` }))
  return {
    owned: ranked(mine, perList),
    songs: withIds(ranked(songs, perList), 'lastfm:track:'),
    artists: withIds(ranked(newArtists, perList), 'lastfm:artist:'),
  }
}

/** Up to `count` seeds: every 🩷 song before any ⭐⭐⭐⭐ one, in a random order within each, so a refresh tries others. */
export function pickSeeds(seeds: Seed[], count: number, random: () => number = Math.random): Seed[] {
  const shuffled = seeds.map(seed => ({ seed, order: random() }))
    .sort((a, b) => b.seed.weight - a.seed.weight || a.order - b.order)
  return shuffled.slice(0, count).map(s => s.seed)
}
