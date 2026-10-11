import { App, FuzzySuggestModal, Modal, Setting, TFile, setIcon } from 'obsidian'
import { matchValues, PropertyValueSuggest, vaultPropertyValues, type VaultValues } from './property-suggest'
import type { CoverChoice } from './steamgriddb'

/**
 * 'ignore' is "Skip every time": this item is passed over by every sync until un-ignored in settings.
 * 'merge' ties a new item to a note that already exists (`mergeWith`) instead of creating one.
 */
export type Choice = 'apply' | 'skip' | 'ignore' | 'all' | 'group' | 'stop' | 'merge'

export interface Decision {
  choice: Choice
  /** Keys of the lines that were unticked: those parts are left out. */
  excluded: string[]
  /** Lines whose new value was edited, by key: the text as typed, or a list's remaining items. */
  edits?: Record<string, string | string[]>
  /** For 'merge': the path of the existing note chosen. */
  mergeWith?: string
  /** Labels of the lines marked "Never for this note": never changed in this note again. */
  locked?: string[]
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
  /** Something wrong with what's in the note now, pointed out next to it (a duration that isn't a number). */
  warn?: string
}

/** A property (or the file name) a change leaves alone; editing it in the pop-up changes it too. */
export interface UnchangedLine {
  label: string
  value: string | null
  warn?: string
  /** Set when it can be edited: the key its edit comes back under (`own:<name>`, or `own-file`). */
  key?: string
  edit?: EditKind
  items?: string[]
}

