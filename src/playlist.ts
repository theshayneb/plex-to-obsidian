import type { App, TFile } from 'obsidian'
import { plexReady, type PlexNotesSettings } from './config'
import { ratingKeyFromLink } from './notes'
import { PlexClient } from './plex'
import { linkPropertyNames } from './properties'

/** A song going into a playlist: its note and the Plex track it's tied to. */
export interface PlaylistSong {
  path: string
  ratingKey: string
  title: string
}

/** What sending a Base's songs to Plex as a playlist would do, worked out before anything is sent. */
export interface PlaylistPlan {
  name: string
  songs: PlaylistSong[]
  /** Notes that can't go in, and why. */
  leftOut: { path: string, reason: string }[]
  /** The music playlist of that name already in Plex, whose songs are replaced. */
  existing: { ratingKey: string, count: number } | null
}

/** Plex sends items to a playlist in batches this size, so a request's address stays short. */
const BATCH = 100

/**
 * The Plex track a note is tied to: the Plex link in one of its link properties, or the item
 * "Use an existing note" tied to it. Null for a note from anywhere else (or none).
 */
export function songKeyOf(frontmatter: Record<string, unknown>, path: string, settings: PlexNotesSettings): string | null {
  const names = [...new Set(Object.values(settings.libraries).flatMap(lib => linkPropertyNames(lib.properties)))]
  for (const name of names) {
    const key = ratingKeyFromLink(frontmatter[name])
    if (key && /^\d+$/.test(key)) return key
  }
  const merged = Object.entries(settings.merged).find(([key, m]) => m.path === path && /^\d+$/.test(key))
  return merged ? merged[0] : null
}

/**
 * Works out a playlist from a Base's notes, in the Base's order: each note's Plex track (only
 * songs; a track Plex no longer has, or something else, is left out), and whether Plex already
 * has a music playlist of that name. Sends nothing.
 */
export async function planPlaylist(app: App, settings: PlexNotesSettings, name: string, files: TFile[]): Promise<PlaylistPlan> {
  if (!plexReady(settings)) throw new Error('Set up Plex in the plugin settings first')
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const leftOut: PlaylistPlan['leftOut'] = []
  const wanted: { path: string, ratingKey: string }[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const key = songKeyOf(frontmatter, file.path, settings)
    if (!key) leftOut.push({ path: file.path, reason: 'no Plex link' })
    else if (seen.has(key)) leftOut.push({ path: file.path, reason: 'same song as a note above' })
    else {
      seen.add(key)
      wanted.push({ path: file.path, ratingKey: key })
    }
  }
  const found = new Map((await plex.items(wanted.map(w => w.ratingKey))).map(item => [item.ratingKey, item]))
  const songs: PlaylistSong[] = []
  for (const { path, ratingKey } of wanted) {
    const item = found.get(ratingKey)
    if (!item) leftOut.push({ path, reason: 'not in Plex any more' })
    else if (item.type !== 'track') leftOut.push({ path, reason: 'not a song in Plex' })
    else songs.push({ path, ratingKey, title: item.grandparentTitle ? `${item.title} (${item.grandparentTitle})` : item.title })
  }
  const same = (await plex.audioPlaylists()).filter(p => p.title === name)
  if (same.some(p => p.smart === true || p.smart === 1 || p.smart === '1')) {
    throw new Error(`"${name}" is a smart playlist in Plex, which can't be filled from a note list. Give this view another playlist name.`)
  }
  const existing = same[0] ? { ratingKey: same[0].ratingKey, count: same[0].leafCount ?? 0 } : null
  return { name, songs, leftOut, existing }
}

/**
 * Sends a planned playlist to Plex: a new playlist, or the existing one emptied and refilled, so
 * it ends up holding just these songs, in this order. Your playlist's own title, poster and
 * description in Plex stay.
 */
export async function sendPlaylist(settings: PlexNotesSettings, plan: PlaylistPlan): Promise<void> {
  if (!plan.songs.length) throw new Error('There are no songs to send')
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const machineId = await plex.machineIdentifier()
  const keys = plan.songs.map(s => s.ratingKey)
  let playlist: string
  let start = 0
  if (plan.existing) {
    playlist = plan.existing.ratingKey
    for (const entry of await plex.playlistEntries(playlist)) await plex.removeFromPlaylist(playlist, entry.playlistItemID)
  } else {
    playlist = await plex.createAudioPlaylist(plan.name, machineId, keys.slice(0, BATCH))
    start = BATCH
  }
  for (; start < keys.length; start += BATCH) await plex.addToPlaylist(playlist, machineId, keys.slice(start, start + BATCH))
}
