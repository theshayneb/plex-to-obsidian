import { describe, expect, it } from 'vitest'
import { matchNotes, openLink, putLink } from '../src/link-text'

describe('typing a link', () => {
  it('finds the open [[ before the cursor', () => {
    expect(openLink('Watched with [[mom', 18)).toEqual({ start: 13, query: 'mom' })
    expect(openLink('Watched with [[Mom]] again', 26)).toBeNull()
    expect(openLink('no link', 7)).toBeNull()
  })
  it('puts the picked note in, closing the link', () => {
    expect(putLink('Watched with [[mom', 18, 'Mom')).toEqual({ text: 'Watched with [[Mom]]', caret: 20 })
    expect(putLink('with [[mo]] and', 9, 'Mom')).toEqual({ text: 'with [[Mom]] and', caret: 12 })
  })
  it('lists notes starting with what is typed first', () => {
    const notes = [{ basename: 'Grandmom' }, { basename: 'Mom' }, { basename: 'Mom and Dad' }, { basename: 'Dad' }]
    expect(matchNotes(notes, 'mom').map(n => n.basename)).toEqual(['Mom', 'Mom and Dad', 'Grandmom'])
  })
})
