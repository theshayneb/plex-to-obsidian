import { describe, expect, it } from 'vitest'
import { compared, daysSpent, daysWith, monthPeriod, parseReaction, summarize, watchEvents, weekNumbers, weeks, type ReactionEvent } from '../src/insights-data'

const at = (y: number, m: number, d: number, h = 20) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000)

describe('insights', () => {
  it('reads a reaction line back, telling feelings from words of your own', () => {
    expect(parseReaction('2026-10-16 · 🩷 · moved, happy · cried at the end', ['moved', 'happy'])).toEqual({ day: '2026-10-16', rating: '🩷', feelings: ['moved', 'happy'], text: 'cried at the end' })
    expect(parseReaction('2026-10-16 · not great, honestly', ['moved'])).toEqual({ day: '2026-10-16', feelings: [], text: 'not great, honestly' })
    expect(parseReaction('loved it', [])).toBeNull()
  })

  it('sums up a month: movies, shows, songs, favourites, feelings and rewatches', () => {
    const events = watchEvents([
      { type: 'movie', title: 'Arrival', ratingKey: '1', viewedAt: at(2026, 9, 2), accountID: 1 },
      { type: 'movie', title: 'Arrival', ratingKey: '1', viewedAt: at(2026, 10, 3), accountID: 1 },
      { type: 'episode', title: 'Pilot', grandparentTitle: 'Lost', grandparentKey: '/library/metadata/88', ratingKey: '881', viewedAt: at(2026, 10, 4), accountID: 1 },
      { type: 'episode', title: 'Two', grandparentTitle: 'Lost', grandparentKey: '/library/metadata/88', ratingKey: '882', viewedAt: at(2026, 10, 5), accountID: 1 },
      { type: 'track', title: 'Airbag', grandparentTitle: 'Radiohead', ratingKey: '7', viewedAt: at(2026, 10, 6), accountID: 1 },
      { type: 'track', title: 'Airbag', grandparentTitle: 'Radiohead', ratingKey: '7', viewedAt: at(2026, 10, 7), accountID: 1 },
      { type: 'movie', title: 'Heat', ratingKey: '2', viewedAt: at(2026, 10, 8), accountID: 7 },
    ])
    const reactions: ReactionEvent[] = [
      { path: 'Books/Dune.md', title: 'Dune', group: 'book', day: '2026-10-10', rating: '🩷', feelings: ['moved'] },
      { path: 'Movies/Arrival.md', title: 'Arrival', group: 'video', day: '2026-10-03', feelings: ['moved', 'sad'] },
      { path: 'Games/Hades.md', title: 'Hades', group: 'game', day: '2026-09-30', feelings: ['happy'] },
    ]
    const s = summarize(events, reactions, monthPeriod(2026, 9))
    expect(s.movies).toEqual([{ key: '1', title: 'Arrival', times: 1, days: ['2026-10-03'] }])
    expect(s.shows).toEqual([{ key: '88', title: 'Lost', episodes: 2 }])
    expect(s.episodes).toBe(2)
    expect(s.songPlays).toBe(2)
    expect(s.topArtists).toEqual([['Radiohead', 2]])
    expect(s.topSongs).toEqual([['Radiohead – Airbag', 2]])
    expect(s.books.map(b => b.title)).toEqual(['Dune'])
    expect(s.games).toEqual([])
    expect(s.favourites.map(f => f.title)).toEqual(['Dune'])
    expect(s.feelings).toEqual([['moved', 2], ['sad', 1]])
    expect(s.rewatches).toEqual([{ title: 'Arrival', path: undefined, kind: 'movie' }])
  })

  it('compares this week with last, plainly', () => {
    const { thisWeek, lastWeek } = weeks(new Date(2026, 9, 16, 12)) // a Friday
    expect(new Date(thisWeek.from * 1000).getDay()).toBe(1)
    const events = watchEvents([
      { type: 'movie', title: 'Arrival', ratingKey: '1', viewedAt: at(2026, 10, 14), accountID: 1 },
      { type: 'episode', title: 'Pilot', grandparentTitle: 'Lost', ratingKey: '881', viewedAt: at(2026, 10, 8), accountID: 1 },
    ])
    const minutes = new Map([['1', 120], ['881', 45]])
    expect(weekNumbers(events, thisWeek, minutes)).toEqual({ hours: 2, movies: 1, episodes: 0, songs: 0 })
    expect(weekNumbers(events, lastWeek, minutes)).toEqual({ hours: 0.8, movies: 0, episodes: 1, songs: 0 })
    expect(compared(2, 0.8, ' h')).toBe('1.2 h more than last week')
    expect(compared(1, 1)).toBe('the same as last week')
  })
})

