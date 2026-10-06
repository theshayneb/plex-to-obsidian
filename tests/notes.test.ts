import { describe, expect, it } from 'vitest'
import {
  classify,
  defaultLibraryTarget,
  addToIndex,
  emptyIndex,
  findNote,
  hasNote,
  planRenames,
  isStarted,
  isWatched,
  plexWebLink,
  ratingKeyFromLink,
  renderFileName,
  type PlexItem,
} from '../src/notes'

const movie: PlexItem = {
  ratingKey: '1234',
  type: 'movie',
  title: 'Spider-Man: Into the Spider-Verse',
  year: 2018,
  summary: 'Miles Morales becomes Spider-Man.',
  originallyAvailableAt: '2018-12-14',
  duration: 7020000,
  viewCount: 1,
  thumb: '/library/metadata/1234/thumb/1',
  Genre: [{ tag: 'Animation' }, { tag: 'Action' }],
}

const show: PlexItem = {
  ratingKey: '55',
  type: 'show',
  title: 'Planet Earth',
  year: 2006,
  leafCount: 11,
  viewedLeafCount: 4,
  Genre: [{ tag: 'Documentary' }],
}

describe('classify', () => {
  it('uses the library target', () => {
    expect(classify(movie, 'movie', true)).toBe('movie')
  })
  it('moves Documentary-genre items to documentaries when enabled', () => {
    expect(classify(show, 'tv', true)).toBe('documentary')
    expect(classify(show, 'tv', false)).toBe('tv')
  })
})

describe('defaultLibraryTarget', () => {
  it('guesses from type and title', () => {
    expect(defaultLibraryTarget('movie', 'Movies')).toBe('movie')
    expect(defaultLibraryTarget('show', 'TV Shows')).toBe('tv')
    expect(defaultLibraryTarget('movie', 'Documentaries')).toBe('documentary')
    expect(defaultLibraryTarget('artist', 'Music')).toBe('skip')
  })
})

describe('isWatched', () => {
  it('needs a play for movies', () => {
    expect(isWatched(movie)).toBe(true)
    expect(isWatched({ ...movie, viewCount: undefined })).toBe(false)
  })
  it('needs every episode for shows', () => {
    expect(isWatched(show)).toBe(false)
    expect(isWatched({ ...show, viewedLeafCount: 11 })).toBe(true)
    expect(isWatched({ ...show, leafCount: 0, viewedLeafCount: 0 })).toBe(false)
  })
})

describe('links', () => {
  it('round-trips the rating key', () => {
    const link = plexWebLink('abc123', '1234')
    expect(link).toBe('https://app.plex.tv/desktop/#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F1234')
    expect(ratingKeyFromLink(link)).toBe('1234')
    expect(ratingKeyFromLink('http://x:32400/library/metadata/99')).toBe('99')
    expect(ratingKeyFromLink(undefined)).toBeNull()
  })
})

describe('renderFileName', () => {
  it('fills the format and strips characters files cannot use', () => {
    expect(renderFileName('{{title}} ({{year}})', movie)).toBe('Spider-Man Into the Spider-Verse (2018)')
  })
  it('drops empty brackets when there is no year', () => {
    expect(renderFileName('{{title}} ({{year}})', { ...movie, year: undefined })).toBe('Spider-Man Into the Spider-Verse')
  })
})

const format = '{{title}} ({{year}})'
const indexOf = (...names: string[]) => {
  const index = emptyIndex()
  for (const n of names) addToIndex(index, `Media/Movies/${n}.md`, n)
  return index
}

describe('hasNote', () => {
  it('matches by rating key', () => {
    const index = emptyIndex()
    addToIndex(index, 'Media/Movies/Whatever.md', 'Whatever', ['1234'])
    expect(hasNote(index, movie, format)).toBe(true)
  })
  it('matches existing file names loosely, with or without the year', () => {
    expect(hasNote(indexOf('Spider-Man - Into the Spider-Verse'), movie, format)).toBe(true)
    expect(hasNote(indexOf('spider-man into the spider-verse (2018)'), movie, format)).toBe(true)
    expect(hasNote(indexOf('Spider-Man'), movie, format)).toBe(false)
  })
})

describe('planRenames', () => {
  const heat: PlexItem = { ratingKey: '2', type: 'movie', title: 'Heat', year: 1995 }
  const dune84: PlexItem = { ratingKey: '3', type: 'movie', title: 'Dune', year: 1984 }
  const dune21: PlexItem = { ratingKey: '4', type: 'movie', title: 'Dune', year: 2021 }
  const plan = (index: ReturnType<typeof emptyIndex>, ...items: PlexItem[]) =>
    planRenames(items.map(item => ({ item, match: findNote(index, item, format) }))).map(p => `${p.item.ratingKey}:${p.path}`)

  it('renames a note only one Plex item matches', () => {
    expect(plan(indexOf('Heat', 'Dune'), heat)).toEqual(['2:Media/Movies/Heat.md'])
  })
  it('leaves a note two Plex items could match', () => {
    expect(plan(indexOf('Dune'), dune84, dune21)).toEqual([])
  })
  it('leaves an item that matches two notes', () => {
    expect(plan(indexOf('Heat', 'Heat (1995)'), heat)).toEqual([])
  })
  it('trusts the Plex link over a name match', () => {
    const index = indexOf('Dune')
    addToIndex(index, 'Media/Movies/Dune.md', 'Dune', ['4'])
    expect(plan(index, dune84, dune21)).toEqual(['4:Media/Movies/Dune.md'])
  })
})

describe('isStarted', () => {
  it('is a movie stopped part way or a partly watched show', () => {
    expect(isStarted({ ...movie, viewCount: 0, viewOffset: 1000 })).toBe(true)
    expect(isStarted({ ...movie, viewOffset: 1000 })).toBe(false)
    expect(isStarted(show)).toBe(true)
    expect(isStarted({ ...show, viewedLeafCount: 11 })).toBe(false)
    expect(isStarted({ ...show, viewedLeafCount: 0 })).toBe(false)
  })
})
