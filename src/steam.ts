import { requestUrl } from 'obsidian'
import type { PlexItem } from './notes'
import { gameItem, parseSteamAccount, portraitCandidates, withDetails, type AppDetails, type OwnedGame } from './steam-data'

const API = 'https://api.steampowered.com'
const STORE = 'https://store.steampowered.com'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

/** Reads a Steam account's games from the Steam Web API, and each game's details from the Steam Store. */
export class SteamClient {
  /** The store allows about 200 requests in 5 minutes, so its requests are spaced out. */
  static storeGapMs = 1500
  /** How long to wait when the store says to slow down, before trying again. */
  static retryAfterMs = 60_000
  private lastStoreRequest = 0
  private resolvedId: string | null = null

  constructor(private readonly apiKey: string, private readonly account: string, private readonly includeFreeGames: boolean) {}

  private async getJson(url: string): Promise<unknown> {
    const res = await requestUrl({ url, throw: false })
    if (res.status === 401 || res.status === 403) throw new Error(`Steam refused the request (${res.status}); check the API key`)
    if (res.status >= 400) throw new Error(`Steam returned ${res.status}`)
    return res.json as unknown
  }

  /** The account's 64-bit Steam ID, looking up a custom URL name if that's what was entered. */
  async steamId(): Promise<string> {
    if (this.resolvedId) return this.resolvedId
    const parsed = parseSteamAccount(this.account)
    if (!parsed) throw new Error('Enter your Steam ID or profile address in the plugin settings')
    if ('steamId' in parsed) return (this.resolvedId = parsed.steamId)
    const body = await this.getJson(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(this.apiKey)}&vanityurl=${encodeURIComponent(parsed.vanity)}`) as
      { response?: { success?: number, steamid?: string } }
    if (body.response?.success !== 1 || !body.response.steamid) throw new Error(`No Steam profile is called "${parsed.vanity}"`)
    return (this.resolvedId = body.response.steamid)
  }

  /** Every game the account owns (and free games played, if wanted), with playtimes. */
  async ownedGames(): Promise<PlexItem[]> {
    const id = await this.steamId()
    // Free games: played ones, ones added to the library but never played (free licences), and
    // newer ones Steam hasn't finished reviewing ("unvetted"), which are otherwise left out.
    const free = this.includeFreeGames ? '&include_played_free_games=1&include_free_sub=1&skip_unvetted_apps=0' : '&include_played_free_games=0'
    const query = `key=${encodeURIComponent(this.apiKey)}&steamid=${id}&include_appinfo=1${free}&format=json`
    const body = await this.getJson(`${API}/IPlayerService/GetOwnedGames/v1/?${query}`) as { response?: { games?: OwnedGame[] } }
    const games = body.response?.games
    if (!games) throw new Error('Steam listed no games. In your Steam profile\'s privacy settings, set "Game details" to Public')
    return games.map(gameItem)
  }

  /** Tag names by ID, fetched once. */
  private static tagNames: Promise<Map<number, string>> | null = null

  /** The game's store details (genres, release date, description, art), portrait cover and tags. */
  async details(item: PlexItem): Promise<PlexItem> {
    const appId = item.steamAppId
    if (!appId) return item
    const data = await this.appDetails(appId)
    const { portrait, tags } = await this.storeItem(appId)
    return { ...withDetails(item, data), portrait, steamTags: tags }
  }

  private async tagNames(): Promise<Map<number, string>> {
    SteamClient.tagNames ??= this.getJson(`${API}/IStoreService/GetTagList/v1/?language=english`)
      .then(body => new Map(((body as { response?: { tags?: { tagid: number, name: string }[] } }).response?.tags ?? []).map(t => [t.tagid, t.name])))
      .catch(() => {
        SteamClient.tagNames = null
        return new Map<number, string>()
      })
    return SteamClient.tagNames
  }

  private async appDetails(appId: number): Promise<AppDetails | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.lastStoreRequest + SteamClient.storeGapMs - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastStoreRequest = Date.now()
      const res = await requestUrl({ url: `${STORE}/api/appdetails?appids=${appId}&l=english`, throw: false })
      if (res.status === 429) {
        await sleep(SteamClient.retryAfterMs)
        continue
      }
      if (res.status >= 400) throw new Error(`the Steam Store returned ${res.status}`)
      const body = res.json as Record<string, { success?: boolean, data?: AppDetails }> | null
      const entry = body?.[String(appId)]
      return entry?.success ? entry.data ?? null : null
    }
    throw new Error('the Steam Store is limiting requests; try again in a few minutes')
  }

  /** The first portrait cover URL that exists (or undefined), and the store's player tags. */
  private async storeItem(appId: number): Promise<{ portrait?: string, tags?: string[] }> {
    let format: string | undefined
    let capsule: string | undefined
    let tags: string[] | undefined
    try {
      const input = JSON.stringify({
        ids: [{ appid: appId }],
        context: { language: 'english', country_code: 'US' },
        data_request: { include_assets: true, include_tag_count: 20 },
      })
      const body = await this.getJson(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(input)}`) as
        { response?: { store_items?: { assets?: { asset_url_format?: string, library_capsule?: string }, tagids?: number[] }[] } }
      const found = body.response?.store_items?.[0]
      format = found?.assets?.asset_url_format
      capsule = found?.assets?.library_capsule
      if (found?.tagids?.length) {
        const names = await this.tagNames()
        tags = found.tagids.map(id => names.get(id)).filter((name): name is string => Boolean(name))
      }
    } catch {
      // fall back to the usual addresses
    }
    return { portrait: await this.portraitAt(appId, format, capsule), tags }
  }

  /** The first portrait cover URL that exists, or undefined. */
  private async portraitAt(appId: number, format: string | undefined, capsule: string | undefined): Promise<string | undefined> {
    for (const url of portraitCandidates(appId, format, capsule)) {
      try {
        const res = await requestUrl({ url, method: 'HEAD', throw: false })
        if (res.status < 400) return url
      } catch {
        // try the next one
      }
    }
    return undefined
  }
}