describe('days from daily notes', () => {
  it('counts the days your daily notes link a book or game', () => {
    const links = [
      { day: '2026-10-01', path: 'Books/Dune.md', title: 'Dune', group: 'book' as const },
      { day: '2026-10-02', path: 'Books/Dune.md', title: 'Dune', group: 'book' as const },
      { day: '2026-10-02', path: 'Books/Dune.md', title: 'Dune', group: 'book' as const },
      { day: '2026-10-02', path: 'Books/Emma.md', title: 'Emma', group: 'book' as const },
      { day: '2026-09-30', path: 'Games/Hades.md', title: 'Hades', group: 'game' as const },
    ]
    const october = monthPeriod(2026, 9)
    expect(daysSpent(links, october, 'book')).toEqual([
      { path: 'Books/Dune.md', title: 'Dune', days: 2, last: '2026-10-02' },
      { path: 'Books/Emma.md', title: 'Emma', days: 1, last: '2026-10-02' },
    ])
    expect(daysWith(links, october, 'book')).toBe(2)
    expect(daysWith(links, october, 'game')).toBe(0)
  })
})

describe('coming back to something', () => {
  it('counts a show your daily notes linked long before as rewatched, but not one carried on from last month', () => {
    const events = watchEvents([
      { type: 'episode', title: 'Chapter 1', grandparentTitle: 'Over the Garden Wall', grandparentKey: '/library/metadata/50', ratingKey: '51', viewedAt: at(2026, 10, 10), accountID: 1 },
      { type: 'episode', title: 'Pilot', grandparentTitle: 'Lost', grandparentKey: '/library/metadata/88', ratingKey: '881', viewedAt: at(2026, 10, 11), accountID: 1 },
      { type: 'movie', title: 'Master of Dark Shadows', ratingKey: '9', viewedAt: at(2026, 10, 12, 20), accountID: 1 },
      { type: 'movie', title: 'Master of Dark Shadows', ratingKey: '9', viewedAt: at(2026, 10, 12, 21), accountID: 1 },
    ])
    const days = [
      { day: '2020-10-31', path: 'TV/Over the Garden Wall.md', title: 'Over the Garden Wall', group: 'video' as const },
      { day: '2024-10-30', path: 'TV/Over the Garden Wall.md', title: 'Over the Garden Wall', group: 'video' as const },
      { day: '2026-09-28', path: 'TV/Lost.md', title: 'Lost', group: 'video' as const },
      { day: '2026-10-02', path: 'Books/Dune.md', title: 'Dune', group: 'book' as const },
      { day: '2021-01-02', path: 'Books/Dune.md', title: 'Dune', group: 'book' as const },
    ]
    const paths: Record<string, string> = { 50: 'TV/Over the Garden Wall.md', 88: 'TV/Lost.md' }
    const s = summarize(events, [], monthPeriod(2026, 9), undefined, days, key => paths[key])
    expect(s.rewatches).toEqual([
      { title: 'Over the Garden Wall', path: 'TV/Over the Garden Wall.md', kind: 'show' },
      { title: 'Dune', path: 'Books/Dune.md', kind: 'book' },
    ])
    // Logged twice the same evening: one viewing.
    expect(s.movies).toEqual([{ key: '9', title: 'Master of Dark Shadows', times: 1, days: ['2026-10-12'] }])
  })
})
