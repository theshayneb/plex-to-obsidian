import { describe, expect, it } from 'vitest'
import { decodeText, encodeTextFile, id3Size, readId3, setOwnTag, tagValue, textForm } from '../src/id3'

const latin = (text: string) => [...text].map(c => c.charCodeAt(0))
const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const big = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** An ID3 tag of these frames (id, content bytes), version 3 or 4, with some padding. */
function tag(version: 3 | 4, frames: [string, number[]][], padding = 16): Uint8Array {
  const body = frames.flatMap(([id, data]) => [...latin(id), ...(version === 4 ? syncsafe(data.length) : big(data.length)), 0, 0, ...data])
  const padded = [...body, ...new Array(padding).fill(0)]
  return Uint8Array.from([...latin('ID3'), version, 0, 0, ...syncsafe(padded.length), ...padded])
}

describe('MP3 tags', () => {
  it('reads a song\'s lyrics tag, its lines kept (old Mac and Windows line endings made plain)', () => {
    const v3 = readId3(tag(3, [['USLT', [0, ...latin('eng'), 0, ...latin('Karma police\rArrest this man\r\n\r\nHe talks in maths')]]]))
    expect(v3.USLT).toEqual(['Karma police\nArrest this man\n\nHe talks in maths'])
    const v4 = readId3(tag(4, [['USLT', [1, ...latin('eng'), ...utf16('Lyrics'), 0, 0, ...utf16('Déjà vu\nAgain')]]]))
    expect(v4.USLT).toEqual(['Déjà vu\nAgain'])
  })

  it('reads standard and your own tags (ID3v2.3, Latin-1 and UTF-16)', () => {
    const bytes = tag(3, [
      ['TIT2', [0, ...latin('Aurora')]],
      ['TBPM', [0, ...latin('118')]],
      ['TXXX', [0, ...latin('songs-db_tempo'), 0, ...latin('Medium')]],
      ['TXXX', [1, ...utf16('Mood'), 0, 0, ...utf16('Dreamy')]],
      ['COMM', [0, ...latin('eng'), 0, ...latin('Great live')]],
    ])
    expect(id3Size(bytes.subarray(0, 10))).toBe(bytes.length)
    const tags = readId3(bytes)
    expect(tags).toMatchObject({ TIT2: ['Aurora'], TBPM: ['118'], 'TXXX:songs-db_tempo': ['Medium'], 'TXXX:mood': ['Dreamy'], COMM: ['Great live'] })
    expect(tagValue(tags, 'songs-db_tempo')).toBe('Medium')
    expect(tagValue(tags, 'TXXX/Mood')).toBe('Dreamy')
    expect(tagValue(tags, 'Mood')).toBe('Dreamy')
    expect(tagValue(tags, 'TBPM')).toBe(118)
    expect(tagValue(tags, 'Tempo')).toBe(118)
    expect(tagValue(tags, 'Comment')).toBe('Great live')
    expect(tagValue(tags, 'Nope')).toBeUndefined()
  })

  it('reads ID3v2.4 tags in UTF-8, several values making a list', () => {
    const encoder = new TextEncoder()
    const tags = readId3(tag(4, [
      ['TXXX', [3, ...encoder.encode('Mood'), 0, ...encoder.encode('Happy'), 0, ...encoder.encode('Energetic')]],
      ['TXXX', [3, ...encoder.encode('songs-db_tempo'), 0, ...encoder.encode('124')]],
    ]))
    expect(tagValue(tags, 'Mood')).toEqual(['Happy', 'Energetic'])
    expect(tagValue(tags, 'songs-db_tempo')).toBe(124)
  })

  it('gives nothing for a file without a tag', () => {
    expect(id3Size(Uint8Array.from(latin('RIFF......')))).toBe(0)
    expect(readId3(Uint8Array.from(latin('nothing here')))).toEqual({})
  })
})

