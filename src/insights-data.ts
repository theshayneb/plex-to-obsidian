// The media dashboard's Insights and Habits: what you watched, played and listened to in a month,
// a year or a week, from Plex's watch history and your reactions. No Obsidian imports, so it can be
// unit tested; the view is recommend-view.ts.
import type { HistoryEntry } from './daily-episodes'

/** One viewing or play in Plex's watch history (the server owner's only). */
export interface WatchEvent {
  kind: 'movie' | 'episode' | 'track'
  /** The movie's, episode's or track's rating key. */
  key: string
  /** The movie's or show's title, or the song's. */
  title: string
  /** For an episode, its show's rating key; for a song, its artist. */
  parent?: string
  viewedAt: number
}

/** The owner's viewings and plays (account 1) in Plex's watch history. */
export function watchEvents(history: HistoryEntry[]): WatchEvent[] {
  const out: WatchEvent[] = []
  for (const h of history) {
    if (!h.viewedAt || (h.accountID !== undefined && h.accountID !== 1)) continue
    const key = h.ratingKey !== undefined ? String(h.ratingKey) : /\/library\/metadata\/(\d+)/.exec(h.key ?? '')?.[1] ?? ''
    if (h.type === 'movie' && h.title) out.push({ kind: 'movie', key, title: h.title, viewedAt: h.viewedAt })
    else if (h.type === 'episode' && h.grandparentTitle) {
      const show = h.grandparentRatingKey !== undefined ? String(h.grandparentRatingKey) : /\/library\/metadata\/(\d+)/.exec(h.grandparentKey ?? '')?.[1] ?? ''
      out.push({ kind: 'episode', key, title: h.grandparentTitle, parent: show, viewedAt: h.viewedAt })
    } else if (h.type === 'track' && h.title) {
      out.push({ kind: 'track', key, title: h.title, parent: h.originalTitle || h.grandparentTitle, viewedAt: h.viewedAt })
    }
  }
  return out
}

/** A reaction line read back from a note: "2026-10-16 · 🩷 · moved, happy · words". */
export interface ReactionEvent {
  path: string
  title: string
  group: 'video' | 'music' | 'game' | 'book'
  day: string
  rating?: string
  feelings: string[]
  text?: string
}

const RATINGS = ['💣', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '🩷']

/**
 * A Reactions line's parts. The feelings part is told from a few words of your own by being a list
 * of feelings the note has (its Feelings property); a line that isn't a reaction gives null.
 */
export function parseReaction(line: string, feelings: string[]): Pick<ReactionEvent, 'day' | 'rating' | 'feelings' | 'text'> | null {
  const parts = line.split(' · ').map(p => p.trim())
  const day = parts.shift() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const out: Pick<ReactionEvent, 'day' | 'rating' | 'feelings' | 'text'> = { day, feelings: [] }
  if (parts[0] && RATINGS.includes(parts[0])) out.rating = parts.shift()
  const known = new Set(feelings.map(f => f.toLowerCase()))
  if (parts[0]) {
    const words = parts[0].split(',').map(w => w.trim()).filter(Boolean)
    if (words.length && words.every(w => known.has(w.toLowerCase()))) {
      out.feelings = words
      parts.shift()
    }
  }
  if (parts.length) out.text = parts.join(' · ')
  return out
}

/** A day a daily note links a media note in its Related property (a day you watched, read or played it). */
export interface DayLink {
  day: string
  path: string
  title: string
  group: ReactionEvent['group']
}

/** A note and how many days in a period your daily notes link it, and the last of them. */
export interface DaysSpent { path: string, title: string, days: number, last: string }

/** The notes of a kind your daily notes link in a period, most days first. */
export function daysSpent(links: DayLink[], period: Period, group: DayLink['group']): DaysSpent[] {
  const byPath = new Map<string, { title: string, days: Set<string> }>()
  for (const l of links) {
    if (l.group !== group || !dayIn(l.day, period)) continue
    const entry = byPath.get(l.path) ?? { title: l.title, days: new Set<string>() }
    entry.days.add(l.day)
    byPath.set(l.path, entry)
  }
  return [...byPath].map(([path, e]) => ({ path, title: e.title, days: e.days.size, last: [...e.days].sort().pop() ?? '' }))
    .sort((a, b) => b.days - a.days || a.title.localeCompare(b.title))
}

/** How many days in a period your daily notes link something of a kind. */
export function daysWith(links: DayLink[], period: Period, group: DayLink['group']): number {
  return new Set(links.filter(l => l.group === group && dayIn(l.day, period)).map(l => l.day)).size
}

