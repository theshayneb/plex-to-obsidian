import { ItemView, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import { compared, habitCounts, monthPeriod, monthsSoFar, summarize, weekNumbers, weeks, yearPeriod, type Period, type PeriodSummary, type WatchEvent } from './insights-data'
import type { Finished } from './reactions'
import type PlexMediaNotesPlugin from './main'
import { artistsOf, type PlexItem } from './notes'
import { similarTracks } from './lastfm'
import { lastfmSuggestions, pickSeeds, seedWeight, songKey, type LastfmSuggestion, type Seed, type SimilarTrack } from './lastfm-data'
import { recommendedSongs } from './listenbrainz'
import { listenbrainzSuggestions, spotifySearch, type ListenBrainzSuggestion } from './listenbrainz-data'

/** A song to try, from Last.fm or ListenBrainz. */
type SongSuggestion = Pick<LastfmSuggestion, 'id' | 'title' | 'artist' | 'track'>
import { isLoved, isOpen, recommend, type RecEntry, type RecGroup, type Recommendation } from './recommend'
import { itemEntry, noteEntries, withItem } from './recommend-data'
import { errorMessage } from './settings'
import { planRevisit } from './playlist'
import { PlexSync } from './sync'
import { DashCards, HABIT_KINDS, type InsightsKind } from './dashboard-cards'

export const RECOMMEND_VIEW = 'pmn-recommendations'

type Tab = 'insights' | 'recommendations' | 'randomizer' | 'habits'
const TABS: [Tab, string][] = [['insights', 'Insights'], ['habits', 'Habits'], ['recommendations', 'Recommendations'], ['randomizer', 'Randomizers']]

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
  /** ListenBrainz's suggestions, once asked (null: not yet), and how asking is going or why it failed. */
  private pmnListenbrainz: ListenBrainzSuggestion[] | null = null
  private pmnListenbrainzState: string | null = null
  private pmnListenbrainzError = false
  /** Making the Revisit playlist: how it's going, or how it ended. */
  private pmnRevisitState: string | null = null
  private pmnRevisitBusy = false
  /** The songs the Revisit playlist would hold, once shown (null: not yet). */
  private pmnRevisitPicks: PlexItem[] | null = null
  private pmnTab: Tab = 'insights'
  /** Plex's watch history from `since` on, once read, with each movie's and show's note. */
  private pmnHistory: { since: number, events: WatchEvent[], notes: Map<string, TFile> } | null = null
  private pmnHistoryState: string | null = null
  private pmnSpan: 'month' | 'year' = 'month'
  private pmnWhen = new Date()
  /** Movies' and episodes' lengths, for the Habits tab's hours (null: not looked up yet). */
  private pmnLengths: Map<string, number> | null = null
  private pmnFinished: Finished[] | null = null

  /** The cards, shared with the ones embedded in notes. */
  private readonly cards: DashCards

  constructor(leaf: WorkspaceLeaf, private readonly pmnPlugin: PlexMediaNotesPlugin) {
    super(leaf)
    this.cards = new DashCards(this.app, pmnPlugin, () => this.pmnRender())
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
      // The year so far, and the two weeks before this one (which can reach back into last year).
      await this.pmnReadHistory(Math.min(monthsSoFar(new Date())[0].from, weeks(new Date()).weekBefore.from))
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
    if (!this.pmnLookupError) await Promise.all([this.pmnAskLastfm(), this.pmnAskListenbrainz()])
  }

  /** Every song you have (a song key under each of its artists), so suggestions leave them out. */
  private pmnOwned(): Set<string> {
    const owned = new Set<string>()
    for (const item of this.pmnTracks.values()) {
      const names = [item.originalTitle, item.grandparentTitle].filter((a): a is string => Boolean(a))
      for (const name of new Set(names.flatMap(n => artistsOf(n, item.title)))) owned.add(songKey(name, item.title))
    }
    return owned
  }

  /** Asks ListenBrainz for the songs it recommends for you (from listeners like you), then redraws with those you don't have. */
  private async pmnAskListenbrainz(): Promise<void> {
    const user = this.pmnPlugin.settings.listenbrainzUser?.trim()
    if (!user) return
    this.pmnListenbrainz = null
    this.pmnListenbrainzError = false
    this.pmnListenbrainzState = 'Asking ListenBrainz…'
    this.pmnRender()
    try {
      const { recommended, recordings } = await recommendedSongs(user)
      this.pmnListenbrainz = listenbrainzSuggestions(recommended, recordings, this.pmnOwned(), new Set(this.pmnPlugin.settings.notInterested), 40)
      this.pmnListenbrainzState = recommended.length ? null : 'ListenBrainz hasn\'t made recommendations for you yet (it makes them from your recent listens, about once a week).'
    } catch (err) {
      this.pmnListenbrainzError = true
      this.pmnListenbrainzState = errorMessage(err)
    }
    this.pmnRender()
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
   * Asks Last.fm for songs like 50 of yours, drawn from your whole library (loved and much-played
   * ones more often, `seedWeight`), then redraws with those you don't have.
   */
  private async pmnAskLastfm(): Promise<void> {
    const key = this.pmnPlugin.settings.lastfmKey?.trim()
    if (!key || this.pmnLastfmState) return
    const music = this.pmnEntries().filter(e => e.group === 'music')
    const seeds: Seed[] = []
    for (const entry of music) {
      const item = this.pmnTracks.get(entry.id)
      const artist = item?.originalTitle || item?.grandparentTitle
      if (!item || !artist) continue
      seeds.push({ title: entry.title, artist, track: item.title, weight: seedWeight(entry.level ?? 0, item.viewCount ?? 0) })
    }
    if (!seeds.length) return
    const chosen = pickSeeds(seeds, 50)
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
      this.pmnLastfm = lastfmSuggestions(tracks, this.pmnOwned(), new Set(this.pmnPlugin.settings.notInterested), 40)
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
    else if (this.pmnTab === 'randomizer') this.cards.randomizer(body)
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
        // One place in the grid: songs to try, and the Revisit playlist under them.
        const column = grid.createDiv('pmn-dash-stack')
        this.pmnSongsCard(column)
        this.pmnRevisitCard(column)
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

  /**
   * Songs to try: Last.fm's and ListenBrainz's suggestions together, taking turns, each song once,
   * ten at a time; one you listen to or turn down makes way for the next.
   */
  private pmnSongsCard(parent: HTMLElement): void {
    const settings = this.pmnPlugin.settings
    const card = parent.createDiv('pmn-card pmn-lastfm')
    card.createDiv({ cls: 'pmn-card-title', text: 'Songs' })
    const lastfm = Boolean(settings.lastfmKey?.trim())
    const listenbrainz = Boolean(settings.listenbrainzUser?.trim())
    if (!lastfm && !listenbrainz) {
      card.createEl('p', { cls: 'pmn-dash-empty', text: 'Add a Last.fm API key or your ListenBrainz username in this plugin\'s settings, under other sources, to get songs you don\'t have yet.' })
      return
    }
    const done = new Set([...settings.notInterested, ...settings.listenedTo])
    const lists = [this.pmnLastfm ?? [], this.pmnListenbrainz ?? []].map(list => list.filter(s => !done.has(s.id)))
    const seen = new Set<string>()
    const songs: SongSuggestion[] = []
    for (let i = 0; songs.length < 10 && i < Math.max(...lists.map(l => l.length)); i++) {
      for (const list of lists) {
        const song = list[i]
        if (!song || songs.length >= 10) continue
        const key = songKey(song.artist, song.track)
        if (seen.has(key)) continue
        seen.add(key)
        songs.push(song)
      }
    }
    for (const song of songs) this.pmnSongRow(card, song)
    // What's still being asked, or couldn't be.
    const states: string[] = []
    if (lastfm && this.pmnLastfmState) states.push(this.pmnLastfmError ? `Last.fm couldn't be asked: ${this.pmnLastfmState}` : this.pmnLastfmState)
    if (listenbrainz && this.pmnListenbrainzState) states.push(this.pmnListenbrainzError ? `ListenBrainz couldn't be asked: ${this.pmnListenbrainzState}` : this.pmnListenbrainzState)
    for (const state of states) card.createEl('p', { cls: 'pmn-dash-empty', text: state })
    if (!songs.length && !states.length) {
      card.createEl('p', {
        cls: 'pmn-dash-empty',
        text: this.pmnLooking ? 'Waiting for Plex…' : this.pmnLastfm || this.pmnListenbrainz ? 'No new songs right now. Refresh for others.' : 'Press Refresh to look for songs.',
      })
    }
  }

  /** A song you don't have: listen to it on Spotify (and it's not suggested again), or turn it down. */
  private pmnSongRow(parent: HTMLElement, song: SongSuggestion): void {
    const row = parent.createDiv('pmn-rec-row')
    const text = row.createDiv('pmn-rec-text')
    text.createSpan({ cls: ['pmn-rec-title', 'pmn-rec-song'], text: song.title })
    const buttons = row.createDiv('pmn-rec-buttons')
    // Listening to it (or keeping it in a Spotify playlist to decide later) takes it off the list.
    const listen = buttons.createEl('a', { cls: 'pmn-rec-listen', text: 'Listen on Spotify', href: spotifySearch(song.artist, song.track), attr: { target: '_blank', rel: 'noopener' } })
    listen.addEventListener('click', () => {
      const settings = this.pmnPlugin.settings
      if (!settings.listenedTo.includes(song.id)) settings.listenedTo.push(song.id)
      void this.pmnPlugin.saveSettings()
      // After the link has opened.
      window.setTimeout(() => this.pmnRender(), 300)
    })
    const no = buttons.createEl('button', { cls: 'pmn-rec-no', text: 'Not interested' })
    no.addEventListener('click', () => void this.pmnNotInterested({ id: song.id, title: song.title }))
  }

  /**
   * "Revisit": a Plex playlist of songs you have but haven't played in a while, that sound like
   * your favorites. Shown first; only sent to Plex when you say so.
   */
  private pmnRevisitCard(parent: HTMLElement): void {
    const card = parent.createDiv('pmn-card')
    card.createDiv({ cls: 'pmn-card-title', text: 'Revisit' })
    card.createEl('p', { cls: 'pmn-dash-empty', text: 'A playlist in Plex of songs you haven\'t played in six months that sound like your ⭐⭐⭐⭐ and 🩷 ones. It\'s made again every week on its own (switch that off in the settings); see a mix here first and make it now if you like it.' })
    const picks = this.pmnRevisitPicks
    if (picks?.length) {
      const list = card.createEl('ol', { cls: 'pmn-revisit-list' })
      for (const track of picks) {
        const item = list.createEl('li')
        item.createSpan({ text: track.title })
        const artist = track.originalTitle || track.grandparentTitle
        if (artist) item.createSpan({ cls: 'pmn-rec-why', text: ` · ${artist}` })
      }
    }
    if (this.pmnRevisitState) card.createEl('p', { cls: 'pmn-dash-note', text: this.pmnRevisitState })
    const buttons = card.createDiv('pmn-rec-buttons')
    const show = buttons.createEl('button', { text: picks ? 'Mix again' : 'Show what it would hold' })
    show.disabled = this.pmnRevisitBusy
    show.addEventListener('click', () => {
      this.pmnRevisitBusy = true
      this.pmnRevisitState = null
      this.pmnRender()
      void planRevisit(this.pmnPlugin.settings, message => {
        this.pmnRevisitState = message
        this.pmnRender()
      }).then(found => {
        this.pmnRevisitPicks = found
        this.pmnRevisitState = null
      }, (err: unknown) => {
        this.pmnRevisitState = errorMessage(err)
      }).then(() => {
        this.pmnRevisitBusy = false
        this.pmnRender()
      })
    })
    if (!picks?.length) return
    const make = buttons.createEl('button', { cls: 'mod-cta', text: `Make it in Plex (${picks.length} songs)` })
    make.disabled = this.pmnRevisitBusy
    make.addEventListener('click', () => {
      this.pmnRevisitBusy = true
      this.pmnRender()
      void this.pmnPlugin.makeRevisit(message => {
        this.pmnRevisitState = message
        this.pmnRender()
      }, picks).then(result => {
        this.pmnRevisitBusy = false
        this.pmnRevisitState = result
        this.pmnRender()
      })
    })
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

  /** Insights: a month or a year of watching, listening, reading and playing. */
  private pmnInsights(el: HTMLElement): void {
    const period = this.pmnPeriod()
    const year = this.pmnWhen.getFullYear()
    const label = this.pmnSpan === 'year' ? String(year) : `${this.pmnWhen.toLocaleString('en', { month: 'long' })} ${year}`
    const controls = this.cards.header(el, `Insights: ${label}`, 'What you watched, listened to, read and played, from Plex\'s history and your reactions.')
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
    const days = this.cards.days()
    const s = summarize(this.pmnHistory?.events ?? [], this.cards.reactions(), period, (_kind, key, fallback) => notes.get(key)?.basename ?? fallback, days, key => notes.get(key)?.path)
    // A column per kind: its count on top, its lists below it.
    const columns = el.createDiv('pmn-dash-columns')
    const column = () => columns.createDiv('pmn-dash-column')
    const pathOf = (key: string) => notes.get(key)?.path

    // In this order: Reactions, Movies, TV shows, Books, Games, Songs.
    const worth = this.cards.reviewCandidates()

    const reactionCol = column()
    this.cards.metric(reactionCol, 'Reactions', String(s.reactions))
    this.cards.listCard(reactionCol, 'Favorites 🩷', s.favourites.map(r => ({ title: r.title, path: r.path })), 'Nothing given 🩷 in a reaction then.')
    this.cards.listCard(reactionCol, 'How it felt', s.feelings.map(([word, n]) => ({ title: word, detail: `×${n}` })), 'No feelings in reactions then.')
    this.pmnFinishedCard(reactionCol)

    // Each kind's count and list, as the cards you can embed in a note ("This month").
    const kindColumn = (kind: InsightsKind, worthKinds: [string, string][]) => {
      const col = column()
      this.cards.monthCard(col, kind, s, period, days, pathOf)
      this.cards.worthCard(col, worthKinds, worth, { card: 'worth-a-few-words', kind })
      return col
    }
    const movieCol = kindColumn('movie', [['movie', 'A movie'], ['documentary', 'A documentary']])
    const tvCol = kindColumn('tv', [['tv', 'A TV show']])
    const bookCol = kindColumn('book', [['book', 'A book']])
    const gameCol = kindColumn('game', [['game', 'A game']])
    kindColumn('song', [['music', 'A song']])

    // What you came back to: a card of its own at the bottom of each kind's column.
    const settings = this.pmnPlugin.settings
    const notAgain = new Set(settings.notRewatches)
    // Empty, a card shows just its title.
    const backAgain = (parent: HTMLElement, kind: PeriodSummary['rewatches'][number]['kind'], button: string) => {
      this.cards.listCard(parent, 'Back again', s.rewatches.filter(r => r.kind === kind && !notAgain.has(r.id)).map(r => ({
        title: r.title,
        path: r.path,
        action: {
          text: button,
          tip: 'Take it off this list',
          run: () => {
            settings.notRewatches.push(r.id)
            void this.pmnPlugin.saveSettings().then(() => this.pmnRender())
          },
        },
      })), '')
    }
    backAgain(movieCol, 'movie', 'Not a rewatch')
    backAgain(tvCol, 'show', 'Not a rewatch')
    backAgain(bookCol, 'book', 'Not a reread')
    backAgain(gameCol, 'game', 'Not a replay')
  }

  /** What you finished lately (movies, and shows once every episode is watched), each to react to. */
  private pmnFinishedCard(parent: HTMLElement): void {
    const finished = parent.createDiv('pmn-card')
    finished.createDiv({ cls: 'pmn-card-title', text: 'Just finished' })
    if (!this.pmnFinished) finished.createEl('p', { cls: 'pmn-dash-empty', text: 'Looking in Plex…' })
    else if (!this.pmnFinished.length) finished.createEl('p', { cls: 'pmn-dash-empty', text: 'Nothing waiting: you\'ve reacted to everything you finished lately.' })
    for (const item of this.pmnFinished ?? []) {
      const row = finished.createDiv('pmn-rec-row')
      const text = row.createDiv('pmn-rec-text')
      this.cards.link(text, item.title, item.path)
      text.createDiv({ cls: 'pmn-rec-why', text: `${item.kind === 'show' ? 'TV show, all watched' : 'Movie'} · ${new Date(item.viewedAt * 1000).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}` })
      row.createDiv('pmn-rec-buttons').createEl('button', { text: 'How was it?' }).addEventListener('click', () => {
        void this.pmnPlugin.reactToFinished(item).then(answer => {
          if (answer !== 'later') this.pmnFinished = (this.pmnFinished ?? []).filter(f => f !== item)
          this.pmnRender()
        })
      })
    }
  }

  /** Habits: this week next to the weeks before, the year by month, and where things stand. Numbers only. */
  private pmnHabits(el: HTMLElement): void {
    this.cards.header(el, 'Habits', 'This week next to the two before it, and this year month by month. Just the numbers.')
    if (this.pmnHistoryState) el.createDiv({ cls: 'pmn-dash-note', text: this.pmnHistoryState })
    const now = new Date()
    const { thisWeek, lastWeek, weekBefore } = weeks(now)
    const events = this.pmnHistory?.events ?? []
    const days = this.cards.days()
    const lengths = this.pmnLengths ?? new Map<string, number>()
    const weekPeriods = [weekBefore, lastWeek, thisWeek]
    const months = monthsSoFar(now)
    const monthLabels = months.map(p => new Date(p.from * 1000).toLocaleDateString('en', { month: 'short' }))
    const byMonth = months.map(p => habitCounts(events, days, p))

    // A column per kind, in the Insights order: this week's number, then the weeks, then the months.
    const columns = el.createDiv('pmn-dash-columns')
    for (const kind of ['movie', 'tv', 'book', 'game', 'song'] as InsightsKind[]) {
      const col = columns.createDiv('pmn-dash-column')
      this.cards.habitsCard(col, kind, events, days, now)
      const [key, , unit] = HABIT_KINDS[kind]
      const monthsCard = col.createDiv('pmn-card')
      monthsCard.createDiv({ cls: 'pmn-card-title', text: `${now.getFullYear()} by month` })
      this.cards.bars(monthsCard, byMonth.map((c, i) => ({ label: monthLabels[i], value: c[key] })), unit)
    }

    // Hours of movies and TV, where Plex knows how long they are.
    const hours = weekPeriods.map(p => weekNumbers(events, p, lengths).hours)
    const metrics = el.createDiv('pmn-dash-metrics')
    this.cards.metric(metrics, 'Hours of movies and TV this week', `${hours[2]} h`, this.pmnLengths ? compared(hours[2], hours[1], ' h') : 'Working out the hours…')

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
    this.cards.listCard(grid, 'Where things stand', [...counts].sort((a, b) => b[1].all - a[1].all).map(([status, c]) => ({
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
