// Reads the tags at the start of an MP3 file (ID3v2.2, 2.3 and 2.4). No Obsidian or Node imports,
// so it can be unit tested; `music-files.ts` does the file reading.

/** A file's tags: standard frames by ID ("TBPM"), your own by "TXXX:<name>" (lower case), comments as "COMM". */
export type FileTags = Record<string, string[]>

/** How many bytes the tag takes, header included, from its first 10 bytes; 0 when there's no ID3v2 tag. */
export function id3Size(header: Uint8Array): number {
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return 0
  return 10 + syncsafe(header, 6) + (header[5] & 0x10 ? 10 : 0)
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f)
}

function bigEndian(bytes: Uint8Array, at: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i]
  return value
}

/** Undoes "unsynchronisation": every 0xFF 0x00 becomes 0xFF. */
function resync(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i])
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++
  }
  return Uint8Array.from(out)
}

/** Text in one of ID3's encodings, split where a frame holds several values. */
function decode(bytes: Uint8Array, encoding: number): string[] {
  let text: string
  if (encoding === 1 || encoding === 2) {
    // UTF-16, with a byte order mark (1) or big-endian without one (2).
    let little = false
    let start = 0
    if (encoding === 1 && bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { little = true; start = 2 }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) start = 2
    }
    const units: number[] = []
    for (let i = start; i + 1 < bytes.length; i += 2) units.push(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1])
    text = String.fromCharCode(...units)
  } else if (encoding === 3) {
    text = new TextDecoder('utf-8').decode(bytes)
  } else {
    text = String.fromCharCode(...bytes)
  }
  // Several values are separated by nulls (UTF-16 ones too, once decoded); a BOM may start each one.
  return text.split('\u0000').map(v => v.replace(/^\uFEFF/, '').trim()).filter(Boolean)
}

/** Where a string ends in an encoding: the null (one byte, or two for UTF-16) after it. */
function textEnd(bytes: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2
  for (let i = from; i < bytes.length; i += wide ? 2 : 1) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return i
  }
  return bytes.length
}

/** Version 2.2's three-letter frame IDs, for the frames read here. */
const V22: Record<string, string> = { TBP: 'TBPM', TKE: 'TKEY', TCM: 'TCOM', TT1: 'TIT1', TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TCO: 'TCON', TXX: 'TXXX', COM: 'COMM' }

/** The tags in an ID3v2 tag (the bytes `id3Size` says it takes), or none if it can't be read. */
export function readId3(tag: Uint8Array): FileTags {
  const tags: FileTags = {}
  if (id3Size(tag) === 0) return tags
  const version = tag[3]
  const flags = tag[5]
  let body = tag.subarray(10, id3Size(tag) - (flags & 0x10 ? 10 : 0))
  if (version < 4 && flags & 0x80) body = resync(body)
  let at = 0
  if (flags & 0x40) at = version === 4 ? syncsafe(body, 0) : 4 + bigEndian(body, 0, 4)
  const idLength = version === 2 ? 3 : 4
  const header = version === 2 ? 6 : 10
  while (at + header <= body.length) {
    const rawId = String.fromCharCode(...body.subarray(at, at + idLength))
    if (!/^[A-Z0-9]+$/.test(rawId)) break
    const size = version === 2 ? bigEndian(body, at + 3, 3) : version === 4 ? syncsafe(body, at + 4) : bigEndian(body, at + 4, 4)
    const frameFlags = version === 2 ? 0 : bigEndian(body, at + 8, 2)
    let data = body.subarray(at + header, at + header + size)
    at += header + size
    if (version === 4) {
      // Compressed or encrypted frames are skipped; a data length indicator comes first.
      if (frameFlags & 0x000c) continue
      if (frameFlags & 0x0002) data = resync(data)
      if (frameFlags & 0x0001) data = data.subarray(4)
    } else if (frameFlags & 0x00c0) {
      continue
    }
    const id = version === 2 ? V22[rawId] : rawId
    if (!id || !data.length) continue
    const encoding = data[0]
    let key = id
    let values: string[]
    if (id === 'TXXX') {
      const end = textEnd(data, 1, encoding)
      key = `TXXX:${decode(data.subarray(1, end), encoding).join(' ').toLowerCase()}`
      values = decode(data.subarray(end + (encoding === 1 || encoding === 2 ? 2 : 1)), encoding)
    } else if (id === 'COMM') {
      const end = textEnd(data, 4, encoding)
      values = decode(data.subarray(end + (encoding === 1 || encoding === 2 ? 2 : 1)), encoding)
    } else if (id.startsWith('T')) {
      values = decode(data.subarray(1), encoding)
    } else {
      continue
    }
    if (values.length) tags[key] = [...tags[key] ?? [], ...values]
  }
  return tags
}

/** Friendly names for the standard frames. */
const FRAME_NAMES: Record<string, string> = {
  tempo: 'TBPM', bpm: 'TBPM', key: 'TKEY', mood: 'TMOO', composer: 'TCOM', grouping: 'TIT1', comment: 'COMM',
}

/**
 * A tag's value by the name you'd see in a tag editor: a frame ID ("TBPM"), your own tag's name
 * ("songs-db_tempo", also written "TXXX/Mood" or "TXXX:Mood"), or a friendly name ("Tempo").
 * Your own tags come first. A number stays a number; several values make a list.
 */
export function tagValue(tags: FileTags, name: string): string | number | string[] | undefined {
  const wanted = name.trim().replace(/^TXXX[/:]/i, '')
  if (!wanted) return undefined
  const values = tags[`TXXX:${wanted.toLowerCase()}`]
    ?? (/^[A-Z0-9]{4}$/.test(wanted) ? tags[wanted] : undefined)
    ?? tags[FRAME_NAMES[wanted.toLowerCase()] ?? '']
  if (!values?.length) return undefined
  if (values.length > 1) return values
  const [value] = values
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value
}

/** A text file's text: UTF-16 (with its byte order mark) or UTF-8, else the Windows character set. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}
