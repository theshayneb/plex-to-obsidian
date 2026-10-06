import { describe, expect, it } from 'vitest'
import {
  buildFrontmatter,
  classify,
  defaultLibraryTarget,
  hasNote,
  isWatched,
  normalizeTitle,
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

describe('hasNote', () => {
  const format = '{{title}} ({{year}})'
  it('matches by rating key', () => {
    expect(hasNote({ ratingKeys: new Set(['1234']), names: new Set() }, movie, format)).toBe(true)
  })
  it('matches existing file names loosely, with or without the year', () => {
    const names = (...n: string[]) => ({ ratingKeys: new Set<string>(), names: new Set(n.map(normalizeTitle)) })
    expect(hasNote(names('Spider-Man - Into the Spider-Verse'), movie, format)).toBe(true)
    expect(hasNote(names('spider-man into the spider-verse (2018)'), movie, format)).toBe(true)
    expect(hasNote(names('Spider-Man'), movie, format)).toBe(false)
  })
})

describe('buildFrontmatter', () => {
  it('maps Plex fields to the note properties in order', () => {
    const fm = buildFrontmatter(movie, 'movie', 'LINK', '[[Media/Movies/Images/x.jpg]]')
    expect(fm).toEqual({
      Genre: ['Animation', 'Action'],
      Summary: 'Miles Morales becomes Spider-Man.',
      Date: '2018-12-14',
      Duration: 117,
      Status: 'completed',
      Link: 'LINK',
      Image: '[[Media/Movies/Images/x.jpg]]',
      tags: ['movie'],
    })
    expect(Object.keys(fm)).toEqual(['Genre', 'Summary', 'Date', 'Duration', 'Status', 'Link', 'Image', 'tags'])
  })
  it('leaves out missing values and tags by kind', () => {
    expect(buildFrontmatter(show, 'documentary', 'LINK', null)).toEqual({
      Genre: ['Documentary'],
      Status: 'pending',
      Link: 'LINK',
      tags: ['documentary'],
    })
    expect(buildFrontmatter(show, 'tv', 'LINK', null).tags).toEqual(['tv_show'])
  })
})
