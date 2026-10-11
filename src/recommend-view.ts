import { ItemView, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import { artistsOf, type PlexItem } from './notes'
import { similarArtists, similarTracks } from './lastfm'
import { artistKey, lastfmSuggestions, pickSeeds, songKey, type LastfmSuggestion, type LastfmSuggestions, type Seed, type SimilarArtist, type SimilarTrack } from './lastfm-data'
import { isLoved, isOpen, recommend, type RecEntry, type RecGroup, type Recommendation } from './recommend'
import { itemEntry, noteEntries, withItem } from './recommend-data'
import { errorMessage } from './settings'
import { PlexSync } from './sync'

export const RECOMMEND_VIEW = 'pmn-recommendations'

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
  /** The Plex track behind each music entry (`note:<path>` or `item:<key>`), for asking Last.fm. */
  private pmnTracks = new Map<string, PlexItem>()
  /** Last.fm's suggestions, once asked (null: not yet). */
  private pmnLastfm: LastfmSuggestions | null = null
  /** How asking Last.fm is going, or why it failed (null: done, or not asked). */
  private pmnLastfmState: string | null = null
  private pmnLastfmError = false

  constructor(leaf: WorkspaceLeaf, private readonly pmnPlugin: PlexMediaNotesPlugin) {
    super(leaf)
  }

  getViewType(): string { return RECOMMEND_VIEW }
  getDisplayText(): string { return 'Recommendations' }
  getIcon(): string { return 'sparkles' }

  async onOpen(): Promise<void> {
    this.pmnRender()
    await this.pmnLookUp()
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
   * Asks Last.fm what's like your loved songs (up to 30, 🩷 first) and their artists (up to 15),
   * then redraws with what it found.
   */
  private async pmnAskLastfm(): Promise<void> {
    const key = this.pmnPlugin.settings.lastfmKey?.trim()
    if (!key || this.pmnLastfmState) return
    const music = this.pmnEntries().filter(e => e.group === 'music')
    const seeds: (Seed & { id: string })[] = []
    for (const entry of music.filter(isLoved)) {
      const item = this.pmnTracks.get(entry.id)
      const artist = item?.originalTitle || item?.grandparentTitle
      if (!item || !artist) continue
      seeds.push({ id: entry.id, title: entry.title, artist, track: item.title, weight: entry.level === 5 ? 2 : 1 })
    }
    if (!seeds.length) return
    const songSeeds = pickSeeds(seeds, 30)
    const artistSeeds = [...new Map(songSeeds.map(seed => [artistKey(seed.artist), seed])).values()].slice(0, 15)
    const total = songSeeds.length + artistSeeds.length
    let done = 0
    this.pmnLastfmError = false
    const step = () => {
      this.pmnLastfmState = `Asking Last.fm: ${done} of ${total}…`
      this.pmnRender()
    }
    step()
    try {
      const tracks: { seed: Seed, similar: SimilarTrack[] }[] = []
      for (const seed of songSeeds) {
        tracks.push({ seed, similar: await similarTracks(key, seed.artist, seed.track) })
        done++
        step()
      }
      const artists: { seed: Seed, similar: SimilarArtist[] }[] = []
      for (const seed of artistSeeds) {
        artists.push({ seed, similar: await similarArtists(key, seed.artist) })
        done++
        step()
      }
      // What you have: every song (under each of its artists) and every artist.
      const owned = new Map<string, { id: string, title: string }>()
      const ownedArtists = new Set<string>()
      for (const entry of music) {
        entry.people.forEach(person => ownedArtists.add(artistKey(person)))
        const item = this.pmnTracks.get(entry.id)
        if (!item) continue
        const names = [item.originalTitle, item.grandparentTitle].filter((a): a is string => Boolean(a))
        for (const name of new Set(names.flatMap(n => artistsOf(n, item.title)))) {
          owned.set(songKey(name, item.title), { id: entry.id, title: entry.title })
          ownedArtists.add(artistKey(name))
        }
      }
      const open = new Set(music.filter(isOpen).map(e => e.id))
      this.pmnLastfm = lastfmSuggestions(tracks, artists, owned, ownedArtists, open, new Set(this.pmnPlugin.settings.notInterested))
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
    if (groups.includes('music')) this.pmnLastfmCard(contentEl, entries, items)
  }

  /** Music from Last.fm: songs you have but haven't rated, and songs and artists you don't have. */
  private pmnLastfmCard(parent: HTMLElement, entries: RecEntry[], items: { entry: RecEntry, item: PlexItem, libraryKey: string }[]): void {
    const card = parent.createDiv('pmn-card pmn-lastfm')
    card.createDiv({ cls: 'pmn-card-title', text: 'Music from Last.fm' })
    if (!this.pmnPlugin.settings.lastfmKey?.trim()) {
      card.createEl('p', { cls: 'pmn-dash-empty', text: 'Add a Last.fm API key in this plugin\'s settings, under other sources, to get songs and artists like your ⭐⭐⭐⭐ and 🩷 songs, from outside your library too.' })
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
    const sections: [string, string, LastfmSuggestion[]][] = [
      ['Songs you have, not rated yet', 'Nothing you have and haven\'t rated is like your loved songs, as far as Last.fm knows.', found.owned],
      ['Songs you don\'t have', 'No new songs found.', found.songs],
      ['Artists you don\'t have', 'No new artists found.', found.artists],
    ]
    const grid = card.createDiv('pmn-lastfm-grid')
    for (const [title, empty, list] of sections) {
      const column = grid.createDiv('pmn-lastfm-column')
      column.createDiv({ cls: 'pmn-lastfm-heading', text: title })
      const shown = list.filter(s => !notInterested.has(s.id))
      if (!shown.length) column.createEl('p', { cls: 'pmn-dash-empty', text: empty })
      for (const suggestion of shown) {
        if (suggestion.id.startsWith('lastfm:')) this.pmnLastfmRow(column, suggestion)
        else {
          const entry = entries.find(e => e.id === suggestion.id)
          if (entry) this.pmnRow(column, { entry, score: suggestion.score, because: suggestion.because, shared: [] }, items)
        }
      }
    }
  }

  /** A song or artist you don't have, linked to its Last.fm page. */
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

  private async pmnNotInterested(entry: { id: string, title: string }): Promise<void> {
    const settings = this.pmnPlugin.settings
    if (!settings.notInterested.includes(entry.id)) settings.notInterested.push(entry.id)
    await this.pmnPlugin.saveSettings()
    new Notice(`${entry.title} won't be suggested again (undo in Settings → Remembered choices)`)
    this.pmnRender()
  }
}
