import { App, Modal, Notice, Setting, TFile, ToggleComponent } from 'obsidian'
import { BOOKS_LIBRARY, type PlexNotesSettings } from './config'
import { FIELD_SOURCES, UNCHECKED_SOURCES, type FieldSource } from './properties'
import { compareTitles } from './notes'


/** Not a property: a check with it renames notes whose file name doesn't follow their library's format. */
export const FILE_NAME = 'File name'

/**
 * The properties a check can compare, by name: which source fills them (none for the file name)
 * and which libraries have them.
 */
export function checkableProperties(settings: PlexNotesSettings): { name: string, source: FieldSource | null, libraries: string[] }[] {
  const byName = new Map<string, { name: string, source: FieldSource | null, libraries: string[] }>()
  const libraries = Object.values(settings.libraries).filter(lib => lib.target !== 'skip')
  if (libraries.length) byName.set(FILE_NAME, { name: FILE_NAME, source: null, libraries: libraries.map(lib => lib.title) })
  for (const lib of Object.values(settings.libraries)) {
    if (lib.target === 'skip') continue
    for (const m of lib.properties) {
      const name = m.name.trim()
      if (!name || UNCHECKED_SOURCES.includes(m.source)) continue
      const entry = byName.get(name) ?? { name, source: m.source, libraries: [] }
      if (!entry.libraries.includes(lib.title)) entry.libraries.push(lib.title)
      byName.set(name, entry)
    }
  }
  return [...byName.values()]
}

/**
 * The properties a check can compare in one library, in alphabetical order after the file name:
 * its own, plus, for books, the rating property other libraries have (book notes may hold one).
 */
export function libraryCheckables(settings: PlexNotesSettings, key: string): { name: string, source: FieldSource | null }[] {
  const lib = settings.libraries[key]
  if (!lib || lib.target === 'skip') return []
  const byName = new Map<string, FieldSource | null>()
  for (const m of lib.properties) {
    const name = m.name.trim()
    if (name && !UNCHECKED_SOURCES.includes(m.source) && !byName.has(name)) byName.set(name, m.source)
  }
  if (lib.target === 'book') {
    for (const m of Object.values(settings.libraries).flatMap(l => l.properties)) {
      const name = m.name.trim()
      if (m.source === 'userRatingEmoji' && name && !byName.has(name)) byName.set(name, m.source)
    }
  }
  const properties = [...byName.entries()]
    .map(([name, source]) => ({ name, source }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return [{ name: FILE_NAME, source: null }, ...properties]
}

/** Libraries whose "Also compare" list is open in the sync pop-up, kept while Obsidian runs. */
const openInSync = new Set<string>()

/** Sources that need a slow lookup per note (HowLongToBeat), pointed out when one is ticked. */
const SLOW_SOURCES: FieldSource[] = ['hltbMain', 'hltbLink', 'durationMinutes', 'durationText', 'durationClock']

/**
 * "Sync with Plex and Steam": choose which libraries to sync and, under each, which properties to
 * also compare with their sources (what "Check notes against sources" used to do). Nothing ticked
 * is a quick sync. Books are only compared (no sync reads them), and start switched off. The
 * choices are remembered for next time.
 */
export class SyncModal extends Modal {
  constructor(app: App, private readonly pmnSettings: PlexNotesSettings, private readonly pmnStart: (libraries: string[], compare: Record<string, string[]>) => void) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Sync with Plex and Steam')
    this.modalEl.addClass('pmn-sync')
    const { contentEl } = this
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Makes notes for anything new and keeps play counts, ratings, statuses, lyrics and song tags up to date. Tick properties under a library to also compare its existing notes with the source; nothing ticked is a quick sync.',
    })
    const settings = this.pmnSettings
    const libraries = Object.entries(settings.libraries).filter(([, lib]) => lib.target !== 'skip')
    // Books are only compared, so they start switched off.
    const switchedOn = new Set(settings.syncLibraries?.filter(key => libraries.some(([k]) => k === key))
      ?? libraries.map(([key]) => key).filter(key => key !== BOOKS_LIBRARY))
    const compare = new Map<string, Set<string>>()
    const warning = createDiv({ cls: 'pmn-sync-warning' })
    const describeAll = () => {
      const on = libraries.filter(([key]) => switchedOn.has(key) && compare.get(key)!.size)
      const count = on.reduce((n, [key]) => n + compare.get(key)!.size, 0)
      warning.toggleClass('pmn-hidden', !on.length)
      warning.setText(`Comparing ${count} propert${count === 1 ? 'y' : 'ies'} in ${on.length} librar${on.length === 1 ? 'y' : 'ies'}: every note in them is looked up one by one, so this sync takes longer. Each note gets one pop-up with its sync changes and its differences together.`)
    }
    for (const [key, lib] of libraries) {
      const properties = libraryCheckables(settings, key)
      const picked = new Set((settings.syncCompare[key] ?? []).filter(name => properties.some(p => p.name === name)))
      compare.set(key, picked)
      const books = key === BOOKS_LIBRARY
      const section = contentEl.createDiv('pmn-sync-library')
      const row = section.createDiv('pmn-sync-row')
      const summary = createSpan({ cls: 'pmn-sync-summary' })
      new ToggleComponent(row).setValue(switchedOn.has(key)).setTooltip(books ? 'Compare book notes' : 'Sync this library').onChange(value => {
        if (value) switchedOn.add(key)
        else switchedOn.delete(key)
        section.toggleClass('is-off', !value)
        describe()
        describeAll()
      })
      const name = row.createDiv({ cls: 'pmn-sync-name', text: lib.title })
      if (books) name.createSpan({ cls: 'pmn-sync-only', text: 'compare only' })
      row.appendChild(summary)
      section.toggleClass('is-off', !switchedOn.has(key))
      const describe = () => {
        summary.empty()
        if (!switchedOn.has(key)) {
          summary.setText('Off')
          return
        }
        const names = properties.filter(p => picked.has(p.name)).map(p => p.name)
        summary.setText(!names.length ? (books ? 'Nothing to compare' : 'Quick sync only') : names.length <= 3 ? `Compare: ${names.join(', ')}` : `Compare: ${names.length} properties`)
        const slow = books ? 'Open Library' : lib.target === 'game' && properties.some(p => picked.has(p.name) && p.source && SLOW_SOURCES.includes(p.source)) ? 'HowLongToBeat' : null
        if (names.length && slow) summary.createSpan({ cls: 'pmn-sync-slow', text: ` · slow (${slow})` })
      }
      const details = section.createEl('details', { cls: 'pmn-sync-compare' })
      details.open = openInSync.has(key)
      details.addEventListener('toggle', () => {
        if (details.open) openInSync.add(key)
        else openInSync.delete(key)
      })
      details.createEl('summary', { text: 'Also compare these properties' })
      const all = details.createDiv('pmn-sync-all')
      const boxes: HTMLInputElement[] = []
      const setAll = (value: boolean) => {
        for (const [i, box] of boxes.entries()) {
          box.checked = value
          if (value) picked.add(properties[i].name)
          else picked.delete(properties[i].name)
        }
        describe()
        describeAll()
      }
      all.createEl('a', { text: 'Tick all', href: '#' }).addEventListener('click', evt => { evt.preventDefault(); setAll(true) })
      all.createEl('a', { text: 'Untick all', href: '#' }).addEventListener('click', evt => { evt.preventDefault(); setAll(false) })
      const grid = details.createDiv('pmn-sync-props')
      for (const { name: property, source } of properties) {
        const label = grid.createEl('label', { cls: 'pmn-sync-prop', attr: { 'aria-label': source ? FIELD_SOURCES[source] : 'Renamed to the library\'s file name format' } })
        const box = label.createEl('input', { type: 'checkbox' })
        box.checked = picked.has(property)
        boxes.push(box)
        label.createSpan({ text: property })
        box.addEventListener('change', () => {
          if (box.checked) picked.add(property)
          else picked.delete(property)
          describe()
          describeAll()
        })
      }
      describe()
    }
    contentEl.appendChild(warning)
    describeAll()
    new Setting(contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Sync').setCta().onClick(() => {
        const keys = libraries.map(([key]) => key).filter(key => switchedOn.has(key))
        const chosen: Record<string, string[]> = {}
        for (const [key] of libraries) {
          // In the order the library lists them, for the pop-ups.
          chosen[key] = libraryCheckables(settings, key).map(p => p.name).filter(name => compare.get(key)!.has(name))
        }
        settings.syncLibraries = keys
        settings.syncCompare = chosen
        this.close()
        if (!keys.length) {
          new Notice('Nothing to sync: switch on at least one library')
          return
        }
        this.pmnStart(keys, Object.fromEntries(keys.filter(key => chosen[key].length).map(key => [key, chosen[key]])))
      }))
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

