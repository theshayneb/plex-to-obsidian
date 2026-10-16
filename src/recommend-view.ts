import { ItemView, moment, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import { compared, daysWith, monthPeriod, parseReaction, summarize, weekNumbers, weeks, yearPeriod, type DayLink, type DaysSpent, type Period, type ReactionEvent, type WatchEvent } from './insights-data'
import type { Finished } from './reactions'
import type PlexMediaNotesPlugin from './main'
import { artistsOf, type PlexItem } from './notes'
import { similarTracks } from './lastfm'
import { lastfmSuggestions, pickSeeds, songKey, type LastfmSuggestion, type Seed, type SimilarTrack } from './lastfm-data'
import { isLoved, isOpen, recommend, type RecEntry, type RecGroup, type Recommendation } from './recommend'
import { itemEntry, noteEntries, withItem } from './recommend-data'
import { errorMessage } from './settings'
import { PlexSync } from './sync'

export const RECOMMEND_VIEW = 'pmn-recommendations'

type Tab = 'insights' | 'recommendations' | 'habits'
const TABS: [Tab, string][] = [['insights', 'Insights'], ['recommendations', 'Recommendations'], ['habits', 'Habits']]

const GROUP_TITLES: Record<RecGroup, string> = {
  video: 'Movies and TV',
  music: 'Music',
  game: 'Games',
  book: 'Books',
}

/**
 * The recommendations dashboard: what you haven't rated or watched yet that's most like what you
 * rated ⭐⭐⭐⭐ or 🩷, per kind of media, from your notes and from Plex and Steam items with no note.
 */
export class RecommendView extends ItemView {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  /** Plex and Steam items with no note yet, once looked up (null: not yet). */
  private pmnItems: { entry: RecEntry, item: PlexItem, libraryKey: string }[] | null = null
  /** What Plex and Steam know about the items notes are for, by note path. */
  private pmnMatched = new Map<string, RecEntry>()
  private pmnLooking = false
  private pmnLookupError: string | null = null
  /** The Plex track behind each music entry (`note:<path>` or `item:<key>`), for asking Last.fm and knowing what you have. */
  private pmnTracks = new Map<string, PlexItem>()
  /** Last.fm's suggestions, once asked (null: not yet). */
  private pmnLastfm: LastfmSuggestion[] | null = null
  /** How asking Last.fm is going, or why it failed (null: done, or not asked). */
  private pmnLastfmState: string | null = null
  private pmnLastfmError = false
  private pmnTab: Tab = 'insights'
  /** Plex's watch history from `since` on, once read, with each movie's and show's note. */
  private pmnHistory: { since: number, events: WatchEvent[], notes: Map<string, TFile> } | null = null
  private pmnHistoryState: string | null = null
  private pmnSpan: 'month' | 'year' = 'month'
  private pmnWhen = new Date()
  /** Movies' and episodes' lengths, for the Habits tab's hours (null: not looked up yet). */
  private pmnLengths: Map<string, number> | null = null
  private pmnFinished: Finished[] | null = null
  /** Which of each kind's candidates "Worth a few words" shows ("Another one" moves on). */
  private readonly pmnReviewAt = new Map<string, number>()

  constructor(leaf: WorkspaceLeaf, private readonly pmnPlugin: PlexMediaNotesPlugin) {
    super(leaf)
  }

  getViewType(): string { return RECOMMEND_VIEW }
  getDisplayText(): string { return 'Media dashboard' }
  getIcon(): string { return 'sparkles' }

  async onOpen(): Promise<void> {
    // A note changed (a reaction written, a rating set): redrawn shortly after, once Obsidian has read it.
    let pending: number | null = null
    this.registerEvent(this.app.metadataCache.on('changed', file => {
      const inLibrary = Object.values(this.pmnPlugin.settings.libraries).some(lib => lib.target !== 'skip' && file.path.startsWith(`${lib.folder.replace(/\/+$/, '')}/`))
      if (this.pmnTab === 'recommendations' || !inLibrary) return
      if (pending !== null) window.clearTimeout(pending)
      pending = window.setTimeout(() => {
        pending = null
        this.pmnRender()
      }, 500)
    }))
    this.pmnRender()
    await this.pmnLoadTab()
  }

  /** Reads what the open tab needs (once), then redraws. */
  private async pmnLoadTab(): Promise<void> {
    if (this.pmnTab === 'recommendations' && !this.pmnItems) await this.pmnLookUp()
    if (this.pmnTab === 'insights') await this.pmnReadHistory(this.pmnPeriod().from - 365 * 86400)
    if (this.pmnTab === 'habits') {
      await this.pmnReadHistory(weeks(new Date()).lastWeek.from)
      await this.pmnReadLengths()
    }
    if (this.pmnTab === 'insights' && !this.pmnFinished) {
      try {
        this.pmnFinished = await new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings()).finishedItems()
      } catch {
        this.pmnFinished = []
      }
      this.pmnRender()
    }
  }

  /** The month or year the Insights tab shows. */
  private pmnPeriod(): Period {
    return this.pmnSpan === 'year' ? yearPeriod(this.pmnWhen.getFullYear()) : monthPeriod(this.pmnWhen.getFullYear(), this.pmnWhen.getMonth())
  }

  /** Reads Plex's watch history back to `since` (unless already read that far). */
  private async pmnReadHistory(since: number, again = false): Promise<void> {
    if (!again && this.pmnHistory && this.pmnHistory.since <= since) return
    if (this.pmnHistoryState === 'Reading your Plex history…') return
    this.pmnHistoryState = 'Reading your Plex history…'
    this.pmnRender()
    try {
      const { events, notes } = await new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings()).watchHistory(since)
      this.pmnHistory = { since, events, notes }
      this.pmnHistoryState = null
    } catch (err) {
      this.pmnHistoryState = `Plex's history couldn't be read: ${errorMessage(err)}`
    }
    this.pmnRender()
  }

  /** Looks up how long this and last week's movies and episodes are, for the hours. */
  private async pmnReadLengths(): Promise<void> {
    const { lastWeek } = weeks(new Date())
    const keys = (this.pmnHistory?.events ?? []).filter(e => e.kind !== 'track' && e.viewedAt >= lastWeek.from).map(e => e.key)
    try {
      this.pmnLengths = await new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings()).lengths(keys)
    } catch {
      this.pmnLengths = new Map()
    }
    this.pmnRender()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  /** Reads Plex and Steam for items with no note yet, then redraws. */
  private async pmnLookUp(): Promise<void> {
    if (this.pmnLooking || (this.pmnLastfmState && !this.pmnLastfmError)) return
    this.pmnLooking = true
    this.pmnLastfm = null
    this.pmnLastfmState = null
    this.pmnLookupError = null
    this.pmnRender()
    try {
      const sync = new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings())
      const { withNotes, withoutNotes } = await sync.libraryItems(() => {})
      this.pmnItems = withoutNotes.map(({ item, kind, libraryKey }) => ({ entry: itemEntry(item, kind), item, libraryKey }))
      this.pmnMatched = new Map(withNotes.map(({ item, path, kind }) => [path, itemEntry(item, kind)]))
      this.pmnTracks = new Map([
        ...withNotes.filter(w => w.kind === 'music').map(({ item, path }): [string, PlexItem] => [`note:${path}`, item]),
        ...withoutNotes.filter(w => w.kind === 'music').map(({ item }): [string, PlexItem] => [`item:${item.ratingKey}`, item]),
      ])
    } catch (err) {
      this.pmnLookupError = errorMessage(err)
    } finally {
      this.pmnLooking = false
      this.pmnRender()
    }
    if (!this.pmnLookupError) await this.pmnAskLastfm()
  }

  /** Every entry: notes (with what their Plex or Steam item knows) and items with no note. */
  private pmnEntries(): RecEntry[] {
    const notes = noteEntries(this.app, this.pmnPlugin.settings).map(note => {
      const item = this.pmnMatched.get(note.path)
      return item ? withItem(note, item) : note
    })
    return [...notes, ...(this.pmnItems ?? []).map(i => i.entry)]
  }

  /**
   * Asks Last.fm for songs like your loved ones (up to 40, 🩷 first), then redraws with those you
   * don't have.
   */
  private async pmnAskLastfm(): Promise<void> {
    const key = this.pmnPlugin.settings.lastfmKey?.trim()
    if (!key || this.pmnLastfmState) return
    const music = this.pmnEntries().filter(e => e.group === 'music')
    const seeds: Seed[] = []
    for (const entry of music.filter(isLoved)) {
      const item = this.pmnTracks.get(entry.id)
      const artist = item?.originalTitle || item?.grandparentTitle
      if (!item || !artist) continue
      seeds.push({ title: entry.title, artist, track: item.title, weight: entry.level === 5 ? 2 : 1 })
    }
    if (!seeds.length) return
    const chosen = pickSeeds(seeds, 40)
    let done = 0
    this.pmnLastfmError = false
    const step = () => {
      this.pmnLastfmState = `Asking Last.fm: ${done} of ${chosen.length}…`
      this.pmnRender()
    }
    step()
    try {
      const tracks: { seed: Seed, similar: SimilarTrack[] }[] = []
      for (const seed of chosen) {
        tracks.push({ seed, similar: await similarTracks(key, seed.artist, seed.track, 50) })
        done++
        step()
      }
      // Every song you have, under each of its artists.
      const owned = new Set<string>()
      for (const entry of music) {
        const item = this.pmnTracks.get(entry.id)
        if (!item) continue
        const names = [item.originalTitle, item.grandparentTitle].filter((a): a is string => Boolean(a))
        for (const name of new Set(names.flatMap(n => artistsOf(n, item.title)))) owned.add(songKey(name, item.title))
      }
      this.pmnLastfm = lastfmSuggestions(tracks, owned, new Set(this.pmnPlugin.settings.notInterested))
      this.pmnLastfmState = null
    } catch (err) {
      this.pmnLastfmError = true
      this.pmnLastfmState = errorMessage(err)
    }
    this.pmnRender()
  }

  private pmnRender(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pmn-dash')
    const tabs = contentEl.createDiv('pmn-dash-tabs')
    for (const [tab, label] of TABS) {
      const button = tabs.createEl('button', { cls: `pmn-dash-tab${tab === this.pmnTab ? ' is-active' : ''}`, text: label })
      button.addEventListener('click', () => {
        if (tab === this.pmnTab) return
        this.pmnTab = tab
        this.pmnRender()
        void this.pmnLoadTab()
      })
    }
    const body = contentEl.createDiv('pmn-dash-body')
    if (this.pmnTab === 'insights') this.pmnInsights(body)
    else if (this.pmnTab === 'habits') this.pmnHabits(body)
    else this.pmnRecommendations(body)
  }

  private pmnRecommendations(contentEl: HTMLElement): void {
    const settings = this.pmnPlugin.settings
    // A note's people (director, cast…) come from its Plex item, so notes needn't have them.
    const items = this.pmnItems ?? []
    const entries = this.pmnEntries()
    const recs = recommend(entries, new Set(settings.notInterested))
    const loved = entries.filter(isLoved)

    const header = contentEl.createDiv('pmn-dash-header')
    const titles = header.createDiv('pmn-dash-titles')
    titles.createDiv({ cls: 'pmn-dash-title', text: 'Recommendations' })
    titles.createDiv({
      cls: 'pmn-dash-subtitle',
      text: `What you haven't rated or watched yet that's most like the ${loved.length} thing${loved.length === 1 ? '' : 's'} you rated ⭐⭐⭐⭐ or 🩷.`,
    })
    const refresh = header.createEl('button', { text: this.pmnLooking ? 'Looking in Plex and Steam…' : 'Refresh' })
    refresh.disabled = this.pmnLooking || Boolean(this.pmnLastfmState && !this.pmnLastfmError)
    refresh.addEventListener('click', () => void this.pmnLookUp())
    if (this.pmnLookupError) {
      contentEl.createDiv({ cls: 'pmn-dash-note', text: `Only your notes are used: Plex and Steam couldn't be read (${this.pmnLookupError}).` })
    }

    // How much there is to go on, per kind of media.
    const groups = (Object.keys(GROUP_TITLES) as RecGroup[]).filter(group => entries.some(e => e.group === group))
    const metrics = contentEl.createDiv('pmn-dash-metrics')
    for (const group of groups) {
      const metric = metrics.createDiv('pmn-dash-metric')
      metric.createDiv({ cls: 'pmn-dash-metric-label', text: GROUP_TITLES[group] })
      const inGroup = entries.filter(e => e.group === group)
      metric.createDiv({ cls: 'pmn-dash-metric-value', text: `${inGroup.filter(isLoved).length} loved` })
      metric.createDiv({ cls: 'pmn-dash-metric-sub', text: `${inGroup.filter(isOpen).length} waiting for you` })
    }

    const grid = contentEl.createDiv('pmn-dash-grid')
    for (const group of groups) {
      // Music is suggested by Last.fm only: you rate every song, so your own library has none to suggest.
      if (group === 'music') {
        this.pmnLastfmCard(grid)
        continue
      }
      const card = grid.createDiv('pmn-card')
      card.createDiv({ cls: 'pmn-card-title', text: GROUP_TITLES[group] })
      const list = recs[group]
      if (!list.length) {
        card.createEl('p', {
          cls: 'pmn-dash-empty',
          text: entries.some(e => e.group === group && isLoved(e))
            ? 'Nothing waiting is like what you loved yet. Notes need genres or people (director, author, artist…) in common.'
            : 'Rate a few ⭐⭐⭐⭐ or 🩷 to get suggestions here.',
        })
        continue
      }
      for (const rec of list) this.pmnRow(card, rec, items)
    }
  }

  /** Music from Last.fm: songs you don't have, like the ones you loved, whoever they're by. */
  private pmnLastfmCard(parent: HTMLElement): void {
    const card = parent.createDiv('pmn-card pmn-lastfm')
    card.createDiv({ cls: 'pmn-card-title', text: 'From Last.fm' })
    if (!this.pmnPlugin.settings.lastfmKey?.trim()) {
      card.createEl('p', { cls: 'pmn-dash-empty', text: 'Add a Last.fm API key in this plugin\'s settings, under other sources, to get songs like your ⭐⭐⭐⭐ and 🩷 ones that you don\'t have yet.' })
      return
    }
    if (this.pmnLastfmState) {
      card.createEl('p', { cls: this.pmnLastfmError ? 'pmn-dash-note' : 'pmn-dash-empty', text: this.pmnLastfmError ? `Last.fm couldn't be asked: ${this.pmnLastfmState}` : this.pmnLastfmState })
      if (!this.pmnLastfmError) return
    }
    const found = this.pmnLastfm
    if (!found) {
      if (!this.pmnLastfmError) {
        card.createEl('p', {
          cls: 'pmn-dash-empty',
          text: this.pmnLooking ? 'Waiting for Plex…' : 'Rate a few songs ⭐⭐⭐⭐ or 🩷 (in notes tied to Plex tracks, or in Plex) to get suggestions here.',
        })
      }
      return
    }
    const notInterested = new Set(this.pmnPlugin.settings.notInterested)
    const shown = found.filter(s => !notInterested.has(s.id))
    if (!shown.length) card.createEl('p', { cls: 'pmn-dash-empty', text: 'No new songs found. Refresh to try other loved songs.' })
    for (const suggestion of shown) this.pmnLastfmRow(card, suggestion)
  }

  /** A song you don't have, linked to its Last.fm page. */
  private pmnLastfmRow(parent: HTMLElement, suggestion: LastfmSuggestion): void {
    const row = parent.createDiv('pmn-rec-row')
    const text = row.createDiv('pmn-rec-text')
    if (suggestion.url) text.createEl('a', { cls: 'pmn-rec-title external-link', text: suggestion.title, href: suggestion.url })
    else text.createSpan({ cls: 'pmn-rec-title', text: suggestion.title })
    if (suggestion.because.length) text.createDiv({ cls: 'pmn-rec-why', text: `Like ${suggestion.because.join(' and ')}` })
    const no = row.createDiv('pmn-rec-buttons').createEl('button', { cls: 'pmn-rec-no', text: 'Not interested' })
    no.addEventListener('click', () => void this.pmnNotInterested({ id: suggestion.id, title: suggestion.title }))
  }

  private pmnRow(card: HTMLElement, rec: Recommendation, items: { entry: RecEntry, item: PlexItem, libraryKey: string }[]): void {
    const row = card.createDiv('pmn-rec-row')
    const text = row.createDiv('pmn-rec-text')
    const { entry } = rec
    const path = entry.id.startsWith('note:') ? entry.id.slice(5) : null
    if (path) {
      const link = text.createEl('a', { cls: 'pmn-rec-title internal-link', text: entry.title })
      link.addEventListener('click', event => {
        event.preventDefault()
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey ? 'tab' : false).openFile(file)
      })
    } else {
      text.createSpan({ cls: 'pmn-rec-title', text: entry.title })
      text.createSpan({ cls: 'pmn-rec-chip', text: 'No note yet' })
    }
    const why = [rec.because.length ? `Like ${rec.because.join(' and ')}` : '', rec.shared.join(', ')].filter(Boolean).join(' · ')
    text.createDiv({ cls: 'pmn-rec-why', text: why })

    const buttons = row.createDiv('pmn-rec-buttons')
    const found = path ? null : items.find(i => i.entry.id === entry.id)
    if (found) {
      const make = buttons.createEl('button', { text: 'Make a note' })
      make.addEventListener('click', () => void this.pmnPlugin.addNew(found.item, found.libraryKey).then(() => {
        this.pmnItems = (this.pmnItems ?? []).filter(i => i !== found)
        this.pmnRender()
      }))
    }
    const no = buttons.createEl('button', { cls: 'pmn-rec-no', text: 'Not interested' })
    no.addEventListener('click', () => void this.pmnNotInterested(entry))
  }

  /** A link to a note (or just the name, when there's no note). */
  private pmnLink(parent: HTMLElement, title: string, path?: string): void {
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null
    if (!(file instanceof TFile)) {
      parent.createSpan({ cls: 'pmn-rec-title', text: title })
      return
    }
    const link = parent.createEl('a', { cls: 'pmn-rec-title internal-link', text: title })
    link.addEventListener('click', event => {
      event.preventDefault()
      void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey ? 'tab' : false).openFile(file)
    })
  }

  /** A card with a title and a list of rows, or a line saying there's nothing. */
  private pmnListCard(grid: HTMLElement, title: string, rows: { title: string, path?: string, detail?: string, divider?: boolean, action?: { text: string, tip: string, run: () => void } }[], empty: string): void {
    const card = grid.createDiv('pmn-card')
    card.createDiv({ cls: 'pmn-card-title', text: title })
    if (!rows.length) {
      card.createEl('p', { cls: 'pmn-dash-empty', text: empty })
      return
    }
    for (const row of rows) {
      const rowEl = card.createDiv('pmn-rec-row')
      // A heavier line where a list's next part starts (Most played: artists, then songs).
      if (row.divider) rowEl.addClass('pmn-rec-divider')
      const line = rowEl.createDiv('pmn-rec-text')
      this.pmnLink(line, row.title, row.path)
      if (row.detail) line.createSpan({ cls: 'pmn-rec-why', text: ` ${row.detail}` })
      if (row.action) {
        const { run } = row.action
        rowEl.createEl('button', { cls: 'pmn-rec-action', text: row.action.text, attr: { 'aria-label': row.action.tip } }).addEventListener('click', run)
      }
    }
  }

  private pmnHeader(parent: HTMLElement, title: string, subtitle: string): HTMLElement {
    const header = parent.createDiv('pmn-dash-header')
    const titles = header.createDiv('pmn-dash-titles')
    titles.createDiv({ cls: 'pmn-dash-title', text: title })
    titles.createDiv({ cls: 'pmn-dash-subtitle', text: subtitle })
    return header.createDiv('pmn-dash-controls')
  }

  private pmnMetric(parent: HTMLElement, label: string, value: string, sub?: string): void {
    const metric = parent.createDiv('pmn-dash-metric')
    metric.createDiv({ cls: 'pmn-dash-metric-label', text: label })
    metric.createDiv({ cls: 'pmn-dash-metric-value', text: value })
    // Always a line under the number, so the cards in a row are the same height.
    metric.createDiv({ cls: 'pmn-dash-metric-sub', text: sub ?? '\u00a0' })
  }

  /** Every day your daily notes link a media note in Related (a day you watched, read or played it). */
  private pmnDays(): DayLink[] {
    const notes = new Map(noteEntries(this.app, this.pmnPlugin.settings).map(n => [n.path, n]))
    const sync = new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings())
    return sync.relatedDays().flatMap(({ day, path }) => {
      const note = notes.get(path)
      return note ? [{ day, path, title: note.title, group: note.group }] : []
    })
  }

  /** Every reaction in your notes. */
  private pmnReactions(): ReactionEvent[] {
    const settings = this.pmnPlugin.settings
    const out: ReactionEvent[] = []
    const list = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(String)
    for (const note of noteEntries(this.app, settings)) {
      const file = this.app.vault.getAbstractFileByPath(note.path)
      if (!(file instanceof TFile)) continue
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      const feelings = [...settings.feelings, ...list(fm[settings.feelingsProperty || 'Feelings'])]
      for (const line of list(fm[settings.reactionsProperty || 'Reactions'])) {
        const r = parseReaction(line, feelings)
        if (r) out.push({ ...r, path: note.path, title: note.title, group: note.group })
      }
    }
    return out
  }

  /** Insights: a month or a year of watching, listening, reading and playing. */
  private pmnInsights(el: HTMLElement): void {
    const period = this.pmnPeriod()
    const year = this.pmnWhen.getFullYear()
    const label = this.pmnSpan === 'year' ? String(year) : `${this.pmnWhen.toLocaleString('en', { month: 'long' })} ${year}`
    const controls = this.pmnHeader(el, `Insights: ${label}`, 'What you watched, listened to, read and played, from Plex\'s history and your reactions.')
    for (const span of ['month', 'year'] as const) {
      const b = controls.createEl('button', { cls: `pmn-dash-tab${span === this.pmnSpan ? ' is-active' : ''}`, text: span === 'month' ? 'Month' : 'Year' })
      b.addEventListener('click', () => {
        this.pmnSpan = span
        this.pmnRender()
        void this.pmnLoadTab()
      })
    }
    const step = (by: number) => {
      const d = new Date(this.pmnWhen)
      if (this.pmnSpan === 'year') d.setFullYear(d.getFullYear() + by)
      else d.setMonth(d.getMonth() + by, 1)
      this.pmnWhen = d
      this.pmnRender()
      void this.pmnLoadTab()
    }
    controls.createEl('button', { text: '‹', attr: { 'aria-label': 'Before' } }).addEventListener('click', () => step(-1))
    const next = controls.createEl('button', { text: '›', attr: { 'aria-label': 'After' } })
    next.disabled = period.to > Date.now() / 1000
    next.addEventListener('click', () => step(1))
    if (this.pmnHistoryState) el.createDiv({ cls: 'pmn-dash-note', text: this.pmnHistoryState })

    const notes = this.pmnHistory?.notes ?? new Map<string, TFile>()
    const days = this.pmnDays()
    const s = summarize(this.pmnHistory?.events ?? [], this.pmnReactions(), period, (_kind, key, fallback) => notes.get(key)?.basename ?? fallback, days, key => notes.get(key)?.path)
    // Books and games: only the days your daily notes link them. A reaction is when you wrote it,
    // often looking back, not a day you read or played; its rating is shown beside a linked one.
    const withReacted = (spent: DaysSpent[], reacted: ReactionEvent[]) => spent.map(d => {
      const rating = reacted.find(r => r.path === d.path)?.rating
      return { title: d.title, path: d.path, detail: `${d.days} day${d.days === 1 ? '' : 's'}${rating ? ` · ${rating}` : ''}` }
    })
    const books = withReacted(s.bookDays, s.books)
    const games = withReacted(s.gameDays, s.games)
    const readingDays = daysWith(days, period, 'book')
    const playingDays = daysWith(days, period, 'game')
    // A column per kind: its count on top, its lists below it.
    const columns = el.createDiv('pmn-dash-columns')
    const column = () => columns.createDiv('pmn-dash-column')
    const pathOf = (key: string) => notes.get(key)?.path
    const dayName = (day: string) => {
      const [y, mo, d] = day.split('-').map(Number)
      return new Date(y, mo - 1, d).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
    }

    // In this order: Reactions, Movies, TV shows, Books, Games, Songs.
    const worth = this.pmnReviewCandidates()

    const reactionCol = column()
    this.pmnMetric(reactionCol, 'Reactions', String(s.reactions))
    this.pmnListCard(reactionCol, 'Favorites 🩷', s.favourites.map(r => ({ title: r.title, path: r.path })), 'Nothing given 🩷 in a reaction then.')
    this.pmnListCard(reactionCol, 'How it felt', s.feelings.map(([word, n]) => ({ title: word, detail: `×${n}` })), 'No feelings in reactions then.')
    this.pmnFinishedCard(reactionCol)

    const movieCol = column()
    const viewings = s.movies.reduce((n, m) => n + m.times, 0)
    this.pmnMetric(movieCol, 'Movies', String(s.movies.length), viewings > s.movies.length ? `${viewings} viewings` : undefined)
    // Newest first, by the last day each was watched.
    const latest = (days: string[]) => [...days].sort().pop() ?? ''
    const movies = [...s.movies].sort((a, b) => latest(b.days).localeCompare(latest(a.days)))
    this.pmnListCard(movieCol, 'Movies', movies.map(m => ({ title: m.title, path: pathOf(m.key), detail: m.days.map(dayName).join(', ') })), 'No movies then.')
    this.pmnWorthCard(movieCol, [['movie', 'A movie'], ['documentary', 'A documentary']], worth)

    const tvCol = column()
    this.pmnMetric(tvCol, 'TV shows', `${s.episodes} episode${s.episodes === 1 ? '' : 's'}`, `${s.shows.length} show${s.shows.length === 1 ? '' : 's'}`)
    this.pmnListCard(tvCol, 'TV shows', s.shows.map(sh => ({ title: sh.title, path: pathOf(sh.key), detail: `${sh.episodes} episode${sh.episodes === 1 ? '' : 's'}` })), 'No TV then.')
    this.pmnWorthCard(tvCol, [['tv', 'A TV show']], worth)

    const bookCol = column()
    this.pmnMetric(bookCol, 'Books', String(books.length), `${readingDays} day${readingDays === 1 ? '' : 's'} of reading`)
    this.pmnListCard(bookCol, 'Books', books, 'No books in your daily notes or reactions then.')
    this.pmnWorthCard(bookCol, [['book', 'A book']], worth)

    const gameCol = column()
    this.pmnMetric(gameCol, 'Games', String(games.length), `${playingDays} day${playingDays === 1 ? '' : 's'} of playing`)
    this.pmnListCard(gameCol, 'Games', games, 'No games in your daily notes or reactions then.')
    this.pmnWorthCard(gameCol, [['game', 'A game']], worth)

    const songCol = column()
    this.pmnMetric(songCol, 'Songs', `${s.songPlays} play${s.songPlays === 1 ? '' : 's'}`)
    this.pmnListCard(songCol, 'Most played', [
      ...s.topArtists.map(([name, n]) => ({ title: name, detail: `${n} plays` })),
      ...s.topSongs.map(([name, n], i) => ({ title: name, detail: `×${n}`, divider: i === 0 && s.topArtists.length > 0 })),
    ], 'No songs then.')
    this.pmnWorthCard(songCol, [['music', 'A song']], worth)

    // What you came back to, at the bottom of the Reactions column.
    const again = { movie: 'rewatched', show: 'rewatched', book: 'reread', game: 'replayed' }
    const settings = this.pmnPlugin.settings
    const notAgain = new Set(settings.notRewatches)
    this.pmnListCard(reactionCol, 'Back again', s.rewatches.filter(r => !notAgain.has(r.id)).map(r => ({
      title: r.title,
      path: r.path,
      detail: r.why ? `${again[r.kind]} · ${r.why}` : again[r.kind],
      action: {
        text: 'Not a rewatch',
        tip: 'Take it off this list',
        run: () => {
          settings.notRewatches.push(r.id)
          void this.pmnPlugin.saveSettings().then(() => this.pmnRender())
        },
      },
    })), 'Nothing you came back to then.')
  }

  /** What you rated 🩷 or 💣 but never wrote about: no Notes and no reaction with words. */
  private pmnReviewCandidates(): { path: string, title: string, level: number, kind: string }[] {
    const settings = this.pmnPlugin.settings
    const skipped = new Set(settings.reviewSkipped)
    const written = new Set(this.pmnReactions().filter(r => r.text).map(r => r.path))
    const out: { path: string, title: string, level: number, kind: string }[] = []
    const libs = Object.values(settings.libraries).map(lib => ({ folder: `${lib.folder.replace(/\/+$/, '')}/`, target: lib.target }))
    for (const note of noteEntries(this.app, settings)) {
      if ((note.level !== 5 && note.level !== 1) || skipped.has(note.path) || written.has(note.path)) continue
      const file = this.app.vault.getAbstractFileByPath(note.path)
      const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {}
      const notesValue: unknown = fm.Notes ?? fm.notes
      if (typeof notesValue === 'string' ? notesValue.trim() : Array.isArray(notesValue) && notesValue.length) continue
      out.push({ path: note.path, title: note.title, level: note.level, kind: libs.find(l => note.path.startsWith(l.folder))?.target ?? note.group })
    }
    // A different order each time the dashboard opens, the same while it's open.
    const order = (path: string) => [...`${path}${this.pmnSeed}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7)
    return out.sort((a, b) => order(a.path) - order(b.path))
  }

  private readonly pmnSeed = Math.random()

  /** What you finished lately (movies, and shows once every episode is watched), each to react to. */
  private pmnFinishedCard(parent: HTMLElement): void {
    const finished = parent.createDiv('pmn-card')
    finished.createDiv({ cls: 'pmn-card-title', text: 'Just finished' })
    if (!this.pmnFinished) finished.createEl('p', { cls: 'pmn-dash-empty', text: 'Looking in Plex…' })
    else if (!this.pmnFinished.length) finished.createEl('p', { cls: 'pmn-dash-empty', text: 'Nothing waiting: you\'ve reacted to everything you finished lately.' })
    for (const item of this.pmnFinished ?? []) {
      const row = finished.createDiv('pmn-rec-row')
      const text = row.createDiv('pmn-rec-text')
      this.pmnLink(text, item.title, item.path)
      text.createDiv({ cls: 'pmn-rec-why', text: `${item.kind === 'show' ? 'TV show, all watched' : 'Movie'} · ${new Date(item.viewedAt * 1000).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}` })
      row.createDiv('pmn-rec-buttons').createEl('button', { text: 'How was it?' }).addEventListener('click', () => {
        void this.pmnPlugin.reactToFinished(item).then(answer => {
          if (answer !== 'later') this.pmnFinished = (this.pmnFinished ?? []).filter(f => f !== item)
          this.pmnRender()
        })
      })
    }
  }

  /**
   * "Worth a few words" for some kinds of media (under their count in Insights): one thing of each
   * you rated 🩷 or 💣 but haven't written about. Nothing shown when there's none.
   */
  private pmnWorthCard(parent: HTMLElement, kinds: [string, string][], candidates: { path: string, title: string, level: number, kind: string }[]): void {
    const found = kinds.map(([kind, label]) => ({ kind, label, list: candidates.filter(c => c.kind === kind) })).filter(k => k.list.length)
    if (!found.length) return
    const card = parent.createDiv('pmn-card')
    card.createDiv({ cls: 'pmn-card-title', text: 'Worth a few words' })
    for (const { kind, label, list } of found) this.pmnReviewCard(card, found.length > 1 ? label : '', kind, list)
  }

  /** One thing you rated 🩷 or 💣 but haven't written about, of one kind. */
  private pmnReviewCard(parent: HTMLElement, label: string, kind: string, candidates: { path: string, title: string, level: number }[]): void {
    const card = parent.createDiv('pmn-review-kind')
    if (label) card.createDiv({ cls: 'pmn-review-kind-label', text: label })
    const pick = candidates[(this.pmnReviewAt.get(kind) ?? 0) % candidates.length]
    const text = card.createDiv('pmn-review')
    this.pmnLink(text.createDiv('pmn-review-title'), pick.title, pick.path)
    const file = this.app.vault.getAbstractFileByPath(pick.path)
    const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {}
    text.createDiv({ cls: 'pmn-rec-why', text: `You rated it ${pick.level === 5 ? '🩷' : '💣'} and haven't written about it yet.${candidates.length > 1 ? ` ${candidates.length - 1} more like it.` : ''}` })
    const why: unknown = fm[this.pmnPlugin.settings.whyProperty || 'Why']
    if (typeof why === 'string' && why.trim()) text.createDiv({ cls: 'pmn-review-wanted', text: `You wanted it because: ${why.trim()}` })
    const buttons = card.createDiv('pmn-rec-buttons pmn-review-buttons')
    buttons.createEl('button', { text: 'Write about it' }).addEventListener('click', () => {
      if (!(file instanceof TFile)) return
      void this.pmnPlugin.reactTo(file, moment.unix(Math.floor(Date.now() / 1000)).format('YYYY-MM-DD')).then(() => this.pmnRender())
    })
    if (candidates.length > 1) {
      buttons.createEl('button', { text: 'Next', attr: { 'aria-label': 'Another one' } }).addEventListener('click', () => {
        this.pmnReviewAt.set(kind, (this.pmnReviewAt.get(kind) ?? 0) + 1)
        this.pmnRender()
      })
    }
    buttons.createEl('button', { cls: 'pmn-rec-no', text: 'Ignore', attr: { 'aria-label': 'Don\'t show this one again' } }).addEventListener('click', () => {
      this.pmnPlugin.settings.reviewSkipped.push(pick.path)
      void this.pmnPlugin.saveSettings().then(() => this.pmnRender())
    })
  }

  /** Habits: this week next to last week, and where things stand. Numbers only. */
  private pmnHabits(el: HTMLElement): void {
    this.pmnHeader(el, 'Habits', 'This week so far, next to last week. Just the numbers.')
    if (this.pmnHistoryState) el.createDiv({ cls: 'pmn-dash-note', text: this.pmnHistoryState })
    const { thisWeek, lastWeek } = weeks(new Date())
    const events = this.pmnHistory?.events ?? []
    const lengths = this.pmnLengths ?? new Map<string, number>()
    const now = weekNumbers(events, thisWeek, lengths)
    const before = weekNumbers(events, lastWeek, lengths)
    const metrics = el.createDiv('pmn-dash-metrics')
    this.pmnMetric(metrics, 'Movies and TV', `${now.hours} h`, this.pmnLengths ? compared(now.hours, before.hours, ' h') : 'Working out the hours…')
    this.pmnMetric(metrics, 'Movies', String(now.movies), compared(now.movies, before.movies))
    this.pmnMetric(metrics, 'Episodes', String(now.episodes), compared(now.episodes, before.episodes))
    this.pmnMetric(metrics, 'Songs played', String(now.songs), compared(now.songs, before.songs))
    // Books and games, from the days your daily notes link them.
    const days = this.pmnDays()
    for (const [group, label] of [['book', 'Days reading'], ['game', 'Days playing']] as const) {
      const a = daysWith(days, thisWeek, group)
      const b = daysWith(days, lastWeek, group)
      this.pmnMetric(metrics, label, String(a), compared(a, b))
    }

    // Where things stand, from your notes' statuses.
    const counts = new Map<string, { all: number, month: number }>()
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    for (const lib of Object.values(this.pmnPlugin.settings.libraries)) {
      if (lib.target === 'skip') continue
      const props = lib.properties.filter(m => m.source === 'status' && m.name.trim()).map(m => m.name.trim())
      if (!props.length) continue
      const folder = `${lib.folder.replace(/\/+$/, '')}/`
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(folder)) continue
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
        for (const name of props) {
          const value: unknown = fm[name]
          if (typeof value !== 'string' || !value.trim()) continue
          const c = counts.get(value.trim().toLowerCase()) ?? { all: 0, month: 0 }
          c.all++
          if (file.stat.mtime >= monthStart) c.month++
          counts.set(value.trim().toLowerCase(), c)
        }
      }
    }
    const grid = el.createDiv('pmn-dash-grid')
    this.pmnListCard(grid, 'Where things stand', [...counts].sort((a, b) => b[1].all - a[1].all).map(([status, c]) => ({
      title: status,
      detail: `${c.all}${c.month ? ` (${c.month} with notes changed this month)` : ''}`,
    })), 'No statuses in your notes yet.')
  }

  private async pmnNotInterested(entry: { id: string, title: string }): Promise<void> {
    const settings = this.pmnPlugin.settings
    if (!settings.notInterested.includes(entry.id)) settings.notInterested.push(entry.id)
    await this.pmnPlugin.saveSettings()
    new Notice(`${entry.title} won't be suggested again (undo in Settings → Remembered choices)`)
    this.pmnRender()
  }
}
