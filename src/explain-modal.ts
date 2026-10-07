import { App, Modal, Setting } from 'obsidian'

/** Asks for a Plex or Steam link (or a title) and shows what a sync does with that item, and why. */
export class ExplainModal extends Modal {
  constructor(app: App, private readonly pmnExplain: (query: string, progress: (message: string) => void) => Promise<string[][]>) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Explain an item')
    this.modalEl.addClass('pmn-explain')
    const { contentEl } = this
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Paste a Plex link (the address of the item\'s page in Plex Web) or a Steam Store link, or type part of a title. Nothing is changed.',
    })
    let query = ''
    const results = contentEl.createDiv('pmn-explain-results')
    const run = async () => {
      if (!query.trim()) return
      results.empty()
      const status = results.createEl('p', { cls: 'setting-item-description', text: 'Checking…' })
      try {
        const reports = await this.pmnExplain(query, message => status.setText(message))
        results.empty()
        for (const [heading, ...paragraphs] of reports) {
          const block = results.createDiv('pmn-explain-report')
          block.createEl('strong', { text: heading })
          for (const text of paragraphs) block.createEl('p', { text })
        }
      } catch (err) {
        results.empty()
        results.createEl('p', { text: `Couldn't check: ${err instanceof Error ? err.message : String(err)}` })
      }
    }
    new Setting(contentEl)
      .addText(text => {
        text.setPlaceholder('Link or title').onChange(value => { query = value })
        text.inputEl.addClass('pmn-explain-input')
        text.inputEl.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') void run()
        })
      })
      .addButton(button => button.setButtonText('Explain').setCta().onClick(() => void run()))
    contentEl.appendChild(results)
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
