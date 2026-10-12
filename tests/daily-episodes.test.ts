import { describe, expect, it } from 'vitest'
import { episodeEntry, episodeLabel, episodesByDay, insertEntries, watchedEpisodes, type WatchedEpisode } from '../src/daily-episodes'

const ep = (show: string, season: number, episode: number, title: string, viewedAt: number): WatchedEpisode =>
  ({ show, showKey: show, season, episode, title, viewedAt })

describe('watchedEpisodes', () => {
  it('reads the owner\'s episodes from Plex\'s history', () => {
    expect(watchedEpisodes([
      { type: 'episode', title: 'Shoes', grandparentTitle: 'Gilmore Girls', grandparentKey: '/library/metadata/77', parentIndex: 2, index: 6, viewedAt: 100, accountID: 1 },
      { type: 'episode', title: 'Other', grandparentTitle: 'Gilmore Girls', grandparentKey: '/library/metadata/77', parentIndex: 2, index: 7, viewedAt: 200, accountID: 5 },
      { type: 'movie', title: 'Heat', viewedAt: 300, accountID: 1 },
    ])).toEqual([{ show: 'Gilmore Girls', showKey: '77', season: 2, episode: 6, title: 'Shoes', viewedAt: 100 }])
  })
})

describe('episodeLabel and episodeEntry', () => {
  it('writes the season, episode and title', () => {
    const e = ep('Gilmore Girls', 2, 5, 'The Dinner Party', 0)
    expect(episodeLabel(e)).toBe('S02E05 – The Dinner Party')
    expect(episodeEntry('[[Gilmore Girls]]', [e])).toEqual({ lead: '▶️ [[Gilmore Girls]]:', parts: ['S02E05 – The Dinner Party'] })
  })
})

describe('episodesByDay', () => {
  it('lists each show\'s episodes of the day in order, once each', () => {
    const day = (s: number) => (s < 1000 ? 'mon' : 'tue')
    const days = episodesByDay([ep('A', 1, 2, 'two', 20), ep('A', 1, 1, 'one', 10), ep('B', 1, 1, 'b', 15), ep('A', 1, 1, 'one', 30), ep('A', 1, 3, 'three', 1500)], day)
    expect([...days.entries()].map(([d, shows]) => [d, shows.map(list => list.map(e => `${e.show} ${e.title}`))])).toEqual([
      ['mon', [['A one', 'A two'], ['B b']]],
      ['tue', [['A three']]],
    ])
  })
})

describe('insertEntries', () => {
  const note = ['# Monday', '> [!note] Day', '> >[!writing] Journaling', '> >', '> > Had a nice day.', '', 'End'].join('\n')
  const a = (...parts: string[]) => ({ lead: '▶️ [[A]]:', parts })

  it('adds lines under the anchor and the empty line below it, with its quote markers', () => {
    const once = insertEntries(note, '[!writing] Journaling', [a('S01E01 – one', 'S01E02 – two')])
    expect(once).toMatchObject({ added: 2, found: true })
    expect(once.text.split('\n')).toEqual(['# Monday', '> [!note] Day', '> >[!writing] Journaling', '> >', '> >- ▶️ [[A]]: S01E01 – one, S01E02 – two', '> > Had a nice day.', '', 'End'])
    // A later episode of the same show joins its line; another show gets a line after it.
    const twice = insertEntries(once.text, '[!writing] Journaling', [a('S01E02 – two', 'S01E03 – three'), { lead: '▶️ [[B]]:', parts: ['S01E01 – b'] }])
    expect(twice.added).toBe(2)
    expect(twice.text.split('\n').slice(3, 7)).toEqual(['> >', '> >- ▶️ [[A]]: S01E01 – one, S01E02 – two, S01E03 – three', '> >- ▶️ [[B]]: S01E01 – b', '> > Had a nice day.'])
    // Nothing new: left exactly as it was.
    expect(insertEntries(twice.text, '[!writing] Journaling', [a('S01E03 – three')])).toEqual({ text: twice.text, added: 0, found: true })
  })

  it('leaves a note without the anchor alone', () => {
    expect(insertEntries('# Nothing here', '[!writing] Journaling', [a('x')])).toEqual({ text: '# Nothing here', added: 0, found: false })
  })
})
