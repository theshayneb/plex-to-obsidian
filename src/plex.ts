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

  async libraryItems(libraryKey: string): Promise<PlexItem[]> {
    return (await this.get(`/library/sections/${encodeURIComponent(libraryKey)}/all`)).Metadata ?? []
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
