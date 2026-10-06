import { App, normalizePath, TFile, TFolder } from 'obsidian'
import { describeValue, editKind, parseEdit, type ApprovalLine, type ApprovalRequest, type Approver } from './approval-modal'
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
  displayName,
  type ExistingNotes,
  type FileNaming,
  type MediaKind,
  type PlexItem,
} from './notes'
import { PlexClient } from './plex'
import { buildFrontmatter, linkPropertyNames, playCount } from './properties'

export interface SyncResult {
  created: string[]
  renamed: { from: string, to: string }[]
  /** Existing notes that got empty properties filled in. */
  filled: string[]
  /** Existing notes whose play count changed. */
  playCounts: string[]
  /** Creations and changes you said no to. */
  declined: number
  /** You pressed Stop. */
  stopped: boolean
  /** Items passed over because "Skip every time" was chosen for them, now or before. */
  ignored: number
  /** Items "Skip every time" was chosen for in this sync. */
  newlyIgnored: string[]
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

/** What was approved: the lines unticked, and the new values edited. */
interface Approval {
  excluded: Set<string>
  edits: Record<string, string | string[]>
}

/** A value for the approval pop-up, editable as text, a number or a list. */
function editable(value: unknown): Pick<ApprovalLine, 'value' | 'edit' | 'items'> {
  const edit = editKind(value)
  return {
    value: describeValue(value),
    edit,
    items: edit === 'list' ? (value as unknown[]).map(String) : undefined,
  }
}

interface FillPlan {
  item: PlexItem
  additions: [string, unknown][]
  /** The property the poster goes in, if it's wanted and Plex has one; downloaded only once approved. */
  imageProperty: string | null
}

function hasImage(item: PlexItem): boolean {
  return Boolean(item.type === 'track' ? item.parentThumb ?? item.thumb : item.thumb)
}

interface Entry {
  item: PlexItem
  lib: ActiveLibrary
}

export class PlexSync {
  private readonly albums = new Map<string, Promise<PlexItem | null>>()

  /** "Apply to all the rest" was chosen, per kind of approval, with the lines unticked then. */
  private readonly approvedAll: Record<ApprovalRequest['action'], Set<string> | null> = { create: null, change: null }

  constructor(
    private readonly app: App,
    private readonly settings: PlexNotesSettings,
    private readonly saveSettings: () => Promise<void>,
    /** Asks before each creation or change when "Ask before every change" is on. */
    private readonly approve?: Approver,
  ) {}

  /**
   * Whether to go ahead with one creation or change, and which of its lines were unticked
   * (those parts are left out). Null means no.
   */
  private async ask(request: ApprovalRequest, result: SyncResult, item: PlexItem, lib: LibrarySetting): Promise<Approval | null> {
    if (result.stopped) return null
    if (!this.settings.askBeforeChanges || !this.approve) return { excluded: new Set(), edits: {} }
    const remembered = this.approvedAll[request.action]
    if (remembered) return { excluded: remembered, edits: {} }
    const { choice, excluded, edits } = await this.approve(request)
    const skipped = new Set(excluded)
    // "All the rest" repeats the unticked lines, not this note's edits.
    if (choice === 'all') this.approvedAll[request.action] = skipped
    if (choice === 'stop') result.stopped = true
    if (choice === 'apply' || choice === 'all') return { excluded: skipped, edits: edits ?? {} }
    if (choice === 'ignore') {
      this.settings.ignored[item.ratingKey] = { name: displayName(item), library: lib.title, since: Date.now() }
      result.newlyIgnored.push(displayName(item))
      result.ignored++
      return null
    }
    result.declined++
    return null
  }

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
    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [], declined: 0, stopped: false, ignored: 0, newlyIgnored: [] }

    const entries: Entry[] = []
    for (const [key, lib] of active) {
      progress(`Reading ${lib.title}…`)
      const music = lib.target === 'music'
      for (const item of await plex.libraryItems(key, music)) {
        const wanted = music ? item.type === 'track' : item.type === 'movie' || item.type === 'show'
        if (wanted) entries.push({ item, lib })
      }
    }