/**
 * Notes in the libraries' folders that match nothing in Plex, Steam or Open Library, shown after
 * a sync or a check (with its summary): each can be opened, or always ignored from then on.
 */
export class UnmatchedModal extends Modal {
  constructor(app: App, private readonly pmnTitle: string, private readonly pmnSummary: string | null,
    private readonly pmnUnmatched: string[], private readonly pmnIgnore: (path: string) => Promise<void>,
    private readonly pmnWhy: Record<string, string> = {}) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText(this.pmnTitle)
    this.modalEl.addClass('pmn-check')
    const { contentEl } = this
    if (this.pmnSummary) contentEl.createEl('p', { text: this.pmnSummary })
    if (!this.pmnUnmatched.length) {
      contentEl.createEl('p', { cls: 'setting-item-description', text: 'Every note in the libraries\' folders matched something.' })
      return
    }
    const count = contentEl.createEl('p', { cls: 'setting-item-description' })
    let left = this.pmnUnmatched.length
    const describe = () => count.setText(left
      ? `${left} note${left === 1 ? '' : 's'} in your libraries' folders ${left === 1 ? 'matches' : 'match'} nothing in Plex, Steam or Open Library. Its name may differ from the source's (choose "Use an existing note…" when a sync offers to create it, or fix its Link), or it's no longer in your library. "Always ignore" stops pointing a note out (undo under Settings → Remembered choices).`
      : 'All done.')
    describe()
    const list = contentEl.createDiv('pmn-check-unmatched')
    const nameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')
    for (const path of [...this.pmnUnmatched].sort((a, b) => compareTitles(nameOf(a), nameOf(b)))) {
      const row = new Setting(list)
        .setName(path.split('/').pop()!.replace(/\.md$/, ''))
        .setDesc([path.split('/').slice(0, -1).join('/'), this.pmnWhy[path]].filter(Boolean).join(' · '))
        .addButton(b => b.setButtonText('Open').onClick(() => {
          const file = this.app.vault.getAbstractFileByPath(path)
          if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file)
        }))
        .addButton(b => b.setButtonText('Always ignore').onClick(async () => {
          await this.pmnIgnore(path)
          row.settingEl.remove()
          left--
          describe()
        }))
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
