import { describe, expect, it } from 'vitest'
import { listenbrainzSuggestions, parseRecommended, parseRecordings, spotifySearch } from '../src/listenbrainz-data'
import { songKey } from '../src/lastfm-data'

describe('ListenBrainz recommendations', () => {
  it('reads recommended recordings and their artists and titles, leaving out songs you have or turned down', () => {
    const recommended = parseRecommended({ payload: { mbids: [
      { recording_mbid: 'm1', score: 9.3 }, { recording_mbid: 'm2', score: 7 }, { recording_mbid: 'm3', score: 8 }, { recording_mbid: 'm4', score: 6 }, { score: 1 },
    ] } })
    expect(recommended).toHaveLength(4)
    const recordings = parseRecordings({
      m1: { recording: { name: 'Glory Box' }, artist: { name: 'Portishead' } },
      m2: { recording: { name: 'Teardrop' }, artist: { name: 'Massive Attack' } },
      m3: { recording: { name: 'Roads (Live)' }, artist: { name: 'Portishead' } },
      m4: { recording: {}, artist: { name: 'Nobody' } },
    })
    const result = listenbrainzSuggestions(recommended, recordings, new Set([songKey('Portishead', 'Roads')]), new Set(['listenbrainz:track:Massive Attack – Teardrop']))
    expect(result).toEqual([{ id: 'listenbrainz:track:Portishead – Glory Box', artist: 'Portishead', track: 'Glory Box', title: 'Portishead – Glory Box', url: 'https://listenbrainz.org/track/m1/', score: 9.3 }])
    expect(parseRecommended(null)).toEqual([])
  })

  it('links a song to a Spotify search', () => {
    expect(spotifySearch('Portishead', 'Glory Box')).toBe('https://open.spotify.com/search/Portishead%20Glory%20Box')
  })
})
