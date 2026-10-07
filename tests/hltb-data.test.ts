import { describe, expect, it } from 'vitest'
import { hltbMinutes, hltbTimes, pickMatch, searchBody, searchTitle, type HltbGame } from '../src/hltb-data'

const results: HltbGame[] = [
  { game_id: 2, game_name: 'Portal 2: Peer Review', release_world: 2011, comp_main: 11784 },
  { game_id: 1, game_name: 'Portal 2', release_world: 2011, comp_main: 30885, game_image: 'Portal2cover.jpg' },
  { game_id: 3, game_name: 'DOOM', release_world: 1993 },
  { game_id: 4, game_name: 'DOOM', release_world: 2016, game_alias: 'Doom 4' },
]

describe('HowLongToBeat', () => {
  it('searches without trademark signs', () => {
    expect(searchTitle('Portal™ 2®')).toBe('Portal 2')
    expect(searchBody('Portal 2').searchTerms).toEqual(['Portal', '2'])
  })

  it('only takes a game with the same name, preferring the same year', () => {
    expect(pickMatch(results, 'Portal 2')?.game_id).toBe(1)
    expect(pickMatch(results, 'DOOM', 2016)?.game_id).toBe(4)
    expect(pickMatch(results, 'Doom 4')?.game_id).toBe(4)
    expect(pickMatch(results, 'DOOM')?.game_id).toBe(3)
    expect(pickMatch(results, 'Portal')).toBeNull()
  })

  it('turns seconds into minutes, with links', () => {
    expect(hltbMinutes(30885)).toBe(515)
    expect(hltbMinutes(0)).toBeUndefined()
    expect(hltbTimes(results[1])).toEqual({
      id: 1, name: 'Portal 2', main: 515,
      url: 'https://howlongtobeat.com/game/1', image: 'https://howlongtobeat.com/games/Portal2cover.jpg',
    })
  })
})
