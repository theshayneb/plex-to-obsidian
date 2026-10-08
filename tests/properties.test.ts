import { describe, expect, it } from 'vitest'
import type { PlexItem } from '../src/notes'
import {
  buildFrontmatter,
  DEFAULT_PROPERTIES,
  defaultValues,
  FIELD_SOURCES,
  linkPropertyNames,
  sourceValue,
  type FieldSource,
  type NoteContext, keepGenres } from '../src/properties'

const movie: PlexItem = {
  ratingKey: '1234',
  type: 'movie',
  title: 'Arrival',
  year: 2016,
  summary: 'A linguist meets aliens.',
  tagline: 'Why are they here?',
  originallyAvailableAt: '2016-11-11',
  duration: 6960000,
  viewCount: 1,
  contentRating: 'PG-13',
  studio: 'Paramount',
  rating: 9.4,
  audienceRating: 8.2,
  Genre: [{ tag: 'Science Fiction' }, { tag: 'Drama' }],
  Director: [{ tag: 'Denis Villeneuve' }],
  Role: ['A', 'B', 'C', 'D', 'E', 'F'].map(tag => ({ tag })),
  Guid: [{ id: 'imdb://tt2543164' }, { id: 'tmdb://329865' }],
}

const ctx: NoteContext = { kind: 'movie', link: 'LINK', image: '[[Media/Movies/Images/Arrival (2016).jpg]]', values: defaultValues('movie') }

describe('buildFrontmatter', () => {
  it('produces the default properties in order', () => {
    const fm = buildFrontmatter(movie, DEFAULT_PROPERTIES, ctx)
    expect(fm).toEqual({
      Genre: ['Science Fiction', 'Drama'],
      Summary: 'A linguist meets aliens.',
      Date: '2016-11-11',
      Duration: 116,
      Status: 'completed',
      Link: 'LINK',
      Image: '[[Media/Movies/Images/Arrival (2016).jpg]]',
      tags: ['movie'],
    })
    expect(Object.keys(fm)).toEqual(['Genre', 'Summary', 'Date', 'Duration', 'Status', 'Link', 'Image', 'tags'])
  })

  it('follows custom names, sources, order and values', () => {
    const fm = buildFrontmatter(movie, [
      { name: 'Runtime', source: 'durationText' },
      { name: 'Genre', source: 'directors' },
      { name: 'Watched', source: 'status' },
      { name: 'Kind', source: 'typeTag' },
      { name: 'Source', source: 'text', text: 'Plex' },
      { name: '  ', source: 'summary' },
    ], { ...ctx, values: { watched: 'seen', started: 'watching', unwatched: 'to watch', tag: 'film' } })
    expect(fm).toEqual({ Runtime: '1h 56m', Genre: ['Denis Villeneuve'], Watched: 'seen', Kind: ['film'], Source: 'Plex' })
  })

  it('writes properties Plex has no value for as empty', () => {
    const fm = buildFrontmatter({ ratingKey: '1', type: 'movie', title: 'X' }, [
      ...DEFAULT_PROPERTIES,
      { name: 'Tagline', source: 'tagline' },
      { name: 'Cast', source: 'castAll' },
      { name: 'Note', source: 'text' },
    ], { ...ctx, image: null })
    expect(fm).toEqual({
      Genre: [], Summary: null, Date: null, Duration: null, Status: 'pending', Link: 'LINK', Image: null, tags: ['movie'],
      Tagline: null, Cast: [], Note: null,
    })
  })
})