    result.ignored = entries.filter(({ item }) => this.isIgnored(item)).length

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
        const plans = planRenames(matches)
        let position = 0
        for (const { item, path } of plans) {
          position++
          if (result.stopped) break
          // Ignored items still count above, so their notes are never taken for another item.
          if (this.isIgnored(item)) continue
          const { lib, kind } = this.libraryFor(item, libOf.get(item)!)
          const file = this.app.vault.getAbstractFileByPath(path)
          if (!(file instanceof TFile)) continue

          // Work out every change first, so it can be shown before anything happens.
          let renameTo: string | null = null
          if (renaming) {
            try {
              renameTo = this.renameTarget(file, item, lib)
            } catch (err) {
              result.failed.push({ title: item.title, error: `rename failed: ${errorText(err)}` })
            }
          }
          let fill: FillPlan | null = null
          if (filling && lib.properties.some(m => m.fill)) {
            try {
              fill = await this.planFill(plex, machineId, file, item, lib, kind)
            } catch (err) {
              result.failed.push({ title: item.title, error: `filling in failed: ${errorText(err)}` })
            }
          }
          const plays = counting ? this.planPlayCount(file, item, lib) : null
          if (!renameTo && !fill && !plays) continue

          const lines: ApprovalLine[] = []
          const now = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
          if (renameTo) {
            const newName = renameTo.split('/').pop()!.replace(/\.md$/, '')
            lines.push({ key: 'rename', label: 'File name', current: file.basename, value: newName, edit: 'text' })
          }
          for (const [name, value] of fill?.additions ?? []) {
            lines.push({ key: `add:${name}`, label: name, current: describeValue(now[name]), ...editable(value) })
          }
          if (fill?.imageProperty) {
            const name = fill.imageProperty
            lines.push({ key: `add:${name}`, label: name, current: describeValue(now[name]), value: 'poster downloaded from Plex' })
          }
          for (const name of plays?.names ?? []) {
            lines.push({ key: `update:${name}`, label: name, current: describeValue(plays!.from[name]), value: String(plays!.count), edit: 'number' })
          }
          const approval = await this.ask({ action: 'change', path, lines, position, total: plans.length }, result, item, lib)
          if (!approval) continue
          const { excluded, edits } = approval
          // Leave out whatever was unticked, and use whatever was edited.
          if (excluded.has('rename')) renameTo = null
          else if (renameTo && typeof edits.rename === 'string') {
            try {
              renameTo = this.renameTargetFor(file, sanitizeFileName(edits.rename, this.settings.fileNameReplacements))
            } catch (err) {
              renameTo = null
              result.failed.push({ title: item.title, error: `rename failed: ${errorText(err)}` })
            }
          }
          if (fill) {
            fill = {
              ...fill,
              additions: fill.additions
                .filter(([name]) => !excluded.has(`add:${name}`))
                .map(([name, value]): [string, unknown] => {
                  const edited = edits[`add:${name}`]
                  return [name, edited === undefined ? value : parseEdit(edited, editKind(value))]
                })
                .filter(([, value]) => !isBlank(value)),
              imageProperty: fill.imageProperty && !excluded.has(`add:${fill.imageProperty}`) ? fill.imageProperty : null,
            }
          }
          const playNames = (plays?.names ?? []).filter(name => !excluded.has(`update:${name}`))
          const playValue = (name: string): unknown => {
            const edited = edits[`update:${name}`]
            return edited === undefined ? plays!.count : parseEdit(edited, 'number')
          }
          if (!renameTo && !fill?.additions.length && !fill?.imageProperty && !playNames.length) {
            result.declined++
            continue
          }

          try {
            if (renameTo) {
              await this.app.fileManager.renameFile(file, renameTo)
              result.renamed.push({ from: path, to: renameTo })
              addToIndex(index, renameTo, renderFileName(this.naming(lib), item))
            }
            if (fill && await this.applyFill(plex, file, fill, lib)) result.filled.push(file.path)
            if (plays && playNames.length) {
              await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                for (const name of playNames) fm[name] = playValue(name)
              })
              result.playCounts.push(file.path)
            }
          } catch (err) {
            result.failed.push({ title: item.title, error: errorText(err) })
          }
        }
      }
    }
    if (!full) return this.finish(result)

    const toCreate = entries.filter(({ item, lib }) =>
      !this.isIgnored(item) && !hasNote(indexes[familyOf(lib)], item, this.naming(lib), lib.matchBy))
    result.skipped = entries.length - toCreate.length - result.ignored
    let position = 0
    for (const { item: listed, lib: listedLib } of toCreate) {
      position++
      if (result.stopped) break
      const index = indexes[familyOf(listedLib)]
      // An item listed twice (in two libraries) gets one note.
      if (hasNote(index, listed, this.naming(listedLib), listedLib.matchBy)) {
        result.skipped++
        continue
      }
      try {
        progress(`Creating ${listed.title}…`)
        const item = await this.fullItem(plex, listed)
        const { lib, kind } = this.libraryFor(item, listedLib)
        const preview = this.previewNote(machineId, item, lib, kind)
        const approval = await this.ask({ action: 'create', path: preview.path, lines: preview.lines, position, total: toCreate.length }, result, item, lib)
        if (!approval) continue
        const { excluded, edits } = approval
        const left = new Set([...excluded].filter(k => k.startsWith('prop:')).map(k => k.slice(5)))
        const overrides: Record<string, unknown> = {}
        for (const [key, edited] of Object.entries(edits)) {
          if (!key.startsWith('prop:')) continue
          const name = key.slice(5)
          overrides[name] = parseEdit(edited, editKind(preview.values[name]))
        }
        const fileName = typeof edits.file === 'string'
          ? sanitizeFileName(edits.file, this.settings.fileNameReplacements) || undefined
          : undefined
        const path = await this.createNote(plex, machineId, item, lib, kind, left, overrides, fileName)
        result.created.push(path)
        const baseName = path.split('/').pop()!.replace(/\.md$/, '')
        addToIndex(index, path, renderFileName(this.naming(lib), item), [item.ratingKey])
        addToIndex(index, path, baseName)
      } catch (err) {
        result.failed.push({ title: listed.title, error: errorText(err) })
      }
    }
    return this.finish(result)
  }

  private isIgnored(item: PlexItem): boolean {
    return item.ratingKey in this.settings.ignored
  }

  /** Saves newly ignored items before handing back the result. */
  private async finish(result: SyncResult): Promise<SyncResult> {
    if (result.newlyIgnored.length) await this.saveSettings()
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
   * Where an existing note would be renamed to (its library's file name format, in its current
   * folder), or null when its name is already right. Throws when the new name is taken.
   */
  private renameTarget(file: TFile, item: PlexItem, lib: LibrarySetting): string | null {
    const baseName = renderFileName(this.naming(lib), item)
    if (isNamedAs(file.basename, baseName)) return null
    return this.renameTargetFor(file, baseName)
  }

  /** The path for renaming a note to this name in its folder. Throws when the name is taken. */
  private renameTargetFor(file: TFile, baseName: string): string | null {
    if (!baseName || baseName === file.basename) return null
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    const to = normalizePath(parent ? `${parent}/${baseName}.${file.extension}` : `${baseName}.${file.extension}`)
    const taken = this.app.vault.getAbstractFileByPath(to)
    // A case-only change finds the note itself, which is fine to rename.
    if (taken && taken !== file) throw new Error(`${to} already exists`)
    return to
  }

  /**
   * The properties marked "fill in on existing notes" that are missing or empty in this note, with
   * the values Plex has for them. Null when there's nothing to add.
   */
  private async planFill(plex: PlexClient, machineId: string, file: TFile, listed: PlexItem, lib: ActiveLibrary, kind: MediaKind): Promise<FillPlan | null> {
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const wanted = lib.properties.filter(m => m.fill && m.name.trim() && isBlank(current[m.name.trim()]))
    if (!wanted.length) return null

    // The link needs nothing more; everything else may need the item's full metadata.
    const needsMore = wanted.some(m => m.source !== 'plexLink' && m.source !== 'text' && m.source !== 'typeTag')
    const item = needsMore ? await this.fullItem(plex, listed) : listed
    const values = buildFrontmatter(item, wanted.filter(m => m.source !== 'poster'), {
      kind,
      link: plexWebLink(machineId, item.ratingKey),
      image: null,
      values: lib.values,
    })
    const additions = Object.entries(values).filter(([, value]) => !isBlank(value))
    const poster = wanted.find(m => m.source === 'poster')
    const imageProperty = poster && hasImage(item) ? poster.name.trim() : null
    if (!additions.length && !imageProperty) return null
    return { item, additions, imageProperty }
  }

  /** Adds the planned properties, downloading the poster if one is wanted. Never replaces a value. */
  private async applyFill(plex: PlexClient, file: TFile, plan: FillPlan, lib: ActiveLibrary): Promise<boolean> {
    const additions = [...plan.additions]
    if (plan.imageProperty) {
      const image = await this.imageFor(plex, plan.item, normalizePath(lib.folder), renderFileName(this.naming(lib), plan.item))
      if (image) additions.push([plan.imageProperty, image])
    }
    if (!additions.length) return false
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [name, value] of additions) {
        if (isBlank(fm[name])) fm[name] = value
      }
    })
    return true
  }

  /**
   * The note's "Play count" properties (as named in its library's settings) that differ from
   * Plex's current count: the one case where a value already in a note is replaced.
   */
  private planPlayCount(file: TFile, item: PlexItem, lib: LibrarySetting): { names: string[], from: Record<string, unknown>, count: number } | null {
    const names = lib.properties.filter(m => m.source === 'viewCount' && m.name.trim()).map(m => m.name.trim())
    if (!names.length) return null
    const count = playCount(item)
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const changed = names.filter(name => from[name] !== count)
    return changed.length ? { names: changed, from, count } : null
  }

  /** The path and properties a new note would get, for the approval pop-up. */
  private previewNote(machineId: string, item: PlexItem, lib: ActiveLibrary, kind: MediaKind): { path: string, lines: ApprovalLine[], values: Record<string, unknown> } {
    const folder = normalizePath(lib.folder)
    const path = this.freePath(folder, renderFileName(this.naming(lib), item), 'md')
    const fileName = path.split('/').pop()!.replace(/\.md$/, '')
    const frontmatter = buildFrontmatter(item, lib.properties, {
      kind,
      link: plexWebLink(machineId, item.ratingKey),
      image: hasImage(item) ? 'poster downloaded from Plex' : null,
      values: lib.values,
    })
    const lines: ApprovalLine[] = [{ key: 'file', label: 'File name', value: fileName, edit: 'text', required: true }]
    for (const [name, value] of Object.entries(frontmatter)) {
      const poster = value === 'poster downloaded from Plex'
      lines.push(poster
        ? { key: `prop:${name}`, label: name, value: describeValue(value) }
        : { key: `prop:${name}`, label: name, ...editable(value) })
    }
    return { path, lines, values: frontmatter }
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

  /**
   * Creates the note. Properties named in `leaveEmpty` (unticked when approving) are added empty,
   * `overrides` replace values (edited when approving), and `fileName` replaces the file name.
   */
  private async createNote(
    plex: PlexClient, machineId: string, item: PlexItem, lib: ActiveLibrary, kind: MediaKind,
    leaveEmpty = new Set<string>(), overrides: Record<string, unknown> = {}, fileName?: string,
  ): Promise<string> {
    const folder = normalizePath(lib.folder)
    await this.ensureFolder(folder)
    const baseName = fileName ?? renderFileName(this.naming(lib), item)
    const path = this.freePath(folder, baseName, 'md')

    const { properties, values } = lib
    const posterWanted = properties.some(m => m.source === 'poster' && m.name.trim() && !leaveEmpty.has(m.name.trim()))
    const image = posterWanted ? await this.imageFor(plex, item, folder, baseName) : null
    const frontmatter = buildFrontmatter(item, properties, {
      kind,
      link: plexWebLink(machineId, item.ratingKey),
      image,
      values,
    })
    for (const [name, value] of Object.entries(overrides)) {
      if (name in frontmatter) frontmatter[name] = value
    }
    for (const name of leaveEmpty) {
      if (name in frontmatter) frontmatter[name] = Array.isArray(frontmatter[name]) ? [] : null
    }

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
