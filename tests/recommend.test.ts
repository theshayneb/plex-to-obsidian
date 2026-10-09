import { describe, expect, it } from 'vitest'
import { isOpen, recommend, type RecEntry } from '../src/recommend'

const entry = (over: Partial<RecEntry> & { id: string }): RecEntry => ({
  title: over.id, group: 'video', genres: [], people: [], level: null, unseen: false, ...over,
})

describe('recommendations', () => {
  const arrival = entry({ id: 'note:Arrival', title: 'Arrival', genres: ['Sci-Fi', 'Drama'], people: ['Denis Villeneuve'], level: 5 })
  const heat = entry({ id: 'note:Heat', title: 'Heat', genres: ['Crime'], people: ['Michael Mann'], level: 4 })
  const meh = entry({ id: 'note:Meh', genres: ['Sci-Fi'], level: 2 })
  const dune = entry({ id: 'note:Dune', title: 'Dune', genres: ['Sci-Fi', 'Adventure'], people: ['Denis Villeneuve'] })
  const collateral = entry({ id: 'item:7', title: 'Collateral', genres: ['Crime'], people: ['Michael Mann'], level: 3, unseen: true })
  const contact = entry({ id: 'note:Contact', title: 'Contact', genres: ['Sci-Fi'] })
  const book = entry({ id: 'note:Book', group: 'book', genres: ['Sci-Fi'], people: ['Denis Villeneuve'] })

  it('only suggests what has no rating or isn\'t watched yet, never what you loved', () => {
    expect([arrival, meh, dune, collateral].map(isOpen)).toEqual([false, false, true, true])
  })

  it('ranks by people in common first, then genres, within each kind of media, and says why', () => {
    const recs = recommend([arrival, heat, meh, dune, collateral, contact, book], new Set())
    expect(recs.video.map(r => r.entry.title)).toEqual(['Dune', 'Collateral', 'Contact'])
    expect(recs.video[0]).toMatchObject({ because: ['Arrival'], shared: ['Denis Villeneuve', 'Sci-Fi'] })
    // Nothing in Books was loved, so nothing is suggested there.
    expect(recs.book).toEqual([])
  })

  it('leaves out what you said you\'re not interested in', () => {
    const recs = recommend([arrival, dune, contact], new Set(['note:Dune']))
    expect(recs.video.map(r => r.entry.title)).toEqual(['Contact'])
  })
})
