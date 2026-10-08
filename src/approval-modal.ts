import { App, FuzzySuggestModal, Modal, Setting, TFile } from 'obsidian'
import type { CoverChoice } from './steamgriddb'

/**
 * 'ignore' is "Skip every time": this item is passed over by every sync until un-ignored in settings.
 * 'merge' ties a new item to a note that already exists (`mergeWith`) instead of creating one.
 */
export type Choice = 'apply' | 'skip' | 'ignore' | 'all' | 'stop' | 'merge'

export interface Decision {
  choice: Choice
  /** Keys of the lines that were unticked: those parts are left out. */
  excluded: string[]
  /** Lines whose new value was edited, by key: the text as typed, or a list's remaining items. */
  edits?: Record<string, string | string[]>
  /** For 'merge': the path of the existing note chosen. */
  mergeWith?: string
}

/** How an editable value is typed: plain text, a comma-separated list, or a number. */
export type EditKind = 'text' | 'list' | 'number'

/** One part of a creation or change, which can be unticked on its own. */
export interface ApprovalLine {
  key: string
  /** The property name, or "File name" for a rename. */
  label: string
  /** What's in the note now (null: empty or missing). Left out for new notes. */
  current?: string | null
  /** What it will be (null: empty). */
  value: string | null
  /** Set when the new value can be edited in the pop-up. */
  edit?: EditKind
  /** A list's items, for editing it item by item. */
  items?: string[]
  /** Can't be unticked (a new note's file name). */
  required?: boolean
  /** Starts unticked: offered, but only done if ticked (replacing a link already in the note). */
  unticked?: boolean
  /** Images to pick from for the value (game covers). */
  choices?: CoverChoice[]
}

export interface ApprovalRequest {
  action: 'create' | 'change'
  /** The note's path (for a rename, its current path). */
  path: string
  /** What will happen, one line per part. */
  lines: ApprovalLine[]
  position: number
  total: number
}

export type Approver = (request: ApprovalRequest) => Promise<Decision>

/** An existing note whose name matches several items: which is it for? */
export interface OwnerRequest {
  path: string
  candidates: { key: string, name: string, library: string }[]
}

/** The chosen item's key, 'none' for none of them, or null to leave the note alone this time. */
export type OwnerChooser = (request: OwnerRequest) => Promise<string | null>

/** Asks whether to create or change one note. Closing it without choosing skips the note. */
export class ApprovalModal extends Modal {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  private pmnDecided = false
  private readonly pmnExcluded = new Set<string>()
  private readonly pmnEdits: Record<string, string | string[]> = {}
  private pmnMergeWith?: string

  constructor(app: App, private readonly pmnRequest: ApprovalRequest, private readonly pmnResolve: (d: Decision) => void) {
    super(app)
  }

