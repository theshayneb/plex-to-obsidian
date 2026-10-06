import { App, normalizePath, TFile, TFolder } from 'obsidian'
import { documentaryLibrary, mergeLibraries, type LibrarySetting, type PlexNotesSettings } from './config'
import {
  addToIndex,
  classify,
  emptyIndex,
  findNote,
  hasNote,
  isNamedAs,
  planRenames,
  plexWebLink,
  ratingKeyFromLink,
  renderFileName,
  sanitizeFileName,
  type ExistingNotes,
  type FileNaming,
  type MediaKind,
  type PlexItem,
} from './notes'
import { PlexClient } from './plex'
import { buildFrontmatter, linkPropertyNames, playCount, usesSource } from './properties'

export interface SyncResult {
  created: string[]
  renamed: { from: string, to: string }[]
  /** Existing notes that got empty properties filled in. */
  filled: string[]
  /** Existing notes whose play count changed. */
  playCounts: string[]
  skipped: number
  failed: { title: string, error: string }[]
}

export type ProgressFn = (message: string) => void

/** 'full' creates, renames and fills in notes; 'playCounts' only refreshes play counts in existing notes. */
export type SyncMode = 'full' | 'playCounts'

type ActiveLibrary = LibrarySetting & { target: MediaKind }

/** Movies, shows and documentaries can match each other's notes (an item may move by genre); music only matches music. */
type Family = 'video' | 'music'
const familyOf = (lib: ActiveLibrary): Family => (lib.target === 'music' ? 'music' : 'video')

interface Entry {
  item: PlexItem
  lib: ActiveLibrary
}

export class PlexSync {
  private readonly albums = new Map<string, Promise<PlexItem | null>>()

  constructor(
    private readonly app: App,
    private readonly settings: PlexNotesSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  private naming(lib: LibrarySetting): FileNaming {
    return { format: lib.fileNameFormat, replacements: this.settings.fileNameReplacements }
  }

  /** The library whose settings make this item's note: its own, or the documentaries library for a documentary. */
  private libraryFor(item: PlexItem, lib: ActiveLibrary): { lib: ActiveLibrary, kind: MediaKind } {
    const kind = classify(item, lib.target, this.settings.useDocumentaryGenre)
    if (kind === 'documentary' && lib.target !== 'documentary') {
      const docs = documentaryLibrary(this.settings) as ActiveLibrary | undefined
      return docs ? { lib: docs, kind } : { lib, kind: lib.target }
    }
    return { lib, kind }
  }

  async run(progress: ProgressFn, mode: SyncMode = 'full'): Promise<SyncResult> {
    const { serverUrl, token } = this.settings
    if (!serverUrl || !token) throw new Error('Set the Plex server address and token in the plugin settings first')

    const plex = new PlexClient(serverUrl, token)
    progress('Connecting to Plex…')
    const machineId = await plex.machineIdentifier()

    if (mode === 'full') {
      mergeLibraries(this.settings, await plex.libraries())
      await this.saveSettings()
    }

    const active = Object.entries(this.settings.libraries)
      .filter((e): e is [string, ActiveLibrary] => e[1].target !== 'skip')
    const indexes: Record<Family, ExistingNotes> = {
      video: this.indexExistingNotes(active.map(([, lib]) => lib).filter(lib => familyOf(lib) === 'video')),
      music: this.indexExistingNotes(active.map(([, lib]) => lib).filter(lib => familyOf(lib) === 'music')),
    }
    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [] }

    const entries: Entry[] = []
    for (const [key, lib] of active) {
      progress(`Reading ${lib.title}…`)
      const music = lib.target === 'music'
      for (const item of await plex.libraryItems(key, music)) {
        const wanted = music ? item.type === 'track' : item.type === 'movie' || item.type === 'show'
        if (wanted) entries.push({ item, lib })
      }
    }

    const full = mode === 'full'
    const renaming = full && this.settings.renameExistingNotes
    const filling = full && active.some(([, lib]) => lib.properties.some(m => m.fill))
    const counting = !full || this.settings.updatePlayCounts
    if (renaming || filling || counting) {
      progress('Checking existing notes…')
      for (const family of ['video', 'music'] as const) {
        const index = indexes[family]
        const matches = entries
          .filter(e => familyOf(e.lib) === family)
          .map(({ item, lib }) => ({ item, lib, match: findNote(index, item, this.naming(lib), lib.matchBy) }))
        const libOf = new Map(matches.map(m => [m.item, m.lib]))
        for (const { item, path } of planRenames(matches)) {
          const { lib, kind } = this.libraryFor(item, libOf.get(item)!)
          let current = path
          if (renaming) {
            try {
              const to = await this.renameNote(path, item, lib)
              if (to) {
                result.renamed.push({ from: path, to })
                addToIndex(index, to, renderFileName(this.naming(lib), item))
                current = to
              }
            } catch (err) {
              result.failed.push({ title: item.title, error: `rename failed: ${errorText(err)}` })
            }
          }
          if (filling && lib.properties.some(m => m.fill)) {
            try {
              if (await this.fillNote(plex, machineId, current, item, lib, kind)) result.filled.push(current)
            } catch (err) {
              result.failed.push({ title: item.title, error: `filling in failed: ${errorText(err)}` })
            }
          }
          if (counting) {
            try {
              if (await this.updatePlayCount(current, item, lib)) result.playCounts.push(current)
            } catch (err) {
              result.failed.push({ title: item.title, error: `updating the play count failed: ${errorText(err)}` })
            }
          }
        }
      }
    }
    if (!full) return result

    for (const { item: listed, lib: listedLib } of entries) {
      const index = indexes[familyOf(listedLib)]
      if (hasNote(index, listed, this.naming(listedLib), listedLib.matchBy)) {
        result.skipped++
        continue
      }
      try {
        progress(`Creating ${listed.title}…`)
        const item = await this.fullItem(plex, listed)
        const { lib, kind } = this.libraryFor(item, listedLib)
        const path = await this.createNote(plex, machineId, item, lib, kind)
        result.created.push(path)
        addToIndex(index, path, renderFileName(this.naming(lib), item), [item.ratingKey])
      } catch (err) {
        result.failed.push({ title: listed.title, error: errorText(err) })
      }
    }
    return result
  }

