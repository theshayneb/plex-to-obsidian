import { App, normalizePath, TFile, TFolder } from 'obsidian'
import { FILE_NAME } from './check-modal'
import { describeValue, editKind, parseEdit, type ApprovalLine, type ApprovalRequest, type UnchangedLine, type Approver, type OwnerChooser } from './approval-modal'
import {
  BOOKS_LIBRARY,
  ensureSteamLibrary,
  hasSource,
  mergeLibraries,
  plexReady,
  STEAM_LIBRARY,
  steamReady,
  type LibrarySetting,
  type PlexNotesSettings,
} from './config'
import {
  addToIndex,
  ambiguousNotes,
  emptyIndex,
  findNote,
  hasNote,
  normalizeTitle,
  isNamedAs,
  planRenames,
  plexWebLink,
  isSearchLink,
  itemKeys,
  songNameVariants,
  ratingKeyFromLink,
  renderFileName,
  sanitizeFileName,
  steamStoreUrl,
  displayName,
  type ExistingNotes,
  type FileNaming,
  type MediaKind,
  type PlexItem,
} from './notes'
import { lookUpBook } from './discover'
import { PlexClient } from './plex'
import { HltbClient } from './hltb'
import { buildFrontmatter, CHECKED_SOURCES, HLTB_SOURCES, sameLengthOtherForm, linkPropertyNames, checkValue, listOf, PLAY_SOURCES, MIRRORED_SOURCES, noteStars, ratingDirection, ratingLabel, RATING_SOURCES, starEmoji, type RatingScale, sameValue, sourceValue, userStars, vagueDate, playtimeShrinks, STATUS_SOURCES, statusMovesForward, UNCHECKED_SOURCES, usesSource, type FieldSource } from './properties'
import { SteamClient } from './steam'
import { readSteamCollections } from './steam-local'
import { readFileTags, readLyrics } from './music-files'
import { steamGridCovers, type CoverChoice } from './steamgriddb'

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
  /** Existing notes chosen with "Use an existing note" in this sync. */
  merged: string[]
  /** Existing notes whose link was replaced with the item's own (when you ticked it). */
  links: string[]
  /** Existing notes with a value corrected to the source's (durations; anything in a check). */
  corrected: string[]
  /** Notes in the libraries' folders that no item matched (full syncs and checks). */
  unmatched: string[]
  /** Notes a check compared with their source (whether or not anything differed). */
  checked: string[]
  /** Why some of the unmatched notes match nothing, by path (when their link says). */
  unmatchedWhy: Record<string, string>
  /** Notes whose rating was sent to Plex. */
  sentRatings: string[]
  /** Links and values you chose to keep in this sync. */
  keptLinks: number
  skipped: number
  failed: { title: string, error: string }[]
}

export type ProgressFn = (message: string) => void

/** 'full' creates, renames and fills in notes; 'playCounts' only refreshes play counts (and ratings, if kept up to date) in existing notes. */
/** 'check' is "Check existing notes against sources": it only compares the chosen properties, always asking. */
export type SyncMode = 'full' | 'playCounts' | 'check'

type ActiveLibrary = LibrarySetting & { target: MediaKind }

/**
 * Movies, shows and documentaries can match each other's notes (an item may move by genre);
 * music only matches music, and games only games.
 */
type Family = 'video' | 'music' | 'game' | 'book'
const FAMILIES: Family[] = ['video', 'music', 'game', 'book']
const familyOf = (lib: ActiveLibrary): Family =>
  (lib.target === 'music' || lib.target === 'game' || lib.target === 'book' ? lib.target : 'video')

/** What was approved: the lines unticked, and the new values edited. */
interface Approval {
  excluded: Set<string>
  edits: Record<string, string | string[]>
  /** "Use an existing note": the note chosen instead of creating one. */
  mergeWith?: string
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

/** Sources holding an image. */
const IMAGE_SOURCES: FieldSource[] = ['poster', 'wideImage']

/** A note's ratings in an older scale, and the same ratings in the star scale, to offer. */
interface Rescale {
  names: string[]
  from: Record<string, unknown>
  to: Record<string, string>
}

/** Values in a note that differ from the source's, offered to fix; `sameLength` names those offered ticked. */
interface Checks {
  names: string[]
  from: Record<string, unknown>
  to: Record<string, unknown>
  sameLength: Set<string>
  /** Those always offered unticked: images you picked yourself (a link to a file in the vault). */
  yours?: Set<string>
}

interface FillPlan {
  item: PlexItem
  /** For a game, the property its cover link goes in (offered with other covers to pick from). */
  coverProperty?: string
  additions: [string, unknown][]
  /** The property the poster goes in, if it's wanted and Plex has one; downloaded only once approved. */
  imageProperty: string | null
}

/** Items from Plex have numeric keys; the rest (Steam, IMDb, Open Library, HowLongToBeat) link their covers. */
function fromPlex(item: PlexItem): boolean {
  return /^\d+$/.test(item.ratingKey)
}

/** Whether Plex has a poster to download for this item. Games link their cover instead. */
function hasImage(item: PlexItem): boolean {
  return Boolean(item.type === 'track' ? item.parentThumb ?? item.thumb : item.thumb)
}

/** Sources whose properties should hold a plain number (minutes, pages). */
const NUMBER_SOURCES: FieldSource[] = ['durationMinutes', 'pages']

const POSTER_PREVIEW = 'poster downloaded from Plex'

interface Entry {
  item: PlexItem
  lib: ActiveLibrary
}

export class PlexSync {
  private readonly albums = new Map<string, Promise<PlexItem | null>>()
  private plex: PlexClient | null = null
  private machineId = ''
  private steam: SteamClient | null = null
  private hltb: HltbClient | null = null

  /** "Apply to all the rest" was chosen, per kind of approval, with the lines unticked then. */
  private readonly approvedAll: Record<ApprovalRequest['action'], Set<string> | null> = { create: null, change: null }

  constructor(
    private readonly app: App,
    private readonly settings: PlexNotesSettings,
    private readonly saveSettings: () => Promise<void>,
    /** Asks before each creation or change when "Ask before every change" is on. */
    private readonly approve?: Approver,
    /** Asks which item an existing note is for, when its name matches several. */
    private readonly chooseOwner?: OwnerChooser,
  ) {}

  /**
   * For each note whose name matches several items, asks which item it's for (in a full sync with
   * asking on). The index is updated so the chosen item matches the note through its link (and so
   * is offered renaming and filling in like any matched note), and the others get their own notes.
   */
  private async resolveAmbiguous(entries: Entry[], index: ExistingNotes, result: SyncResult): Promise<void> {
    if (!this.chooseOwner || !this.settings.askBeforeChanges) return
    const matches = entries.map(({ item, lib }) => ({ item, match: findNote(index, item, this.naming(lib), lib.matchBy) }))
    const libOf = new Map(entries.map(e => [e.item, e.lib]))
    for (const { path, items } of ambiguousNotes(matches)) {
      if (result.stopped) break
      const choice = await this.chooseOwner({
        path,
        candidates: items.map(item => ({ key: item.ratingKey, name: displayName(item), library: libOf.get(item)!.title })),
      })
      if (choice === null) continue
      const baseName = path.split('/').pop()!.replace(/\.md$/, '')
      // Tie the note to the chosen item (or to none), so name matching stops offering it to the others.
      addToIndex(index, path, baseName, [choice === 'none' ? `none:${path}` : choice])
      if (choice !== 'none') index.ratingKeys.set(choice, path)
    }
  }

  /**
   * Whether to go ahead with one creation or change, and which of its lines were unticked
   * (those parts are left out). Null means no.
   */
  /** Ask before every change even with asking switched off (for "Check existing notes against sources"). */
  private alwaysAsk = false
  /** A check of only some libraries: their settings keys (null: every library). */
  private onlyLibraries: Set<string> | null = null
  /** "Apply to the rest of this group": the lines left unticked then, by group. */
  private readonly approvedGroups = new Map<string, Set<string>>()

  /**
   * Whether you chose to keep a note's value over this offer before. Remembered with the offer you
   * turned down, so a different offer (the source corrected, say) is made again; older entries
   * only have the value kept.
   */
  private isKept(key: string, current: unknown, offer: unknown): boolean {
    const entry = this.settings.keptValues[key]
    if (entry === undefined) return false
    const kept = keptEntry(entry)
    return kept ? kept.kept === String(current) && kept.offered === offerText(offer) : entry === String(current)
  }

  /** Remembers keeping a note's value over an offer (see `isKept`). */
  private keep(key: string, current: unknown, offer: unknown): void {
    this.settings.keptValues[key] = JSON.stringify({ kept: String(current), offered: offerText(offer) })
  }

  /** The lines of a change that are about something you said never to change in that note. */
  private lockedLines(request: ApprovalRequest): string[] {
    const locked = request.action === 'change' ? this.settings.lockedProperties[request.path] : undefined
    return locked?.length ? request.lines.filter(l => locked.includes(l.label)).map(l => l.key) : []
  }

