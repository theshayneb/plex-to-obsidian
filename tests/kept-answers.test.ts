import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeAnswers } from '../src/config'

describe('mergeAnswers', () => {
  it('keeps answers an older copy of the settings left out, and drops offers now refused', () => {
    const settings = defaultSettings()
    settings.relatedDeclined = ['Daily/2026-10-31.md|show']
    settings.reactionsDone = { '1@2026-11-04': 5 }
    settings.relatedPending = [
      { path: 'Daily/2026-10-30.md', link: '[[Movie]]', title: 'Movie', kind: 'movie', viewedAt: 1 },
      { path: 'Daily/2026-11-05.md', link: '[[Movie]]', title: 'Movie', kind: 'movie', viewedAt: 2 },
    ]
    expect(mergeAnswers(settings, { relatedDeclined: ['Daily/2026-10-30.md|movie', 'Daily/2026-10-31.md|show'], reactionsDone: { '2@2026-11-05': 6, '1@2026-11-04': 9 } })).toBe(true)
    expect(settings.relatedDeclined).toEqual(['Daily/2026-10-31.md|show', 'Daily/2026-10-30.md|movie'])
    expect(settings.reactionsDone).toEqual({ '1@2026-11-04': 5, '2@2026-11-05': 6 })
    expect(settings.relatedPending.map(o => o.path)).toEqual(['Daily/2026-11-05.md'])
    expect(mergeAnswers(settings, { relatedDeclined: ['Daily/2026-10-30.md|movie'] })).toBe(false)
    expect(mergeAnswers(settings, null)).toBe(false)
  })
})
