// Settings shape, defaults and migration. No Obsidian imports, so it can be unit tested.
import { defaultLibraryTarget, type LibraryTarget, type MatchBy, type MediaKind } from './notes'
import {
  DEFAULT_TAGS,
  defaultProperties,
  defaultValues,
  FIELD_SOURCES,
  oldGameProperties,
  type PropertyMapping,
  type PropertyValues,
} from './properties'

/** One Plex library and how its notes are made. */
export interface LibrarySetting {
  title: string
  /** Plex's library type: movie, show or artist (music). */
  type: string
  target: LibraryTarget
  folder: string
  fileNameFormat: string
  /** How existing notes are recognised besides their Plex link. */
  matchBy: MatchBy
  /** Frontmatter properties written to new notes, in order. */
  properties: PropertyMapping[]
  values: PropertyValues
}

/** An item tied by hand ("Use an existing note") to a note that was already there. */
export interface MergedItem {
  /** How it's listed in settings, e.g. "Heat (1995)". */
  name: string
  library: string
  /** The settings key of its library, for matching it within the right kind of notes. */
  libraryKey: string
  /** The note's path; kept up to date when the note is renamed or moved. */
  path: string
  since: number
}

/** A Plex item "Skip every time" was chosen for. */
export interface IgnoredItem {
  /** How it's listed in settings, e.g. "Heat (1995)" or "Radiohead - Airbag". */
  name: string
  library: string
  /** When it was ignored (ms since 1970). */
  since: number
}

/** The Steam account games are read from. */
export interface SteamSettings {
  /** A Steam Web API key, from steamcommunity.com/dev/apikey. */
  apiKey: string
  /** A 17-digit Steam ID, a profile address, or a custom URL name. */
  account: string
  /** Also list free-to-play games that have been played. */
  includeFreeGames: boolean
  /** Optional SteamGridDB API key, for more covers to choose from in the approval pop-up. */
  gridKey: string
}

/** The library key Steam games are listed under, next to the Plex libraries. */
export const STEAM_LIBRARY = 'steam'

/** Books, added with "Add something new" (there's no book source to sync from). */
export const BOOKS_LIBRARY = 'books'

export interface PlexNotesSettings {
  serverUrl: string
  token: string
  steam: SteamSettings
  /** OMDb API key, for finding movies and shows with "Add something new". */
  omdbKey: string
  /** Subfolder of each library's folder that downloaded posters go in. */
  imagesSubfolder: string
  /** What each character that can't be in a file name becomes; missing or '' drops it. */
  fileNameReplacements: Record<string, string>
  /** Rename matching existing notes to their library's file name format. */
  renameExistingNotes: boolean
  /** Show what will happen and ask before creating or changing each note. */
  askBeforeChanges: boolean
  /** Plex items every sync passes over, keyed by rating key. */
  ignored: Record<string, IgnoredItem>
  /** Items tied to existing notes, by rating key: matched to that note, and never renamed. */
  merged: Record<string, MergedItem>
  /** The properties "Check existing notes against sources" compares, as last chosen (null: not chosen yet). */
  checkProperties: string[] | null
  /** The only genres written to notes, in every library; empty keeps them all. */
  allowedGenres: string[]
  /** Links you chose to keep when a sync offered a different one, by rating key: not offered again while unchanged. */
  keptLinks: Record<string, string>
  /** Durations you chose to keep when a sync offered the source's, by "rating key|property": not offered again while unchanged. */
  keptValues: Record<string, string>
  /** Notes that match nothing but are fine as they are ("Always ignore"): not pointed out again. */
  unmatchedIgnored: string[]
  /** Start every offered change to a value already in a note ticked (off: only clear-cut fixes are). */
  tickDifferences: boolean
  /** One-time changes to saved settings already made, so they aren't made again (and can be undone by hand). */
  migrations: string[]
  /** Refresh "Play count" properties in existing notes on every sync (they're overwritten). */
  updatePlayCounts: boolean
  /** Also replace "Your rating" properties in existing notes on every sync (and in background updates). */
  updateRatings: boolean
  /** Also move "Watched or played status" properties forward (never back, never from your own statuses) on every sync. */
  updateStatus: boolean
  /** Offer to send a rating changed in a note to Plex (in the approval pop-up, so only with asking on). */
  sendRatings: boolean
  /** The rating (stars, 0 for none) a note and Plex last agreed on, by rating key: which side changed since. */
  ratingsSeen: Record<string, number>
  /** Also refresh play counts in the background every this many hours; 0 is off. */
  playCountHours: number
  /** When play counts were last refreshed in the background (ms since 1970). */
  lastPlayCountUpdate: number
  /** Keyed by Plex library section key, plus "steam" for Steam games. */
  libraries: Record<string, LibrarySetting>
}