export interface ApprovalRequest {
  action: 'create' | 'change'
  /** The note's path (for a rename, its current path). */
  path: string
  /** What will happen, one line per part. */
  lines: ApprovalLine[]
  /** Something to check before saying yes, shown above the lines (say, which book was found). */
  note?: string
  /** For a change: the note's other properties, which stay as they are, shown below the lines. */
  unchanged?: UnchangedLine[]
  /** Which group of like changes this is in (library, what changes, and where in the group). */
  group?: string
  /** The group's identity, for "Apply to the rest of this group". */
  groupKey?: string
  /** How many of the group come after this one; the button is offered while there are any. */
  groupLeft?: number
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
  /** Labels marked "Never for this note". */
  private readonly pmnLocked = new Set<string>()
  /** The vault's values for each property, read when first needed. */
  private pmnVaultValues: VaultValues | null = null

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
    if (this.pmnRequest.group) contentEl.createEl('p', { cls: 'pmn-approval-group', text: this.pmnRequest.group })
    contentEl.createEl('p').createEl('code', { text: path })
    if (this.pmnRequest.note) contentEl.createEl('p', { cls: 'pmn-approval-note', text: this.pmnRequest.note })
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: create
        ? 'A new note. Edit any value (× removes an item from a list), or untick a property to leave it empty.'
        : 'Edit any new value (× removes an item from a list), or untick anything you don\'t want changed. The lock next to a line means never change that in this note.',
    })

    if (lines.some(line => line.key.startsWith('fix:'))) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'These values differ from the source\'s. Untick any you want to keep as they are (you won\'t be asked about them again); genres offered are the note\'s own that are in "Genres to keep", plus the source\'s.',
      })
    }
    if (lines.some(line => line.key.startsWith('link:'))) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'The note has a link that doesn\'t point to this item, so its own link is offered. Untick it to keep yours (you won\'t be asked about it again).',
      })
    }

    const table = contentEl.createDiv('pmn-approval-scroll').createEl('table', { cls: 'pmn-approval-table' })
    const head = table.createEl('thead').createEl('tr')
    head.createEl('th')
    head.createEl('th', { text: 'Property' })
    if (!create) head.createEl('th', { text: 'Existing' })
    head.createEl('th', { text: create ? 'Value' : 'New' })
    const body = table.createEl('tbody')
    for (const { key, label, current, value, edit, items, required, choices, unticked, warn } of lines) {
      const row = body.createEl('tr')
      const tickCell = row.createEl('td', { cls: 'pmn-approval-tick' })
      const box = tickCell.createEl('input', { type: 'checkbox' })
      box.checked = !unticked
      box.disabled = Boolean(required)
      if (unticked) {
        this.pmnExcluded.add(key)
        row.addClass('pmn-approval-off')
      }
      row.createEl('td', { cls: create ? 'pmn-approval-name' : 'pmn-approval-name pmn-approval-changed', text: label })
      if (!create) cell(row, current ?? null, 'pmn-approval-now', 'Existing', warn)
      const newLabel = create ? 'Value' : 'New'
      const newCell = () => row.createEl('td', { cls: 'pmn-approval-new', attr: { 'data-label': newLabel } })
      let input: HTMLTextAreaElement | HTMLInputElement | null = null
      if (edit === 'list') {
        input = this.pmnListEditor(newCell(), key, items ?? [], undefined, label)
      } else if (edit) {
        const original = value ?? ''
        input = this.pmnTextField(newCell(), label, original, edit, Boolean(choices?.length) || key === 'file')
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
      // "Never for this note": unticked now, and never offered for this note again.
      if (!create) {
        const lock = tickCell.createEl('button', { cls: 'pmn-approval-lock clickable-icon', attr: { 'aria-label': `Never change ${label} in this note` } })
        setIcon(lock, 'lock-open')
        lock.addEventListener('click', evt => {
          evt.preventDefault()
          const locking = !this.pmnLocked.has(label)
          if (locking) this.pmnLocked.add(label)
          else this.pmnLocked.delete(label)
          setIcon(lock, locking ? 'lock' : 'lock-open')
          lock.toggleClass('is-active', locking)
          lock.setAttr('aria-label', locking ? `Never change ${label} in this note (undo)` : `Never change ${label} in this note`)
          box.checked = !locking
          box.disabled = locking || Boolean(required)
          box.dispatchEvent(new Event('change'))
        })
      }
      box.addEventListener('change', () => {
        row.toggleClass('pmn-approval-off', !box.checked)
        if (input) input.disabled = !box.checked
        if (box.checked) this.pmnExcluded.delete(key)
        else this.pmnExcluded.add(key)
      })
    }

    // The rest of the note: nothing changes unless you edit it here.
    for (const { label, value, warn, key, edit, items } of this.pmnRequest.unchanged ?? []) {
      const row = body.createEl('tr', { cls: 'pmn-approval-same' })
      row.createEl('td')
      const name = row.createEl('td', { cls: 'pmn-approval-name', text: label })
      cell(row, value, 'pmn-approval-now', 'Existing', warn)
      const newCell = row.createEl('td', { cls: 'pmn-approval-new', attr: { 'data-label': 'New' } })
      if (!key || !edit) {
        newCell.addClass('pmn-approval-empty')
        newCell.setText('No change')
        continue
      }
      // Edited, it's a change like the others: bold, in the accent colour.
      const mark = () => name.toggleClass('pmn-approval-changed', key in this.pmnEdits)
      if (edit === 'list') {
        this.pmnListEditor(newCell, key, items ?? [], mark, label)
        continue
      }
      const original = value ?? ''
      const field = this.pmnTextField(newCell, label, original, edit, key === 'own-file')
      field.addEventListener('input', () => {
        if (field.value === original) delete this.pmnEdits[key]
        else this.pmnEdits[key] = field.value
        mark()
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
    if (this.pmnRequest.groupKey && this.pmnRequest.groupLeft) {
      buttons.addButton(b => b.setButtonText(`Apply to the rest of this group (${this.pmnRequest.groupLeft})`)
        .setTooltip('Every note left in this group (same library, same properties changing), with the same lines unticked')
        .onClick(() => this.pmnDecide('group')))
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
    // Closed without choosing: skipped, but a lock pressed still counts.
    if (!this.pmnDecided) this.pmnResolve({ choice: 'skip', excluded: [], locked: [...this.pmnLocked] })
  }

  /** Thumbnails under a cover's link: clicking one puts its address in the box. */
  private pmnCoverPicker(field: HTMLTextAreaElement | HTMLInputElement, choices: CoverChoice[]): void {
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
  private pmnListEditor(td: HTMLElement, key: string, original: string[], onChange?: () => void, property?: string): HTMLInputElement {
    let list = [...original]
    const chips = td.createDiv('pmn-approval-chips')
    const add = td.createEl('input', { type: 'text', cls: 'pmn-approval-add', placeholder: 'Add…' })
    // Items already used for this property elsewhere in the vault, as you type.
    const values = property ? this.pmnValuesOf(property) : []
    const suggest = values.length
      ? new PropertyValueSuggest(this.app, add, values, value => {
        add.value = value
        commit()
      }, () => list)
      : null
    const changed = () => {
      if (list.length === original.length && list.every((v, i) => v === original[i])) delete this.pmnEdits[key]
      else this.pmnEdits[key] = [...list]
      onChange?.()
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
      // With suggestions showing, Enter picks the highlighted one instead.
      if (evt.key === 'Enter' && suggest?.pmnShowing && matchValues(values, add.value, list).length) return
      if (evt.key === 'Enter' || evt.key === ',') {
        evt.preventDefault()
        commit()
      }
    })
    add.addEventListener('blur', commit)
    render()
    return add
  }

  /** The vault's values for a property, most used first (none for links, images and such). */
  private pmnValuesOf(property: string): string[] {
    this.pmnVaultValues ??= vaultPropertyValues(this.app)
    const values = this.pmnVaultValues.get(property.toLowerCase()) ?? []
    return values.filter(v => !/^(https?:\/\/|\[\[|!\[)/i.test(v))
  }

  /**
   * A box for a text value: a one-line box offering the values the property already has in the
   * vault (as Obsidian's properties do) when those are short, else a text area for long text.
   */
  private pmnTextField(td: HTMLElement, property: string, original: string, edit: EditKind, plain: boolean): HTMLTextAreaElement | HTMLInputElement {
    const values = plain || edit === 'number' ? [] : this.pmnValuesOf(property)
    const short = (text: string) => text.length <= 80 && !text.includes('\n')
    if (values.length && short(original) && values.every(short)) {
      const field = td.createEl('input', { type: 'text', cls: 'pmn-approval-input' })
      field.value = original
      field.placeholder = 'Empty'
      new PropertyValueSuggest(this.app, field, values, value => {
        field.value = value
        field.dispatchEvent(new Event('input'))
      })
      return field
    }
    const field = td.createEl('textarea', { cls: 'pmn-approval-input' })
    field.value = original
    field.placeholder = 'Empty'
    field.rows = Math.min(10, Math.max(1, Math.ceil(original.length / 70)))
    return field
  }

  private pmnDecide(choice: Choice): void {
    this.pmnDecided = true
    this.pmnResolve({ choice, excluded: [...this.pmnExcluded], edits: { ...this.pmnEdits }, mergeWith: this.pmnMergeWith, locked: [...this.pmnLocked] })
    this.close()
  }
}

export function askApproval(app: App, request: ApprovalRequest): Promise<Decision> {
  return new Promise(resolve => new ApprovalModal(app, request, resolve).open())
}

/** A table cell showing a value, or "empty" in italics. */
function cell(row: HTMLElement, value: string | null, cls: string, label: string, warn?: string): void {
  const td = row.createEl('td', { cls, attr: { 'data-label': label } })
  if (value === null) td.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
  else td.setText(value)
  if (warn) {
    td.addClass('pmn-approval-warn')
    td.createDiv({ cls: 'pmn-approval-warning', text: warn })
  }
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
