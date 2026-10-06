// Turning Steam's API responses into items. No Obsidian imports, so it can be unit tested.
import type { PlexItem } from './notes'

/** A game from IPlayerService/GetOwnedGames. */
export interface OwnedGame {
  appid: number
  name?: string
  playtime_forever?: number
  playtime_2weeks?: number
  rtime_last_played?: number
}

/** The parts of the store's appdetails `data` used here. */
export interface AppDetails {
  name?: string
  short_description?: string
  header_image?: string
  developers?: string[]
  publishers?: string[]
  genres?: { description: string }[]
  release_date?: { coming_soon?: boolean, date?: string }
  metacritic?: { score?: number }
  platforms?: { windows?: boolean, mac?: boolean, linux?: boolean }
}

/** What was typed as the Steam account: a 17-digit Steam ID, a profile URL, or a custom URL name. */
export function parseSteamAccount(input: string): { steamId: string } | { vanity: string } | null {
  const text = input.trim()
  if (!text) return null
  if (/^\d{17}$/.test(text)) return { steamId: text }
  const profile = /steamcommunity\.com\/profiles\/(\d{17})/i.exec(text)
  if (profile) return { steamId: profile[1] }
  const custom = /steamcommunity\.com\/id\/([^/?#]+)/i.exec(text)
  if (custom) return { vanity: decodeURIComponent(custom[1]) }
  return /^[\w-]+$/.test(text) ? { vanity: text } : null
}

export function gameItem(game: OwnedGame): PlexItem {
  return {
    ratingKey: `steam-${game.appid}`,
    type: 'game',
    title: game.name?.trim() || `Steam app ${game.appid}`,
    steamAppId: game.appid,
    playtimeMinutes: game.playtime_forever ?? 0,
    recentMinutes: game.playtime_2weeks ?? 0,
    lastViewedAt: game.rtime_last_played || undefined,
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Steam's release dates are text like "21 Aug, 2012", "Aug 21, 2012" or "Q4 2024". Returns
 * YYYY-MM-DD when there's a full date, and the year when there's one.
 */
export function parseSteamDate(text: string | undefined): { date?: string, year?: number } {
  if (!text) return {}
  const pad = (n: number) => String(n).padStart(2, '0')
  const dayFirst = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(text)
  const monthFirst = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text)
  const parts = dayFirst
    ? { day: Number(dayFirst[1]), month: MONTHS[dayFirst[2].toLowerCase()], year: Number(dayFirst[3]) }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: MONTHS[monthFirst[1].toLowerCase()], year: Number(monthFirst[3]) }
      : null
  if (parts?.month) return { date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, year: parts.year }
  const year = /\b(19|20)\d{2}\b/.exec(text)
  return year ? { year: Number(year[0]) } : {}
}

/** Store descriptions are HTML; notes get plain text. */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&trade;/g, '™')
    .replace(/&reg;/g, '®')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return text || undefined
}

/** The game with its store details added. */
export function withDetails(item: PlexItem, data: AppDetails | null): PlexItem {
  if (!data) return item
  const { date, year } = parseSteamDate(data.release_date?.date)
  const platforms = Object.entries(data.platforms ?? {})
    .filter(([, on]) => on)
    .map(([name]) => ({ windows: 'Windows', mac: 'macOS', linux: 'Linux' } as Record<string, string>)[name] ?? name)
  return {
    ...item,
    title: item.title || data.name || item.title,
    summary: plainText(data.short_description),
    Genre: (data.genres ?? []).map(g => ({ tag: g.description })),
    originallyAvailableAt: date,
    year,
    developers: data.developers ?? [],
    publishers: data.publishers ?? [],
    platforms,
    metacritic: data.metacritic?.score,
    wideImage: data.header_image,
  }
}

/** Places Steam keeps a game's portrait (600×900) cover, most likely first. */
export function portraitCandidates(appId: number, assetUrlFormat?: string, libraryCapsule?: string): string[] {
  const urls: string[] = []
  if (assetUrlFormat && libraryCapsule) {
    urls.push(`https://shared.cloudflare.steamstatic.com/store_item_assets/${assetUrlFormat.replace('${FILENAME}', libraryCapsule)}`)
  }
  urls.push(
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
  )
  return [...new Set(urls)]
}