export const DEFAULT_FOLDERS: Record<MediaKind, string> = {
  movie: 'Media/Movies',
  tv: 'Media/TV Shows',
  documentary: 'Media/Documentaries',
  music: 'Media/Music',
  game: 'Media/Video Games',
  book: 'Media/Books',
}

export const DEFAULT_FILE_NAMES: Record<MediaKind, string> = {
  movie: '{{title}} ({{year}})',
  tv: '{{title}} ({{year}})',
  documentary: '{{title}} ({{year}})',
  music: '{{artist}} - {{title}}',
  game: '{{title}} ({{year}})',
  book: '{{title}} ({{year}})',
}

/** Track titles like "Intro" are too common to match on their own, so music only matches its full file name. */
export const DEFAULT_MATCH_BY: Record<MediaKind, MatchBy> = {
  movie: 'loose',
  tv: 'loose',
  documentary: 'loose',
  music: 'format',
  game: 'loose',
  book: 'loose',
}

/** The genres kept to start with: the owner's own list. */
export const DEFAULT_GENRES = ['Action', 'Adventure', 'Biography', 'Collecting', 'Comedy', 'Crime', 'Documentary', 'Dystopian', 'Fantasy', 'Fiction', 'Fitness', 'History', 'Horror', 'Memoir', 'Musical', 'Mystery', 'Puzzle', 'Rhythm', 'Sci-Fi', 'Science', 'Self-Help', 'Simulation', 'Strategy', 'Thriller', 'Trivia', 'Western']
export function defaultSettings(): PlexNotesSettings {
  return {
    serverUrl: '',
    token: '',
    steam: { apiKey: '', account: '', includeFreeGames: true, gridKey: '' },
    omdbKey: '',
    imagesSubfolder: 'Images',
    fileNameReplacements: {},
    renameExistingNotes: true,
    askBeforeChanges: true,
    ignored: {},
    merged: {},
    keptLinks: {},
    keptValues: {},
    unmatchedIgnored: [],
    tickDifferences: true,
    migrations: [],
    allowedGenres: [...DEFAULT_GENRES],
    checkProperties: null,
    updatePlayCounts: false,
    updateRatings: false,
    updateStatus: false,
    sendRatings: false,
    ratingsSeen: {},
    playCountHours: 0,
    lastPlayCountUpdate: 0,
    libraries: {},
  }
}

function isKind(target: LibraryTarget): target is MediaKind {
  return target !== 'skip'
}

/** A library set up with the defaults for its type; a skipped one is filled in when it gets a type. */
export function newLibrary(title: string, type: string, target: LibraryTarget = defaultLibraryTarget(type, title)): LibrarySetting {
  const lib: LibrarySetting = {
    title,
    type,
    target: 'skip',
    folder: '',
    fileNameFormat: '',
    matchBy: 'loose',
    properties: [],
    values: { watched: '', started: '', unwatched: '', tag: '' },
  }
  return retarget(lib, target)
}

/**
 * Changes what a library is used as. Settings still at the old type's defaults (or empty) switch
 * to the new type's defaults; anything customised is kept.
 */
