import { AbstractInputSuggest, App } from 'obsidian'

/** Every frontmatter property name used in the vault, most used first. */
export function vaultPropertyNames(app: App): string[] {
  const counts = new Map<string, number>()
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter) continue
    for (const name of Object.keys(frontmatter)) {
      if (name === 'position') continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

/** Ranks names for a query: names starting with it first, then names containing it, keeping the given order. */
export function matchPropertyNames(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return names
  const starts = names.filter(n => n.toLowerCase().startsWith(q))
  const contains = names.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
  return [...starts, ...contains]
}

/** Suggests property names already used in the vault while typing a property name. */
export class PropertyNameSuggest extends AbstractInputSuggest<string> {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  private pmnNames: string[] | null = null

  constructor(app: App, private readonly pmnInput: HTMLInputElement) {
    super(app, pmnInput)
  }

  protected getSuggestions(query: string): string[] {
    this.pmnNames ??= vaultPropertyNames(this.app)
    return matchPropertyNames(this.pmnNames, query)
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value)
  }

  selectSuggestion(value: string): void {
    this.setValue(value)
    // Let the text field's onChange save it, as if typed.
    this.pmnInput.dispatchEvent(new Event('input'))
    this.close()
  }
}

/** Values for property names: lower-cased name → its values across the vault, most used first. */
export type VaultValues = Map<string, string[]>

/**
 * Every text value each frontmatter property has in the vault (list items one by one), most used
 * first, like the suggestions in Obsidian's own properties. Read in one pass over the vault.
 */
export function vaultPropertyValues(app: App): VaultValues {
  const counts = new Map<string, Map<string, number>>()
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter) continue
    for (const [name, raw] of Object.entries(frontmatter)) {
      if (name === 'position') continue
      const key = name.toLowerCase()
      const values = counts.get(key) ?? new Map<string, number>()
      counts.set(key, values)
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (typeof value !== 'string' || !value.trim() || value.includes('\n')) continue
        values.set(value, (values.get(value) ?? 0) + 1)
      }
    }
  }
  return new Map([...counts].map(([key, values]) => [key, [...values.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value)]))
}

/** Values a property is offered, as you type: ones already used in the vault, best matches first. */
export function matchValues(values: string[], query: string, leaveOut: string[] = []): string[] {
  const used = new Set(leaveOut.map(v => v.toLowerCase()))
  return matchPropertyNames(values, query).filter(v => !used.has(v.toLowerCase()) && v !== query.trim())
}

/**
 * Suggests a property's values already used in the vault while typing in a pop-up's box, as
 * Obsidian's properties do. `pick` gets the chosen value.
 */
export class PropertyValueSuggest extends AbstractInputSuggest<string> {
  // "pmn" prefix: avoid clashing with undocumented members of Obsidian's own class.
  /** Whether the list is showing, so Enter picks from it rather than adding what's typed. */
  pmnShowing = false

  constructor(
    app: App,
    input: HTMLInputElement,
    private readonly pmnValues: string[],
    private readonly pmnPick: (value: string) => void,
    /** Values not to offer (a list's items already in it). */
    private readonly pmnLeaveOut: () => string[] = () => [],
  ) {
    super(app, input)
    this.limit = 50
  }

  protected getSuggestions(query: string): string[] {
    return matchValues(this.pmnValues, query, this.pmnLeaveOut())
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value)
  }

  selectSuggestion(value: string): void {
    this.pmnPick(value)
    this.close()
  }

  open(): void {
    super.open()
    this.pmnShowing = true
  }

  close(): void {
    super.close()
    this.pmnShowing = false
  }
}
