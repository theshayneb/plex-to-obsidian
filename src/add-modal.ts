import { App, Modal, Notice, Setting } from 'obsidian'
import { addLibrary, type PlexNotesSettings } from './config'
import type { Found } from './discover-data'
import { findItems, itemDetails, type FindKind } from './discover'
import type { PlexItem } from './notes'

const KIND_LABELS: Record<FindKind, string> = {
  movie: 'Movie',
  show: 'TV show',
  game: 'Video game',
  book: 'Book',
}

/** Which library types each kind can be added to. */
const KIND_TARGETS: Record<FindKind, string[]> = {
  movie: ['movie', 'documentary'],
  show: ['tv', 'documentary'],
  game: ['game'],
  book: ['book'],
}

/**
 * "Add something new": search OMDb, Steam, HowLongToBeat or Open Library, pick a result, and hand
 * it (with its full details) to `onPick` with the library chosen.
 */
export class AddModal extends Modal {
  private pmnKind: FindKind = 'movie'
  private pmnLibrary = ''
  private pmnQuery = ''

  constructor(
    app: App,
    private readonly pmnSettings: PlexNotesSettings,
    private readonly pmnSave: () => Promise<void>,
    private readonly pmnPick: (item: PlexItem, libraryKey: string) => Promise<void>,
  ) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Add something new')
    this.modalEl.addClass('pmn-add')
    this.pmnRender()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  /** Libraries this kind can go in, as [key, title]. */
  private pmnLibraries(): [string, string][] {
    if (this.pmnKind === 'game' || this.pmnKind === 'book') addLibrary(this.pmnSettings, this.pmnKind)
    return Object.entries(this.pmnSettings.libraries)
      .filter(([, lib]) => KIND_TARGETS[this.pmnKind].includes(lib.target))
      .map(([key, lib]) => [key, lib.title])
  }

  private pmnRender(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Find something that isn\'t in Plex or Steam yet and make a note for it. You\'re asked before the note is made, as when syncing.',
    })

    const libraries = this.pmnLibraries()
    if (!libraries.some(([key]) => key === this.pmnLibrary)) this.pmnLibrary = libraries[0]?.[0] ?? ''

    new Setting(contentEl)
      .setName('What')
      .addDropdown(dropdown => {
        for (const [value, label] of Object.entries(KIND_LABELS)) dropdown.addOption(value, label)
        dropdown.setValue(this.pmnKind).onChange(value => {
          this.pmnKind = value as FindKind
          this.pmnRender()
        })
      })
    new Setting(contentEl)
      .setName('Add to')
      .setDesc(libraries.length ? 'The library whose folder and properties the note gets.' : 'No library of this type yet: load your Plex libraries in the settings first.')
      .addDropdown(dropdown => {
        for (const [key, title] of libraries) dropdown.addOption(key, title)
        dropdown.setValue(this.pmnLibrary).onChange(value => { this.pmnLibrary = value })
      })

    const results = createDiv('pmn-add-results')
    const search = async () => {
      if (!this.pmnQuery.trim()) return
      results.empty()
      results.createEl('p', { cls: 'setting-item-description', text: 'Searching…' })
      try {
        const found = await findItems(this.pmnKind, this.pmnQuery.trim(), this.pmnSettings.omdbKey ?? '')
        this.pmnShowResults(results, found)
      } catch (err) {
        results.empty()
        results.createEl('p', { text: err instanceof Error ? err.message : String(err) })
      }
    }
    new Setting(contentEl)
      .addText(text => {
        text.setPlaceholder('Title').setValue(this.pmnQuery).onChange(value => { this.pmnQuery = value })
        text.inputEl.addClass('pmn-add-input')
        text.inputEl.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') void search()
        })
        window.setTimeout(() => text.inputEl.focus(), 0)
      })
      .addButton(button => button.setButtonText('Search').setCta().onClick(() => void search()))
    contentEl.appendChild(results)
  }

  private pmnShowResults(results: HTMLElement, found: Found[]): void {
    results.empty()
    if (!found.length) {
      results.createEl('p', { cls: 'setting-item-description', text: 'Nothing found. Try fewer or different words.' })
      return
    }
    for (const result of found) {
      const row = results.createEl('button', { cls: 'pmn-add-result' })
      const thumb = row.createDiv('pmn-add-thumb')
      if (result.thumb) thumb.createEl('img', { attr: { src: result.thumb, alt: '', loading: 'lazy' } })
      const text = row.createDiv('pmn-add-text')
      text.createEl('strong', { text: result.item.title })
      text.createDiv({ cls: 'pmn-add-detail', text: [result.detail, result.source].filter(Boolean).join(' · ') })
      row.addEventListener('click', () => void this.pmnChoose(result))
    }
  }

  private async pmnChoose(result: Found): Promise<void> {
    if (!this.pmnLibrary) {
      new Notice('Choose a library to add it to')
      return
    }
    try {
      const item = await itemDetails(result, this.pmnSettings.omdbKey ?? '', this.pmnSettings.googleBooksKey ?? '')
      await this.pmnSave()
      this.close()
      await this.pmnPick(item, this.pmnLibrary)
    } catch (err) {
      new Notice(`Couldn't add it: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
