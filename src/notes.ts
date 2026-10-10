// Pure helpers for turning Plex items into notes. No Obsidian imports, so they can be unit tested.

export type MediaKind = 'movie' | 'tv' | 'documentary' | 'music' | 'game' | 'book'
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
  /** The Plex library the item is in (in its full metadata). */
  librarySectionID?: number | string
  librarySectionTitle?: string
  // Music tracks
  /** Album artist. */
  grandparentTitle?: string
  /** Album title. */
  parentTitle?: string
  parentRatingKey?: string
  parentYear?: number
  parentThumb?: string
  /** Track number. */
  index?: number
  /** Disc number. */
  parentIndex?: number
  Style?: PlexTag[]
  Mood?: PlexTag[]
  /** The track's album, fetched separately; genres, styles, label and dates come from it. */
  album?: PlexItem
  // Steam games (type 'game'; ratingKey is "steam-<appid>")
  steamAppId?: number
  /** Where Plex has the item's file (a track's MP3), in the listing. */
  Media?: { Part?: { file?: string }[] }[]
  /** A music file's own tags (desktop only), read from the file Plex has for the track. */
  fileTags?: Record<string, string[]>
  /** A song's lyrics, from the text file beside its music file (desktop only). */
  lyrics?: string
  /** Total playtime, in minutes. */
  playtimeMinutes?: number
  /** Playtime in the last two weeks, in minutes. */
  recentMinutes?: number
  developers?: string[]
  publishers?: string[]
  platforms?: string[]
  metacritic?: number
  /** Portrait cover art (600×900) URL. */
  portrait?: string
  /** The store's player tags ("Mystery", "Comedy"…), most voted first; used as genres only when they're in "Genres to keep". */
  steamTags?: string[]
  /** Your Steam collections it's in (desktop only: undefined when they couldn't be read). */
  steamCollections?: string[]
  /** Landscape header art URL. */
  wideImage?: string
  /** HowLongToBeat's times for the game, when looked up. */
  hltb?: import('./hltb-data').HltbTimes
  /** Other covers to choose from in the approval pop-up. */
  coverChoices?: import('./steamgriddb').CoverChoice[]
  // Found with "Add something new" (not from Plex or Steam): ratingKey "imdb-…", "ol-…" or "hltb-…"
  /** The item's page (IMDb, Open Library, HowLongToBeat), used as its Link. */
  webLink?: string
  // Books
  authors?: string[]
  pages?: number
  isbn?: string
}

export function isMusic(kind: MediaKind): boolean {
  return kind === 'music'
}

/** A track's own artist (Plex keeps it in originalTitle when it differs from the album artist). */
export function trackArtist(item: PlexItem): string | undefined {
  if (item.type !== 'track') return undefined
  return item.originalTitle || item.grandparentTitle
}

/**
 * The first of several artists: "Juanes, Mon Laferte", "Juanes & Mon Laferte" and
 * "Juanes feat. Mon Laferte" are all "Juanes", for matching song notes.
 */
export function firstArtist(artist: string): string {
  return artist.split(/\s*[,;&/]\s*|\s+(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s+/i)[0].trim() || artist.trim()
}

/** A song title without its featured artists: "Aurora (feat. Mon Laferte)" is "Aurora". */
export function withoutFeatured(title: string): string {
  return title.replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '').trim() || title
}

/**
 * Other names a song note might have: its file name with only the first artist before " - "
 * and the title without featured artists ("Juanes, Mon Laferte - Aurora (feat. X)" is also
 * "Juanes - Aurora"). Names without " - " give nothing.
 */
export function songNameVariants(baseName: string): string[] {
  const at = baseName.indexOf(' - ')
  if (at < 0) return []
  const artist = baseName.slice(0, at)
  const title = baseName.slice(at + 3)
  const short = `${firstArtist(artist)} - ${withoutFeatured(title)}`
  return short === baseName ? [] : [short]
}

/** How an item is named in lists: "Title (Year)", or "Artist - Title" for a track. */
export function displayName(item: PlexItem): string {
  if (item.type === 'track') {
    const artist = trackArtist(item)
    return artist ? `${artist} - ${item.title}` : item.title
  }
  const year = yearOf(item)
  return year ? `${item.title} (${year})` : item.title
}

export function yearOf(item: PlexItem): number | undefined {
  return item.year ?? item.parentYear ?? item.album?.year
}

export function genresOf(item: PlexItem): string[] {
  return (item.Genre ?? []).map(g => g.tag).filter(Boolean)
}

export function isDocumentaryGenre(genre: string): boolean {
  return genre.trim().toLowerCase() === 'documentary'
}

/**
 * Default target for a Plex library section, guessed from its type and title. Music libraries start
 * skipped: one note per track can be thousands of notes, so they're switched on by hand.
 */
