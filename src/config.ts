// Settings shape, defaults and migration. No Obsidian imports, so it can be unit tested.
import { defaultLibraryTarget, type LibraryTarget, type MatchBy, type MediaKind } from './notes'
import {
  DEFAULT_TAGS,
  defaultProperties,
  defaultValues,
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

export interface PlexNotesSettings {
  serverUrl: string
  token: string
  steam: SteamSettings
  /** Subfolder of each library's folder that downloaded posters go in. */
  imagesSubfolder: string
  /** What each character that can't be in a file name becomes; missing or '' drops it. */
  fileNameReplacements: Record<string, string>
  useDocumentaryGenre: boolean
  /** Rename matching existing notes to their library's file name format. */
  renameExistingNotes: boolean
  /** Show what will happen and ask before creating or changing each note. */
  askBeforeChanges: boolean
  /** Plex items every sync passes over, keyed by rating key. */
  ignored: Record<string, IgnoredItem>
  /** Refresh "Play count" properties in existing notes on every sync (they're overwritten). */
  updatePlayCounts: boolean
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
}

export const DEFAULT_FILE_NAMES: Record<MediaKind, string> = {
  movie: '{{title}} ({{year}})',
  tv: '{{title}} ({{year}})',
  documentary: '{{title}} ({{year}})',
  music: '{{artist}} - {{title}}',
  game: '{{title}} ({{year}})',
}

/** Track titles like "Intro" are too common to match on their own, so music only matches its full file name. */
export const DEFAULT_MATCH_BY: Record<MediaKind, MatchBy> = {
  movie: 'loose',
  tv: 'loose',
  documentary: 'loose',
  music: 'format',
  game: 'loose',
}

export function defaultSettings(): PlexNotesSettings {
  return {
    serverUrl: '',
    token: '',
    steam: { apiKey: '', account: '', includeFreeGames: true, gridKey: '' },
    imagesSubfolder: 'Images',
    fileNameReplacements: {},
    useDocumentaryGenre: true,
    renameExistingNotes: true,
    askBeforeChanges: true,
    ignored: {},
    updatePlayCounts: false,
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

/** The library documentary-genre items from other libraries are handled by, if there is one. */
export function documentaryLibrary(settings: PlexNotesSettings): LibrarySetting | undefined {
  return Object.values(settings.libraries).find(lib => lib.target === 'documentary')
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
  for (const key of ['serverUrl', 'token', 'imagesSubfolder', 'useDocumentaryGenre', 'renameExistingNotes', 'askBeforeChanges',
    'updatePlayCounts', 'playCountHours', 'lastPlayCountUpdate'] as const) {
    if (saved[key] !== undefined) (settings as unknown as Record<string, unknown>)[key] = saved[key]
  }
  settings.fileNameReplacements = { ...saved.fileNameReplacements }
  settings.ignored = { ...saved.ignored }
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
  // A Steam library still on the first game defaults gets the HowLongToBeat times added.
  const steamLib = settings.libraries[STEAM_LIBRARY]
  if (steamLib && JSON.stringify(steamLib.properties) === JSON.stringify(oldGameProperties())) {
    steamLib.properties = defaultProperties('game')
  }
  return settings
}
