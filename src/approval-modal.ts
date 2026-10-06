import { App, Modal, Setting } from 'obsidian'

export type Choice = 'apply' | 'skip' | 'all' | 'stop'

export interface Decision {
  choice: Choice
  /** Keys of the lines that were unticked: those parts are left out. */
  excluded: string[]
}

/** One part of a creation or change, which can be unticked on its own. */
export interface ApprovalLine {
  key: string
  /** The property name, or "File name" for a rename. */
  label: string
  /** What's in the note now (null: empty or missing). Left out for new notes. */
  current?: string | null
  /** What it will be (null: empty). */
  value: string | null
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

/** Asks whether to create or change one note. Closing it without choosing skips the note. */
export class ApprovalModal extends Modal {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  private pmnDecided = false
  private readonly pmnExcluded = new Set<string>()

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
        ? 'A new note. Untick a property to leave it empty.'
        : 'Untick anything you don\'t want changed.',
    })

    const table = contentEl.createDiv('pmn-approval-scroll').createEl('table', { cls: 'pmn-approval-table' })
    const head = table.createEl('thead').createEl('tr')
    head.createEl('th')
    head.createEl('th', { text: 'Property' })
    if (!create) head.createEl('th', { text: 'Now' })
    head.createEl('th', { text: create ? 'Value' : 'New' })
    const body = table.createEl('tbody')
    for (const { key, label, current, value } of lines) {
      const row = body.createEl('tr')
      const box = row.createEl('td').createEl('input', { type: 'checkbox' })
      box.checked = true
      box.addEventListener('change', () => {
        row.toggleClass('pmn-approval-off', !box.checked)
        if (box.checked) this.pmnExcluded.delete(key)
        else this.pmnExcluded.add(key)
      })
      row.createEl('td', { cls: 'pmn-approval-name', text: label })
      if (!create) cell(row, current ?? null, 'pmn-approval-now')
      cell(row, value, 'pmn-approval-new')
    }

    new Setting(contentEl)
      .addButton(b => b.setButtonText(create ? 'Create' : 'Apply').setCta().onClick(() => this.pmnDecide('apply')))
      .addButton(b => b.setButtonText('Skip').onClick(() => this.pmnDecide('skip')))
      .addButton(b => b.setButtonText(create ? 'Create all the rest' : 'Apply to all the rest')
        .setTooltip('With the same lines unticked')
        .onClick(() => this.pmnDecide('all')))
      .addButton(b => b.setButtonText('Stop').setWarning().onClick(() => this.pmnDecide('stop')))
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.pmnDecided) this.pmnResolve({ choice: 'skip', excluded: [] })
  }

  private pmnDecide(choice: Choice): void {
    this.pmnDecided = true
    this.pmnResolve({ choice, excluded: [...this.pmnExcluded] })
    this.close()
  }
}

export function askApproval(app: App, request: ApprovalRequest): Promise<Decision> {
  return new Promise(resolve => new ApprovalModal(app, request, resolve).open())
}

/** A table cell showing a value, or "empty" in italics. */
function cell(row: HTMLElement, value: string | null, cls: string): void {
  const td = row.createEl('td', { cls })
  if (value === null) td.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
  else td.setText(value)
}

/** A property value as shown in the approval pop-up; null when it's empty. */
export function describeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}