export function retarget(lib: LibrarySetting, target: LibraryTarget): LibrarySetting {
  const old = lib.target
  lib.target = target
  if (!isKind(target)) return lib
  const was = <T>(value: T, oldDefault: (kind: MediaKind) => T): boolean =>
    !value || (Array.isArray(value) && value.length === 0)
    || (isKind(old) && JSON.stringify(value) === JSON.stringify(oldDefault(old)))

  if (was(lib.folder, k => DEFAULT_FOLDERS[k])) lib.folder = DEFAULT_FOLDERS[target]
  if (was(lib.fileNameFormat, k => DEFAULT_FILE_NAMES[k])) lib.fileNameFormat = DEFAULT_FILE_NAMES[target]
  if (!isKind(old) || lib.matchBy === DEFAULT_MATCH_BY[old]) lib.matchBy = DEFAULT_MATCH_BY[target]
  if (was(lib.properties, defaultProperties)) lib.properties = defaultProperties(target)
  const values = defaultValues(target)
  lib.values = {
    watched: lib.values.watched || values.watched,
    started: lib.values.started || values.started,
    unwatched: lib.values.unwatched || values.unwatched,
    tag: was(lib.values.tag, k => DEFAULT_TAGS[k]) ? values.tag : lib.values.tag,
  }
  return lib
}

/** Adds libraries Plex reports that the settings don't know yet, keeping existing choices. */
export function mergeLibraries(settings: PlexNotesSettings, libraries: { key: string, title: string, type: string }[]): void {
  for (const lib of libraries) {
    const existing = settings.libraries[lib.key]
    if (existing) {
      existing.title = lib.title
      existing.type = lib.type
    } else {
      settings.libraries[lib.key] = newLibrary(lib.title, lib.type)
    }
  }
}

export function steamReady(settings: PlexNotesSettings): boolean {
  return Boolean(settings.steam.apiKey.trim() && settings.steam.account.trim())
}

export function plexReady(settings: PlexNotesSettings): boolean {
  return Boolean(settings.serverUrl.trim() && settings.token.trim())
}

/** Once a Steam account is set up, its games get a library of their own (on by default). */
export function ensureSteamLibrary(settings: PlexNotesSettings): void {
  if (steamReady(settings) && !settings.libraries[STEAM_LIBRARY]) {
    settings.libraries[STEAM_LIBRARY] = newLibrary('Steam', 'steam', 'game')
  }
}

/** The library new games and books found with "Add something new" go in (created if needed). */
export function addLibrary(settings: PlexNotesSettings, kind: 'game' | 'book'): LibrarySetting {
  const key = kind === 'game' ? STEAM_LIBRARY : BOOKS_LIBRARY
  settings.libraries[key] ??= kind === 'game' ? newLibrary('Steam', 'steam', 'game') : newLibrary('Books', 'books', 'book')
  return settings.libraries[key]
}

/** Libraries that aren't read from Plex or Steam: books only come from "Add something new". */
export function hasSource(key: string): boolean {
  return key !== BOOKS_LIBRARY
}

/** Settings as saved by 0.0.9 and earlier, when folders, file name and properties were plugin-wide. */
interface LegacySettings {
  moviesFolder?: string
  tvFolder?: string
  documentariesFolder?: string
  fileNameFormat?: string
  properties?: PropertyMapping[]
  values?: { watched?: string, started?: string, unwatched?: string, tags?: Partial<Record<MediaKind, string>> }
  postersFolder?: string
}

type SavedLibrary = Partial<LibrarySetting> & { title?: string, type?: string, target?: LibraryTarget }

