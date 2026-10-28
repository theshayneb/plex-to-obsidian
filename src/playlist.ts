import type { App, TFile } from 'obsidian'
import { plexReady, type PlexNotesSettings } from './config'
import { normalizeTitle, ratingKeyFromLink, withoutFeatured, type PlexItem } from './notes'
import { PlexClient } from './plex'
import { linkPropertyNames } from './properties'
import { revisitPicks, revisitSeeds } from './revisit'

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
 * The Plex item a note is tied to: the item "Tie this note to a Plex item" or "Use an existing
 * note" tied to it, else the Plex link in one of its link properties. Null for a note from
 * anywhere else (or none).
 */
export function songKeyOf(frontmatter: Record<string, unknown>, path: string, settings: PlexNotesSettings): string | null {
  const merged = Object.entries(settings.merged).find(([key, m]) => m.path === path && /^\d+$/.test(key))
  if (merged) return merged[0]
  const names = [...new Set(Object.values(settings.libraries).flatMap(lib => linkPropertyNames(lib.properties)))]
  for (const name of names) {
    const key = ratingKeyFromLink(frontmatter[name])
    if (key && /^\d+$/.test(key)) return key
  }
  return null
}

/**
 * The song on an album a note is for, when its link is to the album's page: the track whose title
 * (without featured artists) starts or ends the note's name ("Uptown Funk by Mark Ronson" is
 * "Uptown Funk"), the longest such title winning. Null when none, or two, fit.
 */
export function trackForNote(noteName: string, tracks: PlexItem[]): PlexItem | null {
  const name = normalizeTitle(noteName)
  const fits = tracks
    .map(track => ({ track, title: normalizeTitle(withoutFeatured(track.title)) }))
    .filter(({ title }) => title && (name === title || name.startsWith(title) || name.endsWith(title)))
    .sort((a, b) => b.title.length - a.title.length)
  if (!fits.length || (fits[1] && fits[1].title.length === fits[0].title.length)) return null
  return fits[0].track
}

/**
 * Works out a playlist from a Base's notes, in the Base's order: each note's Plex track (only
 * songs; a link to an album counts as the album's song named like the note; a track Plex no longer
 * has, or something else, is left out), and whether Plex already has a music playlist of that
 * name. Sends nothing.
 */
export async function planPlaylist(app: App, settings: PlexNotesSettings, name: string, files: TFile[]): Promise<PlaylistPlan> {
  if (!plexReady(settings)) throw new Error('Set up Plex in the plugin settings first')
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const leftOut: PlaylistPlan['leftOut'] = []
  const wanted: { path: string, ratingKey: string }[] = []
  for (const file of files) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const key = songKeyOf(frontmatter, file.path, settings)
    if (!key) leftOut.push({ path: file.path, reason: 'no Plex link' })
    else wanted.push({ path: file.path, ratingKey: key })
  }
  const keys = [...new Set(wanted.map(w => w.ratingKey))]
  const found = new Map((keys.length ? await plex.items(keys) : []).map(item => [item.ratingKey, item]))
  const albums = new Map<string, PlexItem[]>()
  const songs: PlaylistSong[] = []
  /** Which note each song went in for. */
  const seen = new Map<string, string>()
  for (const { path, ratingKey } of wanted) {
    let item = found.get(ratingKey)
    if (item?.type === 'album') {
      if (!albums.has(ratingKey)) albums.set(ratingKey, (await plex.children(ratingKey)).filter(track => track.type === 'track'))
      const noteName = path.split('/').pop()!.replace(/\.md$/, '')
      const track = trackForNote(noteName, albums.get(ratingKey)!)
      if (!track) {
        leftOut.push({ path, reason: `its Link is to the album ${item.title} in Plex, and no song on it is named like this note (use "Tie this note to a Plex item" to pick it)` })
        continue
      }
      item = { ...track, grandparentTitle: track.grandparentTitle ?? item.parentTitle }
    }
    if (!item) leftOut.push({ path, reason: 'not in Plex any more' })
    else if (item.type !== 'track') leftOut.push({ path, reason: `its Link is to ${item.type === 'artist' ? 'an artist' : `a ${item.type}`} in Plex, not a song` })
    else if (seen.has(item.ratingKey)) {
      const other = seen.get(item.ratingKey)!.split('/').pop()!.replace(/\.md$/, '')
      leftOut.push({ path, reason: `same song in Plex as "${other}", above it (${item.title})` })
    } else {
      seen.set(item.ratingKey, path)
      songs.push({ path, ratingKey: item.ratingKey, title: item.grandparentTitle ? `${item.title} (${item.grandparentTitle})` : item.title })
    }
  }
  return { name, songs, leftOut, existing: await existingPlaylist(plex, name, 'Give this view another playlist name.') }
}

