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

/**
 * Notes in the libraries' folders that match nothing in Plex, Steam or Open Library, shown after
 * a sync or a check (with its summary): each can be opened, or always ignored from then on.
 */
export class UnmatchedModal extends Modal {
  constructor(app: App, private readonly pmnTitle: string, private readonly pmnSummary: string | null,
    private readonly pmnUnmatched: string[], private readonly pmnIgnore: (path: string) => Promise<void>) {
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
        .setDesc(path.split('/').slice(0, -1).join('/'))
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
