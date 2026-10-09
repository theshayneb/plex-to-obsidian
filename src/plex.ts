import { requestUrl } from 'obsidian'
import type { PlexItem } from './notes'

export interface PlexLibrary {
  key: string
  title: string
  type: string
}

export interface PlexImage {
  data: ArrayBuffer
  extension: string
}

interface MediaContainer {
  machineIdentifier?: string
  Directory?: PlexLibrary[]
  Metadata?: PlexItem[]
  totalSize?: number
}

export interface PlexPlaylist {
  ratingKey: string
  title: string
  smart?: boolean | number | string
  leafCount?: number
}

/** How Plex names a list of items in its own library, for a playlist. */
export function itemsUri(machineId: string, ratingKeys: string[]): string {
  return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`
}

export function normalizeServerUrl(url: string): string {
  let out = url.trim().replace(/\/+$/, '')
  if (out && !/^https?:\/\//i.test(out)) out = `http://${out}`
  return out
}

export class PlexClient {
  private readonly baseUrl: string

  constructor(serverUrl: string, private readonly token: string) {
    this.baseUrl = normalizeServerUrl(serverUrl)
  }

  private headers(accept: string): Record<string, string> {
    return { Accept: accept, 'X-Plex-Token': this.token }
  }

  private async get(path: string): Promise<MediaContainer> {
    const res = await requestUrl({
      url: `${this.baseUrl}${path}`,
      headers: this.headers('application/json'),
      throw: false,
    })
    if (res.status === 401) throw new Error('Plex rejected the token (401)')
    if (res.status >= 400) throw new Error(`Plex returned ${res.status} for ${path}`)
    const body = res.json as { MediaContainer?: MediaContainer }
    return body.MediaContainer ?? {}
  }

  async machineIdentifier(): Promise<string> {
    const id = (await this.get('/identity')).machineIdentifier
    if (!id) throw new Error('Plex did not return a server identifier')
    return id
  }

  async libraries(): Promise<PlexLibrary[]> {
    return (await this.get('/library/sections')).Directory ?? []
  }

  /** Every item in a library: movies or shows, or for music libraries every track. Read in pages. */
  async libraryItems(libraryKey: string, tracks = false): Promise<PlexItem[]> {
    const pageSize = 500
    const items: PlexItem[] = []
    for (let start = 0; ; start += pageSize) {
      // includeGuids gives each item's IMDb ID, to recognise notes added from IMDb before it was in Plex.
      const query = `${tracks ? 'type=10&' : 'includeGuids=1&'}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`
      const page = await this.get(`/library/sections/${encodeURIComponent(libraryKey)}/all?${query}`)
      const batch = page.Metadata ?? []
      items.push(...batch)
      const total = page.totalSize ?? 0
      if (batch.length < pageSize || (total && items.length >= total)) return items
    }
  }

  /**
   * Sets your rating of an item in Plex: 0–10 (two per star), or -1 to remove it. Plex answers
   * with no content.
   */
  async rate(ratingKey: string, rating: number): Promise<void> {
    const res = await requestUrl({
      url: `${this.baseUrl}/:/rate?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library&rating=${rating}`,
      method: 'PUT',
      headers: this.headers('application/json'),
      throw: false,
    })
    if (res.status === 401) throw new Error('Plex rejected the token (401)')
    if (res.status >= 400) throw new Error(`Plex returned ${res.status} when rating`)
  }

  /** Sends a request that changes something in Plex (playlists), answering with what Plex returns. */
  private async send(method: 'POST' | 'PUT' | 'DELETE', path: string): Promise<MediaContainer> {
    const res = await requestUrl({ url: `${this.baseUrl}${path}`, method, headers: this.headers('application/json'), throw: false })
    if (res.status === 401) throw new Error('Plex rejected the token (401)')
    if (res.status >= 400) throw new Error(`Plex returned ${res.status} for ${path.split('?')[0]}`)
    try {
      return (res.json as { MediaContainer?: MediaContainer }).MediaContainer ?? {}
    } catch {
      return {}
    }
  }

