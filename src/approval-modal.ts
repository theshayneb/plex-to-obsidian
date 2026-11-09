import { App, FuzzySuggestModal, Menu, Modal, Setting, TFile, setIcon } from 'obsidian'
import { renderCheckInSteps } from './check-in-steps'
import { LinkSuggest } from './link-suggest'
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
  /** Where the new value comes from ("Plex", "Last.fm", "This note"), shown under it. */
  source?: string
  /** Where it's written ("This note", "Plex", "Music file"), shown under the property's name. */
  writesTo?: string
  /**
   * Other sources' values for the same property that aren't offered (the same as the note's, or
   * lower), shown in their own column beside the offered ones for comparison.
   */
  also?: { source: string, value: string | null, note: string }[]
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
    // A change to a note you have: the cards (since 0.0.194). A new note keeps its table.
    if (this.pmnRequest.action === 'change') {
      this.pmnReview()
      return
    }
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

    // A property more than one source has a value for is one row, with a column per source.
    const intoNote = (line: ApprovalLine) => !create && (line.writesTo ?? 'This note') === 'This note' && Boolean(line.source)
    const rows: ApprovalLine[][] = []
    for (const line of lines) {
      const same = intoNote(line) ? rows.find(r => intoNote(r[0]) && r[0].label === line.label) : undefined
      if (same) same.push(line)
      else rows.push([line])
    }
    const width = (row: ApprovalLine[]) => row.length + (row[0].also?.length ?? 0)
    const columns = Math.max(1, ...rows.map(width))
    const several = rows.filter(row => width(row) > 1).map(row => row[0].label)

    const table = contentEl.createDiv('pmn-approval-scroll').createEl('table', { cls: columns > 1 ? ['pmn-approval-table', `pmn-approval-cols-${Math.min(columns, 3)}`] : 'pmn-approval-table' })
    const head = table.createEl('thead').createEl('tr')
    head.createEl('th')
    head.createEl('th', { text: 'Property' })
    if (!create) head.createEl('th', { text: 'Current' })
    head.createEl('th', { text: create ? 'Value' : 'New', attr: { colspan: String(columns) } })
    const body = table.createEl('tbody')
    if (several.length) {
      contentEl.insertBefore(createEl('p', {
        cls: 'setting-item-description',
        text: `${several.join(', ')}: more than one source has a value, each in its own column. Tick the one to write to the note.${lines.some(l => l.source === 'Last.fm') ? ' Leave Last.fm\'s unticked and it isn\'t offered for this song again, unless it gains plays Plex doesn\'t know about; Plex\'s count still updates.' : ''}`,
      }), table.parentElement)
    }
    for (const row of rows) {
      const tr = body.createEl('tr')
      const tickCell = tr.createEl('td', { cls: 'pmn-approval-tick' })
      const { label, current, warn, writesTo } = row[0]
      const nameCell = tr.createEl('td', { cls: create ? 'pmn-approval-name' : 'pmn-approval-name pmn-approval-changed', text: label })
      if (writesTo && !create) nameCell.createDiv({ cls: 'pmn-approval-where', text: `Writes to: ${writesTo}` })
      if (!create) cell(tr, current ?? null, 'pmn-approval-now', 'Current', warn)
      const newLabel = create ? 'Value' : 'New'
      const options: { box: HTMLInputElement, line: ApprovalLine, input: HTMLTextAreaElement | HTMLInputElement | null, td: HTMLElement }[] = []
      const refresh = () => {
        tr.toggleClass('pmn-approval-off', options.every(o => !o.box.checked))
        for (const o of options) {
          if (o.input) o.input.disabled = !o.box.checked
          o.td.toggleClass('pmn-approval-off-option', !o.box.checked)
          if (o.box.checked) this.pmnExcluded.delete(o.line.key)
          else this.pmnExcluded.add(o.line.key)
        }
      }
      const split = width(row) > 1
      // Plex first, then the other sources by name.
      const order = (source?: string) => `${source === 'Plex' ? 0 : 1}${source ?? ''}`
      const cells: ({ line: ApprovalLine } | { other: NonNullable<ApprovalLine['also']>[number] })[] = [...row.map(line => ({ line })), ...(row[0].also ?? []).map(other => ({ other }))]
      if (split) cells.sort((a, b) => order('line' in a ? a.line.source : a.other.source).localeCompare(order('line' in b ? b.line.source : b.other.source)))
      for (const c of cells) {
        if (!('line' in c)) {
          const { other } = c
          const td = tr.createEl('td', { cls: 'pmn-approval-new pmn-approval-also', attr: { 'data-label': other.source } })
          td.createDiv({ cls: 'pmn-approval-source', text: other.source })
          if (other.value === null) td.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
          else td.createDiv({ text: other.value })
          td.createDiv({ cls: 'pmn-approval-where', text: other.note })
          continue
        }
        const { line } = c
        const td = tr.createEl('td', { cls: 'pmn-approval-new', attr: { 'data-label': split ? line.source ?? newLabel : newLabel } })
        if (!split && columns > 1) td.setAttr('colspan', String(columns))
        let box: HTMLInputElement
        if (split) {
          // Each source's value in its own column, headed by its name with its own tick box.
          const top = td.createEl('label', { cls: 'pmn-approval-source' })
          box = top.createEl('input', { type: 'checkbox' })
          top.createSpan({ text: line.source ?? '' })
        } else {
          box = tickCell.createEl('input', { type: 'checkbox' })
        }
        box.checked = !line.unticked
        box.disabled = Boolean(line.required)
        const option = { box, line, input: this.pmnValue(td, line), td }
        options.push(option)
        if (!split && line.source) td.createDiv({ cls: 'pmn-approval-where', text: `From: ${line.source}` })
        box.addEventListener('change', () => {
          // One source's value at a time: ticking one unticks the others.
          if (box.checked && split) for (const o of options) if (o !== option) o.box.checked = false
          refresh()
        })
      }
      refresh()
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
          for (const o of options) {
            o.box.checked = !locking && !o.line.unticked
            o.box.disabled = locking || Boolean(o.line.required)
          }
          refresh()
        })
      }
    }

    // The rest of the note: nothing changes unless you edit it here.
    for (const { label, value, warn, key, edit, items } of this.pmnRequest.unchanged ?? []) {
      const row = body.createEl('tr', { cls: 'pmn-approval-same' })
      row.createEl('td')
      const name = row.createEl('td', { cls: 'pmn-approval-name', text: label })
      cell(row, value, 'pmn-approval-now', 'Current', warn)
      const newCell = row.createEl('td', { cls: 'pmn-approval-new', attr: { 'data-label': 'New', colspan: String(columns) } })
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

  /** The count on the Apply button, kept current as choices change. */
  private pmnApply: HTMLButtonElement | null = null
  private pmnCount: HTMLElement | null = null

  /**
   * A change to an existing note, as cards: one per property, in sections (Kept up to date,
   * Differences found, Tags, then the rest of the note, folded), each saying where its value comes
   * from and where it's written. Choices come back as before: unticked lines in `excluded`, edited
   * values in `edits`, locks in `locked`.
   */
  private pmnReview(): void {
    const { path, lines, position, total, group, note } = this.pmnRequest
    this.modalEl.addClass('pmn-review')
    const { contentEl } = this
    renderCheckInSteps(contentEl)
    const name = path.split('/').pop()!.replace(/\.md$/, '')
    const top = contentEl.createDiv('pmn-review-top')
    top.createEl('h2', { text: name })
    if (group) top.createSpan({ cls: 'pmn-review-chip', text: group })
    else top.createSpan({ cls: 'pmn-review-chip', text: `${position} of ${total}` })
    const where = contentEl.createDiv('pmn-review-where')
    where.createSpan({ text: `${path.split('/').slice(0, -1).join('/')} · ` })
    where.createEl('a', { text: 'Open note', href: '#' }).addEventListener('click', evt => {
      evt.preventDefault()
      void this.app.workspace.openLinkText(path, '', true)
    })
    if (note) contentEl.createEl('p', { cls: 'pmn-approval-note', text: note })
    contentEl.createDiv({ cls: 'pmn-review-hint', text: 'Each card says where a value comes from → where it\'s written. Pick what you want; anything you leave as it is isn\'t asked about again while both sides stay the same.' })

    // Lines start ticked or not as the sync planned them.
    for (const line of lines) if (line.unticked) this.pmnExcluded.add(line.key)

    const isTags = (line: ApprovalLine) => line.label.trim().toLowerCase() === 'tags'
    const kept = (line: ApprovalLine) => /^(update:|count:|add:|rename$|rescale:|why$)/.test(line.key)
    const sections: [string, string, ApprovalLine[]][] = [
      ['Kept up to date', 'routine sync updates', lines.filter(l => !isTags(l) && kept(l))],
      ['Differences found', 'from comparing; pick what you want', lines.filter(l => !isTags(l) && !kept(l))],
      ['Tags', 'your note\'s tags and its source\'s', lines.filter(isTags)],
    ]
    const scroll = contentEl.createDiv('pmn-review-scroll')
    for (const [title, hint, sectionLines] of sections) {
      if (!sectionLines.length) continue
      const head = scroll.createDiv('pmn-review-section')
      head.createEl('h3', { text: title })
      head.createSpan({ cls: 'pmn-review-section-hint', text: title === 'Tags' && sectionLines.some(l => l.key.startsWith('file:')) ? 'Obsidian\'s tags and the mp3\'s' : hint })
      // One card per property.
      const byLabel = new Map<string, ApprovalLine[]>()
      for (const line of sectionLines) byLabel.set(line.label, [...byLabel.get(line.label) ?? [], line])
      for (const [label, cardLines] of byLabel) {
        if (title === 'Tags') this.pmnTagsCard(scroll, label, cardLines)
        else if (cardLines.some(l => l.edit === 'list')) this.pmnListCard(scroll, label, cardLines)
        else if (cardLines.some(l => isLong(l.value) || isLong(l.current))) this.pmnTextCard(scroll, label, cardLines)
        else this.pmnChoiceCard(scroll, label, cardLines)
      }
    }
    this.pmnRestOfNote(scroll)

    const foot = contentEl.createDiv('pmn-review-foot')
    this.pmnCount = foot.createSpan({ cls: 'pmn-review-count' })
    foot.createEl('button', { text: 'Skip' }).addEventListener('click', () => this.pmnDecide('skip'))
    const more = foot.createEl('button', { text: 'More ▾' })
    more.addEventListener('click', evt => {
      const menu = new Menu()
      if (this.pmnRequest.groupKey && this.pmnRequest.groupLeft) {
        menu.addItem(item => item.setTitle(`Apply to the ${this.pmnRequest.groupLeft} left like this`).onClick(() => this.pmnDecide('group')))
      }
      menu.addItem(item => item.setTitle('Apply to every note left').onClick(() => this.pmnDecide('all')))
      menu.addItem(item => item.setTitle('Skip this one every time').onClick(() => this.pmnDecide('ignore')))
      menu.addItem(item => item.setTitle('Stop').setWarning(true).onClick(() => this.pmnDecide('stop')))
      menu.showAtMouseEvent(evt)
    })
    this.pmnApply = foot.createEl('button', { cls: 'mod-cta' })
    this.pmnApply.addEventListener('click', () => this.pmnDecide('apply'))
    this.pmnCounted()
  }

  /** "Apply 3 changes": how many lines are chosen, and edits to the rest of the note. */
  private pmnCounted(): void {
    const chosen = this.pmnRequest.lines.filter(l => !this.pmnExcluded.has(l.key)).length
      + Object.keys(this.pmnEdits).filter(key => key.startsWith('own')).length
    this.pmnCount?.setText(`${chosen} change${chosen === 1 ? '' : 's'} chosen`)
    this.pmnApply?.setText(chosen ? `Apply ${chosen} change${chosen === 1 ? '' : 's'}` : 'Done')
  }

  private pmnInclude(line: ApprovalLine, on: boolean): void {
    if (on) this.pmnExcluded.delete(line.key)
    else this.pmnExcluded.add(line.key)
    this.pmnCounted()
  }

  /** A card's frame: the property's name, where its value comes from → where it goes, and the lock. */
  private pmnCard(parent: HTMLElement, label: string, lines: ApprovalLine[], flow = true): { card: HTMLElement, body: HTMLElement, locked: () => boolean, onLock: (f: (locked: boolean) => void) => void } {
    const card = parent.createDiv('pmn-review-card')
    const head = card.createDiv('pmn-review-head')
    head.createSpan({ cls: 'pmn-review-prop', text: label })
    const flowEl = head.createSpan('pmn-review-flow')
    if (flow) {
      const sources = [...new Set(lines.filter(l => !l.key.startsWith('file:')).map(l => sourceName(l.source)))]
      if (sources.length) pills(flowEl, sources.join(' or '), destination(lines[0]))
      else if (lines[0]) pills(flowEl, sourceName(lines[0].source), destination(lines[0]))
    }
    const warn = lines.find(l => l.warn)?.warn
    if (warn) head.createSpan({ cls: 'pmn-review-warn', text: warn })
    const lock = head.createEl('button', { cls: 'pmn-review-lock clickable-icon', attr: { 'aria-label': `Never change ${label} in this note` } })
    setIcon(lock, 'lock-open')
    const body = card.createDiv('pmn-review-body')
    const listeners: ((locked: boolean) => void)[] = []
    lock.addEventListener('click', evt => {
      evt.preventDefault()
      const locking = !this.pmnLocked.has(label)
      if (locking) this.pmnLocked.add(label)
      else this.pmnLocked.delete(label)
      setIcon(lock, locking ? 'lock' : 'lock-open')
      lock.toggleClass('is-active', locking)
      card.toggleClass('is-locked', locking)
      // Locked: none of it is changed, now or ever (undo in Settings → Remembered choices).
      for (const line of lines) {
        if (locking) this.pmnExcluded.add(line.key)
        else if (!line.unticked) this.pmnExcluded.delete(line.key)
      }
      listeners.forEach(f => f(locking))
      this.pmnCounted()
    })
    return { card, body, locked: () => this.pmnLocked.has(label), onLock: f => listeners.push(f) }
  }

  /** One value to pick: the note's (Obsidian) or a source's, each a button; the picked one can be edited. */
  private pmnChoiceCard(parent: HTMLElement, label: string, lines: ApprovalLine[]): void {
    const { body, onLock } = this.pmnCard(parent, label, lines)
    const choices = body.createDiv('pmn-review-choices')
    const editArea = body.createDiv('pmn-review-edit')
    const options: { el: HTMLElement, line: ApprovalLine | null }[] = []
    let picked: ApprovalLine | null = lines.find(l => !l.unticked) ?? null
    const draw = () => {
      for (const o of options) o.el.toggleClass('is-picked', o.line === picked)
      editArea.empty()
      if (picked?.edit) {
        const line = picked
        if (line.choices?.length) this.pmnValue(editArea, line)
        else {
          const link = editArea.createEl('a', { cls: 'pmn-review-link', text: 'Edit this value', href: '#' })
          link.addEventListener('click', evt => {
            evt.preventDefault()
            editArea.empty()
            this.pmnValue(editArea, line)
          })
        }
      }
    }
    const option = (line: ApprovalLine | null, source: string, value: string | null, disabled = false, note?: string) => {
      const el = choices.createEl('button', { cls: 'pmn-review-option' })
      el.createSpan({ cls: 'pmn-review-option-source', text: source })
      const text = el.createSpan({ cls: 'pmn-review-option-value' })
      if (value === null) text.createEl('em', { text: 'Empty' })
      else text.setText(value)
      if (note) el.createSpan({ cls: 'pmn-review-option-note', text: note })
      if (disabled) {
        el.disabled = true
        el.addClass('is-disabled')
        return
      }
      options.push({ el, line })
      el.addEventListener('click', evt => {
        evt.preventDefault()
        if (this.pmnLocked.has(label)) return
        picked = line
        for (const l of lines) this.pmnInclude(l, l === line)
        draw()
      })
    }
    // What's there now first: in the note, or (for a value written elsewhere) in the mp3 or Plex.
    option(null, currentName(lines[0]), lines[0].current ?? null)
    for (const line of lines) option(line, sourceName(line.source), line.value)
    for (const other of lines[0].also ?? []) option(null, other.source, other.value, true, other.note)
    onLock(locked => {
      if (locked) picked = null
      else picked = lines.find(l => !l.unticked) ?? null
      draw()
    })
    draw()
  }

  /** Long text (lyrics, a summary): both sides, the lines that differ marked, and one box to take the new one. */
  private pmnTextCard(parent: HTMLElement, label: string, lines: ApprovalLine[]): void {
    const { body, onLock } = this.pmnCard(parent, label, lines)
    const line = lines[0]
    const now = (line.current ?? '').split('\n')
    const next = (line.value ?? '').split('\n')
    const cols = body.createDiv('pmn-review-cols')
    // A changed line is one line different, not one taken out and one put in.
    const differ = Math.max(now.filter(l => !next.includes(l)).length, next.filter(l => !now.includes(l)).length)
    const short = 8
    const column = (title: string, text: string[], other: string[], cls: string) => {
      const col = cols.createDiv('pmn-review-col')
      col.createDiv({ cls: 'pmn-review-col-title', text: title })
      const box = col.createDiv('pmn-review-text')
      const show = (all: boolean) => {
        box.empty()
        const shown = all ? text : text.slice(0, short)
        shown.forEach((l, i) => {
          if (i) box.createEl('br')
          box.createSpan({ cls: other.includes(l) ? 'is-same' : cls, text: l || ' ' })
        })
        if (!text.join('').trim()) box.createEl('em', { text: 'Empty' })
      }
      show(false)
      return show
    }
    const showNow = column(`${currentName(line)} now`, now, next, 'is-removed')
    const showNext = column(`${sourceName(line.source)} (will replace it)`, next, now, 'is-added')
    const more = body.createDiv('pmn-review-more')
    if (Math.max(now.length, next.length) > short) {
      let all = false
      const toggle = more.createEl('a', { cls: 'pmn-review-link', text: 'Show all', href: '#' })
      toggle.addEventListener('click', evt => {
        evt.preventDefault()
        all = !all
        showNow(all)
        showNext(all)
        toggle.setText(all ? 'Show less' : 'Show all')
      })
      more.createSpan({ text: ' · ' })
    }
    more.createSpan({ text: `${differ} line${differ === 1 ? '' : 's'} different` })
    const take = body.createEl('label', { cls: 'pmn-review-take' })
    const box = take.createEl('input', { type: 'checkbox' })
    box.checked = !line.unticked
    take.createSpan({ text: `Copy the ${sourceName(line.source)}'s ${label} into ${destination(line)}` })
    box.addEventListener('change', () => this.pmnInclude(line, box.checked))
    if (line.edit) {
      const editArea = body.createDiv('pmn-review-edit')
      const link = editArea.createEl('a', { cls: 'pmn-review-link', text: 'Edit this value', href: '#' })
      link.addEventListener('click', evt => {
        evt.preventDefault()
        editArea.empty()
        this.pmnValue(editArea, line)
      })
    }
    onLock(locked => {
      box.checked = !locked && !line.unticked
      box.disabled = locked
    })
  }

  /** A list (genres and such): the note's items, and each of the source's it lacks as its own chip to add. */
  private pmnListCard(parent: HTMLElement, label: string, lines: ApprovalLine[]): void {
    const { body, onLock } = this.pmnCard(parent, label, lines)
    for (const line of lines) {
      const current = splitList(line.current)
      const offered = line.items ?? splitList(line.value)
      const has = (list: string[], v: string) => list.some(x => x.toLowerCase() === v.toLowerCase())
      const additions = offered.filter(v => !has(current, v))
      const dropped = current.filter(v => !has(offered, v))
      const added = new Set(line.unticked ? [] : additions)
      const removed = new Set<string>()
      const result = () => [...current.filter(v => !removed.has(v)), ...additions.filter(v => added.has(v))]
      const update = () => {
        const list = result()
        const same = list.length === current.length && list.every((v, i) => v === current[i])
        if (same) this.pmnExcluded.add(line.key)
        else {
          this.pmnExcluded.delete(line.key)
          this.pmnEdits[line.key] = list
        }
        this.pmnCounted()
      }
      body.createDiv({ cls: 'pmn-review-label', text: `In ${destination(line).replace(/:.*$/, '')}` })
      const own = body.createDiv('pmn-review-chips')
      if (!current.length) own.createEl('em', { cls: 'pmn-review-empty', text: 'Empty' })
      for (const v of current) {
        const chip = own.createEl('button', { cls: 'pmn-review-tag', text: v })
        if (has(dropped, v)) {
          // The source doesn't have it: yours stays unless you tap it away.
          chip.addClass('can-remove')
          chip.setAttr('aria-label', `Not in ${sourceName(line.source)}: tap to take it out`)
          chip.addEventListener('click', evt => {
            evt.preventDefault()
            if (removed.has(v)) removed.delete(v)
            else removed.add(v)
            chip.toggleClass('is-removed', removed.has(v))
            update()
          })
        } else chip.disabled = true
      }
      if (additions.length) {
        body.createDiv({ cls: 'pmn-review-label', text: `Only in ${sourceName(line.source)}: tap any to add` })
        const offer = body.createDiv('pmn-review-chips')
        for (const v of additions) {
          const chip = offer.createEl('button', { cls: 'pmn-review-tag is-offer', text: v })
          chip.toggleClass('is-picked', added.has(v))
          chip.addEventListener('click', evt => {
            evt.preventDefault()
            if (this.pmnLocked.has(label)) return
            if (added.has(v)) added.delete(v)
            else added.add(v)
            chip.toggleClass('is-picked', added.has(v))
            update()
          })
        }
      }
      update()
      onLock(locked => { if (!locked) update() })
    }
  }

  /** Tags: in the source and not Obsidian (to add to the note), in Obsidian and not the mp3 (to add to the file), in both. */
  private pmnTagsCard(parent: HTMLElement, label: string, lines: ApprovalLine[]): void {
    const { body, onLock } = this.pmnCard(parent, label, lines, false)
    const toFile = lines.find(l => l.key.startsWith('file:'))
    const toNote = lines.filter(l => l !== toFile)
    const noteNow = splitList(toNote[0]?.current ?? (toFile ? null : lines[0].current))
    const fileNow = toFile ? splitList(toFile.current) : []
    const has = (list: string[], v: string) => list.some(x => x.toLowerCase() === v.toLowerCase())
    const row = (title: string, line: ApprovalLine, base: string[], from: string, to: string) => {
      const offered = line.items ?? splitList(line.value)
      const additions = offered.filter(v => !has(base, v))
      if (!additions.length) return
      const picked = new Set(line.unticked ? [] : additions)
      body.createDiv({ cls: 'pmn-review-label', text: title })
      const chips = body.createDiv('pmn-review-chips')
      const update = () => {
        if (!picked.size) this.pmnExcluded.add(line.key)
        else {
          this.pmnExcluded.delete(line.key)
          const list = [...base, ...additions.filter(v => picked.has(v))]
          // Written to the music file as text; to the note as a list.
          this.pmnEdits[line.key] = line.key.startsWith('file:') ? list.join(', ') : list
        }
        this.pmnCounted()
      }
      for (const v of additions) {
        const chip = chips.createEl('button', { cls: 'pmn-review-tag is-offer', text: v })
        chip.toggleClass('is-picked', picked.has(v))
        chip.addEventListener('click', evt => {
          evt.preventDefault()
          if (this.pmnLocked.has(label)) return
          if (picked.has(v)) picked.delete(v)
          else picked.add(v)
          chip.toggleClass('is-picked', picked.has(v))
          update()
        })
      }
      pills(chips.createSpan('pmn-review-flow'), from, to)
      update()
      onLock(locked => { if (!locked) update() })
    }
    for (const line of toNote) {
      const from = sourceName(line.source)
      row(`In ${from}, not Obsidian`, line, noteNow, from, 'Obsidian')
    }
    if (toFile) row('In Obsidian, not mp3', toFile, fileNow, 'Obsidian', 'mp3')
    const both = toFile ? noteNow.filter(v => has(fileNow, v)) : noteNow
    if (both.length) {
      body.createDiv({ cls: 'pmn-review-label', text: toFile ? 'In both' : 'In Obsidian' })
      const chips = body.createDiv('pmn-review-chips')
      for (const v of both) chips.createEl('button', { cls: 'pmn-review-tag', text: v }).disabled = true
    }
  }

  /** The rest of the note, nothing in it changing: folded, and each value can still be edited. */
  private pmnRestOfNote(parent: HTMLElement): void {
    const rest = this.pmnRequest.unchanged ?? []
    if (!rest.length) return
    const details = parent.createEl('details', { cls: 'pmn-review-rest' })
    details.createEl('summary', { text: `Nothing to change in the rest of this note: ${rest.length} propert${rest.length === 1 ? 'y' : 'ies'} (open to edit)` })
    for (const { label, value, warn, key, edit, items } of rest) {
      const row = details.createDiv('pmn-review-rest-row')
      const name = row.createDiv({ cls: 'pmn-review-rest-name', text: label })
      const cellEl = row.createDiv('pmn-review-rest-value')
      if (warn) name.createDiv({ cls: 'pmn-review-warn', text: warn })
      if (!key || !edit) {
        if (value === null) cellEl.createEl('em', { cls: 'pmn-review-empty', text: 'Empty' })
        else cellEl.setText(value)
        continue
      }
      const mark = () => {
        name.toggleClass('pmn-approval-changed', key in this.pmnEdits)
        this.pmnCounted()
      }
      if (edit === 'list') {
        this.pmnListEditor(cellEl, key, items ?? [], mark, label)
        continue
      }
      const original = value ?? ''
      const field = this.pmnTextField(cellEl, label, original, edit, key === 'own-file')
      field.addEventListener('input', () => {
        if (field.value === original) delete this.pmnEdits[key]
        else this.pmnEdits[key] = field.value
        mark()
      })
    }
  }

  /** A line's new value: shown, or in a box to edit it (its edit kept in `pmnEdits`). */
  private pmnValue(td: HTMLElement, line: ApprovalLine): HTMLTextAreaElement | HTMLInputElement | null {
    const { key, value, edit, items, choices } = line
    if (edit === 'list') return this.pmnListEditor(td, key, items ?? [], undefined, line.label)
    if (!edit) {
      if (value === null) td.createEl('em', { cls: 'pmn-approval-empty', text: 'Empty' })
      else td.createDiv({ text: value })
      return null
    }
    const original = value ?? ''
    let field: HTMLTextAreaElement | HTMLInputElement
    if (key === 'why') {
      // Your reason for wanting it: a line of text, where "[[" looks for a note to link.
      const input = td.createEl('input', { type: 'text', cls: 'pmn-approval-input' })
      input.value = original
      input.placeholder = 'Optional'
      new LinkSuggest(this.app, input)
      field = input
    } else field = this.pmnTextField(td, line.label, original, edit, Boolean(choices?.length) || key === 'file')
    field.addEventListener('input', () => {
      if (field.value === original) delete this.pmnEdits[key]
      else this.pmnEdits[key] = field.value
    })
    if (choices?.length) this.pmnCoverPicker(field, choices)
    return field
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

/** Text too long or with several lines to show as a button: shown side by side instead. */
function isLong(value: string | null | undefined): boolean {
  return Boolean(value && (value.includes('\n') || value.length > 160))
}

/** A list as shown in a line ("a, b, c" or "a,b,c"), as items. */
function splitList(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean)
}

/** A source as the cards name it: the note is "Obsidian", a music file "mp3". */
function sourceName(source: string | undefined): string {
  if (!source || source === 'This note') return 'Obsidian'
  if (source === 'Music file') return 'mp3'
  if (source === 'This note, in the star scale') return 'Obsidian, in stars'
  return source
}

/** Where a line's value is written: "Obsidian: <property>", "mp3: <property>", "Plex". */
function destination(line: ApprovalLine): string {
  const to = line.writesTo ?? 'This note'
  const property = line.label.replace(/ in the music file$/, '')
  if (to === 'This note') return `Obsidian: ${property}`
  if (to === 'Music file') return `mp3: ${property}`
  if (to === 'This note\'s file name') return 'Obsidian: file name'
  return to
}

/** What the "now" choice is called: the note's value, or the mp3's or Plex's when that's what changes. */
function currentName(line: ApprovalLine): string {
  const to = line.writesTo ?? 'This note'
  if (to === 'Music file') return 'mp3'
  if (to === 'Plex') return 'Plex'
  return 'Obsidian'
}

/** "from → to", as two pills; the note's side in the accent colour. */
function pills(el: HTMLElement, from: string, to: string): void {
  const pill = (text: string) => el.createSpan({ cls: text.startsWith('Obsidian') ? ['pmn-review-pill', 'is-obsidian'] : 'pmn-review-pill', text })
  pill(from)
  el.createSpan({ cls: 'pmn-review-arrow', text: '→' })
  pill(to)
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
