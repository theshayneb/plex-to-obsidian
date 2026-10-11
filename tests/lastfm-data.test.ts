import { describe, expect, it } from 'vitest'
import { artistKey, lastfmError, lastfmSuggestions, parseSimilarTracks, pickSeeds, songKey, type Seed } from '../src/lastfm-data'

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

  it('lists songs you don\'t have, by anyone, 🩷 counting twice, best first', () => {
    const owned = new Set([songKey('Bruno Mars', 'Treasure'), songKey('Daft Punk', 'Get Lucky')])
    const result = lastfmSuggestions(
      [
        { seed: heart, similar: [
          { artist: 'Bruno Mars', title: 'Treasure (Remastered)', match: 0.5, url: 'a' },
          { artist: 'Chic', title: 'Le Freak', match: 0.4, url: 'c' },
          { artist: 'Daft Punk', title: 'Get Lucky', match: 1, url: 'd' },
          { artist: 'Bruno Mars', title: 'Locked Out of Heaven', match: 0.3, url: 'h' },
        ] },
        { seed: star, similar: [
          { artist: 'Chic', title: 'Le Freak', match: 0.5, url: 'c' },
          { artist: 'Nile Rodgers', title: 'Good Times', match: 0.6, url: 'e' },
        ] },
      ],
      owned,
      new Set(['lastfm:track:Nile Rodgers – Good Times']),
    )
    expect(result).toEqual([
      { id: 'lastfm:track:Chic – Le Freak', title: 'Chic – Le Freak', url: 'c', score: 1.3, because: [heart.title, star.title] },
      { id: 'lastfm:track:Bruno Mars – Locked Out of Heaven', title: 'Bruno Mars – Locked Out of Heaven', url: 'h', score: 0.6, because: [heart.title] },
    ])
  })
})

describe('pickSeeds', () => {
  it('takes 🩷 songs before ⭐⭐⭐⭐ ones', () => {
    const seeds = [1, 2, 1, 2].map((weight, i): Seed => ({ title: String(i), artist: 'a', track: String(i), weight }))
    expect(pickSeeds(seeds, 3, () => 0.5).map(s => s.weight)).toEqual([2, 2, 1])
  })
})