  /** Several items at once (as many as Plex still has), in batches. */
  async items(ratingKeys: string[]): Promise<PlexItem[]> {
    const out: PlexItem[] = []
    const notFound = (err: unknown) => err instanceof Error && err.message.includes(' 404 ')
    for (let start = 0; start < ratingKeys.length; start += 100) {
      const batch = ratingKeys.slice(start, start + 100)
      let got: PlexItem[] = []
      try {
        got = (await this.get(`/library/metadata/${batch.map(encodeURIComponent).join(',')}`)).Metadata ?? []
      } catch (err) {
        // Plex can answer 404 for a whole batch when some of it no longer exists.
        if (!notFound(err)) throw err
      }
      out.push(...got)
      // Whatever the batch didn't bring back is asked for on its own, so one missing item never hides the rest.
      const seen = new Set(got.map(item => item.ratingKey))
      for (const key of batch.filter(k => !seen.has(k))) {
        try {
          const item = await this.item(key)
          if (item) out.push(item)
        } catch (err) {
          if (!notFound(err)) throw err
        }
      }
    }
    return out
  }

  /** Your music playlists. */
  async audioPlaylists(): Promise<PlexPlaylist[]> {
    return ((await this.get('/playlists?playlistType=audio')).Metadata ?? []) as unknown as PlexPlaylist[]
  }

  /** The entries of a playlist, each with the id Plex removes it by. */
  async playlistEntries(playlistKey: string): Promise<{ playlistItemID: number }[]> {
    return ((await this.get(`/playlists/${encodeURIComponent(playlistKey)}/items`)).Metadata ?? []) as unknown as { playlistItemID: number }[]
  }

  /** Makes a music playlist of these items, in this order, and answers with its key. */
  async createAudioPlaylist(title: string, machineId: string, ratingKeys: string[]): Promise<string> {
    const made = await this.send('POST', `/playlists?type=audio&smart=0&title=${encodeURIComponent(title)}&uri=${encodeURIComponent(itemsUri(machineId, ratingKeys))}`)
    const key = made.Metadata?.[0]?.ratingKey
    if (!key) throw new Error('Plex did not return the new playlist')
    return key
  }

  /** Adds these items to the end of a playlist, in this order. */
  async addToPlaylist(playlistKey: string, machineId: string, ratingKeys: string[]): Promise<void> {
    await this.send('PUT', `/playlists/${encodeURIComponent(playlistKey)}/items?uri=${encodeURIComponent(itemsUri(machineId, ratingKeys))}`)
  }

  async removeFromPlaylist(playlistKey: string, playlistItemID: number): Promise<void> {
    await this.send('DELETE', `/playlists/${encodeURIComponent(playlistKey)}/items/${playlistItemID}`)
  }

  /** Full metadata; the library listing can leave out some genres. */
  async item(ratingKey: string): Promise<PlexItem | null> {
    return (await this.get(`/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1`)).Metadata?.[0] ?? null
  }

  /** Downloads a poster, resized by Plex's transcoder, falling back to the original image. */
  async poster(thumb: string): Promise<PlexImage | null> {
    const urls = [
      `${this.baseUrl}/photo/:/transcode?width=600&height=900&minSize=1&upscale=1&url=${encodeURIComponent(thumb)}`,
      `${this.baseUrl}${thumb}`,
    ]
    for (const url of urls) {
      try {
        const res = await requestUrl({ url, headers: this.headers('image/*'), throw: false })
        if (res.status >= 400 || res.arrayBuffer.byteLength === 0) continue
        return { data: res.arrayBuffer, extension: imageExtension(res.headers['content-type'] ?? res.headers['Content-Type']) }
      } catch {
        // try the next URL
      }
    }
    return null
  }
}

function imageExtension(contentType: string | undefined): string {
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  return 'jpg'
}
