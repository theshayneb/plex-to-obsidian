// "Add to Related?": the shows and movies Plex says you watched, offered for their days' daily
// notes' Related property, ticked, to say yes or no to before anything goes in.
import { App, Modal, moment } from 'obsidian'
import type { RelatedOffer } from './config'

export type RelatedAnswer = { yes: RelatedOffer[], no: RelatedOffer[] } | 'later'

export class RelatedModal extends Modal {
  private pmnAnswered = false

  constructor(app: App, private readonly pmnOffers: RelatedOffer[], private readonly pmnProperty: string, private readonly pmnDone: (answer: RelatedAnswer) => void) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Add to your daily notes?')
    this.modalEl.addClass('pmn-related')
    const { contentEl } = this
    contentEl.createEl('p', { cls: 'setting-item-description', text: `Plex says you watched these. Ticked ones are added to ${this.pmnProperty} in that day's daily note; unticked ones aren't offered again. "Not now" keeps them all for later.` })
    const ticked = new Set(this.pmnOffers)
    let day = ''
    for (const offer of this.pmnOffers) {
      const name = offer.path.split('/').pop()?.replace(/\.md$/, '') ?? offer.path
      if (offer.path !== day) {
        day = offer.path
        contentEl.createDiv({ cls: 'pmn-related-day', text: `${moment.unix(offer.viewedAt).format('dddd D MMMM')} · ${name}` })
      }
      const row = contentEl.createEl('label', { cls: 'pmn-related-item' })
      const box = row.createEl('input', { type: 'checkbox' })
      box.checked = true
      box.addEventListener('change', () => {
        if (box.checked) ticked.add(offer)
        else ticked.delete(offer)
      })
      row.createEl('strong', { text: offer.title })
      row.createSpan({ cls: 'pmn-add-detail', text: ` · ${offer.kind === 'show' ? 'TV show' : 'Movie'} · ${moment.unix(offer.viewedAt).format('HH:mm')}` })
    }
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' })
    buttons.createEl('button', { cls: 'mod-cta', text: 'Add the ticked ones' }).addEventListener('click', () => {
      this.pmnAnswer({ yes: this.pmnOffers.filter(o => ticked.has(o)), no: this.pmnOffers.filter(o => !ticked.has(o)) })
    })
    buttons.createEl('button', { text: 'Not now' }).addEventListener('click', () => this.pmnAnswer('later'))
  }

  private pmnAnswer(answer: RelatedAnswer): void {
    this.pmnAnswered = true
    this.pmnDone(answer)
    this.close()
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnAnswered) this.pmnDone('later')
  }
}
