import { App, Modal, Setting, TFile } from 'obsidian'
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
 * "Check existing notes against sources": choose the properties to compare, then start. The choice
 * is remembered for next time.
 */
export class CheckModal extends Modal {
  constructor(app: App, private readonly pmnSettings: PlexNotesSettings, private readonly pmnStart: (properties: string[], libraries: string[]) => void) {
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
    // Which libraries: say, only Music, or only Books.
    const libraries = Object.entries(this.pmnSettings.libraries).filter(([, lib]) => lib.target !== 'skip')
    const savedLibraries = this.pmnSettings.checkLibraries
    const checkedLibraries = new Set(savedLibraries?.filter(key => libraries.some(([k]) => k === key)) ?? libraries.map(([key]) => key))
    new Setting(contentEl).setName('Libraries').setHeading()
    for (const [key, lib] of libraries) {
      new Setting(contentEl)
        .setName(lib.title)
        .setDesc(KIND_NAMES[lib.target] ?? '')
        .addToggle(toggle => toggle
          .setValue(checkedLibraries.has(key))
          .onChange(value => {
            if (value) checkedLibraries.add(key)
            else checkedLibraries.delete(key)
          }))
    }
    new Setting(contentEl).setName('Properties').setHeading()
    const properties = checkableProperties(this.pmnSettings)
    const saved = this.pmnSettings.checkProperties
    const chosen = new Set(saved ?? properties.map(p => p.name))
    for (const { name, source, libraries } of properties) {
      new Setting(contentEl)
        .setName(name)
        .setDesc(`${source ? FIELD_SOURCES[source] : 'Renamed to the library\'s file name format'} · ${libraries.join(', ')}`)
        .addToggle(toggle => toggle
          .setValue(chosen.has(name))
          .onChange(value => {
            if (value) chosen.add(name)
            else chosen.delete(name)
          }))
    }
    new Setting(contentEl)
      .addButton(b => b.setButtonText('Start').setCta().onClick(() => {
        const names = properties.map(p => p.name).filter(name => chosen.has(name))
        const keys = libraries.map(([key]) => key).filter(key => checkedLibraries.has(key))
        this.pmnSettings.checkProperties = names
        this.pmnSettings.checkLibraries = keys
        this.close()
        this.pmnStart(names, keys)
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
      ? `${left} note${left === 1 ? '' : 's'} in your libraries' folders ${left === 1 ? 'matches' : 'match'} nothing in Plex, Steam or Open Library. Its name may differ from the source's (choose "Use an existing note…" when a sync offers to create it, or fix its Link), or it's no longer in your library. "Always ignore" stops pointing a note out (undo under Settings → Skipped every time).`
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
