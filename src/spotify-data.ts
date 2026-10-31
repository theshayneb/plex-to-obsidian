// Spotify: finding a suggested song there, and the sign-in address. No Obsidian imports, so it can
// be unit tested; the requests are in spotify.ts.
import { songKey, versionKey } from './lastfm-data'

/** Songs you want to give a listen go in this playlist (made, private, if you have none of that name). */
export const SPOTIFY_PLAYLIST = 'To Listen'

/** Where Spotify sends you back after you approve, caught by the plugin on this computer while you connect. */
export const SPOTIFY_REDIRECT = 'http://127.0.0.1:43219/callback'

/** Only changing your playlists (and reading them, to find "To Listen"). */
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-modify-private playlist-modify-public'

/** The address that asks you to let the plugin change your playlists (PKCE: no secret needed). */
export function spotifyAuthUrl(clientId: string, challenge: string, state: string): string {
  const query = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
    state,
  })
  return `https://accounts.spotify.com/authorize?${query.toString()}`
}

/** A track in Spotify's search answer. */
export interface SpotifyTrack { uri: string, name: string, artists: string[] }

/** `/v1/search?type=track`'s answer. */
export function parseSearch(body: unknown): SpotifyTrack[] {
  const items = (body as { tracks?: { items?: unknown } } | null)?.tracks?.items
  if (!Array.isArray(items)) return []
  return items.map(raw => {
    const t = raw as { uri?: unknown, name?: unknown, artists?: { name?: unknown }[] }
    return {
      uri: typeof t.uri === 'string' ? t.uri : '',
      name: typeof t.name === 'string' ? t.name : '',
      artists: Array.isArray(t.artists) ? t.artists.map(a => typeof a?.name === 'string' ? a.name : '').filter(Boolean) : [],
    }
  }).filter(t => t.uri && t.name && t.artists.length)
}

/**
 * The Spotify track for a song: the same recording if there is one (`exact`), else the same song in
 * another version (a live or remastered one, say), to ask about first; null when none is the song.
 */
export function pickTrack(tracks: SpotifyTrack[], artist: string, title: string): { track: SpotifyTrack, exact: boolean } | null {
  const by = (track: SpotifyTrack, key: (a: string, t: string) => string) =>
    track.artists.some(a => key(a, track.name) === key(artist, title))
  const exact = tracks.find(t => by(t, versionKey))
  if (exact) return { track: exact, exact: true }
  const same = tracks.find(t => by(t, songKey))
  return same ? { track: same, exact: false } : null
}

/** Spotify's error message in an answer, if any. */
export function spotifyError(body: unknown): string | null {
  const error = (body as { error?: unknown, error_description?: unknown } | null)
  if (!error || typeof error !== 'object') return null
  if (typeof error.error_description === 'string') return error.error_description
  if (typeof error.error === 'string') return error.error
  const nested = error.error as { message?: unknown } | undefined
  return nested && typeof nested.message === 'string' ? nested.message : null
}