/** Builds current settings from saved data, moving plugin-wide settings from older versions into each library. */
export function loadSettings(data: unknown): PlexNotesSettings {
  const saved = (data ?? {}) as Partial<PlexNotesSettings> & LegacySettings & { libraries?: Record<string, SavedLibrary> }
  const settings = defaultSettings()
  for (const key of ['serverUrl', 'token', 'imagesSubfolder', 'renameExistingNotes', 'askBeforeChanges', 'omdbKey',
    'updatePlayCounts', 'updateRatings', 'updateStatus', 'sendRatings', 'tickDifferences', 'playCountHours', 'lastPlayCountUpdate'] as const) {
    if (saved[key] !== undefined) (settings as unknown as Record<string, unknown>)[key] = saved[key]
  }
  settings.fileNameReplacements = { ...saved.fileNameReplacements }
  settings.ignored = { ...saved.ignored }
  settings.merged = { ...saved.merged }
  settings.keptLinks = { ...saved.keptLinks }
  settings.keptValues = { ...saved.keptValues }
  settings.ratingsSeen = { ...saved.ratingsSeen }
  if (Array.isArray(saved.unmatchedIgnored)) settings.unmatchedIgnored = saved.unmatchedIgnored.map(String)
  if (Array.isArray(saved.allowedGenres)) settings.allowedGenres = saved.allowedGenres.map(String)
  if (Array.isArray(saved.checkProperties)) settings.checkProperties = saved.checkProperties.map(String)
  settings.steam = { ...settings.steam, ...saved.steam }

  const legacyFolders: Partial<Record<MediaKind, string>> = {
    movie: saved.moviesFolder,
    tv: saved.tvFolder,
    documentary: saved.documentariesFolder,
  }

  for (const [key, lib] of Object.entries(saved.libraries ?? {})) {
    const title = lib.title ?? key
    const type = lib.type ?? ''
    if (lib.folder !== undefined && lib.properties && lib.values) {
      settings.libraries[key] = {
        title,
        type,
        target: lib.target ?? 'skip',
        folder: lib.folder,
        fileNameFormat: lib.fileNameFormat ?? '',
        matchBy: lib.matchBy ?? DEFAULT_MATCH_BY[isKind(lib.target ?? 'skip') ? lib.target as MediaKind : 'movie'],
        properties: lib.properties,
        values: { ...defaultValues(isKind(lib.target ?? 'skip') ? lib.target as MediaKind : 'movie'), ...lib.values },
      }
      continue
    }
    const target: LibraryTarget = lib.target ?? defaultLibraryTarget(type, title)
    const migrated = newLibrary(title, type, target)
    if (isKind(target) && target !== 'music') {
      migrated.folder = legacyFolders[target] || migrated.folder
      migrated.fileNameFormat = saved.fileNameFormat || migrated.fileNameFormat
      if (Array.isArray(saved.properties)) {
        // Before filling in existing notes was a choice, it was always the link and summary.
        migrated.properties = structuredClone(saved.properties).map(m =>
          m.source === 'plexLink' || m.source === 'summary' ? { ...m, fill: true } : m)
      }
      migrated.values = {
        watched: saved.values?.watched || migrated.values.watched,
        started: saved.values?.started || migrated.values.started,
        unwatched: saved.values?.unwatched || migrated.values.unwatched,
        tag: saved.values?.tags?.[target] || migrated.values.tag,
      }
    }
    settings.libraries[key] = migrated
  }
  // Properties whose Plex/Steam/HowLongToBeat source no longer exists (Main + Extras and
  // Completionist were dropped in 0.0.22) are removed.
  for (const lib of Object.values(settings.libraries)) {
    lib.properties = lib.properties.filter(m => m.source in FIELD_SOURCES)
  }
  // Books have no source to load them from, so their library is always there to set up.
  settings.libraries[BOOKS_LIBRARY] ??= newLibrary('Books', 'books', 'book')
  // A Steam library still on the first game defaults gets the HowLongToBeat times added.
  const steamLib = settings.libraries[STEAM_LIBRARY]
  if (steamLib && JSON.stringify(steamLib.properties) === JSON.stringify(oldGameProperties())) {
    steamLib.properties = defaultProperties('game')
  }
  migrateOnce(settings, saved, 'music-no-duration', () => {
    // Music notes don't record a track's length any more.
    for (const lib of Object.values(settings.libraries)) {
      if (lib.target === 'music') lib.properties = lib.properties.filter(m => !(m.source === 'durationClock' && m.name.trim() === 'Duration'))
    }
  })
  migrateOnce(settings, saved, 'book-pages-duration', () => {
    // A book's page count goes in Duration, like other media's length.
    for (const lib of Object.values(settings.libraries)) {
      if (lib.target !== 'book' || lib.properties.some(m => m.name.trim() === 'Duration')) continue
      lib.properties = lib.properties.map(m => m.source === 'pages' && m.name.trim() === 'Pages' ? { ...m, name: 'Duration' } : m)
    }
  })
  return settings
}

/**
 * Makes a change to saved settings once: settings saved before it are changed, and it's never
 * made again (so you can undo it by hand). New settings already have it.
 */
function migrateOnce(settings: PlexNotesSettings, saved: { migrations?: unknown }, name: string, change: () => void): void {
  const done = Array.isArray(saved.migrations) ? saved.migrations.map(String) : []
  settings.migrations = [...new Set([...settings.migrations, ...done])]
  if (settings.migrations.includes(name)) return
  if (Object.keys(saved).length) change()
  settings.migrations.push(name)
}
