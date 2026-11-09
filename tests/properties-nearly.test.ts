import { describe, expect, it } from 'vitest'
import { nearlySame } from '../src/properties'
import { pickMatch } from '../src/hltb-data'

describe('nearlySame', () => {
  it('leaves small drifts in lengths and page counts alone, in the same form only', () => {
    expect(nearlySame('hltbMain', 720, 750)).toBe(true)
    expect(nearlySame('hltbMain', 720, 900)).toBe(false)
    expect(nearlySame('pages', 320, 330)).toBe(true)
    expect(nearlySame('pages', '320', 410)).toBe(false)
    expect(nearlySame('durationMinutes', 116, 118)).toBe(true)
    // Hours for minutes is a different form: still offered.
    expect(nearlySame('durationMinutes', 2, 118)).toBe(false)
    expect(nearlySame('durationText', '12h 30m', '13h')).toBe(true)
    expect(nearlySame('genres', ['a'], ['b'])).toBe(false)
  })
})

describe('pickMatch', () => {
  it('picks the same game whatever order the results come in', () => {
    const a = { game_id: 20, game_name: 'Doom', release_world: 2016 }
    const b = { game_id: 10, game_name: 'Doom', release_world: 1993 }
    const c = { game_id: 5, game_name: 'Doom Eternal', game_alias: 'Doom', release_world: 2020 }
    expect(pickMatch([a, b, c], 'Doom')?.game_id).toBe(10)
    expect(pickMatch([c, b, a], 'Doom')?.game_id).toBe(10)
    expect(pickMatch([b, a], 'Doom', 2016)?.game_id).toBe(20)
    expect(pickMatch([a, b], 'Doom', 2017)?.game_id).toBe(20)
  })
})
