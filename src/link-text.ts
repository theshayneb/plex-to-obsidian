// Typing a [[link]] in a plain text box: what's being looked for, and the text with the link put in.
// No Obsidian imports, so it can be unit tested; the suggestions are in link-suggest.ts.

/** The "[[" before the cursor that isn't closed yet, and what's typed after it; null when there's none. */
export function openLink(text: string, caret: number): { start: number, query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('[[')
  if (start < 0) return null
  const query = before.slice(start + 2)
  if (query.includes(']]') || query.includes('\n')) return null
  return { start, query }
}

/** The text with the open "[[query" (and a "]]" just after the cursor, if any) replaced by "[[link]]", and where the cursor goes. */
export function putLink(text: string, caret: number, link: string): { text: string, caret: number } {
  const open = openLink(text, caret)
  if (!open) return { text, caret }
  const after = text.slice(caret).replace(/^[^\]\n]*\]\]/, '')
  const inserted = `[[${link}]]`
  return { text: text.slice(0, open.start) + inserted + after, caret: open.start + inserted.length }
}

/** Notes whose name starts with what's typed come first, then those that contain it; at most `limit`. */
export function matchNotes<T extends { basename: string }>(notes: T[], query: string, limit = 20): T[] {
  const q = query.trim().toLowerCase()
  const starts: T[] = []
  const contains: T[] = []
  for (const note of notes) {
    const name = note.basename.toLowerCase()
    if (name.startsWith(q)) starts.push(note)
    else if (q && name.includes(q)) contains.push(note)
  }
  const byName = (a: T, b: T) => a.basename.length - b.basename.length || a.basename.localeCompare(b.basename)
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit)
}