  onOpen(): void {
    const { action, path, lines, position, total } = this.pmnRequest
    const create = action === 'create'
    this.titleEl.setText(create ? 'Create this note?' : 'Change this note?')
    this.modalEl.addClass('pmn-approval')
    const { contentEl } = this
    contentEl.createEl('p', { cls: 'setting-item-description', text: `${position} of ${total}` })
    contentEl.createEl('p').createEl('code', { text: path })
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: create
        ? 'A new note. Edit any value (× removes an item from a list), or untick a property to leave it empty.'
        : 'Edit any new value (× removes an item from a list), or untick anything you don\'t want changed.',
    })

    if (lines.some(line => line.key.startsWith('link:'))) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'The note has a link that doesn\'t point to this item, so its own link is offered. A search link is replaced unless you untick it; any other link is kept unless you tick it. A link you keep isn\'t offered for replacing again.',
      })
    }

    const table = contentEl.createDiv('pmn-approval-scroll').createEl('table', { cls: 'pmn-approval-table' })
    const head = table.createEl('thead').createEl('tr')
    head.createEl('th')
    head.createEl('th', { text: 'Property' })
    if (!create) head.createEl('th', { text: 'Now' })
    head.createEl('th', { text: create ? 'Value' : 'New' })
    const body = table.createEl('tbody')
    for (const { key, label, current, value, edit, items, required, choices, unticked } of lines) {
      const row = body.createEl('tr')
      const box = row.createEl('td').createEl('input', { type: 'checkbox' })
      box.checked = !unticked
      box.disabled = Boolean(required)
      if (unticked) {
        this.pmnExcluded.add(key)
        row.addClass('pmn-approval-off')
      }
      row.createEl('td', { cls: 'pmn-approval-name', text: label })
      if (!create) cell(row, current ?? null, 'pmn-approval-now', 'Now')
      const newLabel = create ? 'Value' : 'New'
      const newCell = () => row.createEl('td', { cls: 'pmn-approval-new', attr: { 'data-label': newLabel } })
      let input: HTMLTextAreaElement | HTMLInputElement | null = null
      if (edit === 'list') {
        input = this.pmnListEditor(newCell(), key, items ?? [])
      } else if (edit) {
        const original = value ?? ''
        input = newCell().createEl('textarea', { cls: 'pmn-approval-input' })
        input.value = original
        input.placeholder = 'Empty'
        input.rows = Math.min(10, Math.max(1, Math.ceil(original.length / 70)))
        const field = input
        field.addEventListener('input', () => {
          if (field.value === original) delete this.pmnEdits[key]
          else this.pmnEdits[key] = field.value
        })
        if (choices?.length) this.pmnCoverPicker(field, choices)
        if (unticked) field.disabled = true
      } else {
        cell(row, value, 'pmn-approval-new', newLabel)
      }
      box.addEventListener('change', () => {
        row.toggleClass('pmn-approval-off', !box.checked)
        if (input) input.disabled = !box.checked
        if (box.checked) this.pmnExcluded.delete(key)
        else this.pmnExcluded.add(key)
      })
    }

    const buttons = new Setting(contentEl)
      .addButton(b => b.setButtonText(create ? 'Create' : 'Apply').setCta().onClick(() => this.pmnDecide('apply')))
      .addButton(b => b.setButtonText('Skip').onClick(() => this.pmnDecide('skip')))
    if (create) {
      buttons.addButton(b => b.setButtonText('Use an existing note…')
        .setTooltip('Fill in a note you already have for this instead, and match it from now on')
        .onClick(() => new NotePickerModal(this.app, file => {
          this.pmnMergeWith = file.path
          this.pmnDecide('merge')
        }).open()))
    }
    buttons
      .addButton(b => b.setButtonText('Skip every time')
        .setTooltip('Never create or change a note for this item; undo in settings')
        .onClick(() => this.pmnDecide('ignore')))
      .addButton(b => b.setButtonText(create ? 'Create all the rest' : 'Apply to all the rest')
        .setTooltip('With the same lines unticked')
        .onClick(() => this.pmnDecide('all')))
      .addButton(b => b.setButtonText('Stop').setWarning().onClick(() => this.pmnDecide('stop')))
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnDecided) this.pmnResolve({ choice: 'skip', excluded: [] })
  }

  /** Thumbnails under a cover's link: clicking one puts its address in the box. */
  private pmnCoverPicker(field: HTMLTextAreaElement, choices: CoverChoice[]): void {
    const picker = field.parentElement!.createDiv('pmn-approval-covers')
    const tiles: HTMLElement[] = []
    const mark = () => tiles.forEach((tile, i) => tile.toggleClass('is-selected', choices[i].url === field.value.trim()))
    choices.forEach(choice => {
      const tile = picker.createEl('button', { cls: 'pmn-approval-cover', attr: { 'aria-label': `Use the ${choice.label} cover` } })
      tile.createEl('img', { attr: { src: choice.thumb, alt: choice.label, loading: 'lazy' } })
      tile.createSpan({ text: choice.label })
      tile.addEventListener('click', evt => {
        evt.preventDefault()
        if (field.disabled) return
        field.value = choice.url
        field.dispatchEvent(new Event('input'))
        mark()
      })
      tiles.push(tile)
    })
    field.addEventListener('input', mark)
    mark()
  }

  /** A list as removable chips, plus a box to add items (Enter or comma). Returns the add box. */
  private pmnListEditor(td: HTMLElement, key: string, original: string[]): HTMLInputElement {
    let list = [...original]
    const chips = td.createDiv('pmn-approval-chips')
    const add = td.createEl('input', { type: 'text', cls: 'pmn-approval-add', placeholder: 'Add…' })
    const changed = () => {
      if (list.length === original.length && list.every((v, i) => v === original[i])) delete this.pmnEdits[key]
      else this.pmnEdits[key] = [...list]
    }
    const render = () => {
      chips.empty()
      if (!list.length) chips.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
      list.forEach((item, i) => {
        const chip = chips.createSpan({ cls: 'pmn-approval-chip', text: item })
        const remove = chip.createEl('button', { cls: 'pmn-approval-chip-remove', text: '×' })
        remove.setAttr('aria-label', `Remove ${item}`)
        remove.addEventListener('click', evt => {
          evt.preventDefault()
          if (add.disabled) return
          list = list.filter((_, j) => j !== i)
          changed()
          render()
        })
      })
    }
    const commit = () => {
      const parts = add.value.split(',').map(p => p.trim()).filter(p => p && !list.includes(p))
      if (!parts.length) return
      list = [...list, ...parts]
      add.value = ''
      changed()
      render()
    }
    add.addEventListener('keydown', evt => {
      if (evt.key === 'Enter' || evt.key === ',') {
        evt.preventDefault()
        commit()
      }
    })
    add.addEventListener('blur', commit)
    render()
    return add
  }

  private pmnDecide(choice: Choice): void {
    this.pmnDecided = true
    this.pmnResolve({ choice, excluded: [...this.pmnExcluded], edits: { ...this.pmnEdits }, mergeWith: this.pmnMergeWith })
    this.close()
  }
}

