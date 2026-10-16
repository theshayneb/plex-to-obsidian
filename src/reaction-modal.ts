import { App, Modal, moment, Setting } from 'obsidian'
import type { Finished, Reaction } from './reactions'

/** The star scale, lowest first, as the rating buttons show it. */
const RATINGS = ['💣', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '🩷']

export interface ReactionChoices {
  title: string
  /** The day it was finished (YYYY-MM-DD). */
  date: string
  /** The note's rating now, picked to begin with. */
  rating?: string
  feelings: string[]
  /** Themes used in your notes, most used first; those already in this note are shown as kept. */
  themes: string[]
  tags: string[]
  /** What the note already has: shown as such, never removed. */
  has: { feelings: string[], themes: string[], tags: string[] }
}

/** What the pop-up ended with: a reaction, "not now" (asked again later) or "don't ask" about this one. */
export type ReactionAnswer = { reaction: Reaction } | 'later' | 'never'

/**
 * "How was it?": a rating, feelings, themes and your own tags to tap, and a few words if you like.
 * Everything is optional; nothing in the note is removed.
 */
export class ReactionModal extends Modal {
  private pmnRating: string | undefined
  private readonly pmnPicked = { feelings: new Set<string>(), themes: new Set<string>(), tags: new Set<string>() }
  private pmnText = ''
  private pmnAnswered = false

  constructor(app: App, private readonly pmnChoices: ReactionChoices, private readonly pmnDone: (answer: ReactionAnswer) => void, private readonly pmnInbox = false) {
    super(app)
    this.pmnRating = pmnChoices.rating && RATINGS.includes(pmnChoices.rating) ? pmnChoices.rating : undefined
  }

  onOpen(): void {
    const { contentEl } = this
    const c = this.pmnChoices
    this.modalEl.addClass('pmn-reaction')
    this.titleEl.setText(`How was ${c.title}?`)
    contentEl.createEl('p', { cls: 'setting-item-description', text: `Everything here is optional. It's added to the note as a reaction for ${c.date}; nothing already there is removed.` })

    const ratings = this.pmnSection('Rating').createDiv('pmn-reaction-chips')
    const buttons = RATINGS.map(r => {
      const b = ratings.createEl('button', { cls: 'pmn-reaction-chip pmn-reaction-rating', text: r })
      b.addEventListener('click', () => {
        this.pmnRating = this.pmnRating === r ? undefined : r
        buttons.forEach((other, i) => other.toggleClass('is-active', RATINGS[i] === this.pmnRating))
      })
      return b
    })
    buttons.forEach((b, i) => b.toggleClass('is-active', RATINGS[i] === this.pmnRating))

    this.pmnChips('Feelings', c.feelings, c.has.feelings, this.pmnPicked.feelings)
    this.pmnChips('Themes', c.themes, c.has.themes, this.pmnPicked.themes)
    this.pmnChips('Tags', c.tags, c.has.tags, this.pmnPicked.tags)

    new Setting(contentEl)
      .setName('In a few words')
      .addText(text => {
        text.setPlaceholder('Optional').onChange(value => { this.pmnText = value })
        text.inputEl.addClass('pmn-reaction-text')
        text.inputEl.addEventListener('keydown', evt => {
          if (evt.key === 'Enter') this.pmnSave()
        })
      })

    const actions = new Setting(contentEl)
    if (this.pmnInbox) {
      actions.addButton(b => b.setButtonText('Don\'t ask about this').onClick(() => this.pmnFinish('never')))
      actions.addButton(b => b.setButtonText('Not now').onClick(() => this.pmnFinish('later')))
    }
    actions.addButton(b => b.setButtonText('Save').setCta().onClick(() => this.pmnSave()))
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnAnswered) {
      this.pmnAnswered = true
      this.pmnDone('later')
    }
  }

  private pmnSection(name: string): HTMLElement {
    const section = this.contentEl.createDiv('pmn-reaction-section')
    section.createDiv({ cls: 'pmn-reaction-label', text: name })
    return section
  }

  /** A row of words to tap; those the note already has are marked and can't be untapped. */
  private pmnChips(name: string, words: string[], has: string[], picked: Set<string>): void {
    const lower = new Set(has.map(w => w.toLowerCase()))
    const all = [...words, ...has.filter(w => !words.some(x => x.toLowerCase() === w.toLowerCase()))]
    if (!all.length) return
    const row = this.pmnSection(name).createDiv('pmn-reaction-chips')
    for (const word of all) {
      const chip = row.createEl('button', { cls: 'pmn-reaction-chip', text: word })
      if (lower.has(word.toLowerCase())) {
        chip.addClass('is-kept')
        chip.setAttr('aria-label', 'Already in the note')
        continue
      }
      chip.addEventListener('click', () => {
        if (picked.has(word)) picked.delete(word)
        else picked.add(word)
        chip.toggleClass('is-active', picked.has(word))
      })
    }
  }

  private pmnSave(): void {
    this.pmnFinish({ reaction: {
      date: this.pmnChoices.date,
      rating: this.pmnRating,
      feelings: [...this.pmnPicked.feelings],
      themes: [...this.pmnPicked.themes],
      tags: [...this.pmnPicked.tags],
      text: this.pmnText.trim() || undefined,
    } })
  }

  private pmnFinish(answer: ReactionAnswer): void {
    if (this.pmnAnswered) return
    this.pmnAnswered = true
    this.pmnDone(answer)
    this.close()
  }
}

/** "Just finished": what you finished lately, each to react to (or set aside), one at a time. */
export class FinishedModal extends Modal {
  constructor(app: App, private readonly pmnItems: Finished[], private readonly pmnReact: (item: Finished) => Promise<ReactionAnswer>) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Just finished')
    this.modalEl.addClass('pmn-reaction')
    this.pmnRender()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private pmnRender(): void {
    const { contentEl } = this
    contentEl.empty()
    if (!this.pmnItems.length) {
      contentEl.createEl('p', { cls: 'setting-item-description', text: 'Nothing waiting: you\'ve reacted to everything you finished lately.' })
      return
    }
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Pick one to say how it was. "Not now" keeps it here for later.' })
    for (const item of [...this.pmnItems]) {
      const row = contentEl.createEl('button', { cls: 'pmn-reaction-item' })
      row.createEl('strong', { text: item.title })
      row.createSpan({ cls: 'pmn-add-detail', text: ` · ${item.kind === 'show' ? 'TV show, all watched' : 'Movie'} · ${moment.unix(item.viewedAt).format('ddd D MMM')}` })
      row.addEventListener('click', () => {
        void this.pmnReact(item).then(answer => {
          if (answer !== 'later') this.pmnItems.splice(this.pmnItems.indexOf(item), 1)
          this.pmnRender()
        })
      })
    }
  }
}
