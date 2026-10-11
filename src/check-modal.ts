import { App, type ExtraButtonComponent, Modal, Notice, Setting, TFile, type ToggleComponent } from 'obsidian'
import type { PlexNotesSettings } from './config'
import { FIELD_SOURCES, UNCHECKED_SOURCES, type FieldSource } from './properties'


/** Not a property: a check with it renames notes whose file name doesn't follow their library's format. */
export const FILE_NAME = 'File name'

/** What each kind of library holds, as shown beside its name. */
const KIND_NAMES: Record<string, string> = {
  movie: 'Movies', tv: 'TV shows', documentary: 'Documentaries', music: 'Music', game: 'Games', book: 'Books',
}

/**
 * The properties a check can compare, by name: which source fills them (none for the file name)
 * and which libraries have them.
 */
export function checkableProperties(settings: PlexNotesSettings): { name: string, source: FieldSource | null, libraries: string[] }[] {
  const byName = new Map<string, { name: string, source: FieldSource | null, libraries: string[] }>()
  const libraries = Object.values(settings.libraries).filter(lib => lib.target !== 'skip' && lib.target !== 'book')
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
  return lib.target === 'book' ? properties : [{ name: FILE_NAME, source: null }, ...properties]
}

/** Libraries whose property list is open in the check pop-up, kept while Obsidian runs. */
const openInCheck = new Set<string>()

/**
 * "Check notes against sources": choose the libraries, and in each the properties to compare,
 * then start. The choice is remembered for next time.
 */
export class CheckModal extends Modal {
  constructor(app: App, private readonly pmnSettings: PlexNotesSettings, private readonly pmnStart: (properties: Record<string, string[]>, libraries: string[]) => void) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Check notes against sources')
    this.modalEl.addClass('pmn-check')
    const { contentEl } = this
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Each note matched to a Plex item or Steam game, and each book note (via Open Library), is compared with its source for the properties ticked here, and you choose what to keep in the usual pop-up. A property missing or empty in a note is filled in from the source (ticked). A status only starts ticked when it moves forward; a rating that differs from Plex\'s can go either way (use Plex\'s, or send yours to Plex), both unticked; the source\'s tag is added to your tags; an image you set yourself starts unticked. It\'s slow: each item\'s details are fetched. Notes nothing matched are listed at the end.',
    })
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Switch on the libraries to check, and open one to choose its properties.',
    })
    const settings = this.pmnSettings
    const libraries = Object.entries(settings.libraries).filter(([, lib]) => lib.target !== 'skip')
    const checkedLibraries = new Set(settings.checkLibraries?.filter(key => libraries.some(([k]) => k === key)) ?? libraries.map(([key]) => key))
    const chosen = new Map<string, Set<string>>()
    const list = contentEl.createDiv('pmn-check-libraries')
    for (const [key, lib] of libraries) {
      const properties = libraryCheckables(settings, key)
      const saved = settings.checkByLibrary[key] ?? settings.checkProperties ?? properties.map(p => p.name)
      const picked = new Set(saved.filter(name => properties.some(p => p.name === name)))
      chosen.set(key, picked)

      const section = list.createDiv('pmn-check-library')
      const body = createDiv('pmn-check-properties pmn-indent')
      let chevron: ExtraButtonComponent | null = null
      const showOpen = () => {
        const open = openInCheck.has(key)
        body.toggleClass('pmn-hidden', !open)
        chevron?.setIcon(open ? 'chevron-down' : 'chevron-right')
      }
      const toggleOpen = () => {
        if (openInCheck.has(key)) openInCheck.delete(key)
        else openInCheck.add(key)
        showOpen()
      }
      const row = new Setting(section)
        .setName(lib.title)
        .addExtraButton(button => {
          chevron = button
          button.setTooltip('Choose properties').onClick(toggleOpen)
        })
        .addToggle(toggle => toggle
          .setTooltip('Check this library')
          .setValue(checkedLibraries.has(key))
          .onChange(value => {
            if (value) checkedLibraries.add(key)
            else checkedLibraries.delete(key)
          }))
      row.settingEl.addClass('pmn-check-library-row')
      row.nameEl.addEventListener('click', toggleOpen)
      const describe = () => row.setDesc(`${KIND_NAMES[lib.target] ?? ''} · ${picked.size} of ${properties.length} properties`)
      describe()
      section.appendChild(body)

      const toggles: ToggleComponent[] = []
      new Setting(body)
        .addButton(b => b.setButtonText('Tick all').onClick(() => { toggles.forEach(t => { t.setValue(true) }) }))
        .addButton(b => b.setButtonText('Untick all').onClick(() => { toggles.forEach(t => { t.setValue(false) }) }))
      for (const { name, source } of properties) {
        new Setting(body)
          .setName(name)
          .setDesc(source ? FIELD_SOURCES[source] : 'Renamed to the library\'s file name format')
          .addToggle(toggle => {
            toggles.push(toggle)
            toggle
              .setValue(picked.has(name))
              .onChange(value => {
                if (value) picked.add(name)
                else picked.delete(name)
                describe()
              })
          })
      }
      showOpen()
    }
    new Setting(contentEl)
      .addButton(b => b.setButtonText('Start').setCta().onClick(() => {
        const byLibrary: Record<string, string[]> = {}
        for (const [key] of libraries) {
          // In the order the library lists them, for the pop-ups.
          byLibrary[key] = libraryCheckables(settings, key).map(p => p.name).filter(name => chosen.get(key)!.has(name))
        }
        const keys = libraries.map(([key]) => key).filter(key => checkedLibraries.has(key) && byLibrary[key].length)
        settings.checkByLibrary = byLibrary
        settings.checkLibraries = libraries.map(([key]) => key).filter(key => checkedLibraries.has(key))
        this.close()
        if (!keys.length) {
          new Notice('Nothing to check: switch on a library with at least one property ticked')
          return
        }
        this.pmnStart(Object.fromEntries(keys.map(key => [key, byLibrary[key]])), keys)
      }))
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
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
    for (const path of this.pmnUnmatched) {
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
