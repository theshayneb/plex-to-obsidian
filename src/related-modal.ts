// "Add to Related?": the shows and movies Plex says you watched, offered for their days' daily
// notes' Related property, ticked, to say yes or no to before anything goes in.
import { App, Modal, moment } from 'obsidian'
import type { RelatedOffer } from './config'
import { renderCheckInSteps } from './check-in-steps'

/** 'later' is "Not now"; 'closed' is closed without an answer (Escape). */
export type RelatedAnswer = { yes: RelatedOffer[], no: RelatedOffer[] } | 'later' | 'closed'

export class RelatedModal extends Modal {
  private pmnAnswered = false

  constructor(app: App, private readonly pmnOffers: RelatedOffer[], private readonly pmnProperty: string, private readonly pmnDone: (answer: RelatedAnswer) => void) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Add to your daily notes?')
    this.modalEl.addClass('pmn-related')
    this.modalEl.addClass('pmn-review')
    // A click beside it doesn't close it: only its buttons (or Escape) do.
    this.containerEl.addClass('pmn-related-container')
    const { contentEl } = this
    renderCheckInSteps(contentEl)
    contentEl.createDiv({ cls: 'pmn-review-hint', text: `What Plex and Steam say you watched or played, for each day's ${this.pmnProperty} property. Unticked ones aren't offered again for that day (nor are any, with "None of these"); "Not now" asks again later.` })
    const ticked = new Set(this.pmnOffers)
    const scroll = contentEl.createDiv('pmn-review-scroll')
    const days = new Map<string, RelatedOffer[]>()
    for (const offer of this.pmnOffers) days.set(offer.path, [...days.get(offer.path) ?? [], offer])
    const count = createSpan({ cls: 'pmn-review-count' })
    const add = createEl('button', { cls: 'mod-cta' })
    const counted = () => {
      count.setText(`${ticked.size} link${ticked.size === 1 ? '' : 's'} chosen`)
      add.setText(ticked.size ? `Add ${ticked.size} link${ticked.size === 1 ? '' : 's'}` : 'Done')
    }
    for (const [path, offers] of days) {
      const name = path.split('/').pop()?.replace(/\.md$/, '') ?? path
      const head = scroll.createDiv('pmn-review-section')
      head.createEl('h3', { text: moment.unix(offers[0].viewedAt).format('dddd D MMMM') })
      const sources = [...new Set(offers.map(o => o.kind === 'game' ? 'Steam' : 'Plex'))].join(' and ')
      const flow = head.createSpan('pmn-review-flow')
      flow.createSpan({ cls: 'pmn-review-pill', text: sources })
      flow.createSpan({ cls: 'pmn-review-arrow', text: '→' })
      flow.createSpan({ cls: ['pmn-review-pill', 'is-obsidian'], text: `Obsidian: ${name} · ${this.pmnProperty}` })
      const card = scroll.createDiv('pmn-review-card')
      for (const offer of offers) {
        const row = card.createEl('label', { cls: 'pmn-related-item' })
        const box = row.createEl('input', { type: 'checkbox' })
        box.checked = true
        box.addEventListener('change', () => {
          if (box.checked) ticked.add(offer)
          else ticked.delete(offer)
          counted()
        })
        row.createEl('strong', { text: offer.title })
        const what = offer.kind === 'show' ? 'TV show' : offer.kind === 'game' ? 'Game, last played' : 'Movie'
        row.createSpan({ cls: 'pmn-add-detail', text: `${what} · ${moment.unix(offer.viewedAt).format('HH:mm')} · ${offer.kind === 'game' ? 'Steam' : 'Plex'}` })
      }
    }
    const foot = contentEl.createDiv('pmn-review-foot')
    foot.appendChild(count)
    foot.createEl('button', { text: 'Not now' }).addEventListener('click', () => this.pmnAnswer('later'))
    foot.createEl('button', { text: 'None of these' }).addEventListener('click', () => this.pmnAnswer({ yes: [], no: [...this.pmnOffers] }))
    foot.appendChild(add)
    add.addEventListener('click', () => {
      this.pmnAnswer({ yes: this.pmnOffers.filter(o => ticked.has(o)), no: this.pmnOffers.filter(o => !ticked.has(o)) })
    })
    counted()
  }

  private pmnAnswer(answer: RelatedAnswer): void {
    this.pmnAnswered = true
    this.pmnDone(answer)
    this.close()
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnAnswered) this.pmnDone('closed')
  }
}
