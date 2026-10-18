import { describe, expect, it } from 'vitest'
import { ANY_FILTER, fits, parseLength, pickChoices, pickOne, type PickEntry } from '../src/randomizer'

const movie = (title: string, more: Partial<PickEntry> = {}): PickEntry => ({ path: `Movies/${title}.md`, title, kind: 'movie', genres: [], status: '', tags: [], ...more })

describe('randomizer', () => {
  it('reads lengths written as minutes, text or a clock', () => {
    expect(parseLength(105)).toBe(105)
    expect(parseLength('105')).toBe(105)
    expect(parseLength('1h 52m')).toBe(112)
    expect(parseLength('1 hr 45 min')).toBe(105)
    expect(parseLength('2 hours')).toBe(120)
    expect(parseLength('95 min')).toBe(95)
    expect(parseLength('1:45')).toBe(105)
    expect(parseLength('1:45:00')).toBe(105)
    expect(parseLength('soon')).toBeUndefined()
    expect(parseLength('')).toBeUndefined()
    expect(parseLength(undefined)).toBeUndefined()
  })

  it('finds a comedy under two hours, never seen, tagged holiday', () => {
    const elf = movie('Elf', { genres: ['Comedy', 'Fantasy'], status: 'pending', length: 97, tags: ['holiday'] })
    const long = movie('Love Actually', { genres: ['Comedy'], status: 'pending', length: 135, tags: ['holiday'] })
    const seen = movie('Home Alone', { genres: ['Comedy'], status: 'completed', length: 103, tags: ['Holiday'] })
    const noLength = movie('Scrooged', { genres: ['comedy'], status: 'Pending', tags: ['holiday'] })
    const filter = { genre: 'Comedy', status: 'pending', length: '120', tag: 'holiday' }
    expect([elf, long, seen, noLength].filter(e => fits(e, filter)).map(e => e.title)).toEqual(['Elf'])
    // Without a length choice, case doesn't matter and a missing length is fine.
    expect([elf, long, seen, noLength].filter(e => fits(e, { ...filter, length: '' })).map(e => e.title)).toEqual(['Elf', 'Love Actually', 'Scrooged'])
    expect([elf, long, seen, noLength].filter(e => fits(e, ANY_FILTER))).toHaveLength(4)
  })

  it('offers the genres, statuses and tags the notes have, most common first', () => {
    const choices = pickChoices([
      movie('A', { genres: ['Comedy', 'Drama'], status: 'pending', tags: ['holiday'] }),
      movie('B', { genres: ['comedy'], status: 'completed', tags: ['comfort', 'holiday'] }),
      movie('C', { genres: ['Horror'], status: 'pending' }),
    ])
    expect(choices).toEqual({ genres: ['Comedy', 'Drama', 'Horror'], statuses: ['pending', 'completed'], tags: ['holiday', 'comfort'] })
  })

  it('picks at random, never the same one twice in a row when there are others', () => {
    const list = [movie('A'), movie('B')]
    expect(pickOne(list, 'Movies/A.md', () => 0)?.title).toBe('B')
    expect(pickOne([movie('A')], 'Movies/A.md', () => 0)?.title).toBe('A')
    expect(pickOne([], undefined)).toBeUndefined()
  })
})
