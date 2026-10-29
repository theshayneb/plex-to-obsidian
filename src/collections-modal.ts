// "Send collections to Plex?": the collections your notes ask for and what each would change,
// to tick before anything is sent.
import { App, Modal } from 'obsidian'
import type { CollectionPlan } from './plex-collections'

export class CollectionsModal extends Modal {
  private pmnAnswered = false

  constructor(
    app: App,
    private readonly pmnPlans: CollectionPlan[],
    private readonly pmnLeftOut: { path: string, reason: string }[],
    private readonly pmnDone: (chosen: CollectionPlan[] | null) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Send collections to Plex?')
    this.modalEl.addClass('pmn-related')
    const { contentEl } = this
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Each collection ends up holding just the notes that name it (or have its tag). Untick any to leave as it is in Plex.' })
    const ticked = new Set(this.pmnPlans)
    for (const plan of this.pmnPlans) {
      const head = contentEl.createEl('label', { cls: 'pmn-related-item pmn-collection-head' })
      const box = head.createEl('input', { type: 'checkbox' })
      box.checked = true
      box.addEventListener('change', () => {
        if (box.checked) ticked.add(plan)
        else ticked.delete(plan)
      })
      head.createEl('strong', { text: plan.name })
      head.createSpan({ cls: 'pmn-add-detail', text: ` · ${plan.library} · ${plan.existing ? 'in Plex already' : 'new'}${plan.auto ? ' · by tag' : ''}` })
      const list = contentEl.createEl('ul', { cls: 'pmn-collection-changes' })
      for (const a of plan.add) list.createEl('li', { text: `+ ${a.title}` })
      for (const r of plan.remove) list.createEl('li', { cls: 'pmn-collection-remove', text: `− ${r.title}` })
    }
    if (this.pmnLeftOut.length) {
      contentEl.createDiv({ cls: 'pmn-related-day', text: 'Left out' })
      const list = contentEl.createEl('ul', { cls: 'pmn-collection-changes' })
      for (const l of this.pmnLeftOut) {
        const name = l.path ? l.path.split('/').pop()!.replace(/\.md$/, '') : ''
        list.createEl('li', { cls: 'pmn-collection-remove', text: name ? `${name}: ${l.reason}` : l.reason })
      }
    }
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' })
    buttons.createEl('button', { cls: 'mod-cta', text: 'Send to Plex' }).addEventListener('click', () => this.pmnAnswer(this.pmnPlans.filter(p => ticked.has(p))))
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.pmnAnswer(null))
  }

  private pmnAnswer(chosen: CollectionPlan[] | null): void {
    this.pmnAnswered = true
    this.pmnDone(chosen)
    this.close()
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnAnswered) this.pmnDone(null)
  }
}
