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
  /** Milliseconds into a partly watched movie. */
  viewOffset?: number
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

/** Partly watched: a movie stopped part way, or a show with some but not all episodes watched. */
export function isStarted(item: PlexItem): boolean {
  if (isWatched(item)) return false
  if (item.type === 'show') return (item.viewedLeafCount ?? 0) > 0
  return (item.viewOffset ?? 0) > 0
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

/** Paths of existing notes, by the Plex rating key in their link property and by normalized file name. */
export interface ExistingNotes {
  ratingKeys: Map<string, string>
  names: Map<string, string[]>
}

export function emptyIndex(): ExistingNotes {
  return { ratingKeys: new Map(), names: new Map() }
}

export function addToIndex(index: ExistingNotes, path: string, baseName: string, ratingKeys: string[] = []): void {
  for (const key of ratingKeys) if (!index.ratingKeys.has(key)) index.ratingKeys.set(key, path)
  const name = normalizeTitle(baseName)
  if (!name) return
  const paths = index.names.get(name) ?? []
  if (!paths.includes(path)) paths.push(path)
  index.names.set(name, paths)
}

export interface NoteMatch {
  /** Every existing note the item could be; one when the match is unambiguous. */
  paths: string[]
  /** Matched through the Plex link, so it's certainly this item. */
  byRatingKey: boolean
}

export function findNote(existing: ExistingNotes, item: PlexItem, fileNameFormat: string): NoteMatch | null {
  const keyed = existing.ratingKeys.get(item.ratingKey)
  if (keyed) return { paths: [keyed], byRatingKey: true }
  const paths = new Set<string>()
  for (const name of candidateNames(item, fileNameFormat)) {
    for (const path of existing.names.get(name) ?? []) paths.add(path)
  }
  return paths.size ? { paths: [...paths], byRatingKey: false } : null
}

export function hasNote(existing: ExistingNotes, item: PlexItem, fileNameFormat: string): boolean {
  return findNote(existing, item, fileNameFormat) !== null
}

export interface RenamePlan {
  item: PlexItem
  path: string
}

/**
 * Notes that can safely be renamed: each matched exactly one note, and no other Plex item matched
 * that note. A note matched through its Plex link always belongs to that item.
 */
export function planRenames(matches: { item: PlexItem, match: NoteMatch | null }[]): RenamePlan[] {
  const claims = new Map<string, number>()
  const keyed = new Set<string>()
  for (const { match } of matches) {
    if (!match) continue
    for (const path of match.paths) claims.set(path, (claims.get(path) ?? 0) + 1)
    if (match.byRatingKey) keyed.add(match.paths[0])
  }
  const plans: RenamePlan[] = []
  for (const { item, match } of matches) {
    if (!match || match.paths.length !== 1) continue
    const path = match.paths[0]
    if (match.byRatingKey || (!keyed.has(path) && claims.get(path) === 1)) plans.push({ item, path })
  }
  return plans
}
