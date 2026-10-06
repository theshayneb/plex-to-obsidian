import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => ({ AbstractInputSuggest: class {} }))

const { matchPropertyNames, vaultPropertyNames } = await import('../src/property-suggest')

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
