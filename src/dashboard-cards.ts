// The media dashboard's cards, shared by the dashboard (recommend-view.ts) and by cards embedded in
// notes (the `media-manager` code block, embed-cards.ts): each draws into an element and calls
// `redraw` when something it shows changes.
import { Notice, setIcon, TFile, type App } from 'obsidian'
import { compared, daysWith, habitCounts, parseReaction, weeks, type DayLink, type DaysSpent, type HabitCounts, type Period, type PeriodSummary, type ReactionEvent, type WatchEvent } from './insights-data'
import type PlexMediaNotesPlugin from './main'
import { compareTitles, type MediaKind } from './notes'
import { noteEntries, pickEntries } from './recommend-data'
import { ANY_FILTER, fits, LENGTH_CHOICES, PICK_KINDS, pickChoices, pickOne, type PickEntry, type PickFilter } from './randomizer'
import { PlexSync } from './sync'
import { embedCode, type EmbedSpec } from './embed-spec'

/** The kinds Insights and Habits count, each in its own column. */
export type InsightsKind = 'movie' | 'tv' | 'book' | 'game' | 'song'

/** Which count each kind is in Habits, its name and what it counts. */
export const HABIT_KINDS: Record<InsightsKind, [keyof HabitCounts, string, string]> = {
  movie: ['movies', 'Movies', 'watched'], tv: ['episodes', 'TV shows', 'episodes'], book: ['bookDays', 'Books', 'days reading'],
  game: ['gameDays', 'Games', 'days playing'], song: ['songs', 'Songs', 'plays'],
}

export class DashCards {
  /** The Randomizer's last pick (a note's path), kept while its choices stay the same. */
  pick: string | undefined
  /** How far "Next" has gone in each kind's "Worth a few words". */
  readonly reviewAt = new Map<string, number>()
  private readonly seed = Math.random()

  /** `embedded`: drawn in a note, so without the buttons that copy cards. */
  constructor(private readonly app: App, private readonly plugin: PlexMediaNotesPlugin, private readonly redraw: () => void, private readonly embedded = false) {}

  /**
   * "This month" for one kind, as in Insights' columns: its count, then its list. `s` is the
   * period's summary; `days` your daily notes' links; `pathOf` a Plex item's note.
   */
  monthCard(parent: HTMLElement, kind: InsightsKind, s: PeriodSummary, period: Period, days: DayLink[], pathOf: (key: string) => string | undefined): void {
    const embed: EmbedSpec = { card: 'this-month', kind }
    const dayName = (day: string) => {
      const [y, mo, d] = day.split('-').map(Number)
      return new Date(y, mo - 1, d).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
    }
    // Books and games: only the days your daily notes link them; a reaction's rating is shown beside one.
    const withReacted = (spent: DaysSpent[], reacted: ReactionEvent[]) => spent.map(d => {
      const rating = reacted.find(r => r.path === d.path)?.rating
      return { title: d.title, path: d.path, detail: `${d.days} day${d.days === 1 ? '' : 's'}${rating ? ` · ${rating}` : ''}` }
    })
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    if (kind === 'movie') {
      const viewings = s.movies.reduce((n, m) => n + m.times, 0)
      this.metric(parent, 'Movies', String(s.movies.length), viewings > s.movies.length ? `${viewings} viewings` : undefined)
      // Newest first, by the last day each was watched.
      const latest = (d: string[]) => [...d].sort().pop() ?? ''
      const movies = [...s.movies].sort((a, b) => latest(b.days).localeCompare(latest(a.days)) || compareTitles(a.title, b.title))
      this.listCard(parent, 'Movies', movies.map(m => ({ title: m.title, path: pathOf(m.key), detail: m.days.map(dayName).join(', ') })), 'No movies then.', embed)
    } else if (kind === 'tv') {
      this.metric(parent, 'TV shows', plural(s.episodes, 'episode'), plural(s.shows.length, 'show'))
      this.listCard(parent, 'TV shows', s.shows.map(sh => ({ title: sh.title, path: pathOf(sh.key), detail: plural(sh.episodes, 'episode') })), 'No TV then.', embed)
    } else if (kind === 'book') {
      const books = withReacted(s.bookDays, s.books)
      this.metric(parent, 'Books', String(books.length), `${plural(daysWith(days, period, 'book'), 'day')} of reading`)
      this.listCard(parent, 'Books', books, 'No books in your daily notes then.', embed)
    } else if (kind === 'game') {
      const games = withReacted(s.gameDays, s.games)
      this.metric(parent, 'Games', String(games.length), `${plural(daysWith(days, period, 'game'), 'day')} of playing`)
      this.listCard(parent, 'Games', games, 'No games in your daily notes then.', embed)
    } else {
      this.metric(parent, 'Songs', plural(s.songPlays, 'play'))
      this.listCard(parent, 'Most played', [
        ...s.topArtists.map(([name, n]) => ({ title: name, detail: `${n} plays` })),
        ...s.topSongs.map(([name, n], i) => ({ title: name, detail: `×${n}`, divider: i === 0 && s.topArtists.length > 0 })),
      ], 'No songs then.', embed)
    }
  }

