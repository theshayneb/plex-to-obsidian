// Pure helpers for turning Plex items into notes. No Obsidian imports, so they can be unit tested.

export type MediaKind = 'movie' | 'tv' | 'documentary'
export type LibraryTarget = MediaKind | 'skip'

export interface PlexTag {
  tag: string
}

export interface PlexItem {
  ratingKey: string
  type: string
  title: string
  year?: number
  summary?: string
  originallyAvailableAt?: string
  duration?: number
  viewCount?: number
  leafCount?: number
  viewedLeafCount?: number
  thumb?: string
  tagline?: string
  originalTitle?: string
  contentRating?: string
  studio?: string
  rating?: number
  audienceRating?: number
  userRating?: number
  addedAt?: number
  lastViewedAt?: number
  childCount?: number
  Genre?: PlexTag[]
  Director?: PlexTag[]
  Writer?: PlexTag[]
  Role?: PlexTag[]
  Country?: PlexTag[]
  Collection?: PlexTag[]
  Label?: PlexTag[]
  Guid?: { id: string }[]
}

export function genresOf(item: PlexItem): string[] {
  return (item.Genre ?? []).map(g => g.tag).filter(Boolean)
}

export function isDocumentaryGenre(genre: string): boolean {
  return genre.trim().toLowerCase() === 'documentary'
}

/** The library decides movie vs TV; a "Documentary" genre (when enabled) moves the item to documentaries. */
export function classify(item: PlexItem, libraryTarget: MediaKind, useDocumentaryGenre: boolean): MediaKind {
  if (useDocumentaryGenre && genresOf(item).some(isDocumentaryGenre)) {
    return 'documentary'
  }
  return libraryTarget
}

/** Default target for a Plex library section, guessed from its type and title. */
export function defaultLibraryTarget(type: string, title: string): LibraryTarget {
  if (type !== 'movie' && type !== 'show') return 'skip'
  if (/documentar/i.test(title)) return 'documentary'
  return type === 'movie' ? 'movie' : 'tv'
}

/** Movies count as watched once played; shows once every episode is played. */
export function isWatched(item: PlexItem): boolean {
  if (item.type === 'show') {
    const total = item.leafCount ?? 0
    return total > 0 && (item.viewedLeafCount ?? 0) >= total
  }
  return (item.viewCount ?? 0) > 0
}

export function plexWebLink(machineIdentifier: string, ratingKey: string): string {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`)
  return `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${key}`
}

/** Reads the Plex rating key back out of a note's Link property. */
export function ratingKeyFromLink(link: unknown): string | null {
  if (typeof link !== 'string') return null
  const match = /library(?:\/|%2F)metadata(?:\/|%2F)(\d+)/i.exec(link)
  return match ? match[1] : null
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
}

export function renderFileName(format: string, item: PlexItem): string {
  const raw = format
    .replace(/\{\{\s*title\s*\}\}/gi, item.title)
    .replace(/\{\{\s*year\s*\}\}/gi, item.year ? String(item.year) : '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
  return sanitizeFileName(raw) || sanitizeFileName(item.title) || item.ratingKey
}

/** Loose key for comparing titles with file names: case, accents, punctuation and spacing ignored. */
export function normalizeTitle(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Names an existing note might have for this item. */
export function candidateNames(item: PlexItem, fileNameFormat: string): string[] {
  const names = [item.title, renderFileName(fileNameFormat, item)]
  if (item.year) names.push(`${item.title} (${item.year})`)
  return names.map(normalizeTitle).filter(Boolean)
}

export interface ExistingNotes {
  ratingKeys: Set<string>
  names: Set<string>
}

export function hasNote(existing: ExistingNotes, item: PlexItem, fileNameFormat: string): boolean {
  if (existing.ratingKeys.has(item.ratingKey)) return true
  return candidateNames(item, fileNameFormat).some(n => existing.names.has(n))
}
