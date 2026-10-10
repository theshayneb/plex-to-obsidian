import { describe, expect, it } from 'vitest'
import { id3Size, readId3, tagValue } from '../src/id3'

const latin = (text: string) => [...text].map(c => c.charCodeAt(0))
const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const big = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** An ID3 tag of these frames (id, content bytes), version 3 or 4, with some padding. */
function tag(version: 3 | 4, frames: [string, number[]][]): Uint8Array {
  const body = frames.flatMap(([id, data]) => [...latin(id), ...(version === 4 ? syncsafe(data.length) : big(data.length)), 0, 0, ...data])
  const padded = [...body, ...new Array(16).fill(0)]
  return Uint8Array.from([...latin('ID3'), version, 0, 0, ...syncsafe(padded.length), ...padded])
}

describe('MP3 tags', () => {
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
