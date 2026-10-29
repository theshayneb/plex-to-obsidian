import { describe, expect, it } from 'vitest'
import { collectionChanges, parseCollectionRules, wantedCollections, type CollectionNote } from '../src/collections'

const note = (key: string, over: Partial<CollectionNote> = {}): CollectionNote => ({ path: `Movies/${key}.md`, title: `Movie ${key}`, key, section: '1', collections: [], tags: [], ...over })

describe('Plex collections from notes', () => {
  it('reads "Name: tag" rules', () => {
    expect(parseCollectionRules('Comfort: comfort\n\nHoliday movies: #holiday\ncozy\ncomfort: other')).toEqual([
      { name: 'Comfort', tag: 'comfort' }, { name: 'Holiday movies', tag: 'holiday' }, { name: 'cozy', tag: 'cozy' },
    ])
  })

  it('gathers each named collection and each rule\'s tag, per library, any case', () => {
    const notes = [
      note('1', { collections: ['Heists'], tags: ['comfort', 'movie'] }),
      note('2', { collections: ['heists', 'Faves'] }),
      note('3', { tags: ['#Comfort'] }),
      note('4', { section: '2', collections: ['Heists'] }),
    ]
    const rules = parseCollectionRules('Comfort: comfort')
    const all = wantedCollections(notes, rules).map(c => [c.section, c.name, c.keys, c.auto])
    expect(all).toEqual([
      ['1', 'Comfort', ['1', '3'], true],
      ['1', 'Faves', ['2'], false],
      ['1', 'Heists', ['1', '2'], false],
      ['2', 'Heists', ['4'], false],
    ])
    expect(wantedCollections(notes, rules, false, true).map(c => c.name)).toEqual(['Comfort'])
    expect(wantedCollections(notes, rules, true, false).map(c => c.name)).toEqual(['Faves', 'Heists', 'Heists'])
  })

  it('works out what to add and remove', () => {
    expect(collectionChanges(['1', '2', '3'], ['3', '4'])).toEqual({ add: ['1', '2'], remove: ['4'] })
  })
})