export function defaultLibraryTarget(type: string, title: string): LibraryTarget {
  if (type === 'steam') return 'game'
  if (type === 'books') return 'book'
  if (type !== 'movie' && type !== 'show') return 'skip'
  if (/documentar/i.test(title)) return 'documentary'
  return type === 'movie' ? 'movie' : 'tv'
}

/** Movies count as watched once played; shows once every episode is played. */
export function isWatched(item: PlexItem): boolean {
  // Steam can't tell when a game is finished; that's set by hand.
  if (item.type === 'game' || item.type === 'book') return false
  if (item.type === 'show') {
    const total = item.leafCount ?? 0
    return total > 0 && (item.viewedLeafCount ?? 0) >= total
  }
  return (item.viewCount ?? 0) > 0
}

/** Partly watched: a movie stopped part way, or a show with some but not all episodes watched. */
export function isStarted(item: PlexItem): boolean {
  if (isWatched(item)) return false
  if (item.type === 'game') return (item.playtimeMinutes ?? 0) > 0
  if (item.type === 'show') return (item.viewedLeafCount ?? 0) > 0
  return (item.viewOffset ?? 0) > 0
}

/**
 * The item's page in Plex Web. Plex has no page for a track, so a song links to its album's page,
 * with the track's own key after it (`&track=…`) for matching.
 */
export function plexWebLink(machineIdentifier: string, ratingKey: string, albumKey?: string): string {
  const key = encodeURIComponent(`/library/metadata/${albumKey ?? ratingKey}`)
  return `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${key}${albumKey ? `&track=${ratingKey}` : ''}`
}

