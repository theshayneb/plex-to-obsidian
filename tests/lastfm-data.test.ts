import { describe, expect, it } from 'vitest'
import { artistKey, lastfmError, lastfmSuggestions, parseSimilarArtists, parseSimilarTracks, pickSeeds, songKey, type Seed } from '../src/lastfm-data'

describe('parsing Last.fm', () => {
  it('reads similar tracks, one or several', () => {
    expect(parseSimilarTracks({ similartracks: { track: [
      { name: 'Treasure', match: 0.9, url: 'https://last.fm/t', artist: { name: 'Bruno Mars' } },
      { name: '', match: 0.5, artist: { name: 'Nobody' } },
    ] } })).toEqual([{ artist: 'Bruno Mars', title: 'Treasure', match: 0.9, url: 'https://last.fm/t' }])
    expect(parseSimilarTracks({ similartracks: { track: { name: 'A', match: '0.3', artist: { name: 'B' } } } }))
      .toEqual([{ artist: 'B', title: 'A', match: 0.3, url: '' }])
    expect(parseSimilarTracks(null)).toEqual([])
  })

  it('reads similar artists, with matches given as text', () => {
    expect(parseSimilarArtists({ similarartists: { artist: [{ name: 'Muse', match: '0.75', url: 'u' }] } }))
      .toEqual([{ name: 'Muse', match: 0.75, url: 'u' }])
  })

  it('recognises errors', () => {
    expect(lastfmError({ error: 10, message: 'Invalid API key' })).toEqual({ code: 10, message: 'Invalid API key' })
    expect(lastfmError({ similarartists: {} })).toBeNull()
  })
})

describe('songKey', () => {
  it('compares songs across versions and featured artists', () => {
    expect(songKey('Mark Ronson', 'Uptown Funk (feat. Bruno Mars)')).toBe(songKey('Mark Ronson', 'Uptown Funk'))
    expect(songKey('The Beatles', 'Let It Be - Remastered 2009')).toBe(songKey('the beatles', 'Let It Be'))
    expect(songKey('Mark Ronson, Bruno Mars', 'Uptown Funk')).toBe(songKey('Mark Ronson', 'Uptown Funk'))
    expect(songKey('Simon & Garfunkel', 'Mrs. Robinson')).toBe(songKey('Simon & Garfunkel', 'Mrs Robinson'))
    expect(songKey('A', 'One')).not.toBe(songKey('A', 'Two'))
  })

  it('compares artists', () => {
    expect(artistKey('Florence + the Machine')).toBe(artistKey('florence the machine'))
  })
})

describe('lastfmSuggestions', () => {
  const heart: Seed = { title: 'Mark Ronson - Uptown Funk', artist: 'Mark Ronson', track: 'Uptown Funk', weight: 2 }
  const star: Seed = { title: 'Daft Punk - Get Lucky', artist: 'Daft Punk', track: 'Get Lucky', weight: 1 }

  it('splits songs you have (only open ones) from new songs and new artists, 🩷 counting twice', () => {
    const owned = new Map([
      [songKey('Bruno Mars', 'Treasure'), { id: 'note:Music/Treasure.md', title: 'Bruno Mars - Treasure' }],
      [songKey('Pharrell Williams', 'Happy'), { id: 'note:Music/Happy.md', title: 'Pharrell Williams - Happy' }],
      [songKey('Daft Punk', 'Get Lucky'), { id: 'note:Music/Get Lucky.md', title: 'Daft Punk - Get Lucky' }],
    ])
    const result = lastfmSuggestions(
      [
        { seed: heart, similar: [
          { artist: 'Bruno Mars', title: 'Treasure', match: 0.5, url: 'a' },
          { artist: 'Pharrell Williams', title: 'Happy', match: 0.9, url: 'b' },
          { artist: 'Chic', title: 'Le Freak', match: 0.4, url: 'c' },
          { artist: 'Daft Punk', title: 'Get Lucky', match: 1, url: 'd' },
        ] },
        { seed: star, similar: [
          { artist: 'Chic', title: 'Le Freak', match: 0.5, url: 'c' },
          { artist: 'Nile Rodgers', title: 'Good Times', match: 0.6, url: 'e' },
        ] },
      ],
      [{ seed: heart, similar: [{ name: 'Chic', match: 0.5, url: 'f' }, { name: 'Bruno Mars', match: 1, url: 'g' }] }],
      owned,
      new Set([artistKey('Bruno Mars'), artistKey('Pharrell Williams'), artistKey('Daft Punk')]),
      new Set(['note:Music/Treasure.md']),
      new Set(['lastfm:track:Nile Rodgers – Good Times']),
    )
    // Happy is yours but rated, Get Lucky is a loved one itself.
    expect(result.owned).toEqual([{ id: 'note:Music/Treasure.md', title: 'Bruno Mars - Treasure', url: 'a', score: 1, because: [heart.title] }])
    expect(result.songs).toEqual([{ id: 'lastfm:track:Chic – Le Freak', title: 'Chic – Le Freak', url: 'c', score: 1.3, because: [heart.title, star.title] }])
    expect(result.artists).toEqual([{ id: 'lastfm:artist:Chic', title: 'Chic', url: 'f', score: 1, because: ['Mark Ronson'] }])
  })
})

describe('pickSeeds', () => {
  it('takes 🩷 songs before ⭐⭐⭐⭐ ones', () => {
    const seeds = [1, 2, 1, 2].map((weight, i): Seed => ({ title: String(i), artist: 'a', track: String(i), weight }))
    expect(pickSeeds(seeds, 3, () => 0.5).map(s => s.weight)).toEqual([2, 2, 1])
  })
})
