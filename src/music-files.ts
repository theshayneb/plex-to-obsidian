import { Platform } from 'obsidian'
import { decodeText, id3Size, readId3, type FileTags } from './id3'

interface NodeFs {
  existsSync(path: string): boolean
  readFileSync(path: string): Uint8Array
  openSync(path: string, flags: string): number
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number
  closeSync(fd: number): void
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
 * The lyrics in the text file beside a music file, named the same ("Song.mp3" → "Song.txt", or
 * "Song.lrc"), exactly as written there (only Windows line endings become plain ones). Desktop
 * only: null on phones or when there's no such file.
 */
export function readLyrics(musicPath: string): string | null {
  if (!Platform.isDesktopApp || !musicPath) return null
  const load = (window as unknown as { require?: (id: string) => unknown }).require
  const fs = load?.('fs') as NodeFs | undefined
  if (!fs) return null
  const base = musicPath.replace(/\.[^./\\]+$/, '')
  for (const ext of ['.txt', '.TXT', '.lrc', '.LRC']) {
    const path = base + ext
    try {
      if (!fs.existsSync(path)) continue
      const text = decodeText(fs.readFileSync(path)).replace(/\r\n?/g, '\n')
      return text.trim() ? text.replace(/\n+$/, '') : null
    } catch (err) {
      console.warn('Media Manager: could not read the lyrics in', path, err)
    }
  }
  return null
}
