import { describe, expect, it } from 'vitest'
import { addReaction, finishSeen, reactedSince, reactionLine, wordList } from '../src/reactions'

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

  it('tells whether a note already has a reaction from a day or later', () => {
    const lines = ['2026-10-01 · ⭐⭐⭐', '2026-11-05 · S02E01 – Title · happy']
    expect(reactedSince(lines, '2026-11-04')).toBe(true)
    expect(reactedSince(lines, '2026-11-05')).toBe(true)
    expect(reactedSince(lines, '2026-11-06')).toBe(false)
    expect(reactedSince('2026-11-05 · 🩷', '2026-11-05')).toBe(true)
    expect(reactedSince(undefined, '2026-11-05')).toBe(false)
  })

  it('remembers when each game was first seen in a finishing Steam collection', () => {
    // The first look: what's there is marked as already there.
    const first = finishSeen({ 'steam-1': 'completed' }, null, 100)
    expect(first).toEqual({ 'steam-1': { status: 'completed', at: 100, existing: true } })
    // Later: still there keeps its date; moved in gets this look's; taken out is forgotten.
    const second = finishSeen({ 'steam-1': 'Completed', 'steam-2': 'abandoned' }, first, 200)
    expect(second).toEqual({ 'steam-1': { status: 'completed', at: 100, existing: true }, 'steam-2': { status: 'abandoned', at: 200 } })
    expect(finishSeen({ 'steam-2': 'completed' }, second, 300)).toEqual({ 'steam-2': { status: 'completed', at: 300 } })
  })
})
