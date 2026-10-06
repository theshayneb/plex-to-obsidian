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
  label: string
  value: string
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
    const { contentEl } = this
    contentEl.createEl('p', { cls: 'setting-item-description', text: `${position} of ${total}` })
    contentEl.createEl('p').createEl('code', { text: path })
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: create
        ? 'Untick a property to leave it empty in the new note.'
        : 'Untick anything you don\'t want changed.',
    })
    for (const { key, label, value } of lines) {
      const row = contentEl.createEl('label', { cls: 'mod-checkbox' }).createDiv()
      const box = row.createEl('input', { type: 'checkbox' })
      box.checked = true
      box.addEventListener('change', () => {
        if (box.checked) this.pmnExcluded.delete(key)
        else this.pmnExcluded.add(key)
      })
      row.appendText(' ')
      row.createEl('strong', { text: `${label}: ` })
      row.appendText(value)
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

/** A property value as shown in the approval pop-up. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  const text = Array.isArray(value)
    ? (value.length ? value.map(String).join(', ') : '(empty list)')
    : typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
