import { Platform, requestUrl } from 'obsidian'
import { HLTB, hltbTimes, pickMatch, searchBody, type HltbGame, type HltbTimes } from './hltb-data'

interface Response {
  status: number
  text: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

/** HowLongToBeat only answers requests that say they come from its own site. */
const HEADERS = { Referer: `${HLTB}/` }

/**
 * Looks up games' times on HowLongToBeat, the way its own search page does: a short-lived token
 * from /api/search/site/init, then the search, sent with that token.
 */
export class HltbClient {
  static gapMs = 1000
  private token: string | null = null
  private last = 0

  /** The game's times, or null when HowLongToBeat has no game with that exact name. */
  async times(title: string, year?: number): Promise<HltbTimes | null> {
    const results = await this.search(title)
    const match = pickMatch(results, title, year)
    return match ? hltbTimes(match) : null
  }

  private async search(title: string): Promise<HltbGame[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = this.token ?? await this.newToken()
      const res = await this.send('POST', '/api/search/site', JSON.stringify(searchBody(title)), {
        'Content-Type': 'application/json',
        'x-auth-token': token,
      })
      if (res.status === 403) {
        // The token expired (they last a while): get a fresh one and try again.
        this.token = null
        continue
      }
      if (res.status === 429) {
        await sleep(60_000)
        continue
      }
      if (res.status >= 400) throw new Error(`HowLongToBeat returned ${res.status}`)
      return (JSON.parse(res.text) as { data?: HltbGame[] }).data ?? []
    }
    throw new Error('HowLongToBeat refused the search; try again later')
  }

  private async newToken(): Promise<string> {
    const res = await this.send('GET', `/api/search/site/init?t=${Date.now()}`)
    if (res.status >= 400) throw new Error(`HowLongToBeat refused to start a search (${res.status})`)
    const token = (JSON.parse(res.text) as { token?: string }).token
    if (!token) throw new Error('HowLongToBeat sent no search token')
    return (this.token = token)
  }

  /** One request, spaced out from the last. Falls back to Node on desktop if the Referer was dropped. */
  private async send(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
    const wait = this.last + HltbClient.gapMs - Date.now()
    if (wait > 0) await sleep(wait)
    this.last = Date.now()
    const all = { ...HEADERS, ...headers }
    const res = await requestUrl({ url: `${HLTB}${path}`, method, body, headers: all, throw: false })
    const denied = res.status === 403 && res.text.includes('Access Denied')
    if (denied && Platform.isDesktopApp) return nodeRequest(method, `${HLTB}${path}`, body, all)
    return { status: res.status, text: res.text }
  }
}

/** The bit of Node's https module used here (desktop only). */
interface NodeHttps {
  request(url: string, options: { method: string, headers: Record<string, string> }, callback: (res: {
    statusCode?: number
    setEncoding(encoding: string): void
    on(event: 'data' | 'end', listener: (chunk: string) => void): void
  }) => void): { on(event: 'error', listener: (err: Error) => void): void, write(body: string): void, end(): void }
}

/** A request through Node's https (desktop only), which sends every header as given. */
function nodeRequest(method: string, url: string, body: string | undefined, headers: Record<string, string>): Promise<Response> {
  const load = (window as unknown as { require?: (id: string) => unknown }).require
  const https = load?.('https') as NodeHttps | undefined
  if (!https) return Promise.resolve({ status: 403, text: 'Access Denied' })
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': String(new TextEncoder().encode(body).length) } : {}) } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