  /** Habits for one kind: this week's number against last week's, and the week before, last week and this week as bars. */
  habitsCard(parent: HTMLElement, kind: InsightsKind, events: WatchEvent[], days: DayLink[], now = new Date()): HabitCounts[] {
    const { thisWeek, lastWeek, weekBefore } = weeks(now)
    const byWeek = [weekBefore, lastWeek, thisWeek].map(p => habitCounts(events, days, p))
    const [key, label, unit] = HABIT_KINDS[kind]
    const [, before, current] = byWeek.map(c => c[key])
    this.metric(parent, label, String(current), `${unit}, ${compared(current, before)}`)
    const card = parent.createDiv('pmn-card')
    this.title(card, 'Week by week', { card: 'habits', kind })
    this.bars(card, byWeek.map((c, i) => ({ label: ['Week before', 'Last week', 'This week'][i], value: c[key] })), unit)
    return byWeek
  }

  /** A link to a note (or just the name, when there's no note). */
  link(parent: HTMLElement, title: string, path?: string): void {
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
  listCard(grid: HTMLElement, title: string, rows: { title: string, path?: string, detail?: string, divider?: boolean, action?: { text: string, tip: string, run: () => void } }[], empty: string, embed?: EmbedSpec): void {
    const card = grid.createDiv('pmn-card')
    this.title(card, title, embed)
    if (!rows.length) {
      if (empty) card.createEl('p', { cls: 'pmn-dash-empty', text: empty })
      return
    }
    for (const row of rows) {
      const rowEl = card.createDiv('pmn-rec-row')
      // A heavier line where a list's next part starts (Most played: artists, then songs).
      if (row.divider) rowEl.addClass('pmn-rec-divider')
      const line = rowEl.createDiv('pmn-rec-text')
      this.link(line, row.title, row.path)
      if (row.detail) line.createSpan({ cls: 'pmn-rec-why', text: ` ${row.detail}` })
      if (row.action) {
        const { run } = row.action
        rowEl.createEl('button', { cls: 'pmn-rec-action', text: row.action.text, attr: { 'aria-label': row.action.tip } }).addEventListener('click', run)
      }
    }
  }

  header(parent: HTMLElement, title: string, subtitle: string, embed?: EmbedSpec): HTMLElement {
    const header = parent.createDiv('pmn-dash-header')
    const titles = header.createDiv('pmn-dash-titles')
    titles.createDiv({ cls: 'pmn-dash-title', text: title })
    if (subtitle) titles.createDiv({ cls: 'pmn-dash-subtitle', text: subtitle })
    const controls = header.createDiv('pmn-dash-controls')
    if (embed) this.copyButton(controls, embed)
    return controls
  }

  /** A card's title, with the button that copies the card to embed it in a note (on the dashboard only). */
  title(card: HTMLElement, text: string, embed?: EmbedSpec): void {
    const row = card.createDiv('pmn-card-title')
    row.createSpan({ text })
    if (embed) this.copyButton(row, embed)
  }

  /** The little </> button: copies the code block that shows this card in any note. */
  private copyButton(parent: HTMLElement, embed: EmbedSpec): void {
    if (this.embedded) return
    const button = parent.createEl('button', { cls: 'clickable-icon pmn-embed-copy', attr: { 'aria-label': 'Copy this card to put it in a note' } })
    setIcon(button, 'code-xml')
    if (!button.querySelector('svg')) setIcon(button, 'code')
    button.addEventListener('click', event => {
      event.stopPropagation()
      void navigator.clipboard.writeText(embedCode(embed)).then(() => new Notice('Copied. Paste it into any note to show this card there.'))
    })
  }

  metric(parent: HTMLElement, label: string, value: string, sub?: string): void {
    const metric = parent.createDiv('pmn-dash-metric')
    metric.createDiv({ cls: 'pmn-dash-metric-label', text: label })
    metric.createDiv({ cls: 'pmn-dash-metric-value', text: value })
    // Always a line under the number, so the cards in a row are the same height.
    metric.createDiv({ cls: 'pmn-dash-metric-sub', text: sub ?? '\u00a0' })
  }

  /** Every day your daily notes link a media note in Related (a day you watched, read or played it). */
  days(): DayLink[] {
    const notes = new Map(noteEntries(this.app, this.plugin.settings).map(n => [n.path, n]))
    const sync = new PlexSync(this.app, this.plugin.settings, () => this.plugin.saveSettings())
    return sync.relatedDays().flatMap(({ day, path }) => {
      const note = notes.get(path)
      return note ? [{ day, path, title: note.title, group: note.group }] : []
    })
  }

  /** Every reaction in your notes. */
  reactions(): ReactionEvent[] {
    const settings = this.plugin.settings
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

  /**
   * What you rated 🩷 or 💣 but haven't written your Notes for (your lasting take; a reaction's
   * few words are of the moment, so they don't count).
   */
  reviewCandidates(): { path: string, title: string, level: number, kind: string }[] {
    const settings = this.plugin.settings
    const skipped = new Set(settings.reviewSkipped)
    const out: { path: string, title: string, level: number, kind: string }[] = []
    const libs = Object.values(settings.libraries).map(lib => ({ folder: `${lib.folder.replace(/\/+$/, '')}/`, target: lib.target }))
    for (const note of noteEntries(this.app, settings)) {
      if ((note.level !== 5 && note.level !== 1) || skipped.has(note.path)) continue
      const file = this.app.vault.getAbstractFileByPath(note.path)
      const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {}
      const notesKey = Object.keys(fm).find(key => key.toLowerCase() === 'notes')
      const notesValue: unknown = notesKey ? fm[notesKey] : undefined
      if (typeof notesValue === 'string' ? notesValue.trim() : Array.isArray(notesValue) && notesValue.length) continue
      out.push({ path: note.path, title: note.title, level: note.level, kind: libs.find(l => note.path.startsWith(l.folder))?.target ?? note.group })
    }
    // A different order each time the dashboard opens, the same while it's open.
    const order = (path: string) => [...`${path}${this.seed}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7)
    return out.sort((a, b) => order(a.path) - order(b.path))
  }

  /**
   * "Worth a few words" for some kinds of media (under their count in Insights): one thing of each
   * you rated 🩷 or 💣 but haven't written about. Nothing shown when there's none.
   */
  worthCard(parent: HTMLElement, kinds: [string, string][], candidates: { path: string, title: string, level: number, kind: string }[], embed?: EmbedSpec, always = false): void {
    const found = kinds.map(([kind, label]) => ({ kind, label, list: candidates.filter(c => c.kind === kind) })).filter(k => k.list.length)
    if (!found.length && !always) return
    const card = parent.createDiv('pmn-card')
    this.title(card, 'Worth a few words', embed)
    if (!found.length) card.createEl('p', { cls: 'pmn-dash-empty', text: 'Nothing waiting: everything you loved or hated has "Notes".' })
    for (const { kind, label, list } of found) this.reviewCard(card, found.length > 1 ? label : '', kind, list)
  }

  /** One thing you rated 🩷 or 💣 but haven't written about, of one kind. */
  reviewCard(parent: HTMLElement, label: string, kind: string, candidates: { path: string, title: string, level: number }[]): void {
    const card = parent.createDiv('pmn-review-kind')
    if (label) card.createDiv({ cls: 'pmn-review-kind-label', text: label })
    const pick = candidates[(this.reviewAt.get(kind) ?? 0) % candidates.length]
    const text = card.createDiv('pmn-review')
    this.link(text.createDiv('pmn-review-title'), pick.title, pick.path)
    const file = this.app.vault.getAbstractFileByPath(pick.path)
    const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {}
    text.createDiv({ cls: 'pmn-rec-why', text: `You rated it ${pick.level === 5 ? '🩷' : '💣'} and its "Notes" are empty.${candidates.length > 1 ? ` ${candidates.length - 1} more like it.` : ''}` })
    const why: unknown = fm[this.plugin.settings.whyProperty || 'Why']
    if (typeof why === 'string' && why.trim()) text.createDiv({ cls: 'pmn-review-wanted', text: `You wanted it because: ${why.trim()}` })
    const buttons = card.createDiv('pmn-rec-buttons pmn-review-buttons')
    buttons.createEl('button', { text: 'Write about it' }).addEventListener('click', () => {
      if (!(file instanceof TFile)) return
      void this.plugin.openNotes(file)
    })
    if (candidates.length > 1) {
      buttons.createEl('button', { text: 'Next', attr: { 'aria-label': 'Another one' } }).addEventListener('click', () => {
        this.reviewAt.set(kind, (this.reviewAt.get(kind) ?? 0) + 1)
        this.redraw()
      })
    }
    buttons.createEl('button', { cls: 'pmn-rec-no', text: 'Ignore', attr: { 'aria-label': 'Don\'t show this one again' } }).addEventListener('click', () => {
      this.plugin.settings.reviewSkipped.push(pick.path)
      void this.plugin.saveSettings().then(() => this.redraw())
    })
  }

  /**
   * The Randomizer: one kind of your media, narrowed by genre, status, length and tag (each kind's
   * choices remembered), every note that fits, and one picked at random from them.
   */
  randomizer(el: HTMLElement, only?: MediaKind): void {
    const settings = this.plugin.settings
    const onlyLabel = only ? PICK_KINDS.find(([k]) => k === only)?.[1] : undefined
    this.header(el, onlyLabel ? `${onlyLabel}: randomizer` : 'Randomizer', 'Narrow it down, then let chance choose.', this.embedded ? undefined : { card: 'randomizer', kind: only ?? (PICK_KINDS.some(([k]) => k === settings.randomizer.kind) ? settings.randomizer.kind as MediaKind : 'movie') })
    const all = pickEntries(this.app, settings)
    const kinds = PICK_KINDS.filter(([kind]) => only ? kind === only : all.some(e => e.kind === kind))
    if (!kinds.length || (only && !all.some(e => e.kind === only))) {
      el.createEl('p', { cls: 'pmn-dash-empty', text: only ? `No ${(onlyLabel ?? only).toLowerCase()} notes in your libraries' folders yet.` : 'No movie, show, documentary, book or game notes in your libraries\' folders yet.' })
      return
    }
    // Embedded for one kind: just that kind, no row of kinds (its choices are the dashboard's too).
    const kind = only ?? (kinds.some(([k]) => k === settings.randomizer.kind) ? settings.randomizer.kind : kinds[0][0])
    const save = () => void this.plugin.saveSettings()

    const kindRow = el.createDiv('pmn-pick-kinds')
    if (only) kindRow.hide()
    for (const [k, label] of kinds) {
      const button = kindRow.createEl('button', { cls: `pmn-dash-tab${k === kind ? ' is-active' : ''}`, text: label })
      button.addEventListener('click', () => {
        if (k === kind) return
        settings.randomizer.kind = k
        this.pick = undefined
        save()
        this.redraw()
      })
    }

    const entries = all.filter(e => e.kind === kind)
    const filter: PickFilter = { ...ANY_FILTER, ...settings.randomizer.filters[kind] }
    const choices = pickChoices(entries)
    const filters = el.createDiv('pmn-pick-filters')
    const choose = (label: string, key: keyof PickFilter, options: [string, string][]) => {
      const box = filters.createDiv('pmn-pick-filter')
      box.createDiv({ cls: 'pmn-dash-metric-label', text: label })
      const select = box.createEl('select', { cls: 'dropdown' })
      // A choice no note has any more (say, a tag you removed) is still shown while chosen.
      const all: [string, string][] = [['', 'Any'], ...options, ...filter[key] && !options.some(([v]) => v === filter[key]) ? [[filter[key], filter[key]] as [string, string]] : []]
      for (const [value, text] of all) select.createEl('option', { value, text })
      select.value = filter[key]
      select.addEventListener('change', () => {
        settings.randomizer.filters[kind] = { ...filter, [key]: select.value }
        this.pick = undefined
        save()
        this.redraw()
      })
    }
    choose('Genre', 'genre', choices.genres.map(g => [g, g]))
    choose('Status', 'status', choices.statuses.map(s => [s, s]))
    choose('Length', 'length', (LENGTH_CHOICES[kind] ?? []).map(c => [c.id, c.label]))
    choose('Tag', 'tag', choices.tags.map(t => [t, t]))
    if (filter.genre || filter.status || filter.length || filter.tag) {
      filters.createEl('button', { cls: 'pmn-pick-clear', text: 'Clear' }).addEventListener('click', () => {
        settings.randomizer.filters[kind] = { ...ANY_FILTER }
        this.pick = undefined
        save()
        this.redraw()
      })
    }

    const fitting = entries.filter(e => fits(e, filter)).sort((a, b) => compareTitles(a.title, b.title))
    const lengthText = (e: PickEntry) => e.length === undefined ? undefined
      : kind === 'book' ? `${e.length} pages`
      : e.length >= 60 ? `${Math.floor(e.length / 60)}h${e.length % 60 ? ` ${e.length % 60}m` : ''}` : `${e.length}m`
    const detail = (e: PickEntry) => [e.status, lengthText(e)].filter(Boolean).join(' · ') || undefined

    const grid = el.createDiv('pmn-dash-grid')
    const pickCard = grid.createDiv('pmn-card pmn-pick-card')
    pickCard.createDiv({ cls: 'pmn-card-title', text: 'Your pick' })
    const picked = fitting.find(e => e.path === this.pick)
    if (!fitting.length) {
      pickCard.createEl('p', { cls: 'pmn-dash-empty', text: 'Nothing fits all of that. Try "Any" for one of them.' })
    } else {
      if (picked) {
        const line = pickCard.createDiv('pmn-pick-chosen')
        this.link(line, picked.title, picked.path)
        const about = detail(picked)
        if (about) line.createDiv({ cls: 'pmn-rec-why', text: about })
      }
      const buttons = pickCard.createDiv('pmn-rec-buttons')
      buttons.createEl('button', { text: picked ? 'Pick another' : 'Pick one for me' }).addEventListener('click', () => {
        this.pick = pickOne(fitting, this.pick)?.path
        this.redraw()
      })
    }
    // Notes with no length can't be told apart by length, so they're said, not hidden silently.
    const unknown = filter.length ? entries.filter(e => e.length === undefined && fits(e, { ...filter, length: '' })).length : 0
    const title = `${fitting.length} ${fitting.length === 1 ? 'fits' : 'fit'}`
    this.listCard(grid, title, fitting.map(e => ({ title: e.title, path: e.path, detail: detail(e) })), 'Nothing fits all of that.')
    if (unknown) grid.lastElementChild?.createEl('p', { cls: 'pmn-dash-empty', text: `${unknown} more would fit, but their notes have no length.` })
  }