export function steamStoreUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}/`
}

/**
 * Reads the item's key back out of a note's Link property: a Plex rating key, or "steam-<appid>",
 * "imdb-<id>", "ol-<work id>" or "hltb-<id>" for Steam Store, IMDb, Open Library and HowLongToBeat pages.
 */
export function ratingKeyFromLink(link: unknown): string | null {
  if (typeof link !== 'string') return null
  const steam = /store\.steampowered\.com\/app\/(\d+)/i.exec(link)
  if (steam) return `steam-${steam[1]}`
  const imdb = /imdb\.com\/title\/(tt\d+)/i.exec(link)
  if (imdb) return `imdb-${imdb[1]}`
  const openLibrary = /openlibrary\.org\/works\/(OL\d+W)/i.exec(link)
  if (openLibrary) return `ol-${openLibrary[1]}`
  const hltb = /howlongtobeat\.com\/game\/(\d+)/i.exec(link)
  if (hltb) return `hltb-${hltb[1]}`
  // A song's link is to its album's page, with the track's key after it.
  const track = /[?&]track=(\d+)/.exec(link)
  if (track) return track[1]
  const match = /library(?:\/|%2F)metadata(?:\/|%2F)(\d+)/i.exec(link)
  return match ? match[1] : null
}

/**
 * Whether a link is a search page rather than an item's own page, such as Steam's
 * store.steampowered.com/search/?term=… (bare or inside a Markdown link).
 */
export function isSearchLink(link: unknown): boolean {
  if (typeof link !== 'string') return false
  return /https?:\/\/[^\s)\]]*(\/search\b|[?&](term|q|query|s)=)/i.test(link)
}

/** Characters that can't be in file names (or break links), each with its own replacement setting. */
export const REPLACEABLE_CHARS = [':', '?', '/', '"', '*', '#', '[', ']'] as const
/** The rest share one replacement setting, stored under 'other'. */
export const OTHER_CHARS = '\\ < > | ^'
const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g

/** How file names are built: the format, and what each forbidden character becomes ('' drops it). */
export interface FileNaming {
  format: string
  replacements: Record<string, string>
}

function replacementFor(char: string, replacements: Record<string, string>): string {
  const value = (REPLACEABLE_CHARS as readonly string[]).includes(char) ? replacements[char] : replacements.other
  return (value ?? '').replace(FORBIDDEN, '')
}

/** Swaps each character that can't be in file names for its replacement, as is ("Mission: Impossible" → "Mission- Impossible"). */
export function sanitizeFileName(name: string, replacements: Record<string, string> = {}): string {
  return name
    .replace(FORBIDDEN, (char: string) => replacementFor(char, replacements))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
}

/** Values for the {{…}} placeholders in a file name format. */
function placeholders(item: PlexItem): Record<string, string> {
  const year = yearOf(item)
  return {
    title: item.title,
    year: year ? String(year) : '',
    artist: trackArtist(item) ?? '',
    albumartist: item.grandparentTitle ?? '',
    album: item.parentTitle ?? '',
    track: item.index ? String(item.index).padStart(2, '0') : '',
    disc: item.parentIndex ? String(item.parentIndex) : '',
    author: (item.authors ?? []).join(', '),
  }
}

export function renderFileName(naming: FileNaming, item: PlexItem): string {
  const values = placeholders(item)
  const raw = naming.format
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (all: string, key: string) => values[key.toLowerCase()] ?? all)
    .replace(/\(\s*\)|\[\s*\]/g, '')
    // Separators left dangling by an empty placeholder, e.g. " - " when there's no artist or " by " without an author.
    .replace(/^\s*[-–—]\s+|\s+[-–—]\s*$|\s+by\s*$/gi, '')
  return sanitizeFileName(raw, naming.replacements)
    || sanitizeFileName(item.title, naming.replacements)
    || item.ratingKey
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

/**
 * How existing notes are recognised, besides their Plex link: 'loose' also accepts the bare title
 * or "Title (Year)", 'format' only the library's file name format, 'link' nothing but the link.
 * Case, accents and punctuation are ignored for names.
 */
export type MatchBy = 'loose' | 'format' | 'link'

/** Names an existing note might have for this item. */
export function candidateNames(item: PlexItem, naming: FileNaming, matchBy: MatchBy = 'loose'): string[] {
  if (matchBy === 'link') return []
  const names = [renderFileName(naming, item)]
  // A song by several artists is also looked for under its first artist alone, without featured artists.
  const artist = trackArtist(item)
  if (artist) names.push(renderFileName(naming, { ...item, originalTitle: firstArtist(artist), title: withoutFeatured(item.title) }))
  if (matchBy === 'loose') {
    names.push(item.title)
    if (item.year) names.push(`${item.title} (${item.year})`)
  }
  return [...new Set(names.map(normalizeTitle).filter(Boolean))]
}

/** Paths of existing notes, by the Plex rating key in their link property and by normalized file name. */
export interface ExistingNotes {
  ratingKeys: Map<string, string>
  names: Map<string, string[]>
  /** Rating keys each note links to, so a note linked to one item never name-matches another. */
  keysByPath: Map<string, string[]>
}

export function emptyIndex(): ExistingNotes {
  return { ratingKeys: new Map(), names: new Map(), keysByPath: new Map() }
}

export function addToIndex(index: ExistingNotes, path: string, baseName: string, ratingKeys: string[] = []): void {
  for (const key of ratingKeys) if (!index.ratingKeys.has(key)) index.ratingKeys.set(key, path)
  if (ratingKeys.length) index.keysByPath.set(path, [...(index.keysByPath.get(path) ?? []), ...ratingKeys])
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

/**
 * Every key a note's Link can name this item by: its own, plus "imdb-<id>" when Plex knows its
 * IMDb ID, so a note added from IMDb before the movie was in Plex is recognised once it is.
 */
export function itemKeys(item: PlexItem): string[] {
  const keys = [item.ratingKey]
  for (const guid of item.Guid ?? []) {
    const imdb = /^imdb:\/\/(tt\d+)/.exec(guid.id)
    if (imdb) keys.push(`imdb-${imdb[1]}`)
  }
  return keys
}

export function findNote(existing: ExistingNotes, item: PlexItem, naming: FileNaming, matchBy: MatchBy = 'loose'): NoteMatch | null {
  const keys = itemKeys(item)
  for (const key of keys) {
    const keyed = existing.ratingKeys.get(key)
    if (keyed) return { paths: [keyed], byRatingKey: true }
  }
  const paths = new Set<string>()
  for (const name of candidateNames(item, naming, matchBy)) {
    for (const path of existing.names.get(name) ?? []) {
      const linked = existing.keysByPath.get(path)
      if (!linked || linked.some(key => keys.includes(key))) paths.add(path)
    }
  }
  return paths.size ? { paths: [...paths], byRatingKey: false } : null
}

export function hasNote(existing: ExistingNotes, item: PlexItem, naming: FileNaming, matchBy: MatchBy = 'loose'): boolean {
  return findNote(existing, item, naming, matchBy) !== null
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

/**
 * Notes no Plex link claims, whose names match more than one item: the plugin can't tell which
 * item such a note is for, so it asks.
 */
export function ambiguousNotes(matches: { item: PlexItem, match: NoteMatch | null }[]): { path: string, items: PlexItem[] }[] {
  const keyed = new Set(matches.filter(m => m.match?.byRatingKey).map(m => m.match!.paths[0]))
  const claimants = new Map<string, PlexItem[]>()
  for (const { item, match } of matches) {
    if (!match || match.byRatingKey) continue
    for (const path of match.paths) {
      if (!keyed.has(path)) claimants.set(path, [...(claimants.get(path) ?? []), item])
    }
  }
  return [...claimants.entries()].filter(([, items]) => items.length > 1).map(([path, items]) => ({ path, items }))
}

/** Already named right: exactly the expected name, or it with the " 2", " 3"… added when the name was taken. */
export function isNamedAs(baseName: string, expected: string): boolean {
  if (baseName === expected) return true
  return baseName.startsWith(`${expected} `) && /^\d+$/.test(baseName.slice(expected.length + 1))
}
