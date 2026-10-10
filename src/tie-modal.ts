import { App, Modal, Setting } from 'obsidian'
import { displayName, type PlexItem } from './notes'

/**
 * "Tie this note to a Plex item": asks for the item's Plex link, then ties the open note to it (an
 * album's link lists its songs to pick from), as "Use an existing note" does.
 */
export class TieModal extends Modal {
  constructor(
    app: App,
    private readonly pmnNoteName: string,
    /** The items a link can be tied to: one, or an album's songs. Throws with a reason. */
    private readonly pmnFind: (link: string) => Promise<PlexItem[]>,
    private readonly pmnTie: (item: PlexItem) => Promise<void>,
  ) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText(`Tie "${this.pmnNoteName}" to Plex`)
    this.modalEl.addClass('pmn-explain')
    const { contentEl } = this
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Paste the item\'s Plex link (the address of its page in Plex Web). For a song, its album\'s page will do: you pick the song next. Syncs then treat this note as that item\'s, whatever its name, and never rename it.',
    })
    let link = ''
    const results = contentEl.createDiv('pmn-explain-results')
    const tie = async (item: PlexItem) => {
      await this.pmnTie(item)
      this.close()
    }
    const run = async () => {
      if (!link.trim()) return
      results.empty()
      const status = results.createEl('p', { cls: 'setting-item-description', text: 'Looking it up in Plex…' })
      try {
        const items = await this.pmnFind(link)
        results.empty()
        if (items.length === 1) {
          await tie(items[0])
          return
        }
        results.createEl('p', { text: 'Which song is it?' })
        for (const item of items) {
          new Setting(results)
            .setName(`${item.index ? `${item.index}. ` : ''}${displayName(item)}`)
            .addButton(button => button.setButtonText('Tie').onClick(() => void tie(item)))
        }
      } catch (err) {
        status.setText(err instanceof Error ? err.message : String(err))
      }
    }
    new Setting(contentEl)
      .addText(text => {
        text.setPlaceholder('Plex link').onChange(value => { link = value })
        text.inputEl.addClass('pmn-explain-input')
        text.inputEl.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') void run()
        })
      })
      .addButton(button => button.setButtonText('Look up').setCta().onClick(() => void run()))
    contentEl.appendChild(results)
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