  private async ask(request: ApprovalRequest, result: SyncResult, item: PlexItem, lib: LibrarySetting): Promise<Approval | null> {
    if (result.stopped) return null
    // What you said never to change in this note is left out, unasked, however the rest is decided.
    const locked = this.lockedLines(request)
    if (locked.length) {
      const lines = request.lines.filter(l => !locked.includes(l.key))
      if (!lines.length) return { excluded: new Set(locked), edits: {} }
      request = { ...request, lines }
    }
    if ((!this.settings.askBeforeChanges && !this.alwaysAsk) || !this.approve) return { excluded: new Set(locked), edits: {} }
    const remembered = this.approvedAll[request.action] ?? (request.groupKey ? this.approvedGroups.get(request.groupKey) : undefined)
    // "All the rest" leaves out what was unticked then, and anything that would start unticked here
    // (a link, status, rating or image of your own): those are never changed without being seen.
    if (remembered) return { excluded: new Set([...remembered, ...locked, ...request.lines.filter(l => l.unticked).map(l => l.key)]), edits: {} }
    const shown = request.action === 'change' ? this.withWholeNote(request, lib) : request
    const { choice, excluded, edits, mergeWith, locked: lockedNow } = await this.approve(shown)
    // "Never for this note": remembered for this note whatever was chosen.
    const newlyLocked = request.lines.filter(l => lockedNow?.includes(l.label))
    if (newlyLocked.length) {
      const names = new Set([...this.settings.lockedProperties[request.path] ?? [], ...newlyLocked.map(l => l.label)])
      this.settings.lockedProperties[request.path] = [...names]
    }
    const lockedKeys = new Set(newlyLocked.map(l => l.key))
    // "All the rest" repeats the unticked lines (not ones locked for this note alone), not this note's edits.
    const unticked = new Set(excluded.filter(key => !lockedKeys.has(key)))
    const skipped = new Set([...excluded, ...locked])
    if (choice === 'all') this.approvedAll[request.action] = unticked
    if (choice === 'group' && request.groupKey) this.approvedGroups.set(request.groupKey, unticked)
    if (choice === 'stop') result.stopped = true
    if (choice === 'apply' || choice === 'all' || choice === 'group') {
      try {
        await this.applyOwnEdits(shown, edits ?? {}, result)
      } catch (err) {
        result.failed.push({ title: request.path, error: `your edits failed: ${errorText(err)}` })
      }
      return { excluded: skipped, edits: edits ?? {} }
    }
    if (choice === 'merge' && mergeWith) return { excluded: new Set(), edits: {}, mergeWith }
    if (choice === 'ignore') {
      this.settings.ignored[item.ratingKey] = { name: displayName(item), library: lib.title, since: Date.now() }
      result.newlyIgnored.push(displayName(item))
      result.ignored++
      return null
    }
    result.declined++
    return null
  }

  /**
   * A change pop-up with the rest of the note: its file name and every property no line is about,
   * in the note's order, and a warning on each duration (or page count) that isn't a number.
   */
  private withWholeNote(request: ApprovalRequest, lib: LibrarySetting): ApprovalRequest {
    const file = this.app.vault.getAbstractFileByPath(request.path)
    if (!(file instanceof TFile)) return request
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const numbers = new Set(lib.properties.filter(m => NUMBER_SOURCES.includes(m.source)).map(m => m.name.trim()))
    const warnOf = (name: string): string | undefined => {
      const value: unknown = frontmatter[name]
      return numbers.has(name) && !isBlank(value) && typeof value !== 'number' ? 'Not a number' : undefined
    }
    const lines = request.lines.map(line => line.key === 'rename' || !warnOf(line.label) ? line : { ...line, warn: warnOf(line.label) })
    const shown = new Set(lines.map(line => line.label))
    const rest: UnchangedLine[] = Object.entries(frontmatter)
      .filter(([name]) => !shown.has(name))
      .map(([name, value]) => {
        // Anything but a nested object can be edited here.
        const plain = value === null || typeof value !== 'object' || Array.isArray(value)
        const editing = plain ? { key: `own:${name}`, ...editable(value) } : {}
        // A duration or page count typed as a number is saved as one.
        if (numbers.has(name) && 'edit' in editing && editing.edit === 'text') editing.edit = 'number'
        return { label: name, value: describeValue(value), warn: warnOf(name), ...editing }
      })
    const unchanged = lines.some(line => line.key === 'rename') ? rest : [{ label: 'File name', value: file.basename, key: 'own-file', edit: 'text' as const }, ...rest]
    return { ...request, lines, unchanged }
  }

