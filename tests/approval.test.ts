import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => ({ Modal: class {}, Setting: class {}, FuzzySuggestModal: class {}, AbstractInputSuggest: class {} }))

const { describeValue, editKind, parseEdit } = await import('../src/approval-modal')

describe('editing values in the approval pop-up', () => {
  it('knows how each value is edited', () => {
    expect(editKind(['a'])).toBe('list')
    expect(editKind(116)).toBe('number')
    expect(editKind('text')).toBe('text')
    expect(editKind(null)).toBe('text')
  })

  it('turns edits back into property values', () => {
    expect(parseEdit(['Crime'], 'list')).toEqual(['Crime'])
    expect(parseEdit(' Crime,  Drama ,', 'list')).toEqual(['Crime', 'Drama'])
    expect(parseEdit(' 12 ', 'number')).toBe(12)
    expect(parseEdit('about 12', 'number')).toBe('about 12')
    expect(parseEdit('  ', 'text')).toBeNull()
    expect(parseEdit(' Hello ', 'text')).toBe('Hello')
  })

  it('shows values, with null for empty', () => {
    expect(describeValue(['a', 'b'])).toBe('a, b')
    expect(describeValue([])).toBeNull()
    expect(describeValue('')).toBeNull()
    expect(describeValue(0)).toBe('0')
  })
})
