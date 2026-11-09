import { Platform } from 'obsidian'
import { id3Size, readId3, setOwnTag, tagValue, type FileTags } from './id3'

interface NodeFs {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
  openSync(path: string, flags: string): number
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number
  writeFileSync(path: string, data: Uint8Array): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
}

function nodeFs(): NodeFs | null {
  if (!Platform.isDesktopApp) return null
  const load = (window as unknown as { require?: (id: string) => unknown }).require
  return (load?.('fs') as NodeFs | undefined) ?? null
}

/** Tags bigger than this (a large cover picture, say) are read only this far. */
const MAX_TAG = 8 * 1024 * 1024

/**
 * The tags of a music file on this computer, from the ID3 tag at its start (only that part is
 * read). Desktop only: null on phones, when the file can't be read, or when it has no tag.
 */
export function readFileTags(path: string): FileTags | null {
  if (!Platform.isDesktopApp || !path) return null
  const load = (window as unknown as { require?: (id: string) => unknown }).require
  const fs = load?.('fs') as NodeFs | undefined
  if (!fs) return null
  let fd: number | null = null
  try {
    fd = fs.openSync(path, 'r')
    const header = new Uint8Array(10)
    if (fs.readSync(fd, header, 0, 10, 0) < 10) return null
    const size = Math.min(id3Size(header), MAX_TAG)
    if (!size) return null
    const tag = new Uint8Array(size)
    fs.readSync(fd, tag, 0, size, 0)
    return readId3(tag)
  } catch (err) {
    console.warn('Media Manager: could not read the tags of', path, err)
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/**
 * A song's lyrics, from its music file's own lyrics tag (ID3's unsynchronised lyrics, the first
 * one when there are several), line endings made plain and blank lines at the end left off.
 */
export function lyricsOf(tags: FileTags | null): string | null {
  const text = tags?.USLT?.[0]?.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  return text ? text : null
}

type TagRead = string | number | string[] | undefined
const tagText = (value: TagRead): string => (Array.isArray(value) ? value.join('; ') : String(value ?? '')).trim()
const same = (a: TagRead, b: string | string[]): boolean => tagText(a) === tagText(b)

/**
 * Puts `value` in your own tag `name` (an existing TXXX tag) of a music file on this computer,
 * changing only the bytes of the tag that differ, in the same file (never a copy). `expected` is
 * the value read before: when the file holds something else now, nothing is written. A list is
 * written as several values; with `create`, a tag the file lacks is added (when there's room).
 * Returns why it wasn't written, or null when it was.
 */
export function writeOwnTag(path: string, name: string, value: string | string[], expected: string | string[], create = false): string | null {
  const fs = nodeFs()
  if (!fs || !path) return 'music files can only be changed on the computer Plex runs on'
  let fd: number | null = null
  try {
    fd = fs.openSync(path, 'r+')
    const header = new Uint8Array(10)
    if (fs.readSync(fd, header, 0, 10, 0) < 10) return 'the file has no tag'
    const size = id3Size(header)
    if (!size) return 'the file has no tag'
    const tag = new Uint8Array(size)
    if (fs.readSync(fd, tag, 0, size, 0) < size) return 'the tag couldn\'t be read'
    const now = tagValue(readId3(tag), name)
    if (!same(now, expected)) return `the file's ${name} has changed since it was read (it's now "${tagText(now)}")`
    const edit = setOwnTag(tag, name, value, create)
    if ('error' in edit) return edit.error
    if (edit.to > edit.from) {
      fs.writeSync(fd, edit.tag, edit.from, edit.to - edit.from, edit.from)
      fs.fsyncSync(fd)
    }
    const check = new Uint8Array(size)
    fs.readSync(fd, check, 0, size, 0)
    if (!same(tagValue(readId3(check), name), value)) return 'the new value couldn\'t be read back'
    return null
  } catch (err) {
    console.warn('Media Manager: could not write the tags of', path, err)
    return err instanceof Error ? err.message : String(err)
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}
