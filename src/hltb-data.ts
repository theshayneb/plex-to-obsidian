// HowLongToBeat search requests and results. No Obsidian imports, so it can be unit tested.
import { normalizeTitle } from './notes'

/** A game in HowLongToBeat's search results (times in seconds). */
export interface HltbGame {
  game_id: number
  game_name: string
  game_alias?: string
  release_world?: number
  comp_main?: number
  game_image?: string
  review_score?: number
}

/** A game's HowLongToBeat main story time, and its page. */
export interface HltbTimes {
  id: number
  name: string
  /** Main story, in hours. */
  main?: number
  url: string
  image?: string
}

export const HLTB = 'https://howlongtobeat.com'

/** Steam names often carry ™ and ®, which HowLongToBeat's names don't. */
export function searchTitle(title: string): string {
  return title.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim()
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

/** Seconds as hours, to one decimal place; undefined when HowLongToBeat has no time. */
export function hltbHours(seconds: number | undefined): number | undefined {
  return seconds && seconds > 0 ? Math.round(seconds / 360) / 10 : undefined
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
    main: hltbHours(game.comp_main),
    url: `${HLTB}/game/${game.game_id}`,
    image: game.game_image ? `${HLTB}/games/${encodeURIComponent(game.game_image)}` : undefined,
  }
}
