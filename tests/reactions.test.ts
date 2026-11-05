import { describe, expect, it } from 'vitest'
import { addReaction, reactionLine, wordList } from '../src/reactions'

const names = { reactions: 'Reactions', feelings: 'Feelings', themes: 'Themes', rating: 'Rating' }

describe('reactions', () => {
  it('writes a reaction as one line, leaving out what was skipped', () => {
    expect(reactionLine({ date: '2026-10-16', rating: '🩷', feelings: ['moved', 'happy'], themes: [], tags: [], text: ' cried at the\nend ' }))
      .toBe('2026-10-16 · 🩷 · moved, happy · cried at the end')
    expect(reactionLine({ date: '2026-10-16', feelings: [], themes: [], tags: [] })).toBe('2026-10-16')
  })

  it('names a TV show\'s episodes in place of the rating', () => {
    const r = { date: '2026-11-04', rating: '⭐⭐⭐⭐', feelings: ['entertained', 'happy'], themes: [], tags: [], text: 'Just as strong!' }
    expect(reactionLine({ ...r, episodes: 'S02E01 – The Return' })).toBe('2026-11-04 · S02E01 – The Return · entertained, happy · Just as strong!')
    expect(reactionLine({ ...r, episodes: '' })).toBe('2026-11-04 · entertained, happy · Just as strong!')
    const fm: Record<string, unknown> = {}
    addReaction(fm, { ...r, episodes: 'S02E01 – The Return' }, names)
    expect(fm.Rating).toBe('⭐⭐⭐⭐')
  })

  it('adds to what the note has, never removing anything', () => {
    const fm: Record<string, unknown> = { Reactions: '2020-01-01 · ⭐⭐⭐', Feelings: ['Moved'], Themes: ['loyalty'], tags: ['movie'], Rating: '⭐⭐⭐' }
    addReaction(fm, { date: '2026-10-16', rating: '🩷', feelings: ['moved', 'sad'], themes: ['chosen family'], tags: ['#comfort'], text: 'better the second time' }, names)
    expect(fm).toEqual({
      Reactions: ['2020-01-01 · ⭐⭐⭐', '2026-10-16 · 🩷 · moved, sad · better the second time'],
      Feelings: ['Moved', 'sad'],
      Themes: ['loyalty', 'chosen family'],
      tags: ['movie', 'comfort'],
      Rating: '🩷',
    })
    // No rating picked: the note's stays.
    addReaction(fm, { date: '2026-10-17', feelings: [], themes: [], tags: [] }, names)
    expect(fm.Rating).toBe('🩷')
    expect(fm.Reactions).toHaveLength(3)
  })

  it('reads the settings\' word lists', () => {
    expect(wordList('moved\n sad, happy\n\nMoved')).toEqual(['moved', 'sad', 'happy'])
  })
})
