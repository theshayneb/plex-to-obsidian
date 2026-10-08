import { App, normalizePath, TFile, TFolder } from 'obsidian'
import { describeValue, editKind, parseEdit, type ApprovalLine, type ApprovalRequest, type Approver, type OwnerChooser } from './approval-modal'
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
import { buildFrontmatter, CHECKED_SOURCES, HLTB_SOURCES, sameLengthOtherForm, linkPropertyNames, checkValue, listOf, PLAY_SOURCES, MIRRORED_SOURCES, noteStars, ratingDirection, RATING_SOURCES, sameValue, sourceValue, userStars, STATUS_SOURCES, statusMovesForward, UNCHECKED_SOURCES, usesSource, type FieldSource } from './properties'
import { SteamClient } from './steam'
import { readSteamCollections } from './steam-local'
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

/** A rating in words, for the approval pop-up. */
function stars(n: number): string {
  return `${n} star${n === 1 ? '' : 's'}`
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

  private async ask(request: ApprovalRequest, result: SyncResult, item: PlexItem, lib: LibrarySetting): Promise<Approval | null> {
    if (result.stopped) return null
    if ((!this.settings.askBeforeChanges && !this.alwaysAsk) || !this.approve) return { excluded: new Set(), edits: {} }
    const remembered = this.approvedAll[request.action]
    if (remembered) return { excluded: remembered, edits: {} }
    const { choice, excluded, edits, mergeWith } = await this.approve(request)
    const skipped = new Set(excluded)
    // "All the rest" repeats the unticked lines, not this note's edits.
    if (choice === 'all') this.approvedAll[request.action] = skipped
    if (choice === 'stop') result.stopped = true
    if (choice === 'apply' || choice === 'all') return { excluded: skipped, edits: edits ?? {} }
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
  private async prepare(progress: ProgressFn, refresh: boolean): Promise<{ active: [string, ActiveLibrary][], indexes: Record<Family, ExistingNotes>, entries: Entry[] }> {
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
        for (const item of games) {
          entries.push({ item: collections ? { ...item, steamCollections: collections.get(item.steamAppId ?? 0) ?? [] } : item, lib })
        }
        continue
      }
      const music = lib.target === 'music'
      for (const item of await this.plex!.libraryItems(key, music)) {
        const wanted = music ? item.type === 'track' : item.type === 'movie' || item.type === 'show'
        if (wanted) entries.push({ item, lib })
      }
    }
    return { active, indexes, entries }
  }

  /**
   * @param checking for 'check': the property names to compare (in every library that has them).
   */
  async run(progress: ProgressFn, mode: SyncMode = 'full', checking: string[] = []): Promise<SyncResult> {
    const { active, indexes, entries } = await this.prepare(progress, mode === 'full')
    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [], declined: 0, stopped: false, ignored: 0, newlyIgnored: [], merged: [], links: [], corrected: [], sentRatings: [], keptLinks: 0, unmatched: [] }

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
      for (const family of FAMILIES) {
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
          // A note chosen with "Use an existing note" keeps the name you gave it.
          if (renaming && !this.isMerged(item)) {
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
          const rating = genreCheck ? null : this.ratingPlan(file, item, lib)
          const notOverwritten = new Set(beingFilled)
          if (rating && rating.direction !== 'toNote') rating.names.forEach(name => notOverwritten.add(name))
          const plays = counting ? this.planUpdates(file, item, lib, updating, notOverwritten) : null
          // Only offered when there's a pop-up to choose in: a link already there is never replaced unasked.
          const asking = full && this.settings.askBeforeChanges && Boolean(this.approve)
          const toPlex = asking && this.settings.sendRatings && this.plex && rating?.direction === 'toPlex' && rating.note
            && this.settings.keptValues[`${item.ratingKey}|plexRating`] !== String(rating.note) ? rating.note : null
          // Remembered only when the note and Plex agree (or one was just made to match the other).
          if (rating && (rating.note ?? 0) === rating.plex) this.seeRating(item.ratingKey, rating.plex)
          const links = asking ? this.planLinks(file, item, lib) : null
          let checks: Checks | null = null
          try {
            checks = genreCheck ? await this.planFullCheck(file, item, lib, kind, chosen, progress) : asking ? this.planChecks(file, item, lib) : null
          } catch (err) {
            result.failed.push({ title: item.title, error: `checking failed: ${errorText(err)}` })
          }
          if (!renameTo && !fill && !plays && !links && !checks && !toPlex) continue

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
            const shown = typeof to === 'number' ? { value: String(to), edit: 'number' as const } : editable(to)
            lines.push({ key: `fix:${name}`, label: name, current: describeValue(checks!.from[name]), ...shown, unticked: Boolean(checks!.yours?.has(name)) || (!this.settings.tickDifferences && !checks!.sameLength.has(name)) })
          }
          if (toPlex) {
            lines.push({ key: 'plexRating', label: 'Your rating in Plex', current: rating!.plex ? stars(rating!.plex) : null, value: stars(toPlex), unticked: !this.settings.tickDifferences })
          }
          const approval = await this.ask({ action: 'change', path, lines, position, total: plans.length }, result, item, lib)
          if (!approval) continue
          const { excluded, edits } = approval
          const sending = Boolean(toPlex) && !excluded.has('plexRating')
          if (toPlex && !sending) {
            // Plex's rating is to stay as it is: don't offer this note's rating again while it's the same.
            this.settings.keptValues[`${item.ratingKey}|plexRating`] = String(toPlex)
            result.keptLinks++
          }
          const fixNames = (checks?.names ?? []).filter(name => !excluded.has(`fix:${name}`))
          // A value left unticked is yours to keep: don't offer to fix it again while it stays the same.
          for (const name of (checks?.names ?? []).filter(n => excluded.has(`fix:${n}`))) {
            this.settings.keptValues[`${item.ratingKey}|${name}`] = String(checks!.from[name])
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
          if (!renameTo && !fill?.additions.length && !fill?.imageProperty && !playNames.length && !linkNames.length && !fixNames.length && !sending) {
            result.declined++
            continue
          }

          try {
            if (renameTo) {
              await this.app.fileManager.renameFile(file, renameTo)
              result.renamed.push({ from: path, to: renameTo })
              addToIndex(index, renameTo, renderFileName(this.naming(lib), item))
            }
            if (fill && await this.applyFill(file, fill, lib)) result.filled.push(file.path)
            if (fixNames.length) {
              await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                for (const name of fixNames) {
                  const edited = edits[`fix:${name}`]
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
              if (rating && playNames.some(name => rating.names.includes(name))) this.seeRating(item.ratingKey, rating.plex)
            }
            if (sending && toPlex) {
              await this.plex!.rate(item.ratingKey, toPlex * 2)
              this.seeRating(item.ratingKey, toPlex)
              result.sentRatings.push(file.path)
            }
          } catch (err) {
            result.failed.push({ title: item.title, error: errorText(err) })
          }
        }
      }
    }
    if (genreCheck && !result.stopped) await this.checkBooks(chosen, result, progress)
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
  async explain(query: string, progress: ProgressFn): Promise<string[][]> {
    const { indexes, entries } = await this.prepare(progress, true)
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

  /** Why an item a link points to isn't in any library being synced. */
  private async explainMissing(key: string): Promise<string[]> {
    if (key.startsWith('steam-')) {
      return [
        `Steam app ${key.slice(6)}`,
        'This game isn\'t in the games list Steam gives for your account. It may be a game you don\'t own, a free game you haven\'t played (or free-to-play games are switched off), or the Steam library is set to Skip.',
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
    const item = found.type === 'game' ? await this.gameDetails(found, lib) : found
    const family = familyOf(lib)
    const libs = Object.values(this.settings.libraries)
      .filter((l): l is ActiveLibrary => l.target !== 'skip')
      .filter(l => familyOf(l) === family)
    const index = this.indexExistingNotes(libs)
    this.addMerged(index, family)
    const match = findNote(index, item, this.naming(lib), lib.matchBy)
    if (match) return { existing: match.paths[0] }

    const result: SyncResult = { created: [], renamed: [], filled: [], playCounts: [], skipped: 0, failed: [], declined: 0, stopped: false, ignored: 0, newlyIgnored: [], merged: [], links: [], corrected: [], sentRatings: [], keptLinks: 0, unmatched: [] }
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
    return { created: await this.createNote(item, lib, kind, left, overrides, fileName) }
  }

  private isIgnored(item: PlexItem): boolean {
    return item.ratingKey in this.settings.ignored
  }

  /** Whether a Plex rating was seen (or sent) that differs from the last one recorded. */
  private ratingsChanged = false

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
    const note = names.map(name => noteStars(from[name])).find(value => value !== null) ?? null
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
    if (!fill) return
    const now = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const lines: ApprovalLine[] = fill.additions.map(([name, value]) => {
      const choices = name === fill!.coverProperty ? fill!.item.coverChoices : undefined
      return { key: `add:${name}`, label: name, current: describeValue(now[name]), ...editable(value), choices }
    })
    if (fill.imageProperty) {
      lines.push({ key: `add:${fill.imageProperty}`, label: fill.imageProperty, current: describeValue(now[fill.imageProperty]), value: POSTER_PREVIEW })
    }
    const approval = await this.ask({ action: 'change', path, lines, position, total }, result, item, lib)
    if (!approval) return
    const { excluded, edits } = approval
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
        console.warn(`Media import and sync: HowLongToBeat lookup for ${item.title} failed`, err)
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
          console.warn(`Media import and sync: SteamGridDB covers for ${item.title} failed`, err)
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
      const value = sourceValue(m.source, item, ctx)
      if (value === undefined || from[name] === value || (Array.isArray(value) && sameValue(from[name], value))) continue
      // A status only ever moves forward, and one of your own is left alone.
      if (STATUS_SOURCES.includes(m.source) && !statusMovesForward(from[name], value, lib.values)) continue
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
      const value = sourceValue(m.source, item, ctx)
      if (typeof value !== 'number') continue
      if (current === value || (typeof current === 'string' && current.trim() === String(value))) continue
      if (this.settings.keptValues[`${item.ratingKey}|${name}`] === String(current)) continue
      to[name] = value
      if (sameLengthOtherForm(current, value)) sameLength.add(name)
    }
    const names = Object.keys(to)
    return names.length ? { names, from, to, sameLength } : null
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
  private async planFullCheck(file: TFile, item: PlexItem, lib: ActiveLibrary, kind: MediaKind, chosen: Set<string>, progress: ProgressFn): Promise<Checks | null> {
    const mappings = lib.properties.filter(m => chosen.has(m.name.trim()) && !UNCHECKED_SOURCES.includes(m.source))
    if (!mappings.length) return null
    progress(`Checking ${displayName(item)}…`)
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
      if (m.source === 'plexLink') {
        const pointsAt = ratingKeyFromLink(current)
        if (pointsAt && keys.includes(pointsAt)) continue
      }
      const offer = checkValue(m.source, current, sourceValue(m.source, item, ctx), this.settings.allowedGenres, kind, lib.leaveOutGenres)
      if (!offer) continue
      if (this.settings.keptValues[`${noteKey}|${name}`] === String(current)) continue
      to[name] = offer.to
      if (offer.ticked || (m.source === 'plexLink' && isSearchLink(current))) ticked.add(name)
      // An image linked to a file in the vault ("[[…]]") is one you set: it stays unless you tick it.
      if (IMAGE_SOURCES.includes(m.source) && typeof current === 'string' && current.trim().startsWith('[[')) yours.add(name)
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
  private async checkBooks(chosen: Set<string>, result: SyncResult, progress: ProgressFn): Promise<void> {
    const lib = this.settings.libraries[BOOKS_LIBRARY] as LibrarySetting | undefined
    if (!lib || lib.target !== 'book') return
    const mappings = lib.properties.filter(m => chosen.has(m.name.trim()) && !UNCHECKED_SOURCES.includes(m.source))
    if (!mappings.length) return
    const linkProp = lib.properties.find(m => m.source === 'plexLink' && m.name.trim())?.name.trim()
    const authorProp = lib.properties.find(m => m.source === 'authors' && m.name.trim())?.name.trim()
    const folder = normalizePath(lib.folder)
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${folder}/`))
    let position = 0
    for (const file of files) {
      position++
      if (result.stopped) break
      const noteKey = `book:${file.path}`
      if (noteKey in this.settings.ignored) continue
      const from = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      const link: unknown = linkProp ? from[linkProp] : undefined
      const linked = ratingKeyFromLink(link)
      const work = linked?.startsWith('ol-') ? linked.slice(3) : null
      if (!work && noteKey in this.settings.keptLinks) {
        if (!this.settings.unmatchedIgnored.includes(file.path)) result.unmatched.push(file.path)
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
        continue
      }
      if (!book) {
        if (!this.settings.unmatchedIgnored.includes(file.path)) result.unmatched.push(file.path)
        continue
      }
      const searched = !work
      const checks = this.compareNote(file, book, lib, 'book', mappings, noteKey)
      const lines: ApprovalLine[] = []
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

      const note = searched
        ? `Found on Open Library: ${book.title}${book.authors?.length ? ` by ${book.authors.join(', ')}` : ''}${book.year ? `, ${book.year}` : ''}. Make sure it's the same book; if it isn't, press Skip.`
        : undefined
      const asItem: PlexItem = { ratingKey: noteKey, type: 'book', title: file.basename }
      const approval = await this.ask({ action: 'change', path: file.path, lines, note, position, total: files.length }, result, asItem, lib)
      if (!approval) continue
      const { excluded, edits } = approval
      const offered = new Map<string, unknown>([...(checks?.names ?? []).map((n): [string, unknown] => [n, checks!.to[n]]), ...(newLink && linkProp ? [[linkProp, newLink] as [string, unknown]] : [])])
      const apply = [...offered.keys()].filter(name => !excluded.has(`fix:${name}`))
      for (const name of [...offered.keys()].filter(n => excluded.has(`fix:${n}`))) {
        if (searched && name === linkProp) {
          // Not this book's link: don't look this note up again.
          this.settings.keptLinks[noteKey] = typeof link === 'string' ? link : ''
        } else {
          this.settings.keptValues[`${noteKey}|${name}`] = String(from[name])
        }
        result.keptLinks++
      }
      if (!apply.length) {
        result.declined++
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
    return plexWebLink(this.machineId, item.ratingKey)
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
