// Spotify: connecting once (you approve in the browser and Spotify sends you back to a little
// listener on this computer), then adding suggested songs to your "To Listen" playlist. Only your
// playlists can be changed. The pure parts are in spotify-data.ts.
import { Platform, requestUrl } from 'obsidian'
import type { PlexNotesSettings } from './config'
import { parseSearch, pickTrack, spotifyAuthUrl, spotifyError, SPOTIFY_PLAYLIST, SPOTIFY_REDIRECT, type SpotifyTrack } from './spotify-data'

const API = 'https://api.spotify.com/v1'
const TOKEN = 'https://accounts.spotify.com/api/token'

/** What connecting gives: kept in the settings, so every device can use it. */
export interface SpotifyAuth { accessToken: string, refreshToken: string, expiresAt: number }

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function randomText(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64url(bytes).slice(0, length)
}

async function tokenRequest(fields: Record<string, string>): Promise<SpotifyAuth & { refreshToken: string }> {
  const res = await requestUrl({ url: TOKEN, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams(fields).toString(), throw: false })
  let body: unknown = null
  try {
    body = res.json
  } catch {
    // not JSON
  }
  const b = body as { access_token?: unknown, refresh_token?: unknown, expires_in?: unknown } | null
  if (res.status >= 400 || typeof b?.access_token !== 'string') throw new Error(`Spotify: ${spotifyError(body) ?? `returned ${res.status}`}`)
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : fields.refresh_token ?? '',
    expiresAt: Date.now() + (Number(b.expires_in) || 3600) * 1000,
  }
}

/** The bit of Node's http module used to catch Spotify's answer (desktop only). */
interface NodeHttp {
  createServer(handler: (req: { url?: string }, res: { writeHead(status: number, headers: Record<string, string>): void, end(text: string): void }) => void): {
    listen(port: number, host: string, done: () => void): void
    on(event: 'error', handler: (err: Error) => void): void
    close(): void
  }
}

/**
 * Connects to Spotify: opens Spotify's page asking you to let the plugin change your playlists,
 * catches its answer on this computer, and keeps the result in the settings. Desktop only.
 */
export async function connectSpotify(settings: PlexNotesSettings, save: () => Promise<void>): Promise<void> {
  const clientId = settings.spotifyClientId.trim()
  if (!clientId) throw new Error('Paste your Spotify app\'s Client ID first')
  const http = Platform.isDesktopApp ? (window as unknown as { require?: (id: string) => unknown }).require?.('http') as NodeHttp | undefined : undefined
  if (!http) throw new Error('Connecting to Spotify works on a computer; once connected there, phones can use it too')
  const verifier = randomText(64)
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = randomText(16)
  const port = Number(new URL(SPOTIFY_REDIRECT).port)
  const code = await new Promise<string>((resolve, reject) => {
    let done = false
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', SPOTIFY_REDIRECT)
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('')
        return
      }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ok ? '<p>Connected to Spotify. You can close this tab and go back to Obsidian.</p>' : '<p>Spotify didn\'t connect. Go back to Obsidian and try again.</p>')
      finish(() => ok ? resolve(ok) : reject(new Error(`Spotify: ${url.searchParams.get('error') ?? 'not connected'}`)))
    })
    const timer = window.setTimeout(() => finish(() => reject(new Error('Spotify didn\'t answer within 3 minutes'))), 180_000)
    const finish = (then: () => void) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      server.close()
      then()
    }
    server.on('error', err => finish(() => reject(new Error(`Couldn't wait for Spotify's answer: ${err.message}`))))
    server.listen(port, '127.0.0.1', () => window.open(spotifyAuthUrl(clientId, challenge, state)))
  })
  settings.spotifyAuth = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier })
  await save()
}

/** Playlist ids found while Obsidian runs, by account. */
let playlistId: { token: string, id: string } | null = null

/** Adds songs to your Spotify "To Listen" playlist (made, private, if you have none). */
export class SpotifyClient {
  constructor(private readonly settings: PlexNotesSettings, private readonly save: () => Promise<void>) {}

  private async token(): Promise<string> {
    const auth = this.settings.spotifyAuth
    if (!auth) throw new Error('Connect Spotify in the plugin settings first')
    if (auth.expiresAt - 60_000 > Date.now()) return auth.accessToken
    this.settings.spotifyAuth = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: this.settings.spotifyClientId.trim() })
    await this.save()
    return this.settings.spotifyAuth.accessToken
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number, json: unknown }> {
    const res = await requestUrl({
      url: path.startsWith('http') ? path : `${API}${path}`,
      method,
      headers: { Authorization: `Bearer ${await this.token()}` },
      contentType: body ? 'application/json' : undefined,
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    })
    let json: unknown = null
    try {
      json = res.json
    } catch {
      // no body
    }
    return { status: res.status, json }
  }

  private async ok(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const { status, json } = await this.api(method, path, body)
    if (status === 429) throw new Error('Spotify is busy (too many requests); try again in a minute')
    if (status >= 400) throw new Error(`Spotify: ${spotifyError(json) ?? `returned ${status}`}`)
    return json
  }

  /** The song on Spotify: the same recording, else another version of it (`exact` false); null when Spotify hasn't got it. */
  async find(artist: string, title: string): Promise<{ track: SpotifyTrack, exact: boolean } | null> {
    for (const q of [`track:"${title}" artist:"${artist}"`, `${artist} ${title}`]) {
      const found = pickTrack(parseSearch(await this.ok('GET', `/search?type=track&limit=10&q=${encodeURIComponent(q)}`)), artist, title)
      if (found) return found
    }
    return null
  }

  /** Your "To Listen" playlist's id (any case), made if you have none. */
  private async playlist(): Promise<string> {
    const token = this.settings.spotifyAuth?.refreshToken ?? ''
    if (playlistId?.token === token) return playlistId.id
    let next: string | null = '/me/playlists?limit=50'
    while (next) {
      const page = await this.ok('GET', next) as { items?: { id?: string, name?: string }[], next?: string | null }
      const mine = (page.items ?? []).find(p => p.name?.trim().toLowerCase() === SPOTIFY_PLAYLIST.toLowerCase())
      if (mine?.id) {
        playlistId = { token, id: mine.id }
        return mine.id
      }
      next = page.next ?? null
    }
    const me = await this.ok('GET', '/me') as { id?: string }
    const made = await this.ok('POST', `/users/${encodeURIComponent(me.id ?? '')}/playlists`, { name: SPOTIFY_PLAYLIST, public: false, description: 'Songs to give a listen, from Media Manager' }) as { id?: string }
    if (!made.id) throw new Error('Spotify didn\'t make the playlist')
    playlistId = { token, id: made.id }
    return made.id
  }

  /** Adds a track to "To Listen". */
  async add(uri: string): Promise<void> {
    const id = await this.playlist()
    // Spotify has called this endpoint both "items" and "tracks": the other is tried if one isn't there.
    const first = await this.api('POST', `/playlists/${id}/items`, { uris: [uri] })
    if (first.status < 400) return
    if (first.status !== 404 && first.status !== 405) throw new Error(`Spotify: ${spotifyError(first.json) ?? `returned ${first.status}`}`)
    await this.ok('POST', `/playlists/${id}/tracks`, { uris: [uri] })
  }
}
