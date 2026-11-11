import { App, Modal, moment, Setting } from 'obsidian'
import { renderCheckInSteps } from './check-in-steps'
import { LinkSuggest, typingLink } from './link-suggest'
import type { Finished, Reaction } from './reactions'

/** The star scale, lowest first, as the rating buttons show it. */
const RATINGS = ['💣', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '🩷']

export interface ReactionChoices {
  title: string
  /** The day it was finished (YYYY-MM-DD). */
  date: string
  /** Why you wanted it (from "Add something new"), shown to compare. */
  why?: string
  /** The note's rating now, picked to begin with. */
  rating?: string
  feelings: string[]
  /** Themes used in your notes, most used first; those already in this note are shown as kept. */
  themes: string[]
  tags: string[]
  /** What the note already has: shown as such, never removed. */
  has: { feelings: string[], themes: string[], tags: string[] }
  /**
   * For a TV show: the episodes Plex says you watched that day ("S02E01 – Title, …", maybe empty),
   * editable; the line names them and leaves out the rating, which is the show's.
   */
  episodes?: string
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
  private pmnEpisodes: string | undefined
  private pmnAnswered = false
  /** The "Add your own" box's theme not yet added with Enter: added when saving. */
  private pmnOwnTheme: HTMLInputElement | null = null

  constructor(app: App, private readonly pmnChoices: ReactionChoices, private readonly pmnDone: (answer: ReactionAnswer) => void, private readonly pmnInbox = false) {
    super(app)
    this.pmnRating = pmnChoices.rating && RATINGS.includes(pmnChoices.rating) ? pmnChoices.rating : undefined
    this.pmnEpisodes = pmnChoices.episodes
  }