/** Plex's music playlist of this name (give or take capitals and spaces at the ends); a smart one is refused. */
async function existingPlaylist(plex: PlexClient, name: string, instead: string): Promise<PlaylistPlan['existing']> {
  const same = (await plex.audioPlaylists()).filter(p => p.title.trim().toLowerCase() === name.trim().toLowerCase())
  if (same.some(p => p.smart === true || p.smart === 1 || p.smart === '1')) {
    throw new Error(`"${name}" is a smart playlist in Plex, which can't be filled from a list of songs. ${instead}`)
  }
  return same[0] ? { ratingKey: same[0].ratingKey, count: same[0].leafCount ?? 0 } : null
}

/** The playlist "Revisit" is made as, in Plex. */
export const REVISIT_PLAYLIST = 'Revisit'

/**
 * The songs the "Revisit" playlist would hold, worked out without sending anything: songs in your
 * music libraries you haven't played in half a year that sound like up to 30 of your favorites
 * (`revisitPicks`), a new mix each time.
 */
export async function planRevisit(settings: PlexNotesSettings, progress: (message: string) => void = () => {}): Promise<PlexItem[]> {
  if (!plexReady(settings)) throw new Error('Set up Plex in the plugin settings first')
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const libraries = Object.entries(settings.libraries).filter(([key, lib]) => lib.target === 'music' && /^\d+$/.test(key))
  if (!libraries.length) throw new Error('No library is set to Music in the plugin settings')
  const tracks: PlexItem[] = []
  for (const [key, lib] of libraries) {
    progress(`Reading ${lib.title}…`)
    tracks.push(...await plex.libraryItems(key, true))
  }
  const seeds = revisitSeeds(tracks, 30)
  if (!seeds.length) throw new Error('No songs are rated ⭐⭐⭐⭐ or 🩷 in Plex yet, so there\'s nothing to go on')
  const near: { seed: PlexItem, similar: (PlexItem & { distance?: number })[] }[] = []
  for (const [i, seed] of seeds.entries()) {
    progress(`Finding songs that sound like your favorites: ${i + 1} of ${seeds.length}…`)
    near.push({ seed, similar: await plex.nearest(seed.ratingKey) })
  }
  if (!near.some(n => n.similar.length)) {
    throw new Error('Plex found no songs that sound like your favorites. This uses Plex\'s sonic analysis, which needs Plex Pass and the music library\'s "Sonic analysis" option (Plex analyses the songs in its scheduled tasks).')
  }
  const picks = revisitPicks(near, Math.floor(Date.now() / 1000))
  if (!picks.length) throw new Error('Every song that sounds like your favorites was played in the last six months: nothing to revisit')
  return picks
}

/** Sends these songs to Plex as the "Revisit" playlist (made, or emptied and refilled). */
export async function sendRevisit(settings: PlexNotesSettings, picks: PlexItem[]): Promise<void> {
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const existing = await existingPlaylist(plex, REVISIT_PLAYLIST, 'Rename it in Plex so this one can be made.')
  await sendPlaylist(settings, {
    name: REVISIT_PLAYLIST,
    songs: picks.map(track => ({ path: '', ratingKey: track.ratingKey, title: track.title })),
    leftOut: [],
    existing,
  })
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
    // Emptied first, so it ends up holding just these songs rather than gaining them at the end;
    // anything a clear-out left behind is removed one by one.
    playlist = plan.existing.ratingKey
    await plex.clearPlaylist(playlist)
    for (const entry of await plex.playlistEntries(playlist)) await plex.removeFromPlaylist(playlist, entry.playlistItemID)
  } else {
    playlist = await plex.createAudioPlaylist(plan.name, machineId, keys.slice(0, BATCH))
    start = BATCH
  }
  for (; start < keys.length; start += BATCH) await plex.addToPlaylist(playlist, machineId, keys.slice(start, start + BATCH))
  const count = (await plex.playlistEntries(playlist)).length
  if (count !== keys.length) {
    throw new Error(`Plex's "${plan.name}" now has ${count} song${count === 1 ? '' : 's'} instead of ${keys.length}. Its old songs may not have been removed; try sending it again.`)
  }
}
