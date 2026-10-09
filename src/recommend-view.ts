import { ItemView, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import type { PlexItem } from './notes'
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
    if (this.pmnLooking) return
    this.pmnLooking = true
    this.pmnLookupError = null
    this.pmnRender()
    try {
      const sync = new PlexSync(this.app, this.pmnPlugin.settings, () => this.pmnPlugin.saveSettings())
      const { withNotes, withoutNotes } = await sync.libraryItems(() => {})
      this.pmnItems = withoutNotes.map(({ item, kind, libraryKey }) => ({ entry: itemEntry(item, kind), item, libraryKey }))
      this.pmnMatched = new Map(withNotes.map(({ item, path, kind }) => [path, itemEntry(item, kind)]))
    } catch (err) {
      this.pmnLookupError = errorMessage(err)
    } finally {
      this.pmnLooking = false
      this.pmnRender()
    }
  }

  private pmnRender(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pmn-dash')
    const settings = this.pmnPlugin.settings
    // A note's people (director, cast…) come from its Plex item, so notes needn't have them.
    const notes = noteEntries(this.app, settings).map(note => {
      const item = this.pmnMatched.get(note.path)
      return item ? withItem(note, item) : note
    })
    const items = this.pmnItems ?? []
    const entries: RecEntry[] = [...notes, ...items.map(i => i.entry)]
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
    refresh.disabled = this.pmnLooking
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

  private async pmnNotInterested(entry: RecEntry): Promise<void> {
    const settings = this.pmnPlugin.settings
    if (!settings.notInterested.includes(entry.id)) settings.notInterested.push(entry.id)
    await this.pmnPlugin.saveSettings()
    new Notice(`${entry.title} won't be suggested again (undo in Settings → Remembered choices)`)
    this.pmnRender()
  }
}