describe('changing your own tag', () => {
  const frames = (tempo: number[]): [string, number[]][] => [
    ['TIT2', [0, ...latin('Aurora')]],
    ['TXXX', tempo],
    ['APIC', [0, ...latin('image/jpeg'), 0, 3, 0, 1, 2, 3, 4, 5]],
  ]
  const edited = (result: ReturnType<typeof setOwnTag>) => {
    if ('error' in result) throw new Error(result.error)
    return result
  }

  it('changes the value in place, the tag keeping its size and the frames after it', () => {
    const before = tag(3, frames([0, ...latin('TEMPO'), 0, ...latin('Slow')]))
    const longer = edited(setOwnTag(before, 'TXXX/TEMPO', 'Very Fast'))
    expect(longer.tag.length).toBe(before.length)
    expect(id3Size(longer.tag)).toBe(id3Size(before))
    expect(readId3(longer.tag)).toEqual({ ...readId3(before), 'TXXX:tempo': ['Very Fast'] })
    // Only the stretch from the frame on changed.
    expect(longer.from).toBeGreaterThan(20)
    const shorter = edited(setOwnTag(longer.tag, 'tempo', 'Slow'))
    expect([...shorter.tag]).toEqual([...before])
  })

  it('keeps UTF-16 and ID3v2.4', () => {
    const before = tag(4, frames([1, ...utf16('TEMPO'), 0, 0, ...utf16('Moderate')]))
    const after = edited(setOwnTag(before, 'TEMPO', 'Very Slow')).tag
    expect(readId3(after)['TXXX:tempo']).toEqual(['Very Slow'])
    expect(readId3(after).TIT2).toEqual(['Aurora'])
  })

  it('writes a list of tags, one value each, and adds the tag when the file has none', () => {
    const before = tag(3, frames([1, ...utf16('Obsidian Tags'), 0, 0, ...utf16('comfort')]), 64)
    const listed = edited(setOwnTag(before, 'Obsidian Tags', ['comfort', 'holiday']))
    expect(readId3(listed.tag)['TXXX:obsidian tags']).toEqual(['comfort', 'holiday'])
    expect(listed.tag.length).toBe(before.length)
    // A file without the tag: refused unless asked to add it, then added after the other frames.
    const without = tag(3, [['TIT2', [0, ...latin('Aurora')]]], 80)
    expect(setOwnTag(without, 'Obsidian Tags', ['feminism'])).toEqual({ error: 'there\'s no Obsidian Tags tag in the file' })
    const added = edited(setOwnTag(without, 'Obsidian Tags', ['feminism', 'holiday'], true))
    expect(readId3(added.tag)).toEqual({ TIT2: ['Aurora'], 'TXXX:obsidian tags': ['feminism', 'holiday'] })
    expect(added.tag.length).toBe(without.length)
    // Not enough room for it: refused.
    expect(setOwnTag(tag(3, [['TIT2', [0, ...latin('Aurora')]]]), 'Obsidian Tags', ['a-very-long-tag-name-that-does-not-fit'], true)).toEqual({ error: 'there\'s no room left in the tag' })
  })

  it('refuses when there is no room, no such tag, or two of them', () => {
    const full = tag(3, frames([0, ...latin('TEMPO'), 0, ...latin('Slow')]))
    expect(setOwnTag(full, 'TEMPO', 'Very Fast and then some more words')).toEqual({ error: 'there\'s no room left in the tag' })
    expect(setOwnTag(full, 'Mood', 'Happy')).toEqual({ error: 'there\'s no Mood tag in the file' })
    const twice = tag(3, [['TXXX', [0, ...latin('TEMPO'), 0, ...latin('Slow')]], ['TXXX', [0, ...latin('tempo'), 0, ...latin('Fast')]]])
    expect(setOwnTag(twice, 'TEMPO', 'Fast')).toEqual({ error: 'there are two TEMPO tags' })
  })
})

describe('lyrics files', () => {
  it('writes a new text the way the file was written', () => {
    const windows = Uint8Array.from([...latin('Caf'), 0xe9, 0x0d, 0x0a, ...latin('two'), 0x0d, 0x0a])
    const form = textForm(windows)
    expect(form).toEqual({ encoding: 'windows-1252', crlf: true, finalNewline: true })
    expect([...encodeTextFile('Café\nthree', form)!]).toEqual([...latin('Caf'), 0xe9, 0x0d, 0x0a, ...latin('three'), 0x0d, 0x0a])
    expect(encodeTextFile('日本', form)).toBeNull()
    const wide = textForm(Uint8Array.from(utf16('Hi')))
    expect(decodeText(encodeTextFile('Hé\nyo', wide)!)).toBe('Hé\nyo')
    expect(textForm(new TextEncoder().encode('a\nb')).encoding).toBe('utf-8')
  })


  it('reads UTF-8, UTF-16 and Windows text', () => {
    expect(decodeText(new TextEncoder().encode('\uFEFFCafé\nline'))).toBe('Café\nline')
    expect(decodeText(Uint8Array.from([0xff, 0xfe, 0x48, 0, 0x69, 0]))).toBe('Hi')
    expect(decodeText(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café')
  })
})