export function askApproval(app: App, request: ApprovalRequest): Promise<Decision> {
  return new Promise(resolve => new ApprovalModal(app, request, resolve).open())
}

/** A table cell showing a value, or "empty" in italics. */
function cell(row: HTMLElement, value: string | null, cls: string, label: string): void {
  const td = row.createEl('td', { cls, attr: { 'data-label': label } })
  if (value === null) td.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
  else td.setText(value)
}

/** How a property value is edited in the pop-up. */
export function editKind(value: unknown): EditKind {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  return 'text'
}

/** Turns an edited value back into a property value: a list, a number, text, or null when cleared. */
export function parseEdit(text: string | string[], kind: EditKind): string | number | string[] | null {
  if (Array.isArray(text)) return text
  const trimmed = text.trim()
  if (kind === 'list') return trimmed.split(',').map(part => part.trim()).filter(Boolean)
  if (!trimmed) return null
  if (kind === 'number' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return trimmed
}

/** A property value as shown in the approval pop-up; null when it's empty. */
export function describeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
  return text
}

/** Asks which of several items an existing note is for. Closing it leaves the note alone. */
export class OwnerModal extends Modal {
  private pmnDecided = false

  constructor(app: App, private readonly pmnRequest: OwnerRequest, private readonly pmnResolve: (choice: string | null) => void) {
    super(app)
  }

  onOpen(): void {
    const { path, candidates } = this.pmnRequest
    this.titleEl.setText('Which item is this note for?')
    const { contentEl } = this
    contentEl.createEl('p').createEl('code', { text: path })
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Its name matches more than one item, so the plugin can\'t tell which one it\'s for. The item you pick is treated as this note\'s (you\'ll still be asked before anything changes); the others get their own notes.',
    })
    for (const { key, name, library } of candidates) {
      new Setting(contentEl)
        .setName(name)
        .setDesc(library)
        .addButton(b => b.setButtonText('This one').setCta().onClick(() => this.pmnDecide(key)))
    }
    new Setting(contentEl)
      .addButton(b => b.setButtonText('None of these').onClick(() => this.pmnDecide('none')))
      .addButton(b => b.setButtonText('Skip').onClick(() => this.pmnDecide(null)))
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnDecided) this.pmnResolve(null)
  }

  private pmnDecide(choice: string | null): void {
    this.pmnDecided = true
    this.pmnResolve(choice)
    this.close()
  }
}

export function askOwner(app: App, request: OwnerRequest): Promise<string | null> {
  return new Promise(resolve => new OwnerModal(app, request, resolve).open())
}

/** Search for a note in the vault, for "Use an existing note". */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly pmnChosen: (file: TFile) => void) {
    super(app)
    this.setPlaceholder('Find the note this is for')
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles()
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/, '')
  }

  onChooseItem(file: TFile): void {
    this.pmnChosen(file)
  }
}
