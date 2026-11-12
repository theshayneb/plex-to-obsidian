import { describe, expect, it } from 'vitest'
import { cleanTag, fileTagList, isSongTagsRow, songTagDiff, unionTags } from '../src/song-tags'
import { buildFrontmatter } from '../src/properties'

describe('song tags', () => {
  it('cleans tags as Music Manager does and reads a file\'s list', () => {
    expect(cleanTag(' #Found family ')).toBe('Found-family')
    expect(fileTagList(['feminism', '#holiday; comfort', 'Feminism'])).toEqual(['feminism', 'holiday', 'comfort'])
    expect(fileTagList(undefined)).toEqual([])
  })

  it('tells which tags are only in the file and only in the note, type tags aside', () => {
    const types = new Set(['music', 'song'])
    expect(songTagDiff(['music', 'Holiday', 'comfort'], ['comfort', 'feminism'], types)).toEqual({ toNote: ['feminism'], toFile: ['Holiday'] })
    expect(songTagDiff('music, comfort', ['Comfort'], types)).toEqual({ toNote: [], toFile: [] })
  })

  it('knows a song tags row and adds lists together', () => {
    expect(isSongTagsRow({ name: 'tags', source: 'fileTag', text: 'Obsidian Tags' })).toBe(true)
    expect(isSongTagsRow({ name: 'tags', source: 'fileTag' })).toBe(false)
    expect(isSongTagsRow({ name: 'Tempo', source: 'fileTag', text: 'TEMPO' })).toBe(false)
    expect(unionTags(['music'], ['Music', 'holiday'])).toEqual(['music', 'holiday'])
  })

  it('gives a new song note its type tag and its file\'s tags in one list', () => {
    const item = { ratingKey: '1', type: 'track', title: 'Girls', fileTags: { 'TXXX:obsidian tags': ['feminism', 'holiday'] } }
    const fm = buildFrontmatter(item as never, [{ name: 'tags', source: 'typeTag' }, { name: 'tags', source: 'fileTag', text: 'Obsidian Tags' }], { kind: 'music', link: '', image: null, values: { watched: '', started: '', unwatched: '', tag: 'music' } } as never)
    expect(fm.tags).toEqual(['music', 'feminism', 'holiday'])
  })

  it('gives a new song note its type tag even when only the file\'s tags have a row', () => {
    const item = { ratingKey: '1', type: 'track', title: 'Girls', fileTags: { 'TXXX:obsidian tags': ['feminism'] } }
    const fm = buildFrontmatter(item as never, [{ name: 'tags', source: 'fileTag', text: 'Obsidian Tags' }], { kind: 'music', link: '', image: null, values: { watched: '', started: '', unwatched: '', tag: 'song' } } as never)
    expect(fm.tags).toEqual(['song', 'feminism'])
  })
})