describe('sourceValue', () => {
  const value = (source: FieldSource, item: PlexItem = movie, c: NoteContext = ctx) => sourceValue(source, item, c)

  it('sets completed, started or pending', () => {
    expect(value('status')).toBe('completed')
    expect(value('status', { ...movie, viewCount: 0, viewOffset: 600000 })).toBe('started')
    expect(value('status', { ...movie, viewCount: 0 })).toBe('pending')
    const show: PlexItem = { ratingKey: '9', type: 'show', title: 'S', leafCount: 10 }
    expect(value('status', { ...show, viewedLeafCount: 10 })).toBe('completed')
    expect(value('status', { ...show, viewedLeafCount: 3 })).toBe('started')
    expect(value('status', { ...show, viewedLeafCount: 0 })).toBe('pending')
  })

  it('removes the Documentary genre from documentaries only', () => {
    const doc = { ...movie, Genre: [{ tag: 'Documentary' }, { tag: 'History' }] }
    expect(value('genres', doc, { ...ctx, kind: 'documentary' })).toEqual(['History'])
    expect(value('genres', doc)).toEqual(['Documentary', 'History'])
  })

  it('reads the other Plex fields', () => {
    expect(value('castTop5')).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(value('castAll')).toHaveLength(6)
    expect(value('imdbId')).toBe('tt2543164')
    expect(value('tmdbId')).toBe('329865')
    expect(value('tvdbId')).toBeUndefined()
    expect(value('contentRating')).toBe('PG-13')
    expect(value('criticRating')).toBe(9.4)
    expect(value('durationText', { ...movie, duration: 3600000 })).toBe('1h')
    expect(value('seasons')).toBeUndefined()
    expect(value('seasons', { ...movie, type: 'show', childCount: 3 })).toBe(3)
    const added = new Date(2024, 0, 5, 12).getTime() / 1000
    expect(value('addedAt', { ...movie, addedAt: added })).toBe('2024-01-05')
  })

  it('turns your rating into whole stars and emoji, rounding half stars up', () => {
    const rated = (userRating?: number) => ({ ...movie, userRating })
    expect(value('userRating', rated(6))).toBe(3)
    expect(value('userRating', rated(5))).toBe(3)
    expect(value('userRating', rated(10))).toBe(5)
    expect(value('userRating', rated(undefined))).toBeUndefined()
    expect(value('userRatingEmoji', rated(2))).toBe('⭐')
    expect(value('userRatingEmoji', rated(5))).toBe('⭐⭐⭐')
    expect(value('userRatingEmoji', rated(8))).toBe('⭐⭐⭐⭐')
    expect(value('userRatingEmoji', rated(9))).toBe('🩷')
    expect(value('userRatingEmoji', rated(10))).toBe('🩷')
    expect(value('userRatingEmoji', rated(undefined))).toBeUndefined()
  })

  it('reads track fields, falling back to the album', () => {
    const track: PlexItem = {
      ratingKey: '7', type: 'track', title: 'Karma Police', grandparentTitle: 'Radiohead', parentTitle: 'OK Computer',
      index: 6, parentIndex: 1, duration: 264000,
      album: { ratingKey: '90', type: 'album', title: 'OK Computer', year: 1997, studio: 'Parlophone',
        Genre: [{ tag: 'Alternative' }], Style: [{ tag: 'Art Rock' }], Mood: [{ tag: 'Brooding' }] },
    }
    const c = { ...ctx, kind: 'music' as const, values: defaultValues('music') }
    expect(value('artist', track, c)).toBe('Radiohead')
    expect(value('album', track, c)).toBe('OK Computer')
    expect(value('trackNumber', track, c)).toBe(6)
    expect(value('discNumber', track, c)).toBe(1)
    expect(value('durationClock', track, c)).toBe('4:24')
    expect(value('durationClock', { ...track, duration: 3725000 }, c)).toBe('1:02:05')
    expect(value('genres', track, c)).toEqual(['Alternative'])
    expect(value('styles', track, c)).toEqual(['Art Rock'])
    expect(value('moods', track, c)).toEqual(['Brooding'])
    expect(value('studio', track, c)).toBe('Parlophone')
    expect(value('year', track, c)).toBe(1997)
    expect(value('typeTag', track, c)).toEqual(['music'])
    expect(value('artist')).toBeUndefined()
  })

  it('has a label for every source', () => {
    for (const source of Object.keys(FIELD_SOURCES) as FieldSource[]) {
      expect(() => value(source)).not.toThrow()
    }
  })
})

describe('linkPropertyNames', () => {
  it('includes renamed link properties and the original Link', () => {
    expect(linkPropertyNames([{ name: 'Plex', source: 'plexLink' }])).toEqual(['Plex', 'Link'])
    expect(linkPropertyNames(DEFAULT_PROPERTIES)).toEqual(['Link'])
  })
})

describe('keepGenres', () => {
  const mine = ['Action', 'Adventure', 'Sci-Fi', 'Fantasy', 'Documentary', 'Musical']
  it('keeps only the listed genres, spelled as listed', () => {
    expect(keepGenres(['Drama', 'sci-fi', 'Family'], mine)).toEqual(['Sci-Fi'])
    expect(keepGenres(['Family'], mine)).toEqual([])
  })
  it('understands other names for them', () => {
    expect(keepGenres(['Science Fiction', 'Action & Adventure'], mine)).toEqual(['Sci-Fi', 'Action', 'Adventure'])
    expect(keepGenres(['Sci-Fi & Fantasy', 'Sci-Fi', 'Music'], mine)).toEqual(['Sci-Fi', 'Fantasy', 'Musical'])
  })
  it('keeps everything when the list is empty', () => {
    expect(keepGenres(['Drama', 'Family'], [])).toEqual(['Drama', 'Family'])
    expect(keepGenres(['Drama'], undefined)).toEqual(['Drama'])
  })
})