/** A stretch of time, in seconds since 1970 (from included, to not). */
export interface Period { from: number, to: number }

const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

/** A calendar month (month 0–11), in local time. */
export function monthPeriod(year: number, month: number): Period {
  return { from: seconds(new Date(year, month, 1)), to: seconds(new Date(year, month + 1, 1)) }
}

export function yearPeriod(year: number): Period {
  return { from: seconds(new Date(year, 0, 1)), to: seconds(new Date(year + 1, 0, 1)) }
}

/** This week (from Monday) up to now, and the whole week before it. */
export function weeks(now: Date): { thisWeek: Period, lastWeek: Period } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const before = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
  return { thisWeek: { from: seconds(monday), to: seconds(now) }, lastWeek: { from: seconds(before), to: seconds(monday) } }
}

const inPeriod = (at: number, p: Period) => at >= p.from && at < p.to

/** The local day (YYYY-MM-DD) of a time in seconds. */
export function localDay(at: number): string {
  const d = new Date(at * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayIn = (day: string, p: Period) => {
  const [y, m, d] = day.split('-').map(Number)
  return inPeriod(seconds(new Date(y, m - 1, d, 12)), p)
}

/** Most first, then alphabetically, at most `limit`. */
function top(counts: Map<string, number>, limit: number): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
}

const tally = (values: string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return counts
}

export interface PeriodSummary {
  /** Each movie, with the days it was watched (several viewings on one day count once). */
  movies: { key: string, title: string, times: number, days: string[] }[]
  shows: { key: string, title: string, episodes: number }[]
  episodes: number
  songPlays: number
  topArtists: [string, number][]
  topSongs: [string, number][]
  /** Books and games you reacted to then (each once). */
  books: ReactionEvent[]
  games: ReactionEvent[]
  /** Books and games your daily notes link then, with the days. */
  bookDays: DaysSpent[]
  gameDays: DaysSpent[]
  /** What you gave 🩷 then. */
  favourites: ReactionEvent[]
  feelings: [string, number][]
  /**
   * What you came back to then: movies seen on another day before (in Plex's history, your
   * daily notes or a reaction), and shows, books and games back after a break: linked before,
   * then nothing for the three months before this time's first day (so carrying on isn't a return).
   */
  rewatches: { title: string, path?: string, kind: 'movie' | 'show' | 'book' | 'game' }[]
  reactions: number
}

/**
 * A month's or year's watching, playing and listening. `events` may reach back before the period
 * (they show what's a rewatch); `reactions` are every reaction in your notes.
 */
export function summarize(events: WatchEvent[], reactions: ReactionEvent[], period: Period, titleOf: (kind: 'movie' | 'show', key: string, fallback: string) => string = (_k, _key, t) => t, days: DayLink[] = [], pathOf: (key: string) => string | undefined = () => undefined): PeriodSummary {
  const now = events.filter(e => inPeriod(e.viewedAt, period))
  const moviesSeen = new Map<string, { key: string, title: string, times: number, days: string[] }>()
  const shows = new Map<string, { key: string, title: string, episodes: number }>()
  for (const e of now) {
    if (e.kind === 'movie') {
      const m = moviesSeen.get(e.key) ?? { key: e.key, title: titleOf('movie', e.key, e.title), times: 0, days: [] }
      const day = localDay(e.viewedAt)
      if (!m.days.includes(day)) {
        m.days.push(day)
        m.times++
      }
      moviesSeen.set(e.key, m)
    } else if (e.kind === 'episode') {
      const key = e.parent || e.title
      const s = shows.get(key) ?? { key, title: titleOf('show', key, e.title), episodes: 0 }
      s.episodes++
      shows.set(key, s)
    }
  }
  const songs = now.filter(e => e.kind === 'track')
  const reacted = reactions.filter(r => dayIn(r.day, period))
  const once = (list: ReactionEvent[]) => [...new Map(list.map(r => [r.path, r])).values()]
  // A movie seen on an earlier day (not just logged twice by Plex the same day).
  const earlier = new Set(events.filter(e => e.kind === 'movie' && e.viewedAt < period.from && localDay(e.viewedAt) !== localDay(period.from)).map(e => e.key))
  const start = new Date(period.from * 1000)
  const startDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const reactedBefore = new Set(reactions.filter(r => r.day < startDay).map(r => r.title))
  // The days your daily notes link each note.
  const linked = new Map<string, string[]>()
  for (const l of days) linked.set(l.path, [...linked.get(l.path) ?? [], l.day])
  const before = (path: string | undefined, day: string) => Boolean(path && (linked.get(path) ?? []).some(d => d < day))
  const monthsBefore = (day: string) => {
    const [y, m, d] = day.split('-').map(Number)
    return localDay(seconds(new Date(y, m - 1, d - 90, 12)))
  }
  // Back after a break: linked before, then nothing (no daily-note link, and for a show no episode
  // in Plex's history) in the three months before its first day now.
  const cameBack = (path: string | undefined, first: string, showKey?: string) => {
    if (!path) return false
    const gap = monthsBefore(first)
    const linkedDays = linked.get(path) ?? []
    if (!before(path, gap) || linkedDays.some(d => d >= gap && d < first)) return false
    return !showKey || !events.some(e => e.kind === 'episode' && (e.parent || e.title) === showKey && localDay(e.viewedAt) >= gap && localDay(e.viewedAt) < first)
  }
  const firstEpisode = new Map<string, number>()
  for (const e of now) if (e.kind === 'episode') firstEpisode.set(e.parent || e.title, Math.min(firstEpisode.get(e.parent || e.title) ?? Infinity, e.viewedAt))
  const rewatches: PeriodSummary['rewatches'] = [
    ...[...moviesSeen.values()]
      .filter(m => m.times > 1 || earlier.has(m.key) || reactedBefore.has(m.title) || before(pathOf(m.key), m.days[0]))
      .map(m => ({ title: m.title, path: pathOf(m.key), kind: 'movie' as const })),
    ...[...shows.values()]
      .filter(sh => cameBack(pathOf(sh.key), localDay(firstEpisode.get(sh.key) ?? period.from), sh.key))
      .map(sh => ({ title: sh.title, path: pathOf(sh.key), kind: 'show' as const })),
  ]
  return {
    movies: [...moviesSeen.values()].sort((a, b) => b.times - a.times || a.title.localeCompare(b.title)),
    shows: [...shows.values()].sort((a, b) => b.episodes - a.episodes || a.title.localeCompare(b.title)),
    episodes: now.filter(e => e.kind === 'episode').length,
    songPlays: songs.length,
    topArtists: top(tally(songs.map(s => s.parent ?? '').filter(Boolean)), 5),
    topSongs: top(tally(songs.map(s => s.parent ? `${s.parent} – ${s.title}` : s.title)), 5),
    books: once(reacted.filter(r => r.group === 'book')),
    games: once(reacted.filter(r => r.group === 'game')),
    bookDays: daysSpent(days, period, 'book'),
    gameDays: daysSpent(days, period, 'game'),
    favourites: once(reacted.filter(r => r.rating === '🩷')),
    feelings: top(tally(reacted.flatMap(r => r.feelings.map(f => f.toLowerCase()))), 8),
    rewatches: [
      ...rewatches,
      ...(['book', 'game'] as const).flatMap(group => daysSpent(days, period, group)
        .filter(d => {
          const first = days.filter(l => l.path === d.path && dayIn(l.day, period)).map(l => l.day).sort()[0]
          return cameBack(d.path, first)
        })
        .map(d => ({ title: d.title, path: d.path, kind: group }))),
    ],
    reactions: reacted.length,
  }
}

export interface WeekNumbers {
  /** Hours of movies and TV (where Plex knows how long they are). */
  hours: number
  movies: number
  episodes: number
  songs: number
}

/** A week's numbers, for comparing this week with last. `minutes` is each movie's and episode's length. */
export function weekNumbers(events: WatchEvent[], period: Period, minutes: Map<string, number>): WeekNumbers {
  const now = events.filter(e => inPeriod(e.viewedAt, period))
  const video = now.filter(e => e.kind !== 'track')
  return {
    hours: Math.round(video.reduce((sum, e) => sum + (minutes.get(e.key) ?? 0), 0) / 6) / 10,
    movies: now.filter(e => e.kind === 'movie').length,
    episodes: now.filter(e => e.kind === 'episode').length,
    songs: now.filter(e => e.kind === 'track').length,
  }
}

/** "3 more than last week", "the same as last week", "1.5 fewer than last week": plain, never a judgement. */
export function compared(now: number, before: number, unit = ''): string {
  const diff = Math.round((now - before) * 10) / 10
  if (!diff) return 'the same as last week'
  return `${Math.abs(diff)}${unit} ${diff > 0 ? 'more' : 'fewer'} than last week`
}
