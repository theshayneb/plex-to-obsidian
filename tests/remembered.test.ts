import { describe, expect, it } from 'vitest'
import { newLibrary } from '../src/config'
import { groupByKind, keptEntries, kindOfLibrary, kindOfPath, OTHER_KIND } from '../src/remembered'

const libraries = {
  '1': { ...newLibrary('Films', 'movie', 'movie'), folder: 'Media/Movies' },
  '2': { ...newLibrary('Songs', 'artist', 'music'), folder: 'Media/Music' },
  '3': { ...newLibrary('Pop', 'artist', 'music'), folder: 'Media/Music/Pop' },
}

describe('kindOfPath', () => {
  it('uses the library whose folder holds the note', () => {
    expect(kindOfPath(libraries, 'Media/Movies/Heat (1995).md')).toBe('Movies')
    expect(kindOfPath(libraries, 'Media/Music/Pop/Uptown Funk.md')).toBe('Music')
  })

  it('puts notes outside every library under other', () => {
    expect(kindOfPath(libraries, 'Inbox/Heat.md')).toBe(OTHER_KIND)
    expect(kindOfPath(libraries, 'Media/Movies2/Heat.md')).toBe(OTHER_KIND)
  })
})

describe('kindOfLibrary', () => {
  it('finds the library by key, then by title', () => {
    expect(kindOfLibrary(libraries, '2', 'whatever')).toBe('Music')
    expect(kindOfLibrary(libraries, undefined, 'Films')).toBe('Movies')
    expect(kindOfLibrary(libraries, 'gone', 'Gone')).toBe(OTHER_KIND)
  })
})

describe('groupByKind', () => {
  it('orders kinds as listed and names alphabetically', () => {
    const entries = [
      { kind: 'Music', name: 'b song' }, { kind: OTHER_KIND, name: 'x' }, { kind: 'Movies', name: 'Zodiac' },
      { kind: 'Music', name: 'A song' }, { kind: 'Movies', name: 'alien' },
    ]
    expect(groupByKind(entries, e => e.kind, e => e.name).map(([kind, list]) => [kind, list.map(e => e.name)])).toEqual([
      ['Movies', ['alien', 'Zodiac']],
      ['Music', ['A song', 'b song']],
      [OTHER_KIND, ['x']],
    ])
  })
})

describe('keptEntries', () => {
  it('reads kept values, old and new, and kept links', () => {
    expect(keptEntries(
      { '12|Date': JSON.stringify({ kept: '2025-01-01', offered: '2012-01-01' }), 'book:Books/A.md|Genre': 'Fantasy', '12|plexRating': '4' },
      { 'steam-5': 'https://example.com' },
    )).toEqual([
      { key: '12|Date', links: false, item: '12', property: 'Date', kept: '2025-01-01', offered: '2012-01-01' },
      { key: 'book:Books/A.md|Genre', links: false, item: 'book:Books/A.md', property: 'Genre', kept: 'Fantasy', offered: null },
      { key: '12|plexRating', links: false, item: '12', property: 'Rating sent to Plex', kept: '4', offered: null },
      { key: 'steam-5', links: true, item: 'steam-5', property: 'Link', kept: 'https://example.com', offered: null },
    ])
  })
})
