import { App, Modal } from 'obsidian'

/** A yes-or-no question; resolves true for yes, false for no or closing it. */
export function confirm(app: App, title: string, text: string, yes: string): Promise<boolean> {
  return new Promise(resolve => {
    let answered = false
    const modal = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(title)
        this.contentEl.createEl('p', { text })
        const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' })
        buttons.createEl('button', { cls: 'mod-cta', text: yes }).addEventListener('click', () => {
          answered = true
          resolve(true)
          this.close()
        })
        buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close())
      }

      onClose(): void {
        this.contentEl.empty()
        if (!answered) resolve(false)
      }
    })(app)
    modal.open()
  })
}
