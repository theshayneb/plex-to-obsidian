import { App, Modal, Setting, TFile } from 'obsidian'
import type { PlexNotesSettings } from './config'
import { FIELD_SOURCES, UNCHECKED_SOURCES, type FieldSource } from './properties'

/** Sources left unticked to start with: covers, which you may have picked yourself. */
const OFF_TO_START: FieldSource[] = ['poster', 'wideImage']

/** The properties a check can compare, by name: which source fills them and which libraries have them. */
export function checkableProperties(settings: PlexNotesSettings): { name: string, source: FieldSource, libraries: string[] }[] {
  const byName = new Map<string, { name: string, source: FieldSource, libraries: string[] }>()
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
  constructor(app: App, private readonly pmnSettings: PlexNotesSettings, private readonly pmnStart: (properties: string[]) => void) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Check existing notes against sources')
    this.modalEl.addClass('pmn-check')
    const { contentEl } = this
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Each note matched to a Plex item or Steam game, and each book note (via Open Library), is compared with its source for the properties ticked here. Where they differ you\'re asked, as in a sync: empty values, durations in hours and genres are offered ticked; any other difference unticked, so it\'s only changed if you tick it. Status, play counts, playtime and ratings aren\'t compared (syncs keep those up to date). It\'s slow: each item\'s details are fetched. Notes nothing matched are listed at the end.',
    })
    const properties = checkableProperties(this.pmnSettings)
    const saved = this.pmnSettings.checkProperties
    const chosen = new Set(saved ?? properties.filter(p => !OFF_TO_START.includes(p.source)).map(p => p.name))
    for (const { name, source, libraries } of properties) {
      new Setting(contentEl)
        .setName(name)
        .setDesc(`${FIELD_SOURCES[source]} · ${libraries.join(', ')}`)
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
        this.pmnSettings.checkProperties = names
        this.close()
        this.pmnStart(names)
      }))
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

/** The end of a check: what changed, and the notes nothing matched, each opening on click. */
export class CheckReportModal extends Modal {
  constructor(app: App, private readonly pmnSummary: string, private readonly pmnUnmatched: string[]) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Check finished')
    this.modalEl.addClass('pmn-check')
    const { contentEl } = this
    contentEl.createEl('p', { text: this.pmnSummary })
    if (!this.pmnUnmatched.length) {
      contentEl.createEl('p', { cls: 'setting-item-description', text: 'Every note in the libraries\' folders matched something.' })
      return
    }
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `${this.pmnUnmatched.length} note${this.pmnUnmatched.length === 1 ? '' : 's'} in the libraries' folders matched nothing in Plex, Steam or Open Library, so they weren't checked. Its name may differ from the source's (use "Use an existing note…" when a sync offers to create it, or fix its Link), or it's no longer in your library.`,
    })
    const list = contentEl.createEl('ul', { cls: 'pmn-check-unmatched' })
    for (const path of this.pmnUnmatched) {
      const link = list.createEl('li').createEl('a', { text: path.replace(/\.md$/, ''), href: '#' })
      link.addEventListener('click', evt => {
        evt.preventDefault()
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) void this.app.workspace.getLeaf(true).openFile(file)
      })
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