  onOpen(): void {
    const { contentEl } = this
    const c = this.pmnChoices
    this.modalEl.addClass('pmn-reaction')
    this.titleEl.setText(`How was ${c.title}?`)
    if (c.why) contentEl.createEl('p', { cls: 'pmn-review-wanted', text: `You wanted it because: ${c.why}` })
    contentEl.createEl('p', { cls: 'setting-item-description', text: `Everything here is optional. It's added to the note as a reaction for ${c.date}; nothing already there is removed.` })

    if (this.pmnEpisodes !== undefined) {
      new Setting(contentEl)
        .setName('Episodes watched')
        .setDesc(this.pmnEpisodes ? 'From Plex: named in the reaction instead of a rating.' : 'Plex has none of its episodes that day: type them if you like.')
        .addText(text => {
          text.setPlaceholder('Optional').setValue(this.pmnEpisodes ?? '').onChange(value => { this.pmnEpisodes = value })
          text.inputEl.addClass('pmn-reaction-text')
        })
    }

    const ratingSection = this.pmnSection(this.pmnEpisodes !== undefined ? 'Rating for the show' : 'Rating')
    if (this.pmnEpisodes !== undefined) ratingSection.createDiv({ cls: 'setting-item-description', text: 'Goes in the note\'s rating, not in this reaction.' })
    const ratings = ratingSection.createDiv('pmn-reaction-chips')
    const buttons = RATINGS.map(r => {
      const b = ratings.createEl('button', { cls: 'pmn-reaction-chip pmn-reaction-rating', text: r })
      b.addEventListener('click', () => {
        this.pmnRating = this.pmnRating === r ? undefined : r
        buttons.forEach((other, i) => other.toggleClass('is-active', RATINGS[i] === this.pmnRating))
      })
      return b
    })
    buttons.forEach((b, i) => b.toggleClass('is-active', RATINGS[i] === this.pmnRating))

    // Feelings are about this time (this episode, this rewatch): none picked to begin with, any can be.
    this.pmnChips('Feelings', c.feelings, c.has.feelings, this.pmnPicked.feelings, false, true)
    this.pmnOwnTheme = this.pmnChips('Themes', c.themes, c.has.themes, this.pmnPicked.themes, true)
    this.pmnChips('Tags', c.tags, c.has.tags, this.pmnPicked.tags)

    new Setting(contentEl)
      .setName('In a few words')
      .setDesc('Optional: how it felt this time. Your lasting take goes in the note\'s "Notes".')
      .addText(text => {
        text.setPlaceholder('Optional').onChange(value => { this.pmnText = value })
        text.inputEl.addClass('pmn-reaction-text')
        // "[[" looks for a note to link, as in the editor.
        new LinkSuggest(this.app, text.inputEl)
        text.inputEl.addEventListener('keydown', evt => {
          if (evt.key === 'Enter' && !typingLink(text.inputEl)) this.pmnSave()
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

  /**
   * A row of words to tap; those the note already has are marked and can't be untapped. With
   * `own`, a box after them adds a word of your own (Enter), just for this note; it's returned.
   */
  private pmnChips(name: string, words: string[], has: string[], picked: Set<string>, own = false, thisTime = false): HTMLInputElement | null {
    const lower = new Set(has.map(w => w.toLowerCase()))
    const all = [...words, ...has.filter(w => !words.some(x => x.toLowerCase() === w.toLowerCase()))]
    if (!all.length && !own) return null
    const section = this.pmnSection(name)
    if (thisTime) section.createDiv({ cls: 'setting-item-description', text: 'How it felt this time. Underlined ones you\'ve felt about it before.' })
    const row = section.createDiv('pmn-reaction-chips')
    const chips = new Map<string, HTMLButtonElement>()
    const addChip = (word: string, before: HTMLElement | null = null): HTMLButtonElement => {
      const chip = createEl('button', { cls: 'pmn-reaction-chip', text: word })
      row.insertBefore(chip, before)
      chips.set(word.toLowerCase(), chip)
      // Felt before: marked, but picked (or not) for this time like any other.
      if (thisTime && lower.has(word.toLowerCase())) {
        chip.addClass('was-felt')
        chip.setAttr('aria-label', 'You\'ve felt this about it before')
      } else if (lower.has(word.toLowerCase())) {
        chip.addClass('is-kept')
        chip.setAttr('aria-label', 'Already in the note')
        return chip
      }
      chip.addEventListener('click', () => {
        if (picked.has(word)) picked.delete(word)
        else picked.add(word)
        chip.toggleClass('is-active', picked.has(word))
      })
      return chip
    }
    for (const word of all) addChip(word)
    if (!own) return null
    const box = row.createEl('input', { type: 'text', cls: 'pmn-reaction-own', placeholder: 'Add your own…' })
    box.addEventListener('keydown', evt => {
      if (evt.key !== 'Enter') return
      evt.preventDefault()
      const word = box.value.trim()
      box.value = ''
      if (!word) return
      const chip = chips.get(word.toLowerCase()) ?? addChip(word, box)
      if (!lower.has(word.toLowerCase()) && !picked.has(chip.getText())) chip.click()
    })
    return box
  }

  private pmnSave(): void {
    this.pmnFinish({ reaction: {
      date: this.pmnChoices.date,
      rating: this.pmnRating,
      feelings: [...this.pmnPicked.feelings],
      themes: [...this.pmnPicked.themes, ...this.pmnOwnTheme?.value.trim() ? [this.pmnOwnTheme.value.trim()] : []],
      tags: [...this.pmnPicked.tags],
      text: this.pmnText.trim() || undefined,
      ...this.pmnEpisodes !== undefined ? { episodes: this.pmnEpisodes.trim() } : {},
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
  constructor(app: App, private readonly pmnItems: Finished[], private readonly pmnReact: (item: Finished) => Promise<ReactionAnswer>, private readonly pmnClosed?: () => void, private readonly pmnSetAside?: (item: Finished) => Promise<void>) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText('Just finished')
    this.modalEl.addClass('pmn-reaction')
    this.pmnRender()
  }

  onClose(): void {
    this.contentEl.empty()
    this.pmnClosed?.()
  }

  private pmnRender(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('pmn-review')
    renderCheckInSteps(contentEl)
    if (!this.pmnItems.length) {
      contentEl.createEl('p', { cls: 'pmn-review-hint', text: 'Nothing waiting: you\'ve reacted to everything you finished lately.' })
    } else {
      contentEl.createDiv({ cls: 'pmn-review-hint', text: 'Movies, shows you watched (or finished), and games you moved into a Steam collection that finishes them, in the last two weeks.' })
      const head = contentEl.createDiv('pmn-review-section')
      head.createEl('h3', { text: 'To react to' })
      const flow = head.createSpan('pmn-review-flow')
      flow.createSpan({ cls: 'pmn-review-pill', text: 'Plex and Steam' })
      flow.createSpan({ cls: 'pmn-review-arrow', text: '→' })
      flow.createSpan({ cls: ['pmn-review-pill', 'is-obsidian'], text: 'Obsidian: Reactions, Feelings, Themes' })
      const card = contentEl.createDiv('pmn-review-card')
      for (const item of [...this.pmnItems]) {
        const row = card.createDiv('pmn-finished-row')
        const text = row.createDiv('pmn-finished-text')
        text.createEl('strong', { text: item.title })
        if (item.kind === 'game') {
          // A game: the Steam collection's status, when it went in, how long you played.
          if (item.status) text.createSpan({ cls: ['pmn-finished-status', /abandon/i.test(item.status) ? 'is-abandoned' : 'is-completed'], text: item.status })
          text.createDiv({ cls: 'pmn-add-detail', text: [`Game · moved in ${moment.unix(item.viewedAt).format('ddd D MMM')}`, item.playtime ? `${Math.round(item.playtime / 60)} h played` : ''].filter(Boolean).join(' · ') })
        } else if (item.episodes !== undefined) {
          text.createDiv({ cls: 'pmn-add-detail', text: [`TV show · ${moment.unix(item.viewedAt).format('ddd D MMM')}`, item.episodes].filter(Boolean).join(' · ') })
        } else text.createSpan({ cls: 'pmn-add-detail', text: ` ${item.kind === 'show' ? 'TV show, all watched' : 'Movie'} · ${moment.unix(item.viewedAt).format('ddd D MMM')}` })
        // "Not this one": set aside for good (a rewatch is asked about again).
        if (this.pmnSetAside) {
          const setAside = this.pmnSetAside
          row.createEl('button', { text: 'Not this one' }).addEventListener('click', () => {
            void setAside(item).then(() => {
              this.pmnItems.splice(this.pmnItems.indexOf(item), 1)
              this.pmnRender()
            })
          })
        }
        row.createEl('button', { cls: 'mod-cta', text: 'How was it?' }).addEventListener('click', () => {
          void this.pmnReact(item).then(answer => {
            if (answer !== 'later') this.pmnItems.splice(this.pmnItems.indexOf(item), 1)
            this.pmnRender()
          })
        })
      }
    }
    const foot = contentEl.createDiv('pmn-review-foot')
    foot.createSpan({ cls: 'pmn-review-count', text: this.pmnItems.length ? 'Closing keeps them, to answer later.' : '' })
    // Closing keeps them all, to answer later (they're asked about again at the next check-in).
    if (this.pmnItems.length) foot.createEl('button', { text: 'Not now' }).addEventListener('click', () => this.close())
    foot.createEl('button', { cls: 'mod-cta', text: 'Done' }).addEventListener('click', () => this.close())
  }
}
