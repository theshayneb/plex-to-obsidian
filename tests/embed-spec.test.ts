import { describe, expect, it } from 'vitest'
import { embedCode, readKind, readSpec } from '../src/embed-spec'

describe('embedded cards', () => {
  it('writes the code block a card is copied as, and reads it back', () => {
    const code = embedCode({ card: 'randomizer', kind: 'book' })
    expect(code).toBe('```media-manager\ncard: randomizer\nkind: book\n```\n')
    expect(readSpec(code.split('\n').slice(1, -2).join('\n'))).toEqual({ card: 'randomizer', kind: 'book' })
    expect(readSpec('  Card :  Habits \nkind:TV shows')).toEqual({ card: 'habits', kind: 'TV shows' })
  })

  it('reads a kind however it is written', () => {
    expect(['movie', 'Movies', 'TV', 'tv shows', 'tv_show', 'Documentaries', 'books', 'Video games', 'music', 'songs'].map(readKind))
      .toEqual(['movie', 'movie', 'tv', 'tv', 'tv', 'documentary', 'book', 'game', 'song', 'song'])
    expect(readKind('podcasts')).toBeNull()
  })
})
