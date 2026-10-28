import { describe, expect, it } from 'vitest'
import { artistKey, lastfmError, lastfmSuggestions, parseSimilarTracks, pickSeeds, seedWeight, songKey, parseTopTracks, playCountsByKey, type Seed } from '../src/lastfm-data'

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

  it('lists songs you don\'t have, by anyone, those like more of your songs first, then by weighted match', () => {
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
      { id: 'lastfm:track:Chic – Le Freak', artist: 'Chic', track: 'Le Freak', seeds: 2, title: 'Chic – Le Freak', url: 'c', score: 1.3, because: [heart.title, star.title] },
      { id: 'lastfm:track:Bruno Mars – Locked Out of Heaven', artist: 'Bruno Mars', track: 'Locked Out of Heaven', seeds: 1, title: 'Bruno Mars – Locked Out of Heaven', url: 'h', score: 0.6, because: [heart.title] },
    ])
  })
})

describe('pickSeeds', () => {
  it('draws from the whole library, heavier songs more likely', () => {
    const seeds = [1, 2, 1, 2].map((weight, i): Seed => ({ title: String(i), artist: 'a', track: String(i), weight }))
    // The same draw for each: the heavier ones come first.
    expect(pickSeeds(seeds, 3, () => 0.5).map(s => s.weight)).toEqual([2, 2, 1])
    // A light song with a lucky draw still gets in.
    const draws = [0.99, 0.1, 0.1, 0.1]
    expect(pickSeeds(seeds, 1, () => draws.shift()!).map(s => s.title)).toEqual(['0'])
    // Over many draws a weight-2 song is picked first about twice as often as a weight-1 one.
    let heavy = 0
    for (let i = 0; i < 4000; i++) if (pickSeeds([seeds[0], seeds[1]], 1)[0].weight === 2) heavy++
    expect(heavy / 4000).toBeGreaterThan(0.6)
    expect(heavy / 4000).toBeLessThan(0.73)
  })

  it('weighs a song by its rating and how much you played it', () => {
    expect(seedWeight(5, 0)).toBe(3)
    expect(seedWeight(4, 2)).toBe(4)
    expect(seedWeight(0, 0)).toBe(1)
    expect(seedWeight(0, 14)).toBe(4)
  })
})

describe('Last.fm play counts', () => {
  it('reads a page of top tracks and adds up versions of the same song', () => {
    const page = parseTopTracks({ toptracks: { track: [
      { name: 'Karma Police', playcount: '30', artist: { name: 'Radiohead' } },
      { name: 'Karma Police - Remastered', playcount: '10', artist: { name: 'Radiohead' } },
      { name: 'Airbag', playcount: '5', artist: { name: 'Radiohead' } },
    ], '@attr': { totalPages: '3' } } })
    expect(page.pages).toBe(3)
    expect(playCountsByKey(page.tracks)).toEqual(new Map([['radiohead|karmapolice', 40], ['radiohead|airbag', 5]]))
    expect(parseTopTracks({ toptracks: { track: { name: 'One', playcount: '1', artist: { name: 'U2' } } } }).tracks).toHaveLength(1)
  })
})
