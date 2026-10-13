// Episodes watched in Plex, written into that day's daily note. No Obsidian imports, so it can be
// unit tested; the vault work is in sync.ts.

/** One viewing from Plex's watch history. */
export interface WatchedEpisode {
  show: string
  /** The show's rating key, to find its note. */
  showKey: string
  season?: number
  episode?: number
  title: string
  /** When it was watched (seconds since 1970). */
  viewedAt: number
}

/** An entry of Plex's watch history (`/status/sessions/history/all`). */
export interface HistoryEntry {
  type?: string
  title?: string
  grandparentTitle?: string
  grandparentKey?: string
  grandparentRatingKey?: string | number
  parentIndex?: number
  index?: number
  viewedAt?: number
  accountID?: number
}

/** The episodes in Plex's watch history watched by the server's owner (account 1). */
export function watchedEpisodes(history: HistoryEntry[]): WatchedEpisode[] {
  const out: WatchedEpisode[] = []
  for (const h of history) {
    if (h.type !== 'episode' || !h.viewedAt || !h.grandparentTitle) continue
    if (h.accountID !== undefined && h.accountID !== 1) continue
    const showKey = h.grandparentRatingKey !== undefined ? String(h.grandparentRatingKey) : /\/library\/metadata\/(\d+)/.exec(h.grandparentKey ?? '')?.[1] ?? ''
    out.push({ show: h.grandparentTitle, showKey, season: h.parentIndex, episode: h.index, title: h.title ?? '', viewedAt: h.viewedAt })
  }
  return out
}

const two = (n: number): string => String(n).padStart(2, '0')

/** "S02E05 – Title" (or just the title when Plex has no numbers). */
export function episodeLabel(e: WatchedEpisode): string {
  const code = e.season !== undefined && e.episode !== undefined ? `S${two(e.season)}E${two(e.episode)}` : ''
  return [code, e.title].filter(Boolean).join(' – ')
}

/**
 * The episodes to write, by day (`dayOf` turns a time into the day's key): each show's episodes
 * watched that day, in the order watched, the shows in the order they were first watched.
 */
export function episodesByDay(episodes: WatchedEpisode[], dayOf: (seconds: number) => string): Map<string, WatchedEpisode[][]> {
  const byDay = new Map<string, Map<string, WatchedEpisode[]>>()
  for (const e of [...episodes].sort((a, b) => a.viewedAt - b.viewedAt)) {
    const day = dayOf(e.viewedAt)
    const shows = byDay.get(day) ?? new Map<string, WatchedEpisode[]>()
    const key = e.showKey || e.show
    const list = shows.get(key) ?? []
    // An episode watched twice that day is listed once.
    if (!list.some(seen => episodeLabel(seen) === episodeLabel(e))) list.push(e)
    shows.set(key, list)
    byDay.set(day, shows)
  }
  return new Map([...byDay.entries()].map(([day, shows]) => [day, [...shows.values()]]))
}

/** One show's line: "▶️ [[Show]]:" and its episodes, each "S02E05 – Title". */
export interface DailyEntry { lead: string, parts: string[] }

/** The line for a show's episodes: "▶️ [[Show]]: S02E05 – Title, S02E06 – Title". */
export function episodeEntry(link: string, episodes: WatchedEpisode[]): DailyEntry {
  return { lead: `▶️ ${link}:`, parts: episodes.map(episodeLabel) }
}

/** The first line whose text (without callout or quote markers) starts with `anchor` (any case). */
function anchorLine(lines: string[], anchor: string): number {
  const want = anchor.replace(/^[>\s]*/, '').trim().toLowerCase()
  if (!want) return -1
  return lines.findIndex(line => line.replace(/^[>\s]*/, '').trim().toLowerCase().startsWith(want))
}

/**
 * A daily note with entries added under the anchor line: after the anchor and the empty quote line
 * right below it, and after entries added before, each line starting with `quote` (by default that
 * empty line's quote markers, else the anchor's; earlier entries there are given the same ones)
 * ("> >- ▶️ [[Show]]: S02E05 – Title"). A show that already has a line (anywhere) gets the
 * episodes it lacks added at its end ("…, S02E06 – Title"); nothing is changed or removed.
 * `found` is false when the anchor isn't there.
 */
export function insertEntries(text: string, anchor: string, entries: DailyEntry[], quote?: string): { text: string, added: number, found: boolean } {
  const lines = text.split('\n')
  const at = anchorLine(lines, anchor)
  if (at < 0) return { text, added: 0, found: false }
  // The quote markers of the empty quote line under the anchor (inside the callout), else the anchor's.
  const markers = (line: string): string => /^[>\s]*/.exec(line)![0].replace(/\s+$/, '')
  const below = at + 1 < lines.length && /^[>\s]*$/.test(lines[at + 1]) && lines[at + 1].includes('>')
  const prefix = quote?.trim() ?? markers(below ? lines[at + 1] : lines[at])
  let added = 0
  const fresh: string[] = []
  for (const { lead, parts } of entries) {
    const existing = lines.findIndex(line => line.includes(lead))
    if (existing >= 0) {
      const missing = parts.filter(part => !lines[existing].includes(part))
      if (missing.length) {
        lines[existing] = `${lines[existing].replace(/\s+$/, '')}, ${missing.join(', ')}`
        added += missing.length
      }
      continue
    }
    fresh.push(`${prefix}- ${lead} ${parts.join(', ')}`)
    added += parts.length
  }
  let to = at + 1
  // The empty line under the anchor (inside the callout: only quote markers).
  if (below) to++
  // Earlier entries (written with other quote markers by older versions get these ones).
  let fixed = false
  while (to < lines.length && /^[>\s]*-\s*▶️/.test(lines[to])) {
    const line = `${prefix}${lines[to].slice(markers(lines[to]).length)}`
    if (line !== lines[to]) {
      lines[to] = line
      fixed = true
    }
    to++
  }
  lines.splice(to, 0, ...fresh)
  return { text: added || fixed ? lines.join('\n') : text, added, found: true }
}
