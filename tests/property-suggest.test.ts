import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => ({ AbstractInputSuggest: class {} }))

const { matchPropertyNames, matchValues, vaultPropertyNames, vaultPropertyValues } = await import('../src/property-suggest')

describe('vaultPropertyNames', () => {
  it('lists every property name in the vault, most used first', () => {
    const notes: Record<string, unknown>[] = [
      { tags: [], Genre: [], position: {} },
      { tags: [], Rating: 3 },
      { tags: [], Genre: [] },
      {},
    ]
    const app = {
      vault: { getMarkdownFiles: () => notes.map((_, i) => ({ path: `${i}.md` })) },
      metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: notes[parseInt(f.path)] }) },
    }
    expect(vaultPropertyNames(app as never)).toEqual(['tags', 'Genre', 'Rating'])
  })
})

describe('matchPropertyNames', () => {
  const names = ['tags', 'Genre', 'Rating', 'My rating', 'aliases']
  it('puts names starting with the query first, then ones containing it', () => {
    expect(matchPropertyNames(names, 'rat')).toEqual(['Rating', 'My rating'])
    expect(matchPropertyNames(names, 'A')).toEqual(['aliases', 'tags', 'Rating', 'My rating'])
  })
  it('lists everything for an empty query', () => {
    expect(matchPropertyNames(names, ' ')).toEqual(names)
  })
})

describe('vaultPropertyValues', () => {
  it('lists each property\'s values across the vault, list items one by one, most used first', () => {
    const notes: Record<string, unknown>[] = [
      { Genre: ['Drama', 'Thriller'], Status: 'Watched', Duration: 120 },
      { genre: ['Drama'], Status: 'Not watched', Summary: 'Line one\nline two' },
      { Genre: 'Comedy', Status: 'Watched' },
    ]
    const app = {
      vault: { getMarkdownFiles: () => notes.map((_, i) => ({ path: `${i}.md` })) },
      metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: notes[parseInt(f.path)] }) },
    }
    const values = vaultPropertyValues(app as never)
    expect(values.get('genre')).toEqual(['Drama', 'Comedy', 'Thriller'])
    expect(values.get('status')).toEqual(['Watched', 'Not watched'])
    expect(values.get('duration')).toEqual([])
    expect(values.get('summary')).toEqual([])
  })
})

describe('matchValues', () => {
  it('offers matching values, leaving out ones already chosen and the exact text typed', () => {
    const values = ['Drama', 'Science Fiction', 'Comedy', 'Dramedy']
    expect(matchValues(values, 'dra')).toEqual(['Drama', 'Dramedy'])
    expect(matchValues(values, 'fi')).toEqual(['Science Fiction'])
    expect(matchValues(values, '', ['drama'])).toEqual(['Science Fiction', 'Comedy', 'Dramedy'])
    expect(matchValues(values, 'Comedy')).toEqual([])
  })
})