  /**
   * A small bar chart: one bar per period, the last one (now) labelled with its number; every bar
   * says its number on hover, and the chart says them all to screen readers.
   */
  bars(parent: HTMLElement, bars: { label: string, value: number }[], unit: string): void {
    const width = 240
    const height = 96
    const top = 14
    const bottom = 18
    const gap = 4
    const max = Math.max(1, ...bars.map(b => b.value))
    const slot = width / bars.length
    const barWidth = Math.max(4, Math.min(28, slot - gap))
    const svg = parent.createSvg('svg', { cls: 'pmn-bars', attr: { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': bars.map(b => `${b.label}: ${b.value} ${unit}`).join(', ') } })
    const base = height - bottom
    svg.createSvg('line', { cls: 'pmn-bars-axis', attr: { x1: 0, x2: width, y1: base, y2: base } })
    bars.forEach((bar, i) => {
      const x = i * slot + (slot - barWidth) / 2
      const h = bar.value ? Math.max(2, (bar.value / max) * (base - top)) : 0
      // An SVG element's classes go one by one (a space in one throws, and the rest isn't drawn).
      const group = svg.createSvg('g', { cls: i === bars.length - 1 ? ['pmn-bars-bar', 'is-current'] : 'pmn-bars-bar' })
      group.createSvg('title').textContent = `${bar.label}: ${bar.value} ${unit}`
      // A wider, invisible target than the bar, so hovering is easy.
      group.createSvg('rect', { cls: 'pmn-bars-hit', attr: { x: i * slot, y: 0, width: slot, height: base } })
      if (h) {
        // Rounded at the top only, square on the baseline.
        const r = Math.min(4, barWidth / 2, h)
        group.createSvg('path', { cls: 'pmn-bars-fill', attr: { d: `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barWidth - r} Q${x + barWidth},${base - h} ${x + barWidth},${base - h + r} V${base} Z` } })
      }
      if (i === bars.length - 1) group.createSvg('text', { cls: 'pmn-bars-value', attr: { x: x + barWidth / 2, y: base - h - 3 } }).textContent = String(bar.value)
      // With many bars (months), their first letter, so they don't run together.
      group.createSvg('text', { cls: 'pmn-bars-label', attr: { x: i * slot + slot / 2, y: height - 4 } }).textContent = bars.length > 6 ? bar.label.slice(0, 1) : bar.label
    })
  }
}
