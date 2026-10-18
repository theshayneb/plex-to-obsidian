// The media dashboard's cards in any note: a `media-manager` code block such as
//
//   ```media-manager
//   card: randomizer
//   kind: book
//   ```
//
// (copied with the </> button on a card in the dashboard). The cards are drawn by dashboard-cards.ts.
import { MarkdownRenderChild, TFile } from 'obsidian'
import { DashCards, HABIT_KINDS, type InsightsKind } from './dashboard-cards'
import { monthPeriod, summarize, weeks, type WatchEvent } from './insights-data'
import type PlexMediaNotesPlugin from './main'
import { PICK_KINDS } from './randomizer'
import { PlexSync } from './sync'
import { CARDS, readKind, readSpec, type CardName } from './embed-spec'

/** Plex's history, read once for every embedded card that needs it (kept ten minutes). */
let shared: { since: number, at: number, read: Promise<{ events: WatchEvent[], notes: Map<string, TFile> }> } | null = null

function history(plugin: PlexMediaNotesPlugin, since: number): Promise<{ events: WatchEvent[], notes: Map<string, TFile> }> {
  if (shared && shared.since <= since && Date.now() - shared.at < 10 * 60 * 1000) return shared.read
  const read = new PlexSync(plugin.app, plugin.settings, () => plugin.saveSettings()).watchHistory(since)
  shared = { since, at: Date.now(), read }
  read.catch(() => { if (shared?.read === read) shared = null })
  return read
}

/** One embedded card, redrawn when it changes (a pick, an answer) or a media note does. */
export class EmbeddedCard extends MarkdownRenderChild {
  private readonly cards: DashCards
  private readonly spec: { card: string, kind: string }
  private timer: number | null = null

  constructor(containerEl: HTMLElement, private readonly plugin: PlexMediaNotesPlugin, source: string) {
    super(containerEl)
    this.spec = readSpec(source)
    this.cards = new DashCards(plugin.app, plugin, () => void this.draw(), true)
  }

  onload(): void {
    this.containerEl.addClass('pmn-embed')
    void this.draw()
    // A note in a library folder changing (a reaction written, a status changed) may change the card.
    this.registerEvent(this.plugin.app.metadataCache.on('changed', file => {
      const inLibrary = Object.values(this.plugin.settings.libraries).some(lib => lib.target !== 'skip' && file.path.startsWith(`${lib.folder.replace(/\/+$/, '')}/`))
      if (!inLibrary || this.spec.card === 'this-month' || this.spec.card === 'habits') return
      if (this.timer !== null) window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = null
        void this.draw()
      }, 500)
    }))
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
  }

  private problem(text: string): void {
    const el = this.containerEl
    el.empty()
    el.createDiv({ cls: 'pmn-dash-note', text })
  }

  private async draw(): Promise<void> {
    const el = this.containerEl
    const card = this.spec.card as CardName
    const kind = readKind(this.spec.kind)
    if (!CARDS.includes(card)) {
      this.problem(`Media Manager: "card:" should be one of ${CARDS.join(', ')}.`)
      return
    }
    if (!kind) {
      this.problem('Media Manager: "kind:" should be movie, tv, documentary, book, game or song.')
      return
    }
    if (card === 'randomizer') {
      if (kind === 'song' || !PICK_KINDS.some(([k]) => k === kind)) {
        this.problem('Media Manager: the randomizer is for movies, TV shows, documentaries, books and games.')
        return
      }
      el.empty()
      this.cards.randomizer(el, kind)
      return
    }
    if (card === 'worth-a-few-words') {
      // As on the dashboard: movies with documentaries; a song is a "music" note.
      const kinds: [string, string][] = kind === 'movie' ? [['movie', 'A movie'], ['documentary', 'A documentary']]
        : [[kind === 'song' ? 'music' : kind, '']]
      el.empty()
      this.cards.worthCard(el, kinds, this.cards.reviewCandidates(), undefined, true)
      return
    }
    if (kind === 'documentary' || !(kind in HABIT_KINDS)) {
      this.problem('Media Manager: this card is for movies, TV shows, books, games and songs (documentaries count with movies).')
      return
    }
    const now = new Date()
    const period = monthPeriod(now.getFullYear(), now.getMonth())
    const since = card === 'habits' ? weeks(now).weekBefore.from : period.from - 86400
    if (!el.hasChildNodes()) el.createDiv({ cls: 'pmn-dash-note', text: 'Reading your Plex history…' })
    let read: { events: WatchEvent[], notes: Map<string, TFile> }
    try {
      read = await history(this.plugin, since)
    } catch (err) {
      this.problem(`Plex's history couldn't be read: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    el.empty()
    const days = this.cards.days()
    if (card === 'habits') {
      this.cards.habitsCard(el, kind as InsightsKind, read.events, days, now)
      return
    }
    const s = summarize(read.events, this.cards.reactions(), period, (_k, key, fallback) => read.notes.get(key)?.basename ?? fallback, days, key => read.notes.get(key)?.path)
    this.cards.monthCard(el, kind as InsightsKind, s, period, days, key => read.notes.get(key)?.path)
  }
}