  /**
   * The edits you made in a change pop-up to properties (or the file name) it wasn't changing:
   * written as soon as you approve, before the pop-up's own changes.
   */
  private async applyOwnEdits(request: ApprovalRequest, edits: Record<string, string | string[]>, result: SyncResult): Promise<void> {
    const own = (request.unchanged ?? []).filter(line => line.key && line.edit && line.key in edits)
    if (!own.length) return
    const file = this.app.vault.getAbstractFileByPath(request.path)
    if (!(file instanceof TFile)) return
    const properties = own.filter(line => line.key !== 'own-file')
    if (properties.length) {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const line of properties) fm[line.label] = parseEdit(edits[line.key!], line.edit!) ?? (line.edit === 'list' ? [] : null)
      })
    }
    const renamed = own.find(line => line.key === 'own-file')
    if (renamed) {
      const from = file.path
      const to = this.renameTargetFor(file, sanitizeFileName(String(edits['own-file']), this.settings.fileNameReplacements))
      if (to) {
        await this.app.fileManager.renameFile(file, to)
        result.renamed.push({ from, to })
      }
    }
    if (!result.corrected.includes(file.path)) result.corrected.push(file.path)
  }

  private naming(lib: LibrarySetting): FileNaming {
    return { format: lib.fileNameFormat, replacements: this.settings.fileNameReplacements }
  }

  /** The library whose settings make this item's note: always its own (documentaries only come from documentary libraries). */
  private libraryFor(_item: PlexItem, lib: ActiveLibrary): { lib: ActiveLibrary, kind: MediaKind } {
    return { lib, kind: lib.target }
  }

  /**
   * Connects to Plex and Steam, refreshes the library list (unless only play counts are wanted),
   * reads every active library and indexes the notes already in their folders.
   */
  private async prepare(progress: ProgressFn, refresh: boolean, readTags = true): Promise<{ active: [string, ActiveLibrary][], indexes: Record<Family, ExistingNotes>, entries: Entry[] }> {
    const usePlex = plexReady(this.settings)
    const useSteam = steamReady(this.settings)
    if (!usePlex && !useSteam) throw new Error('Set up Plex or Steam in the plugin settings first')

    if (usePlex) {
      const { serverUrl, token } = this.settings
      this.plex = new PlexClient(serverUrl, token)
      progress('Connecting to Plex…')
      this.machineId = await this.plex.machineIdentifier()
      if (refresh) mergeLibraries(this.settings, await this.plex.libraries())
    }
    if (useSteam) {
      const { apiKey, account, includeFreeGames } = this.settings.steam
      this.steam = new SteamClient(apiKey.trim(), account.trim(), includeFreeGames)
      if (refresh) ensureSteamLibrary(this.settings)
    }
    if (refresh) await this.saveSettings()

    const active = Object.entries(this.settings.libraries)
      .filter((e): e is [string, ActiveLibrary] => e[1].target !== 'skip')
      .filter(([key]) => hasSource(key) && (key === STEAM_LIBRARY ? useSteam : usePlex))
      .filter(([key]) => !this.onlyLibraries || this.onlyLibraries.has(key))
    const indexes = Object.fromEntries(FAMILIES.map(family =>
      [family, this.indexExistingNotes(active.map(([, lib]) => lib).filter(lib => familyOf(lib) === family))])) as Record<Family, ExistingNotes>
    for (const family of FAMILIES) this.addMerged(indexes[family], family)

    const entries: Entry[] = []
    for (const [key, lib] of active) {
      progress(`Reading ${lib.title}…`)
      if (key === STEAM_LIBRARY) {
        const games = await this.steam!.ownedGames()
        // Your collections are only on this computer's Steam files (desktop only), so a game gets
        // them only when they could be read; otherwise its collections property is left alone.
        const collections = usesSource(lib.properties, 'steamCollections')
          ? readSteamCollections(await this.steam!.steamId(), this.settings.steam.folder ?? '')
          : null
        // Steam leaves free games you haven't played out of your list, so a note already linked to a
        // Steam game counts it as yours anyway: named as the note is (so it's never renamed for it),
        // with no playtime. Its store details are fetched only when a check or fill-in needs them.
        const owned = new Set(games.map(game => game.ratingKey))
        for (const [key, path] of indexes.game.ratingKeys) {
          if (!key.startsWith('steam-') || owned.has(key)) continue
          const name = path.split('/').pop()!.replace(/\.md$/, '')
          games.push({ ratingKey: key, type: 'game', title: name, steamAppId: Number(key.slice(6)), playtimeMinutes: 0 })
        }
        for (const item of games) {
          entries.push({ item: collections ? { ...item, steamCollections: collections.get(item.steamAppId ?? 0) ?? [] } : item, lib })
        }
        continue
      }
      const music = lib.target === 'music'
      // A music file's own tags (tempo and the like) are read from the file Plex has for each track,
      // only when a property uses them (and never in background updates).
      const fileTags = music && readTags && usesSource(lib.properties, 'fileTag')
      // So are the lyrics, from the text file beside each music file.
      const lyricsFiles = music && readTags && usesSource(lib.properties, 'lyricsFile')
      for (const item of await this.plex!.libraryItems(key, music)) {
        const wanted = music ? item.type === 'track' : item.type === 'movie' || item.type === 'show'
        if (!wanted) continue
        const file = item.Media?.[0]?.Part?.[0]?.file ?? ''
        const tags = fileTags ? readFileTags(file) : null
        const lyrics = lyricsFiles ? readLyrics(file) : null
        entries.push({ item: tags || lyrics ? { ...item, ...tags ? { fileTags: tags } : {}, ...lyrics ? { lyrics } : {} } : item, lib })
      }
    }
    // A note whose Plex links are all to items Plex no longer lists (say, a track Plex re-added under
    // a new key) is matched by its name again, rather than tied to nothing for good.
    if (usePlex) {
      const listed = new Set(entries.flatMap(({ item }) => itemKeys(item)))
      for (const index of Object.values(indexes)) {
        for (const [path, keys] of index.keysByPath) {
          if (keys.every(key => /^\d+$/.test(key) && !listed.has(key))) index.keysByPath.delete(path)
        }
      }
    }
    return { active, indexes, entries }
  }

  /**
   * @param checking for 'check': the property names to compare (in every library that has them).
   * @param only for 'check': just these notes (say, the open one), not every note.
   * @param libraries for 'check': just these libraries (settings keys; `books` for the books), not all.
   */
  async run(progress: ProgressFn, mode: SyncMode = 'full', checking: string[] = [], only?: Set<string>, libraries?: Set<string>): Promise<SyncResult> {
    this.onlyLibraries = mode === 'check' && libraries ? libraries : null
    const { active, indexes, entries } = await this.prepare(progress, mode === 'full', mode !== 'playCounts')
    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [], declined: 0, stopped: false, ignored: 0, newlyIgnored: [], merged: [], links: [], corrected: [], sentRatings: [], keptLinks: 0, unmatched: [], checked: [], unmatchedWhy: {} }

    result.ignored = entries.filter(({ item }) => this.isIgnored(item)).length

    const full = mode === 'full'
    // "Check existing notes against sources": only the chosen properties, always asked about.
    const genreCheck = mode === 'check'
    const chosen = new Set(checking)
    this.alwaysAsk = genreCheck
    if (full) {
      for (const family of FAMILIES) {
        await this.resolveAmbiguous(entries.filter(e => familyOf(e.lib) === family), indexes[family], result)
      }
    }
    // Notes in the libraries' folders that nothing in Plex or Steam matches, to point out.
    if (full || genreCheck) {
      for (const family of FAMILIES) {
        const matched = entries
          .filter(e => familyOf(e.lib) === family)
          .flatMap(({ item, lib }) => findNote(indexes[family], item, this.naming(lib), lib.matchBy)?.paths ?? [])
        this.listUnmatched(family, active, matched, result)
      }
      if (genreCheck && only) result.unmatched = result.unmatched.filter(path => only.has(path))
      await this.explainUnmatched(result, entries, progress)
    }
    const renaming = full && this.settings.renameExistingNotes
    const filling = full && active.some(([, lib]) => lib.properties.some(m => m.fill))
    // The only values ever replaced in existing notes: play counts and ratings, each when switched on.
    const updating: FieldSource[] = genreCheck ? [] : [
      ...this.settings.updatePlayCounts ? PLAY_SOURCES : [],
      ...this.settings.updateRatings ? RATING_SOURCES : [],
      ...this.settings.updateStatus ? STATUS_SOURCES : [],
      ...MIRRORED_SOURCES,
    ]
    const counting = updating.length > 0
    const sendingRatings = full && this.settings.sendRatings
    if (renaming || filling || counting || genreCheck || sendingRatings) {
      progress('Checking existing notes…')
      // Every note's changes are worked out first, then asked about grouped by library and by which
      // properties change, so a run of the same kind of change can be approved one after another.
      const pending: { lib: ActiveLibrary, labels: string[], decide: (position: number, total: number, group: string, groupKey: string, groupLeft: number) => Promise<void> }[] = []
      for (const family of FAMILIES) {
        const index = indexes[family]
        const matches = entries
          .filter(e => familyOf(e.lib) === family)
          .map(({ item, lib }) => ({ item, lib, match: findNote(index, item, this.naming(lib), lib.matchBy) }))
        const libOf = new Map(matches.map(m => [m.item, m.lib]))
        const plans = planRenames(matches)
        let planned = 0
        for (const { item, path } of plans) {
          planned++
          if (result.stopped) break
          // The pop-ups only start once every note's changes are known, so show how far along it is.
          progress(`Checking existing notes: ${planned} of ${plans.length} (${displayName(item)})…`)
          // Ignored items still count above, so their notes are never taken for another item.
          if (this.isIgnored(item)) continue
          if (genreCheck && only && !only.has(path)) continue
          const { lib, kind } = this.libraryFor(item, libOf.get(item)!)
          const file = this.app.vault.getAbstractFileByPath(path)
          if (!(file instanceof TFile)) continue
          if (genreCheck) result.checked.push(path)

          // Work out every change first, so it can be shown before anything happens.
          let renameTo: string | null = null
          // A note chosen with "Use an existing note" keeps the name you gave it.
          if ((renaming || (genreCheck && chosen.has(FILE_NAME))) && !this.isMerged(item)) {
            try {
              renameTo = this.renameTarget(file, item, lib)
            } catch (err) {
              result.failed.push({ title: item.title, error: `rename failed: ${errorText(err)}` })
            }
          }
          let fill: FillPlan | null = null
          if (filling && lib.properties.some(m => m.fill)) {
            try {
              fill = await this.planFill(file, item, lib, kind)
            } catch (err) {
              result.failed.push({ title: item.title, error: `filling in failed: ${errorText(err)}` })
            }
          }
          // A property already being filled in (it's empty) isn't offered a second time as an update.
          const beingFilled = new Set([...fill?.additions.map(([name]) => name) ?? [], ...fill?.imageProperty ? [fill.imageProperty] : []])
          // Ratings: which side changed since the last sync decides which way a difference goes, so a
          // rating changed in the note isn't overwritten with Plex's old one.
          // A rating still in an older scale is offered in the star scale whenever a pop-up can ask.
          const reviewing = genreCheck || (full && this.settings.askBeforeChanges && Boolean(this.approve))
          // A check converts and compares ratings only when its rating property is among those checked.
          const ratingChecked = !genreCheck || lib.properties.some(m => RATING_SOURCES.includes(m.source) && chosen.has(m.name.trim()))
          const rescale = reviewing && ratingChecked ? this.planRescale(file, item, lib) : null
          const rating = this.ratingPlan(file, item, lib)
          const notOverwritten = new Set([...beingFilled, ...rescale?.names ?? []])
          if (rating && rating.direction !== 'toNote') rating.names.forEach(name => notOverwritten.add(name))
          const plays = counting ? this.planUpdates(file, item, lib, updating, notOverwritten) : null
          // Only offered when there's a pop-up to choose in: a link already there is never replaced unasked.
          const asking = full && this.settings.askBeforeChanges && Boolean(this.approve)
          // A check offers sending your rating to Plex whenever the two differ (you pick which wins);
          // a sync only when the note's is the one that changed.
          const offerToPlex = genreCheck ? ratingChecked && Boolean(rating?.note && rating.note !== rating.plex) : asking && this.settings.sendRatings && rating?.direction === 'toPlex'
          const toPlex = offerToPlex && this.plex && rating?.note
            && this.settings.keptValues[`${item.ratingKey}|plexRating`] !== String(rating.note) ? rating.note : null
          // Remembered only when the note and Plex agree (or one was just made to match the other).
          if (rating && (rating.note ?? 0) === rating.plex) this.seeRating(item.ratingKey, rating.plex)
          const links = asking ? this.planLinks(file, item, lib) : null
          let checks: Checks | null = null
          try {
            checks = genreCheck ? await this.planFullCheck(file, item, lib, kind, chosen) : asking ? this.planChecks(file, item, lib) : null
          } catch (err) {
            result.failed.push({ title: item.title, error: `checking failed: ${errorText(err)}` })
          }
          // The rescaled rating is offered once, not again as a difference.
          if (checks && rescale) {
            checks.names = checks.names.filter(name => !rescale.names.includes(name))
            if (!checks.names.length) checks = null
          }
          if (!renameTo && !fill && !plays && !links && !checks && !toPlex && !rescale) continue

          const lines: ApprovalLine[] = []
          const now = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
          if (renameTo) {
            const newName = renameTo.split('/').pop()!.replace(/\.md$/, '')
            lines.push({ key: 'rename', label: 'File name', current: file.basename, value: newName, edit: 'text' })
          }
          for (const [name, value] of fill?.additions ?? []) {
            const choices = name === fill?.coverProperty ? fill.item.coverChoices : undefined
            lines.push({ key: `add:${name}`, label: name, current: describeValue(now[name]), ...editable(value), choices })
          }
          if (fill?.imageProperty) {
            const name = fill.imageProperty
            lines.push({ key: `add:${name}`, label: name, current: describeValue(now[name]), value: POSTER_PREVIEW })
          }
          for (const name of plays?.names ?? []) {
            lines.push({ key: `update:${name}`, label: name, current: describeValue(plays!.from[name]), value: String(plays!.to[name]), edit: editKind(plays!.to[name]) })
          }
          for (const name of links?.names ?? []) {
            // A search page is a stand-in, so replacing it starts ticked; any other link starts unticked.
            lines.push({ key: `link:${name}`, label: name, current: describeValue(links!.from[name]), value: links!.to[name], edit: 'text', unticked: !this.settings.tickDifferences && !links!.placeholders.has(name) })
          }
          for (const name of checks?.names ?? []) {
            // The same length in hours or as text starts ticked; any other difference starts unticked.
            const to = checks!.to[name]
            const shown = to === POSTER_PREVIEW ? { value: POSTER_PREVIEW } : typeof to === 'number' ? { value: String(to), edit: 'number' as const } : editable(to)
            lines.push({ key: `fix:${name}`, label: name, current: describeValue(checks!.from[name]), ...shown, unticked: Boolean(checks!.yours?.has(name)) || (!this.settings.tickDifferences && !checks!.sameLength.has(name)) })
          }
          lines.push(...this.rescaleLines(rescale))
          if (toPlex) {
            lines.push({ key: 'plexRating', label: 'Your rating in Plex', current: rating!.plex ? ratingLabel(rating!.plex, 'stars', (item.userRating ?? 0) / 2) : null, value: ratingLabel(toPlex), edit: 'text', unticked: genreCheck || !this.settings.tickDifferences })
          }
          // Lines about what you said never to change in this note are left out unasked (see `ask`).
          const lockedHere = this.settings.lockedProperties[path] ?? []
          const askedLines = lines.filter(line => !lockedHere.includes(line.label))
          if (!askedLines.length) continue
          pending.push({ lib, labels: [...new Set(askedLines.map(line => line.label))].sort(), decide: async (position, total, group, groupKey, groupLeft) => {
            const approval = await this.ask({ action: 'change', path, lines, position, total, group, groupKey, groupLeft }, result, item, lib)
            if (!approval) return
            const { excluded, edits } = approval
            const sending = Boolean(toPlex) && !excluded.has('plexRating')
            // Reviewed either way: ticked, the note gets the star scale; unticked, its rating already is.
            const rescaleNames = (rescale?.names ?? []).filter(name => !excluded.has(`rescale:${name}`))
            if (toPlex && !sending) {
              // Plex's rating is to stay as it is: don't offer this note's rating again while it's the same.
              this.settings.keptValues[`${item.ratingKey}|plexRating`] = String(toPlex)
              result.keptLinks++
            }
            const fixNames = (checks?.names ?? []).filter(name => !excluded.has(`fix:${name}`))
            // A value left unticked is yours to keep: don't offer to fix it again while it stays the same.
            for (const name of (checks?.names ?? []).filter(n => excluded.has(`fix:${n}`))) {
              this.keep(`${item.ratingKey}|${name}`, checks!.from[name], checks!.to[name])
              result.keptLinks++
            }
            const linkNames = (links?.names ?? []).filter(name => !excluded.has(`link:${name}`))
            // A link left unticked is yours to keep: don't offer to replace it again while it stays the same.
            const keptLink = (links?.names ?? []).find(name => excluded.has(`link:${name}`))
            if (keptLink) {
              this.settings.keptLinks[item.ratingKey] = String(links!.from[keptLink])
              result.keptLinks++
            }
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
              return edited === undefined ? plays!.to[name] : parseEdit(edited, editKind(plays!.to[name]))
            }
            if (!renameTo && !fill?.additions.length && !fill?.imageProperty && !playNames.length && !linkNames.length && !fixNames.length && !sending && !rescaleNames.length) {
              result.declined++
              return
            }

            try {
              if (renameTo) {
                await this.app.fileManager.renameFile(file, renameTo)
                result.renamed.push({ from: path, to: renameTo })
                addToIndex(index, renameTo, renderFileName(this.naming(lib), item))
              }
              if (fill && await this.applyFill(file, fill, lib)) result.filled.push(file.path)
              if (fixNames.length) {
                // A Plex poster offered for an empty image property is downloaded now that it's approved.
                const posters = new Map<string, string | null>()
                for (const name of fixNames.filter(n => checks!.to[n] === POSTER_PREVIEW)) {
                  posters.set(name, await this.imageFor(item, normalizePath(lib.folder), renderFileName(this.naming(lib), item)))
                }
                await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                  for (const name of fixNames) {
                    const edited = edits[`fix:${name}`]
                    if (posters.has(name)) {
                      const image = posters.get(name)
                      if (image) fm[name] = image
                      continue
                    }
                    fm[name] = edited === undefined ? checks!.to[name] : parseEdit(edited, editKind(checks!.to[name]))
                  }
                })
                result.corrected.push(file.path)
              }
              if (linkNames.length) {
                await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                  for (const name of linkNames) {
                    const edited = edits[`link:${name}`]
                    fm[name] = typeof edited === 'string' ? edited.trim() : links!.to[name]
                  }
                })
                result.links.push(file.path)
              }
              if (plays && playNames.length) {
                await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                  for (const name of playNames) fm[name] = playValue(name)
                })
                result.playCounts.push(file.path)
                if (rating && playNames.some(name => rating.names.includes(name))) {
                  this.seeRating(item.ratingKey, rating.plex)
                  // Written by the plugin, so in the star scale now.
                  this.reviewRating(item.ratingKey)
                }
              }
              if (await this.applyRescale(file, item.ratingKey, rescale, excluded, edits)) result.corrected.push(file.path)
              if (sending && toPlex) {
                const level = this.plexRatingToSend(toPlex, rescale, excluded, edits)
                await this.plex!.rate(item.ratingKey, level * 2)
                this.seeRating(item.ratingKey, level)
                result.sentRatings.push(file.path)
              }
            } catch (err) {
              result.failed.push({ title: item.title, error: errorText(err) })
            }
          } })
        }
      }
      const libraryOrder = active.map(([, l]) => l.title)
      const groupOf = (p: typeof pending[number]) => p.labels.join(', ')
      pending.sort((a, b) => libraryOrder.indexOf(a.lib.title) - libraryOrder.indexOf(b.lib.title)
        || a.labels.length - b.labels.length || groupOf(a).localeCompare(groupOf(b)))
      let position = 0
      for (const p of pending) {
        position++
        if (result.stopped) break
        const same = pending.filter(q => q.lib.title === p.lib.title && groupOf(q) === groupOf(p))
        const place = same.indexOf(p) + 1
        await p.decide(position, pending.length, `${p.lib.title} · ${groupOf(p)} (${place} of ${same.length})`, `${p.lib.title}|${groupOf(p)}`, same.length - place)
      }
    }
    if (genreCheck && !result.stopped) await this.checkBooks(chosen, result, progress, only)
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
        const item = await this.fullItem(listed, listedLib)
        const { lib, kind } = this.libraryFor(item, listedLib)
        const preview = this.previewNote(item, lib, kind)
        const approval = await this.ask({ action: 'create', path: preview.path, lines: preview.lines, position, total: toCreate.length }, result, item, lib)
        if (!approval) continue
        if (approval.mergeWith) {
          await this.mergeInto(item, lib, kind, approval.mergeWith, index, result, position, toCreate.length)
          continue
        }
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
        const path = await this.createNote(item, lib, kind, left, overrides, fileName)
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

  /**
   * Explains, without changing anything, what a sync does with the items a Plex or Steam link
   * points to, or whose title contains the text: one report (a list of paragraphs) per item.
   */
  /**
   * The items in Plex and Steam that have no note yet (and aren't skipped every time), with the
   * library each is in, for recommendations. Reads the libraries; changes nothing.
   */
  async withoutNotes(progress: ProgressFn): Promise<{ item: PlexItem, libraryKey: string, kind: MediaKind }[]> {
    return (await this.libraryItems(progress)).withoutNotes
  }

  /**
   * Every item in Plex and Steam: those with a note (one note only), by its path, and those with
   * none yet. For recommendations, which take a note's people (director, cast…) from its item.
   * Reads the libraries; changes nothing.
   */
  async libraryItems(progress: ProgressFn): Promise<{
    withNotes: { item: PlexItem, path: string, kind: MediaKind }[]
    withoutNotes: { item: PlexItem, libraryKey: string, kind: MediaKind }[]
  }> {
    const { active, indexes, entries } = await this.prepare(progress, false, false)
    const withNotes: { item: PlexItem, path: string, kind: MediaKind }[] = []
    const withoutNotes: { item: PlexItem, libraryKey: string, kind: MediaKind }[] = []
    for (const { item, lib } of entries) {
      if (this.isIgnored(item)) continue
      const match = findNote(indexes[familyOf(lib)], item, this.naming(lib), lib.matchBy)
      if (match?.paths.length === 1) withNotes.push({ item, path: match.paths[0], kind: lib.target })
      else if (!match) withoutNotes.push({ item, kind: lib.target, libraryKey: active.find(([, l]) => l === lib)?.[0] ?? '' })
    }
    return { withNotes, withoutNotes }
  }

  async explain(query: string, progress: ProgressFn): Promise<string[][]> {
    const { indexes, entries } = await this.prepare(progress, true, false)
    const key = ratingKeyFromLink(query)
    if (key) {
      const found = entries.filter(e => e.item.ratingKey === key)
      if (found.length) return found.map(e => this.explainEntry(e, indexes, entries))
      return [await this.explainMissing(key)]
    }
    const wanted = normalizeTitle(query)
    if (!wanted) return [['Paste a Plex or Steam link, or type part of a title.']]
    const found = entries.filter(e => normalizeTitle(displayName(e.item)).includes(wanted))
    if (!found.length) {
      return [[`Nothing in the libraries being synced has a title containing "${query.trim()}". If it's in Plex, paste its link instead (in Plex Web, the address of its page): that also shows which library it's in.`]]
    }
    const reports = found.slice(0, 10).map(e => this.explainEntry(e, indexes, entries))
    if (found.length > 10) reports.push([`…and ${found.length - 10} more. Type more of the title to narrow it down.`])
    return reports
  }

  /**
   * Why each unmatched note with a link matches nothing: what its link points to, and why that
   * isn't synced (or that another note already has it).
   */
  private async explainUnmatched(result: SyncResult, entries: Entry[], progress: ProgressFn): Promise<void> {
    const names = [...new Set(Object.values(this.settings.libraries).flatMap(lib => linkPropertyNames(lib.properties)))]
    const listed = new Map(entries.flatMap(({ item }) => itemKeys(item).map((key): [string, PlexItem] => [key, item])))
    // Enough to explain a long list without a request per note on a huge one.
    for (const path of result.unmatched.slice(0, 200)) {
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) continue
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      const key = names.map(name => ratingKeyFromLink(frontmatter[name])).find((k): k is string => Boolean(k))
      if (!key) {
        result.unmatchedWhy[path] = 'It has no Plex or Steam link, and its file name matches no item\'s.'
        continue
      }
      const item = listed.get(key)
      if (item) {
        result.unmatchedWhy[path] = `Its link is to ${displayName(item)}, but another note is matched to that.`
        continue
      }
      if (key.startsWith('imdb-') || key.startsWith('ol-') || key.startsWith('hltb-')) continue
      progress(`Looking into ${file.basename}…`)
      try {
        result.unmatchedWhy[path] = (await this.explainMissing(key)).join(': ')
      } catch {
        // Just not explained.
      }
    }
  }

  /** Why an item a link points to isn't in any library being synced. */
  private async explainMissing(key: string): Promise<string[]> {
    if (key.startsWith('steam-')) {
      return [
        `Steam app ${key.slice(6)}`,
        'This game isn\'t in the games list Steam gives for your account. It may be a game you don\'t own, or a free game you haven\'t played (Steam leaves those out; a note linked to it counts it as yours), or the Steam library is set to Skip.',
      ]
    }
    if (!this.plex) return ['That\'s a Plex link, but Plex isn\'t set up in the plugin settings.']
    const item = await this.plex.item(key).catch(() => null)
    if (!item) return ['Plex has no item with that link. Check the address, or that it\'s on the server set up in the plugin.']
    const name = displayName(item)
    if (item.type === 'episode' || item.type === 'season') {
      return [name, `That's a link to ${item.type === 'episode' ? 'an episode' : 'a season'}. Notes are made for whole shows: paste the show's link instead.`]
    }
    if (item.type === 'album' || item.type === 'artist') {
      return [name, `That's a link to ${item.type === 'album' ? 'an album' : 'an artist'}. Music notes are made for each track.`]
    }
    const section = item.librarySectionID === undefined ? '' : String(item.librarySectionID)
    const lib = this.settings.libraries[section]
    const where = item.librarySectionTitle ?? lib?.title ?? 'a Plex library'
    if (!lib) return [name, `It's in "${where}", which isn't in the plugin's settings yet. Press "Load libraries" in the settings, then choose its type.`]
    if (lib.target === 'skip') return [name, `It's in "${lib.title}", which is set to Skip, so no notes are made for it. Choose a type for that library in the settings.`]
    return [name, `It's in "${lib.title}", but wasn't in what Plex listed for that library just now. If it was added very recently, Plex may still be processing it; try again in a few minutes.`]
  }

  /** What a sync does with one listed item, and why. */
  private explainEntry({ item, lib }: Entry, indexes: Record<Family, ExistingNotes>, entries: Entry[]): string[] {
    const name = displayName(item)
    const report = [`${name} (in ${lib.title})`]
    if (this.isIgnored(item)) {
      report.push('You chose "Skip every time" for it, so every sync passes over it. Un-ignore it under Settings → Skipped every time.')
      return report
    }
    const { lib: noteLib } = this.libraryFor(item, lib)
    const merged = this.settings.merged[item.ratingKey]
    if (merged) {
      report.push(`You chose "Use an existing note" for it: ${merged.path}. Syncs treat that as its note and never rename it. Undo this under Settings → Merged with existing notes.`)
      return report
    }
    const index = indexes[familyOf(lib)]
    const match = findNote(index, item, this.naming(lib), lib.matchBy)
    if (!match) {
      const path = this.freePath(normalizePath(noteLib.folder), renderFileName(this.naming(noteLib), item), 'md')
      report.push(`It has no note yet. The next sync will ${this.settings.askBeforeChanges ? 'offer to create' : 'create'} ${path}.`)
      return report
    }
    if (match.byRatingKey) {
      report.push(`It already has a note, which links to it: ${match.paths[0]}. A sync only changes that note if renaming, filling in or play counts call for it.`)
      return report
    }
    const notes = match.paths.join(', ')
    report.push(match.paths.length > 1
      ? `It counts as already having a note, because these notes' names match its title: ${notes}. So no new note is made for it.`
      : `It counts as already having a note, because this note's name matches its title: ${notes}. So no new note is made for it.`)
    const rivals = entries
      .filter(e => e.item !== item && familyOf(e.lib) === familyOf(lib))
      .filter(e => findNote(index, e.item, this.naming(e.lib), e.lib.matchBy)?.paths.some(p => match.paths.includes(p)))
      .map(e => displayName(e.item))
    if (rivals.length) {
      report.push(`${rivals.join(', ')} ${rivals.length > 1 ? 'match' : 'matches'} the same note, so the plugin can't tell whose note it is and leaves it alone (no renaming or filling in).`)
    }
    report.push(`If that note is for something else, rename it (adding the year, say) or give it a Link to the right item; this one then gets its own note on the next sync. Or set "Match existing notes by" for ${lib.title} to "Link or file name", so a bare title no longer counts.`)
    return report
  }

  /**
   * Adds one item found with "Add something new" to a library: asks first (as for a sync) and
   * makes the note, unless a note already matches it (then that note's path is returned).
   */
  async addNew(found: PlexItem, libKey: string): Promise<{ created?: string, existing?: string }> {
    const chosen = this.settings.libraries[libKey] as LibrarySetting | undefined
    if (!chosen || chosen.target === 'skip') throw new Error('Choose a library to add it to')
    const lib = chosen as ActiveLibrary
    // A Plex item (made from the recommendations page) needs the server, for its link and poster,
    // and its full details, which listings leave some of out.
    if (fromPlex(found) && !this.plex && plexReady(this.settings)) {
      this.plex = new PlexClient(this.settings.serverUrl, this.settings.token)
      this.machineId = await this.plex.machineIdentifier()
    }
    const item = found.type === 'game' ? await this.gameDetails(found, lib)
      : fromPlex(found) && this.plex ? { ...found, ...await this.plex.item(found.ratingKey) ?? {} } : found
    const family = familyOf(lib)
    const libs = Object.values(this.settings.libraries)
      .filter((l): l is ActiveLibrary => l.target !== 'skip')
      .filter(l => familyOf(l) === family)
    const index = this.indexExistingNotes(libs)
    this.addMerged(index, family)
    const match = findNote(index, item, this.naming(lib), lib.matchBy)
    if (match) return { existing: match.paths[0] }

    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [], declined: 0, stopped: false, ignored: 0, newlyIgnored: [], merged: [], links: [], corrected: [], sentRatings: [], keptLinks: 0, unmatched: [], checked: [], unmatchedWhy: {} }
    const kind = lib.target
    const preview = this.previewNote(item, lib, kind)
    const approval = await this.ask({ action: 'create', path: preview.path, lines: preview.lines, position: 1, total: 1 }, result, item, lib)
    if (!approval) {
      await this.finish(result)
      return {}
    }
    if (approval.mergeWith) {
      await this.mergeInto(item, lib, kind, approval.mergeWith, index, result, 1, 1)
      await this.finish(result)
      return { existing: approval.mergeWith }
    }
    const { excluded, edits } = approval
    const left = new Set([...excluded].filter(k => k.startsWith('prop:')).map(k => k.slice(5)))
    const overrides: Record<string, unknown> = {}
    for (const [key, edited] of Object.entries(edits)) {
      if (key.startsWith('prop:')) overrides[key.slice(5)] = parseEdit(edited, editKind(preview.values[key.slice(5)]))
    }
    const fileName = typeof edits.file === 'string' ? sanitizeFileName(edits.file, this.settings.fileNameReplacements) || undefined : undefined
    const created = await this.createNote(item, lib, kind, left, overrides, fileName)
    await this.finish(result)
    return { created }
  }

  private isIgnored(item: PlexItem): boolean {
    return item.ratingKey in this.settings.ignored
  }

  /** Whether a Plex rating was seen (or sent), or a note's rating reviewed, since the last save. */
  private ratingsChanged = false

  /**
   * How a note's emoji rating is read: in the star scale once reviewed (or made by the plugin since
   * the star scale came in), else in the scale it was written in before (music in plain stars).
   */
  private noteScale(noteKey: string, lib: LibrarySetting): RatingScale {
    return this.settings.ratingsReviewed[noteKey] ? 'stars' : lib.target === 'music' ? 'plain' : 'emoji'
  }

  private reviewRating(noteKey: string): void {
    if (this.settings.ratingsReviewed[noteKey]) return
    this.settings.ratingsReviewed[noteKey] = true
    this.ratingsChanged = true
  }

  /**
   * A note's emoji ratings, not yet reviewed in the star scale, written in it: the same rating
   * (read in its old scale) as 💣, ⭐⭐ to ⭐⭐⭐⭐ or 🩷, to offer. A note already written that way is
   * marked reviewed without asking.
   */
  private planRescale(file: TFile, item: PlexItem, lib: LibrarySetting): Rescale | null {
    const names = lib.properties.filter(m => m.source === 'userRatingEmoji' && m.name.trim()).map(m => m.name.trim())
    return this.planRescaleOf(file, item.ratingKey, names, this.noteScale(item.ratingKey, lib))
  }

  /** As `planRescale`, for these properties of a note (by its key), written in `old` until reviewed. */
  private planRescaleOf(file: TFile, noteKey: string, names: string[], old: RatingScale): Rescale | null {
    if (this.settings.ratingsReviewed[noteKey] || !names.length) return null
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const to: Record<string, string> = {}
    for (const name of names) {
      const current: unknown = from[name]
      const level = noteStars(current, old)
      const written = level ? starEmoji(level, 'stars') : undefined
      if (written && written !== String(current).trim()) to[name] = written
    }
    const changed = Object.keys(to)
    if (!changed.length) {
      this.reviewRating(noteKey)
      return null
    }
    return { names: changed, from, to }
  }

  /**
   * The rating to send to Plex: as typed on its own line (💣 to 🩷, or 1–5 stars), else as the
   * note's rating line was left (a converted rating you edited), else the one offered.
   */
  private plexRatingToSend(offered: number, rescale: Rescale | null, excluded: Set<string>, edits: Record<string, string | string[]>): number {
    const typed = edits.plexRating
    if (typeof typed === 'string') {
      const stars = noteStars(typed, 'stars') ?? Number(/\d+/.exec(typed)?.[0])
      return stars >= 1 ? Math.min(5, stars) : offered
    }
    for (const name of rescale?.names ?? []) {
      if (excluded.has(`rescale:${name}`)) continue
      const edited = edits[`rescale:${name}`]
      const level = noteStars(typeof edited === 'string' ? edited : rescale!.to[name], 'stars')
      if (level) return level
    }
    return offered
  }

  /** The approval pop-up's lines for a rescale. */
  private rescaleLines(rescale: Rescale | null): ApprovalLine[] {
    return (rescale?.names ?? []).map(name => ({ key: `rescale:${name}`, label: name, current: describeValue(rescale!.from[name]), value: rescale!.to[name], edit: 'text' as const, unticked: !this.settings.tickDifferences }))
  }

  /** Writes the rescaled ratings that were left ticked (as edited), and marks the note reviewed either way. */
  private async applyRescale(file: TFile, noteKey: string, rescale: Rescale | null, excluded: Set<string>, edits: Record<string, string | string[]>): Promise<boolean> {
    if (!rescale) return false
    this.reviewRating(noteKey)
    const names = rescale.names.filter(name => !excluded.has(`rescale:${name}`))
    if (!names.length) return false
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const name of names) {
        const edited = edits[`rescale:${name}`]
        fm[name] = typeof edited === 'string' ? edited.trim() : rescale.to[name]
      }
    })
    return true
  }

  private seeRating(ratingKey: string, stars: number): void {
    if (this.settings.ratingsSeen[ratingKey] === stars) return
    this.settings.ratingsSeen[ratingKey] = stars
    this.ratingsChanged = true
  }

  /**
   * An item's rating properties, the note's rating (stars, from the first that has one), Plex's and
   * which way a difference goes (`ratingDirection`). Null for items not from Plex, or libraries
   * without a rating property.
   */
  private ratingPlan(file: TFile, item: PlexItem, lib: LibrarySetting): { names: string[], note: number | null, plex: number, direction: 'toNote' | 'toPlex' | null } | null {
    if (!fromPlex(item)) return null
    const names = lib.properties.filter(m => RATING_SOURCES.includes(m.source) && m.name.trim()).map(m => m.name.trim())
    if (!names.length) return null
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const scale = this.noteScale(item.ratingKey, lib)
    const note = names.map(name => noteStars(from[name], scale)).find(value => value !== null) ?? null
    const plex = userStars(item) ?? 0
    return { names, note, plex, direction: ratingDirection(note, plex, this.settings.ratingsSeen[item.ratingKey]) }
  }

  private isMerged(item: PlexItem): boolean {
    return item.ratingKey in this.settings.merged
  }

  /** Ties items chosen with "Use an existing note" to their notes, wherever those notes are. */
  private addMerged(index: ExistingNotes, family: Family): void {
    for (const [key, merged] of Object.entries(this.settings.merged)) {
      const lib = this.settings.libraries[merged.libraryKey]
      if (lib && lib.target !== 'skip' && familyOf(lib as ActiveLibrary) !== family) continue
      if (!(this.app.vault.getAbstractFileByPath(merged.path) instanceof TFile)) continue
      addToIndex(index, merged.path, '', [key])
    }
  }

  /**
   * "Use an existing note": ties the item to that note from now on (it's matched to it and never
   * renamed), then offers to fill in the properties the note is missing or has empty, never
   * replacing anything already there.
   */
  private async mergeInto(item: PlexItem, lib: ActiveLibrary, kind: MediaKind, path: string, index: ExistingNotes,
    result: SyncResult, position: number, total: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) {
      result.failed.push({ title: item.title, error: `couldn't find ${path}` })
      return
    }
    const libraryKey = Object.entries(this.settings.libraries).find(([, l]) => l === lib)?.[0] ?? ''
    this.settings.merged[item.ratingKey] = { name: displayName(item), library: lib.title, libraryKey, path, since: Date.now() }
    addToIndex(index, path, '', [item.ratingKey])
    result.merged.push(path)

    const everything: ActiveLibrary = { ...lib, properties: lib.properties.map(m => ({ ...m, fill: true })) }
    let fill = await this.planFill(file, item, everything, kind)
    // Its rating, if written in an older scale, is offered in the star scale too.
    const rescale = this.planRescale(file, item, lib)
    if (!fill && !rescale) return
    const now = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const lines: ApprovalLine[] = (fill?.additions ?? []).map(([name, value]) => {
      const choices = name === fill!.coverProperty ? fill!.item.coverChoices : undefined
      return { key: `add:${name}`, label: name, current: describeValue(now[name]), ...editable(value), choices }
    })
    if (fill?.imageProperty) {
      lines.push({ key: `add:${fill.imageProperty}`, label: fill.imageProperty, current: describeValue(now[fill.imageProperty]), value: POSTER_PREVIEW })
    }
    lines.push(...this.rescaleLines(rescale))
    const approval = await this.ask({ action: 'change', path, lines, position, total }, result, item, lib)
    if (!approval) return
    const { excluded, edits } = approval
    await this.applyRescale(file, item.ratingKey, rescale, excluded, edits)
    if (!fill) return
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
    try {
      if (await this.applyFill(file, fill, everything)) result.filled.push(path)
    } catch (err) {
      result.failed.push({ title: item.title, error: `filling in failed: ${errorText(err)}` })
    }
  }

  /** Saves newly ignored and merged items, links and values kept, and ratings seen, before handing back the result. */
  private async finish(result: SyncResult): Promise<SyncResult> {
    if (result.newlyIgnored.length || result.merged.length || result.keptLinks || this.ratingsChanged) await this.saveSettings()
    this.ratingsChanged = false
    return result
  }

  /**
   * Movies and shows are fetched again for their full metadata (the listing can leave out genres).
   * Tracks keep their listing plus their album, fetched once per album, and the track itself only
   * when its moods are wanted (the listing leaves them out).
   */
  private async fullItem(listed: PlexItem, lib?: LibrarySetting): Promise<PlexItem> {
    if (listed.type === 'game') return this.gameDetails(listed, lib)
    const plex = this.plex
    if (!plex) return listed
    if (listed.type !== 'track') return (await plex.item(listed.ratingKey).catch(() => null)) ?? listed
    const albumKey = listed.parentRatingKey
    if (!albumKey) return listed
    let album = this.albums.get(albumKey)
    if (!album) {
      album = plex.item(albumKey).catch(() => null)
      this.albums.set(albumKey, album)
    }
    // A library listing leaves out a track's own moods, so the track is fetched when they're wanted;
    // one without moods of its own still gets its album's.
    const wantsMoods = lib && usesSource(lib.properties, 'moods')
    const own = wantsMoods ? await plex.item(listed.ratingKey).catch(() => null) : null
    return { ...listed, ...own?.Mood?.length ? { Mood: own.Mood } : {}, album: (await album) ?? undefined }
  }

  /**
   * A game's store details, plus (when its library wants them) HowLongToBeat's times and, when
   * asking first, other covers to pick from. Lookups that fail leave those parts out.
   */
  private async gameDetails(listed: PlexItem, lib?: LibrarySetting): Promise<PlexItem> {
    // Store details need no key, so games found by searching get them without Steam set up.
    const steam = this.steam ?? new SteamClient('', '', false)
    const item = listed.steamAppId ? await steam.details(listed) : { ...listed }
    const properties = lib?.properties ?? []
    const wantsCover = usesSource(properties, 'poster') && this.settings.askBeforeChanges
    const wantsHltb = properties.some(m => HLTB_SOURCES.includes(m.source) && m.name.trim())
    if ((wantsHltb || wantsCover) && !item.hltb) {
      try {
        this.hltb ??= new HltbClient()
        item.hltb = (await this.hltb.times(item.title, item.year)) ?? undefined
      } catch (err) {
        console.warn(`Media Manager: HowLongToBeat lookup for ${item.title} failed`, err)
      }
    }
    if (wantsCover) {
      const choices: CoverChoice[] = []
      if (item.portrait) choices.push({ url: item.portrait, thumb: item.portrait, label: 'Steam' })
      if (item.hltb?.image) choices.push({ url: item.hltb.image, thumb: item.hltb.image, label: 'HowLongToBeat' })
      const gridKey = (this.settings.steam.gridKey ?? '').trim()
      if (gridKey && item.steamAppId) {
        try {
          choices.push(...await steamGridCovers(gridKey, item.steamAppId))
        } catch (err) {
          console.warn(`Media Manager: SteamGridDB covers for ${item.title} failed`, err)
        }
      }
      item.coverChoices = choices
      // With no Steam portrait, HowLongToBeat's cover is the next best thing.
      item.portrait ??= item.hltb?.image
    }
    return item
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
  private async planFill(file: TFile, listed: PlexItem, lib: ActiveLibrary, kind: MediaKind): Promise<FillPlan | null> {
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const wanted = lib.properties.filter(m => m.fill && m.name.trim() && isBlank(current[m.name.trim()]))
    if (!wanted.length) return null

    // The link needs nothing more; everything else may need the item's full metadata.
    const needsMore = wanted.some(m => m.source !== 'plexLink' && m.source !== 'text' && m.source !== 'typeTag')
    const item = needsMore ? await this.fullItem(listed, lib) : listed
    // A cover from Steam, IMDb or the like is a link, filled in like any value; a Plex poster is
    // downloaded once approved.
    const game = !fromPlex(item)
    const values = buildFrontmatter(item, wanted.filter(m => game || m.source !== 'poster'), {
      kind,
      link: this.linkFor(item),
      image: game ? item.portrait ?? null : null,
      values: lib.values,
      genres: this.settings.allowedGenres,
      leaveOut: lib.leaveOutGenres,
    })
    const additions = Object.entries(values).filter(([, value]) => !isBlank(value))
    const poster = game ? undefined : wanted.find(m => m.source === 'poster')
    const imageProperty = poster && hasImage(item) ? poster.name.trim() : null
    if (!additions.length && !imageProperty) return null
    const coverProperty = game ? wanted.find(m => m.source === 'poster')?.name.trim() : undefined
    return { item, additions, imageProperty, coverProperty }
  }

  /** Adds the planned properties, downloading the poster if one is wanted. Never replaces a value. */
  private async applyFill(file: TFile, plan: FillPlan, lib: ActiveLibrary): Promise<boolean> {
    const additions = [...plan.additions]
    if (plan.imageProperty) {
      const image = await this.imageFor(plan.item, normalizePath(lib.folder), renderFileName(this.naming(lib), plan.item))
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
   * The note's properties with these sources (play counts, playtime, ratings) that differ from the
   * current values: the one case where a value already in a note is replaced. Nothing is cleared
   * when Plex has no value.
   */
  private planUpdates(file: TFile, item: PlexItem, lib: ActiveLibrary, sources: FieldSource[], skip: Set<string> = new Set()): { names: string[], from: Record<string, unknown>, to: Record<string, unknown> } | null {
    const mappings = lib.properties.filter(m => sources.includes(m.source) && m.name.trim() && !skip.has(m.name.trim()))
    if (!mappings.length) return null
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const to: Record<string, unknown> = {}
    const ctx = { kind: lib.target, link: '', image: null, values: lib.values }
    for (const m of mappings) {
      const name = m.name.trim()
      const value = sourceValue(m.source, item, ctx, m.text)
      if (value === undefined || from[name] === value || (Array.isArray(value) && sameValue(from[name], value))) continue
      // A status only ever moves forward, and one of your own is left alone.
      if (STATUS_SOURCES.includes(m.source) && !statusMovesForward(from[name], value, lib.values)) continue
      // A playtime never goes down: one longer in the note than Steam's stays.
      if (m.source === 'playtime' && playtimeShrinks(from[name], value)) continue
      to[name] = value
    }
    const names = Object.keys(to)
    return names.length ? { names, from, to } : null
  }

  /**
   * Properties checked against the source (`CHECKED_SOURCES`: durations in minutes) whose value
   * in the note is a different number, to offer the source's. Values you chose to keep before are
   * left alone. `sameLength` names those that are the same length in another form (hours, text).
   */
  private planChecks(file: TFile, item: PlexItem, lib: ActiveLibrary): Checks | null {
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const ctx = { kind: lib.target, link: '', image: null, values: lib.values }
    const to: Record<string, number> = {}
    const sameLength = new Set<string>()
    for (const m of lib.properties) {
      const name = m.name.trim()
      const current: unknown = from[name]
      if (!CHECKED_SOURCES.includes(m.source) || !name || isBlank(current)) continue
      const value = sourceValue(m.source, item, ctx, m.text)
      if (typeof value !== 'number') continue
      if (current === value || (typeof current === 'string' && current.trim() === String(value))) continue
      if (this.isKept(`${item.ratingKey}|${name}`, current, value)) continue
      to[name] = value
      if (sameLengthOtherForm(current, value)) sameLength.add(name)
    }
    const names = Object.keys(to)
    return names.length ? { names, from, to, sameLength } : null
  }

  /**
   * The notes whose release date is only a year (or the 1st of January that a year alone becomes),
   * in every library's folder, the Books library's included, with the date properties to check.
   */
  vagueDateNotes(): { paths: Set<string>, properties: string[] } {
    const paths = new Set<string>()
    const properties = new Set<string>()
    const files = this.app.vault.getMarkdownFiles()
    for (const lib of Object.values(this.settings.libraries)) {
      if (lib.target === 'skip') continue
      const names = lib.properties.filter(m => m.source === 'releaseDate' && m.name.trim()).map(m => m.name.trim())
      if (!names.length) continue
      const folder = normalizePath(lib.folder)
      for (const file of files) {
        if (!file.path.startsWith(`${folder}/`)) continue
        const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
        const vague = names.filter(name => vagueDate(from[name]))
        if (!vague.length) continue
        paths.add(file.path)
        vague.forEach(name => properties.add(name))
      }
    }
    return { paths, properties: [...properties] }
  }

  /**
   * The notes in this family's folders that no item matched (nor "Use an existing note" tied),
   * apart from those you chose to always ignore.
   */
  private listUnmatched(family: Family, active: [string, ActiveLibrary][], matched: string[], result: SyncResult): void {
    const folders = [...new Set(active.filter(([, lib]) => familyOf(lib) === family).map(([, lib]) => normalizePath(lib.folder)))]
    const taken = new Set([...matched, ...Object.values(this.settings.merged).map(m => m.path)])
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some(folder => file.path.startsWith(`${folder}/`)) || taken.has(file.path)) continue
      if (this.settings.unmatchedIgnored.includes(file.path)) continue
      result.unmatched.push(file.path)
    }
  }

  /**
   * "Check existing notes against sources" for one note: the chosen properties whose value differs
   * from the source's (`checkValue` says what's offered and whether it starts ticked), with the
   * item's full details fetched. Values you chose to keep before are left alone, and so is a link
   * that points to this item in any form.
   */
  private async planFullCheck(file: TFile, item: PlexItem, lib: ActiveLibrary, kind: MediaKind, chosen: Set<string>): Promise<Checks | null> {
    const mappings = lib.properties.filter(m => chosen.has(m.name.trim()) && !UNCHECKED_SOURCES.includes(m.source))
    if (!mappings.length) return null
    // A game's HowLongToBeat lookup (and cover choices) only when a property needs them.
    const needsLib = mappings.some(m => HLTB_SOURCES.includes(m.source) || m.source === 'poster')
    const full = await this.fullItem(item, needsLib ? lib : undefined)
    return this.compareNote(file, full, lib, kind, mappings, item.ratingKey)
  }

  /** The differences between a note and an item's details, for the chosen properties. */
  private compareNote(file: TFile, item: PlexItem, lib: LibrarySetting, kind: MediaKind, mappings: LibrarySetting['properties'], noteKey: string): Checks | null {
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const ctx = { kind, link: this.linkFor(item), image: fromPlex(item) ? null : item.portrait ?? null, values: lib.values, genres: this.settings.allowedGenres, leaveOut: lib.leaveOutGenres }
    const keys = itemKeys(item)
    const to: Record<string, unknown> = {}
    const ticked = new Set<string>()
    const yours = new Set<string>()
    for (const m of mappings) {
      const name = m.name.trim()
      const current: unknown = from[name]
      // A song's older link (to the track, which Plex has no page for) is replaced, ticked.
      const oldSongLink = m.source === 'plexLink' && item.type === 'track' && typeof current === 'string' && !/[?&]track=/.test(current) && keys.includes(ratingKeyFromLink(current) ?? '') && current !== this.linkFor(item)
      if (m.source === 'plexLink' && !oldSongLink) {
        const pointsAt = ratingKeyFromLink(current)
        if (pointsAt && keys.includes(pointsAt)) continue
      }
      const kept = (offer: unknown) => this.isKept(`${noteKey}|${name}`, current, offer)
      if (m.source === 'poster' && fromPlex(item)) {
        // A Plex poster is downloaded, so it's only offered where the note has none.
        if (isBlank(current) && hasImage(item) && !kept(POSTER_PREVIEW)) {
          to[name] = POSTER_PREVIEW
          ticked.add(name)
        }
        continue
      }
      if (STATUS_SOURCES.includes(m.source)) {
        // Open Library knows nothing of your reading; elsewhere, only a step forward starts ticked.
        if (item.type === 'book') continue
        const value = sourceValue(m.source, item, ctx, m.text)
        if (isBlank(value) || sameValue(current, value) || kept(value)) continue
        to[name] = value
        if (statusMovesForward(current, value, lib.values)) ticked.add(name)
        else yours.add(name)
        continue
      }
      const offer = checkValue(m.source, current, sourceValue(m.source, item, ctx, m.text), this.settings.allowedGenres, kind, lib.leaveOutGenres)
      if (!offer || kept(offer.to)) continue
      to[name] = offer.to
      // A rating of yours is replaced with Plex's only if you tick it (or send yours to Plex instead).
      if (RATING_SOURCES.includes(m.source) && !isBlank(current)) yours.add(name)
      if (offer.ticked || (m.source === 'plexLink' && (isSearchLink(current) || oldSongLink))) ticked.add(name)
      // An image linked to a file in the vault ("[[…]]") is one you set: it stays unless you tick it.
      if (IMAGE_SOURCES.includes(m.source) && typeof current === 'string' && current.trim().startsWith('[[')) yours.add(name)
      // A source that only knows the year (Open Library's books) is a guess against a date of yours.
      if (m.source === 'releaseDate' && !isBlank(current) && vagueDate(offer.to)) yours.add(name)
    }
    const names = Object.keys(to)
    return names.length ? { names, from, to, sameLength: ticked, yours } : null
  }

  /**
   * "Check existing notes against sources" for the Books library, which no sync lists: each note
   * is compared with its Open Library work. A note without an Open Library link is looked up by
   * title and author; the pop-up says which book was found. Leaving its link unticked means it's
   * the wrong book: that note isn't looked up again. Books that can't be found count as unmatched.
   */
  private async checkBooks(chosen: Set<string>, result: SyncResult, progress: ProgressFn, only?: Set<string>): Promise<void> {
    const lib = this.settings.libraries[BOOKS_LIBRARY] as LibrarySetting | undefined
    if (!lib || lib.target !== 'book') return
    if (this.onlyLibraries && !this.onlyLibraries.has(BOOKS_LIBRARY)) return
    const mappings = lib.properties.filter(m => chosen.has(m.name.trim()) && !UNCHECKED_SOURCES.includes(m.source))
    // Book ratings are converted to the star scale too: the Books library's rating property, or the
    // name the other libraries give theirs (book notes may have one the plugin doesn't fill in).
    const ratingNames = [...new Set(Object.values(this.settings.libraries).flatMap(l => l.properties)
      .filter(m => m.source === 'userRatingEmoji' && m.name.trim()).map(m => m.name.trim()))]
      .filter(name => chosen.has(name))
    if (!mappings.length && !ratingNames.length) return
    const linkProp = lib.properties.find(m => m.source === 'plexLink' && m.name.trim())?.name.trim()
    const authorProp = lib.properties.find(m => m.source === 'authors' && m.name.trim())?.name.trim()
    const folder = normalizePath(lib.folder)
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${folder}/`) && (!only || only.has(f.path)))
    let position = 0
    for (const file of files) {
      position++
      if (result.stopped) break
      const noteKey = `book:${file.path}`
      if (noteKey in this.settings.ignored) continue
      const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      const rescale = this.planRescaleOf(file, noteKey, ratingNames, 'emoji')
      const asItem: PlexItem = { ratingKey: noteKey, type: 'book', title: file.basename }
      // A book nothing can be found for still gets its rating converted.
      const rescaleOnly = async (): Promise<void> => {
        if (!rescale) return
        const approval = await this.ask({ action: 'change', path: file.path, lines: this.rescaleLines(rescale), position, total: files.length }, result, asItem, lib)
        if (!approval) return
        if (await this.applyRescale(file, noteKey, rescale, approval.excluded, approval.edits)) result.corrected.push(file.path)
        else result.declined++
      }
      const link: unknown = linkProp ? from[linkProp] : undefined
      const linked = ratingKeyFromLink(link)
      const work = linked?.startsWith('ol-') ? linked.slice(3) : null
      if (!work && noteKey in this.settings.keptLinks) {
        if (!this.settings.unmatchedIgnored.includes(file.path)) result.unmatched.push(file.path)
        await rescaleOnly()
        continue
      }
      if (!mappings.length) {
        await rescaleOnly()
        continue
      }
      let book: PlexItem | null
      try {
        progress(`Checking ${file.basename}…`)
        const authors = listOf(authorProp ? from[authorProp] : undefined).map(a => a.replace(/^\[\[(?:[^\]|]*\|)?([^\]]*)\]\]$/, '$1'))
        // A name like "Dune by Frank Herbert" is searched for as "Dune", by Frank Herbert.
        const title = authors.length ? file.basename.replace(/\s+by\s+.+$/i, '') : file.basename
        book = await lookUpBook({ work, title, author: authors[0] }, this.settings.googleBooksKey ?? '')
      } catch (err) {
        result.failed.push({ title: file.basename, error: `checking failed: ${errorText(err)}` })
        await rescaleOnly()
        continue
      }
      if (!book) {
        if (!this.settings.unmatchedIgnored.includes(file.path)) result.unmatched.push(file.path)
        await rescaleOnly()
        continue
      }
      result.checked.push(file.path)
      const searched = !work
      const checks = this.compareNote(file, book, lib, 'book', mappings.filter(m => !rescale?.names.includes(m.name.trim())), noteKey)
      const lines: ApprovalLine[] = this.rescaleLines(rescale)
      for (const name of checks?.names ?? []) {
        const offer = checks!.to[name]
        const shown = typeof offer === 'number' ? { value: String(offer), edit: 'number' as const } : editable(offer)
        lines.push({ key: `fix:${name}`, label: name, current: describeValue(checks!.from[name]), ...shown, unticked: Boolean(checks!.yours?.has(name)) || (!this.settings.tickDifferences && !checks!.sameLength.has(name)) })
      }
      // A book found by searching also offers its link, whether or not the Link property is checked.
      const newLink = searched && linkProp && book.webLink && !checks?.names.includes(linkProp) ? book.webLink : null
      if (newLink && linkProp) {
        lines.push({ key: `fix:${linkProp}`, label: linkProp, current: describeValue(link), value: newLink, edit: 'text', unticked: !this.settings.tickDifferences && !isBlank(link) })
      }
      if (!lines.length) continue

      const note = searched && (checks || newLink)
        ? `Found on Open Library: ${book.title}${book.authors?.length ? ` by ${book.authors.join(', ')}` : ''}${book.year ? `, ${book.year}` : ''}. Make sure it's the same book; if it isn't, press Skip.`
        : undefined
      const approval = await this.ask({ action: 'change', path: file.path, lines, note, position, total: files.length }, result, asItem, lib)
      if (!approval) continue
      const { excluded, edits } = approval
      const rescaled = await this.applyRescale(file, noteKey, rescale, excluded, edits)
      const offered = new Map<string, unknown>([...(checks?.names ?? []).map((n): [string, unknown] => [n, checks!.to[n]]), ...(newLink && linkProp ? [[linkProp, newLink] as [string, unknown]] : [])])
      const apply = [...offered.keys()].filter(name => !excluded.has(`fix:${name}`))
      for (const name of [...offered.keys()].filter(n => excluded.has(`fix:${n}`))) {
        if (searched && name === linkProp) {
          // Not this book's link: don't look this note up again.
          this.settings.keptLinks[noteKey] = typeof link === 'string' ? link : ''
        } else {
          this.keep(`${noteKey}|${name}`, from[name], offered.get(name))
        }
        result.keptLinks++
      }
      if (!apply.length) {
        if (rescaled) result.corrected.push(file.path)
        else result.declined++
        continue
      }
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          for (const name of apply) {
            const edited = edits[`fix:${name}`]
            const value = offered.get(name)
            fm[name] = edited === undefined ? value : parseEdit(edited, editKind(value))
          }
        })
        result.corrected.push(file.path)
        if (linkProp && apply.includes(linkProp) && searched) result.links.push(file.path)
      } catch (err) {
        result.failed.push({ title: file.basename, error: errorText(err) })
      }
    }
  }


  /**
   * Link properties that hold a link to somewhere other than this item (say, a game's HowLongToBeat
   * page instead of its Steam Store page), to offer the item's own link instead. A link to this item
   * in any form (its Plex page or IMDb page for a movie) counts as right, and so does one you chose
   * to keep before.
   */
  private planLinks(file: TFile, item: PlexItem, lib: ActiveLibrary): { names: string[], from: Record<string, unknown>, to: Record<string, string>, placeholders: Set<string> } | null {
    const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const keys = itemKeys(item)
    const link = this.linkFor(item)
    const to: Record<string, string> = {}
    const placeholders = new Set<string>()
    for (const m of lib.properties) {
      const name = m.name.trim()
      const current: unknown = from[name]
      if (m.source !== 'plexLink' || !name || isBlank(current) || current === link) continue
      const pointsAt = ratingKeyFromLink(current)
      if (pointsAt && keys.includes(pointsAt)) continue
      if (this.settings.keptLinks[item.ratingKey] === String(current)) continue
      to[name] = link
      if (isSearchLink(current)) placeholders.add(name)
    }
    const names = Object.keys(to)
    return names.length ? { names, from, to, placeholders } : null
  }

  /** Where the item's Link points: its Plex page, a game's Steam Store page, or its IMDb (or the like) page. */
  private linkFor(item: PlexItem): string {
    if (item.type === 'game' && item.steamAppId) return steamStoreUrl(item.steamAppId)
    if (!fromPlex(item) && item.webLink) return item.webLink
    return plexWebLink(this.machineId, item.ratingKey, item.type === 'track' ? item.parentRatingKey : undefined)
  }

  /** The path and properties a new note would get, for the approval pop-up. */
  private previewNote(item: PlexItem, lib: ActiveLibrary, kind: MediaKind): { path: string, lines: ApprovalLine[], values: Record<string, unknown> } {
    const folder = normalizePath(lib.folder)
    const path = this.freePath(folder, renderFileName(this.naming(lib), item), 'md')
    const fileName = path.split('/').pop()!.replace(/\.md$/, '')
    const frontmatter = buildFrontmatter(item, lib.properties, {
      kind,
      link: this.linkFor(item),
      image: !fromPlex(item) ? item.portrait ?? null : hasImage(item) ? POSTER_PREVIEW : null,
      values: lib.values,
      genres: this.settings.allowedGenres,
      leaveOut: lib.leaveOutGenres,
    })
    const lines: ApprovalLine[] = [{ key: 'file', label: 'File name', value: fileName, edit: 'text', required: true }]
    for (const [name, value] of Object.entries(frontmatter)) {
      const poster = value === POSTER_PREVIEW
      const cover = !fromPlex(item) && lib.properties.some(m => m.source === 'poster' && m.name.trim() === name)
      lines.push(poster
        ? { key: `prop:${name}`, label: name, value: describeValue(value) }
        : { key: `prop:${name}`, label: name, ...editable(value), choices: cover ? item.coverChoices : undefined })
    }
    return { path, lines, values: frontmatter }
  }

  /** Rating keys (from the Plex link property) and file names of every note in these libraries' folders. */
  private indexExistingNotes(libs: LibrarySetting[]): ExistingNotes {
    const index: ExistingNotes = emptyIndex()
    if (!libs.length) return index
    const folders = [...new Set(libs.map(lib => normalizePath(lib.folder)))]
    const linkProps = [...new Set(Object.values(this.settings.libraries).flatMap(lib => linkPropertyNames(lib.properties)))]
    const musicFolders = libs.filter(lib => lib.target === 'music').map(lib => ({ folder: normalizePath(lib.folder), format: lib.fileNameFormat }))
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some(folder => file.path.startsWith(`${folder}/`))) continue
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
      const ratingKeys = linkProps
        .map(prop => ratingKeyFromLink(frontmatter?.[prop]))
        .filter((key): key is string => key !== null)
      addToIndex(index, file.path, file.basename, ratingKeys)
      // A song note named with several artists is also found under the first one alone.
      for (const { folder, format } of musicFolders) {
        if (!file.path.startsWith(`${folder}/`)) continue
        for (const name of songNameVariants(file.basename, format)) addToIndex(index, file.path, name)
      }
    }
    return index
  }

  /**
   * Creates the note. Properties named in `leaveEmpty` (unticked when approving) are added empty,
   * `overrides` replace values (edited when approving), and `fileName` replaces the file name.
   */
  private async createNote(
    item: PlexItem, lib: ActiveLibrary, kind: MediaKind,
    leaveEmpty = new Set<string>(), overrides: Record<string, unknown> = {}, fileName?: string,
  ): Promise<string> {
    const folder = normalizePath(lib.folder)
    await this.ensureFolder(folder)
    const baseName = fileName ?? renderFileName(this.naming(lib), item)
    const path = this.freePath(folder, baseName, 'md')

    const { properties, values } = lib
    const posterWanted = properties.some(m => m.source === 'poster' && m.name.trim() && !leaveEmpty.has(m.name.trim()))
    const image = posterWanted ? await this.imageFor(item, folder, baseName) : null
    const frontmatter = buildFrontmatter(item, properties, {
      kind,
      link: this.linkFor(item),
      image,
      values,
      genres: this.settings.allowedGenres,
      leaveOut: lib.leaveOutGenres,
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
    // Its rating, if any, is written in the star scale.
    if (properties.some(m => m.source === 'userRatingEmoji')) this.reviewRating(item.ratingKey)
    return path
  }

  /**
   * The item's poster (for a track, its album's cover, shared by the album's tracks), saved and
   * linked. A game's portrait cover is linked where Steam keeps it.
   */
  private async imageFor(item: PlexItem, folder: string, baseName: string): Promise<string | null> {
    if (!fromPlex(item)) return item.portrait ?? null
    const plex = this.plex
    if (!plex) return null
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

/** An offer as remembered with a kept value: text as it is, anything else as JSON. */
function offerText(offer: unknown): string {
  return typeof offer === 'string' ? offer : JSON.stringify(offer) ?? ''
}

/** A kept value remembered with the offer turned down (null: an older entry, the kept value alone). */
function keptEntry(entry: string): { kept: string, offered: string } | null {
  if (!entry.startsWith('{"kept":')) return null
  try {
    const parsed = JSON.parse(entry) as { kept?: unknown, offered?: unknown }
    return typeof parsed.kept === 'string' && typeof parsed.offered === 'string' ? { kept: parsed.kept, offered: parsed.offered } : null
  } catch {
    return null
  }
}