  /**
   * Movies and shows are fetched again for their full metadata (the listing can leave out genres).
   * Tracks keep their listing, which is complete, plus their album, fetched once per album.
   */
  private async fullItem(plex: PlexClient, listed: PlexItem): Promise<PlexItem> {
    if (listed.type !== 'track') return (await plex.item(listed.ratingKey).catch(() => null)) ?? listed
    const albumKey = listed.parentRatingKey
    if (!albumKey) return listed
    let album = this.albums.get(albumKey)
    if (!album) {
      album = plex.item(albumKey).catch(() => null)
      this.albums.set(albumKey, album)
    }
    return { ...listed, album: (await album) ?? undefined }
  }

  /**
   * Renames an existing note to its library's file name format, in its current folder. Only the
   * file name changes; links to it are updated according to Obsidian's own setting. Returns the
   * new path, or null when the name is already right.
   */
  private async renameNote(path: string, item: PlexItem, lib: LibrarySetting): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    const baseName = renderFileName(this.naming(lib), item)
    if (isNamedAs(file.basename, baseName)) return null
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const to = normalizePath(parent ? `${parent}/${baseName}.${file.extension}` : `${baseName}.${file.extension}`)
    const taken = this.app.vault.getAbstractFileByPath(to)
    // A case-only change finds the note itself, which is fine to rename.
    if (taken && taken !== file) {
      throw new Error(`${to} already exists`)
    }
    await this.app.fileManager.renameFile(file, to)
    return to
  }

  /**
   * Fills in the properties marked "fill in on existing notes" (in the note's library settings)
   * that are missing or empty in an existing note. Nothing else in the note changes, and values
   * already there are never replaced. Returns whether anything was added.
   */
  private async fillNote(plex: PlexClient, machineId: string, path: string, listed: PlexItem, lib: ActiveLibrary, kind: MediaKind): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const wanted = lib.properties.filter(m => m.fill && m.name.trim() && isBlank(current[m.name.trim()]))
    if (!wanted.length) return false

    // The link needs nothing more; everything else may need the item's full metadata.
    const needsMore = wanted.some(m => m.source !== 'plexLink' && m.source !== 'text' && m.source !== 'typeTag')
    const item = needsMore ? await this.fullItem(plex, listed) : listed
    const image = usesSource(wanted, 'poster')
      ? await this.imageFor(plex, item, normalizePath(lib.folder), renderFileName(this.naming(lib), item))
      : null
    const values = buildFrontmatter(item, wanted, {
      kind,
      link: plexWebLink(machineId, item.ratingKey),
      image,
      values: lib.values,
    })
    const additions = Object.entries(values).filter(([, value]) => !isBlank(value))
    if (!additions.length) return false
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [name, value] of additions) {
        if (isBlank(fm[name])) fm[name] = value
      }
    })
    return true
  }

  /**
   * Sets the note's "Play count" properties (as named in its library's settings) to Plex's current
   * count. The one case where a value already in a note is replaced. Returns whether it changed.
   */
  private async updatePlayCount(path: string, item: PlexItem, lib: LibrarySetting): Promise<boolean> {
    const names = lib.properties.filter(m => m.source === 'viewCount' && m.name.trim()).map(m => m.name.trim())
    if (!names.length) return false
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false
    const count = playCount(item)
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    if (names.every(name => current[name] === count)) return false
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const name of names) fm[name] = count
    })
    return true
  }

  /** Rating keys (from the Plex link property) and file names of every note in these libraries' folders. */
  private indexExistingNotes(libs: LibrarySetting[]): ExistingNotes {
    const index: ExistingNotes = emptyIndex()
    if (!libs.length) return index
    const folders = [...new Set(libs.map(lib => normalizePath(lib.folder)))]
    const linkProps = [...new Set(Object.values(this.settings.libraries).flatMap(lib => linkPropertyNames(lib.properties)))]
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some(folder => file.path.startsWith(`${folder}/`))) continue
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
      const ratingKeys = linkProps
        .map(prop => ratingKeyFromLink(frontmatter?.[prop]))
        .filter((key): key is string => key !== null)
      addToIndex(index, file.path, file.basename, ratingKeys)
    }
    return index
  }

  private async createNote(plex: PlexClient, machineId: string, item: PlexItem, lib: ActiveLibrary, kind: MediaKind): Promise<string> {
    const folder = normalizePath(lib.folder)
    await this.ensureFolder(folder)
    const baseName = renderFileName(this.naming(lib), item)
    const path = this.freePath(folder, baseName, 'md')

    const { properties, values } = lib
    const image = usesSource(properties, 'poster') ? await this.imageFor(plex, item, folder, baseName) : null
    const frontmatter = buildFrontmatter(item, properties, {
      kind,
      link: plexWebLink(machineId, item.ratingKey),
      image,
      values,
    })

    const file = await this.app.vault.create(path, '')
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      Object.assign(fm, frontmatter)
    })
    return path
  }

  /** The item's poster (for a track, its album's cover, shared by the album's tracks), saved and linked. */
  private async imageFor(plex: PlexClient, item: PlexItem, folder: string, baseName: string): Promise<string | null> {
    const track = item.type === 'track'
    const thumb = track ? item.parentThumb ?? item.thumb : item.thumb
    if (!thumb) return null
    const imageName = track && item.grandparentTitle && item.parentTitle
      ? sanitizeFileName(`${item.grandparentTitle} - ${item.parentTitle}`, this.settings.fileNameReplacements)
      : baseName
    return this.savePoster(plex, thumb, folder, imageName || baseName)
  }

  /** Saves the poster in the library folder's images subfolder and returns a link to it. */
  private async savePoster(plex: PlexClient, thumb: string, libraryFolder: string, baseName: string): Promise<string | null> {
    const folder = normalizePath(`${libraryFolder}/${this.settings.imagesSubfolder}`)
    for (const ext of ['jpg', 'png', 'webp']) {
      const existing = this.app.vault.getAbstractFileByPath(`${folder}/${baseName}.${ext}`)
      if (existing instanceof TFile) return `[[${existing.path}]]`
    }
    const image = await plex.poster(thumb)
    if (!image) return null
    await this.ensureFolder(folder)
    const path = this.freePath(folder, baseName, image.extension)
    await this.app.vault.createBinary(path, image.data)
    return `[[${path}]]`
  }

  private freePath(folder: string, baseName: string, ext: string): string {
    let path = normalizePath(`${folder}/${baseName}.${ext}`)
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
      path = normalizePath(`${folder}/${baseName} ${n}.${ext}`)
    }
    return path
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      const existing = this.app.vault.getAbstractFileByPath(current)
      if (existing instanceof TFolder) continue
      if (existing) throw new Error(`${current} is a file, not a folder`)
      await this.app.vault.createFolder(current)
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}
