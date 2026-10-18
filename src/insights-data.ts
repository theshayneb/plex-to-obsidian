// The media dashboard's Insights and Habits: what you watched, played and listened to in a month,
// a year or a week, from Plex's watch history and your reactions. No Obsidian imports, so it can be
// unit tested; the view is recommend-view.ts.
import type { HistoryEntry } from './daily-episodes'
import { compareTitles } from './notes'

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
    .sort((a, b) => b.days - a.days || compareTitles(a.title, b.title))
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
export function weeks(now: Date): { thisWeek: Period, lastWeek: Period, weekBefore: Period } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const before = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
  const earlier = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 14)
  return {
    thisWeek: { from: seconds(monday), to: seconds(now) },
    lastWeek: { from: seconds(before), to: seconds(monday) },
    weekBefore: { from: seconds(earlier), to: seconds(before) },
  }
}

/** This year's months so far, January first, the current one up to now. */
export function monthsSoFar(now: Date): Period[] {
  return Array.from({ length: now.getMonth() + 1 }, (_, m) => {
    const p = monthPeriod(now.getFullYear(), m)
    return m === now.getMonth() ? { from: p.from, to: seconds(now) } : p
  })
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
  return [...counts].sort((a, b) => b[1] - a[1] || compareTitles(a[0], b[0])).slice(0, limit)
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
  /** Books and games you reacted to then (each once): for their ratings, not as days read or played. */
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
  rewatches: {
    title: string
    path?: string
    kind: 'movie' | 'show' | 'book' | 'game'
    /** For a movie, what showed it was seen before. */
    why?: string
    /** What "Not a rewatch" remembers: the item and the day judged (a movie's latest viewing, else the first day then). */
    id: string
  }[]
  reactions: number
}

/** Plex entries for one movie closer together than this are one viewing. */
const VIEWING_GAP = 12 * 3600

/**
 * A month's or year's watching, playing and listening. `events` may reach back before the period
 * (they show what's a rewatch); `reactions` are every reaction in your notes.
 */
