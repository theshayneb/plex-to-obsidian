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
