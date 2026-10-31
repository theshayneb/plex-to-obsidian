import { describe, expect, it } from 'vitest'
import { parseSearch, pickTrack, spotifyAuthUrl, spotifyError, SPOTIFY_REDIRECT } from '../src/spotify-data'

const track = (uri: string, name: string, ...artists: string[]) => ({ uri, name, artists: artists.map(n => ({ name: n })) })

describe('Spotify', () => {
  it('asks only to change playlists, coming back to this computer', () => {
    const url = new URL(spotifyAuthUrl(' abc ', 'challenge', 'xyz'))
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'abc', response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, code_challenge_method: 'S256', code_challenge: 'challenge',
      scope: 'playlist-read-private playlist-modify-private playlist-modify-public', state: 'xyz',
    })
  })

  it('picks the same recording, else the same song in another version, else nothing', () => {
    const found = parseSearch({ tracks: { items: [
      track('spotify:track:1', 'Glory Box - Live', 'Portishead'),
      track('spotify:track:2', 'Glory Box', 'Portishead'),
      track('spotify:track:3', 'Glory Box', 'Someone Else'),
      { name: 'No uri' },
    ] } })
    expect(found).toHaveLength(3)
    expect(pickTrack(found, 'Portishead', 'Glory Box')).toEqual({ track: found[1], exact: true })
    expect(pickTrack([found[0]], 'Portishead', 'Glory Box')).toEqual({ track: found[0], exact: false })
    expect(pickTrack([found[2]], 'Portishead', 'Glory Box')).toBeNull()
    expect(parseSearch(null)).toEqual([])
  })

  it('reads Spotify\'s error messages', () => {
    expect(spotifyError({ error: { status: 403, message: 'Insufficient client scope' } })).toBe('Insufficient client scope')
    expect(spotifyError({ error: 'invalid_grant', error_description: 'Refresh token revoked' })).toBe('Refresh token revoked')
    expect(spotifyError({ tracks: {} })).toBeNull()
  })
})