export function summarize(events: WatchEvent[], reactions: ReactionEvent[], period: Period, titleOf: (kind: 'movie' | 'show', key: string, fallback: string) => string = (_k, _key, t) => t, days: DayLink[] = [], pathOf: (key: string) => string | undefined = () => undefined): PeriodSummary {
  const now = events.filter(e => inPeriod(e.viewedAt, period))
  const moviesSeen = new Map<string, { key: string, title: string, times: number, days: string[] }>()
  const shows = new Map<string, { key: string, title: string, episodes: number }>()
  // Each movie's viewings: Plex often logs one viewing more than once (and a late film can cross
  // midnight), so entries less than 12 hours apart are one viewing, dated by its first entry.
  const viewings = new Map<string, { start: number, last: number }[]>()
  for (const e of events.filter(e => e.kind === 'movie' && e.viewedAt < period.to).sort((a, b) => a.viewedAt - b.viewedAt)) {
    const list = viewings.get(e.key) ?? []
    const current = list[list.length - 1]
    if (current && e.viewedAt - current.last < VIEWING_GAP) current.last = e.viewedAt
    else list.push({ start: e.viewedAt, last: e.viewedAt })
    viewings.set(e.key, list)
  }
  for (const e of now) {
    if (e.kind === 'movie') {
      if (moviesSeen.has(e.key)) continue
      // The viewings with an entry in the period, each on the day it began.
      const these = (viewings.get(e.key) ?? []).filter(v => v.last >= period.from)
      const days = [...new Set(these.map(v => localDay(v.start)))].sort().reverse()
      moviesSeen.set(e.key, { key: e.key, title: titleOf('movie', e.key, e.title), times: these.length, days })
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
    ...[...moviesSeen.values()].flatMap(m => {
      const first = m.days[m.days.length - 1]
      const seen = (viewings.get(m.key) ?? []).filter(v => v.last < period.from).map(v => localDay(v.start)).pop()
      const path = pathOf(m.key)
      const noted = path ? (linked.get(path) ?? []).filter(d => d < first).sort().pop() : undefined
      const reacted = reactions.filter(r => r.title === m.title && r.day < first).map(r => r.day).sort().pop()
      const why = m.times > 1 ? `watched ${m.times} times then`
        : seen ? `Plex has it on ${seen}`
        : noted ? `daily note ${noted} links it`
        : reacted ? `reaction from ${reacted}` : undefined
      return why ? [{ title: m.title, path, kind: 'movie' as const, why, id: `movie:${m.key}@${m.days[0]}` }] : []
    }),
    ...[...shows.values()].flatMap(sh => {
      const first = localDay(firstEpisode.get(sh.key) ?? period.from)
      return cameBack(pathOf(sh.key), first, sh.key) ? [{ title: sh.title, path: pathOf(sh.key), kind: 'show' as const, id: `show:${sh.key}@${first}` }] : []
    }),
  ]
  return {
    movies: [...moviesSeen.values()].sort((a, b) => b.times - a.times || compareTitles(a.title, b.title)),
    shows: [...shows.values()].sort((a, b) => b.episodes - a.episodes || compareTitles(a.title, b.title)),
    episodes: now.filter(e => e.kind === 'episode').length,
    songPlays: songs.length,
    topArtists: top(tally(songs.map(s => s.parent ?? '').filter(Boolean)), 5),
    topSongs: top(tally(songs.map(s => s.parent ? `${s.parent} – ${s.title}` : s.title)), 5),
    books: once(reacted.filter(r => r.group === 'book')),
    games: once(reacted.filter(r => r.group === 'game')),
    bookDays: daysSpent(days, period, 'book'),
    gameDays: daysSpent(days, period, 'game'),
    favourites: once(reacted.filter(r => r.rating === '🩷')).sort((a, b) => compareTitles(a.title, b.title)),
    feelings: top(tally(reacted.flatMap(r => r.feelings.map(f => f.toLowerCase()))), 8),
    rewatches: [
      ...rewatches,
      ...(['book', 'game'] as const).flatMap(group => daysSpent(days, period, group)
        .flatMap(d => {
          const first = days.filter(l => l.path === d.path && dayIn(l.day, period)).map(l => l.day).sort()[0]
          return cameBack(d.path, first) ? [{ title: d.title, path: d.path, kind: group, id: `${group}:${d.path}@${first}` }] : []
        })),
    ].sort((a, b) => compareTitles(a.title, b.title)),
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

/** What a stretch of time held, for the Habits charts: in the Insights order. */
export interface HabitCounts {
  /** Movie viewings (Plex entries less than 12 hours apart are one). */
  movies: number
  episodes: number
  /** Days your daily notes link a book, and a game. */
  bookDays: number
  gameDays: number
  songs: number
}

export function habitCounts(events: WatchEvent[], days: DayLink[], period: Period): HabitCounts {
  const now = events.filter(e => inPeriod(e.viewedAt, period))
  // One viewing per sitting, as in Insights.
  let movies = 0
  const last = new Map<string, number>()
  for (const e of now.filter(e => e.kind === 'movie').sort((a, b) => a.viewedAt - b.viewedAt)) {
    const before = last.get(e.key)
    if (before === undefined || e.viewedAt - before >= VIEWING_GAP) movies++
    last.set(e.key, e.viewedAt)
  }
  return {
    movies,
    episodes: now.filter(e => e.kind === 'episode').length,
    bookDays: daysWith(days, period, 'book'),
    gameDays: daysWith(days, period, 'game'),
    songs: now.filter(e => e.kind === 'track').length,
  }
}

/** "3 more than last week", "the same as last week", "1.5 fewer than last week": plain, never a judgement. */
export function compared(now: number, before: number, unit = ''): string {
  const diff = Math.round((now - before) * 10) / 10
  if (!diff) return 'the same as last week'
  return `${Math.abs(diff)}${unit} ${diff > 0 ? 'more' : 'fewer'} than last week`
}
