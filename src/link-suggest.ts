import { AbstractInputSuggest, App, TFile } from 'obsidian'
import { matchNotes, openLink, putLink } from './link-text'

/**
 * Note suggestions in a plain text box, as in the editor: typing "[[mom" lists the notes whose name
 * starts with (then contains) "mom", and picking one puts "[[Mom]]" in the text.
 */
export class LinkSuggest extends AbstractInputSuggest<TFile> {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  constructor(app: App, private readonly pmnInput: HTMLInputElement) {
    super(app, pmnInput)
    this.limit = 20
  }

  protected getSuggestions(): TFile[] {
    const open = openLink(this.pmnInput.value, this.pmnInput.selectionStart ?? this.pmnInput.value.length)
    if (!open) return []
    return matchNotes(this.app.vault.getMarkdownFiles(), open.query)
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ text: file.basename })
    if (file.parent && file.parent.path !== '/') el.createDiv({ cls: 'pmn-link-suggest-path', text: file.parent.path })
  }

  selectSuggestion(file: TFile): void {
    const input = this.pmnInput
    const link = this.app.metadataCache.fileToLinktext(file, '', true)
    const { text, caret } = putLink(input.value, input.selectionStart ?? input.value.length, link)
    input.value = text
    input.setSelectionRange(caret, caret)
    input.dispatchEvent(new Event('input'))
    this.close()
  }
}

/** Whether the cursor is inside a "[[" not yet closed (so Enter picks a note rather than saving). */
export function typingLink(input: HTMLInputElement): boolean {
  return openLink(input.value, input.selectionStart ?? input.value.length) !== null
}
