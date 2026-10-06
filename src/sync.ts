import { App, normalizePath, TFile, TFolder } from 'obsidian'
import {
  classify,
  hasNote,
  normalizeTitle,
  plexWebLink,
  ratingKeyFromLink,
  renderFileName,
  type ExistingNotes,
  type MediaKind,
  type PlexItem,
} from './notes'
import { PlexClient } from './plex'
import { buildFrontmatter, linkPropertyNames, usesSource } from './properties'
import { mergeLibraries, type PlexNotesSettings } from './settings'

export interface SyncResult {
  created: string[]
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

    const existing = this.indexExistingNotes()
    const result: SyncResult = { created: [], skipped: 0, failed: [] }

    for (const [key, library] of Object.entries(this.settings.libraries)) {
      if (library.target === 'skip') continue
      progress(`Reading ${library.title}…`)
      const items = await plex.libraryItems(key)

      for (const listed of items) {
        if (listed.type !== 'movie' && listed.type !== 'show') continue
        if (hasNote(existing, listed, this.settings.fileNameFormat)) {
          result.skipped++
          continue
        }
        try {
          progress(`Creating ${listed.title}…`)
          const item = (await plex.item(listed.ratingKey).catch(() => null)) ?? listed
          const path = await this.createNote(plex, machineId, item, classify(item, library.target, this.settings.useDocumentaryGenre))
          result.created.push(path)
          existing.ratingKeys.add(item.ratingKey)
          existing.names.add(normalizeTitle(renderFileName(this.settings.fileNameFormat, item)))
        } catch (err) {
          result.failed.push({ title: listed.title, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    return result
  }

  /** Rating keys (from the Plex link property) and file names of every note in the three media folders. */
  private indexExistingNotes(): ExistingNotes {
    const index: ExistingNotes = { ratingKeys: new Set(), names: new Set() }
    const folders = (['movie', 'tv', 'documentary'] as const).map(kind => this.folderFor(kind))
    const linkProps = linkPropertyNames(this.settings.properties)
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some(folder => file.path.startsWith(`${folder}/`))) continue
      index.names.add(normalizeTitle(file.basename))
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
      for (const prop of linkProps) {
        const ratingKey = ratingKeyFromLink(frontmatter?.[prop])
        if (ratingKey) index.ratingKeys.add(ratingKey)
      }
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
