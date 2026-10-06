import { App, normalizePath, TFile, TFolder } from 'obsidian'
import {
  addToIndex,
  classify,
  emptyIndex,
  findNote,
  hasNote,
  planRenames,
  plexWebLink,
  ratingKeyFromLink,
  renderFileName,
  type ExistingNotes,
  type LibraryTarget,
  type MediaKind,
  type PlexItem,
} from './notes'
import { PlexClient } from './plex'
import { buildFrontmatter, linkPropertyNames, usesSource } from './properties'
import { mergeLibraries, type PlexNotesSettings } from './settings'

export interface SyncResult {
  created: string[]
  renamed: { from: string, to: string }[]
  skipped: number
  failed: { title: string, error: string }[]
}

export type ProgressFn = (message: string) => void

export class PlexSync {
  constructor(
    private readonly app: App,
    private readonly settings: PlexNotesSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  private folderFor(kind: MediaKind): string {
    const folder = kind === 'movie'
      ? this.settings.moviesFolder
      : kind === 'tv' ? this.settings.tvFolder : this.settings.documentariesFolder
    return normalizePath(folder)
  }

  async run(progress: ProgressFn): Promise<SyncResult> {
    const { serverUrl, token } = this.settings
    if (!serverUrl || !token) throw new Error('Set the Plex server address and token in the plugin settings first')

    const plex = new PlexClient(serverUrl, token)
    progress('Connecting to Plex…')
    const machineId = await plex.machineIdentifier()

    mergeLibraries(this.settings, await plex.libraries())
    await this.saveSettings()

    const format = this.settings.fileNameFormat
    const existing = this.indexExistingNotes()
    const result: SyncResult = { created: [], renamed: [], skipped: 0, failed: [] }

    const entries: { item: PlexItem, target: Exclude<LibraryTarget, 'skip'> }[] = []
    for (const [key, library] of Object.entries(this.settings.libraries)) {
      if (library.target === 'skip') continue
      progress(`Reading ${library.title}…`)
      for (const item of await plex.libraryItems(key)) {
        if (item.type === 'movie' || item.type === 'show') entries.push({ item, target: library.target })
      }
    }

    if (this.settings.renameExistingNotes) {
      progress('Checking existing note names…')
      const matches = entries.map(({ item }) => ({ item, match: findNote(existing, item, format) }))
      for (const { item, path } of planRenames(matches)) {
        try {
          const to = await this.renameNote(path, item)
          if (to) {
            result.renamed.push({ from: path, to })
            addToIndex(existing, to, renderFileName(format, item))
          }
        } catch (err) {
          result.failed.push({ title: item.title, error: `rename failed: ${errorText(err)}` })
        }
      }
    }

    for (const { item: listed, target } of entries) {
      if (hasNote(existing, listed, format)) {
        result.skipped++
        continue
      }
      try {
        progress(`Creating ${listed.title}…`)
        const item = (await plex.item(listed.ratingKey).catch(() => null)) ?? listed
        const path = await this.createNote(plex, machineId, item, classify(item, target, this.settings.useDocumentaryGenre))
        result.created.push(path)
        addToIndex(existing, path, renderFileName(format, item), [item.ratingKey])
      } catch (err) {
        result.failed.push({ title: listed.title, error: errorText(err) })
      }
    }
    return result
  }

  /**
   * Renames an existing note to the file name format, in its current folder. Only the file name
   * changes; links to it are updated according to Obsidian's own setting. Returns the new path,
   * or null when the name is already right or the new name is taken.
   */
  private async renameNote(path: string, item: PlexItem): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    const baseName = renderFileName(this.settings.fileNameFormat, item)
    if (file.basename === baseName) return null
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

  /** Rating keys (from the Plex link property) and file names of every note in the three media folders. */
  private indexExistingNotes(): ExistingNotes {
    const index: ExistingNotes = emptyIndex()
    const folders = (['movie', 'tv', 'documentary'] as const).map(kind => this.folderFor(kind))
    const linkProps = linkPropertyNames(this.settings.properties)
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

  private async createNote(plex: PlexClient, machineId: string, item: PlexItem, kind: MediaKind): Promise<string> {
    const folder = this.folderFor(kind)
    await this.ensureFolder(folder)
    const baseName = renderFileName(this.settings.fileNameFormat, item)
    const path = this.freePath(folder, baseName, 'md')

    const { properties, values } = this.settings
    const image = item.thumb && usesSource(properties, 'poster')
      ? await this.savePoster(plex, item.thumb, folder, baseName)
      : null
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

  /** Saves the poster in the media folder's images subfolder and returns a link to it. */
  private async savePoster(plex: PlexClient, thumb: string, mediaFolder: string, baseName: string): Promise<string | null> {
    const folder = normalizePath(`${mediaFolder}/${this.settings.imagesSubfolder}`)
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
