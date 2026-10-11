// HowLongToBeat search requests and results. No Obsidian imports, so it can be unit tested.
import { normalizeTitle } from './notes'

/** A game in HowLongToBeat's search results (times in seconds). */
export interface HltbGame {
  game_id: number
  game_name: string
  game_alias?: string
  release_world?: number
  comp_main?: number
  /** Main story plus extras. */
  comp_plus?: number
  game_image?: string
  review_score?: number
  profile_platform?: string
}

/** A game's HowLongToBeat main story time, and its page. */
export interface HltbTimes {
  id: number
  name: string
  /** Main story, in minutes (main story plus extras when there's no main story time). */
  main?: number
  url: string
  image?: string
}

export const HLTB = 'https://howlongtobeat.com'

/** Steam names often carry ™ and ®, which HowLongToBeat's names don't. */
export function searchTitle(title: string): string {
  return title.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The names to look a game up by: its own, then without a subtitle or edition, since stores often
 * rename a game ("Slay the Princess — The Pristine Cut", "Hades: Definitive Edition") while
 * HowLongToBeat keeps the plain name.
 */
export function titleVariants(title: string): string[] {
  const own = searchTitle(title)
  const base = own
    .split(/\s+[—–-]\s+|:\s+/)[0]
    .replace(/\s+(?:-\s*)?(?:the\s+)?(?:definitive|complete|enhanced|anniversary|deluxe|ultimate|special|remastered|game of the year|goty)(?:\s+edition)?$/i, '')
    .replace(/\s+(?:director'?s|pristine|final)\s+cut$/i, '')
    .trim()
  return base && base !== own ? [own, base] : [own]
}

/** The body HowLongToBeat's own search page sends. */
export function searchBody(title: string): Record<string, unknown> {
  return {
    searchType: 'games',
    searchTerms: searchTitle(title).split(' '),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: '', flow: '', genre: '' },
        year: '',
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  }
}

/** Seconds as whole minutes (like Plex durations); undefined when HowLongToBeat has no time. */
export function hltbMinutes(seconds: number | undefined): number | undefined {
  return seconds && seconds > 0 ? Math.round(seconds / 60) : undefined
}

/**
 * The result that is this game: its name (or alias) must match the title, ignoring case and
 * punctuation. With several, the one released in the game's year wins. Never a near miss, so a
 * note never gets another game's times.
 */
export function pickMatch(results: HltbGame[], title: string, year?: number): HltbGame | null {
  const wanted = normalizeTitle(searchTitle(title))
  const same = results.filter(g =>
    normalizeTitle(g.game_name) === wanted || (g.game_alias ? g.game_alias.split(',').some(a => normalizeTitle(a) === wanted) : false))
  if (!same.length) return null
  return same.find(g => year && g.release_world === year) ?? same[0]
}

export function hltbTimes(game: HltbGame): HltbTimes {
  return {
    id: game.game_id,
    name: game.game_name,
    // Without a main story time, main story plus extras stands in.
    main: hltbMinutes(game.comp_main) ?? hltbMinutes(game.comp_plus),
    url: `${HLTB}/game/${game.game_id}`,
    image: game.game_image ? `${HLTB}/games/${encodeURIComponent(game.game_image)}` : undefined,
  }
}
