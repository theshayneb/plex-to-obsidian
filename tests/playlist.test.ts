import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plex's answers by path, and every request sent (method and path, with its query).
const responses = new Map<string, unknown>()
const sent: string[] = []

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(({ url, method }: { url: string, method?: string }) => {
    const full = decodeURIComponent(url.replace('http://plex:32400', ''))
    sent.push(`${method ?? 'GET'} ${full}`)
    const body = method && method !== 'GET' ? { MediaContainer: { Metadata: [{ ratingKey: '900' }] } } : responses.get(full.split('?')[0])
    return Promise.resolve(body ? { status: 200, json: body, headers: {} } : { status: 404, json: {}, headers: {} })
  }),
}))

const { planPlaylist, sendPlaylist, songKeyOf } = await import('../src/playlist')
const { defaultSettings, newLibrary } = await import('../src/config')

function setup(notes: Record<string, Record<string, unknown>>) {
  const files = Object.keys(notes).map(path => ({ path }))
  const app = { metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: notes[f.path] }) } }
  const settings = { ...defaultSettings(), serverUrl: 'http://plex:32400', token: 't' }
  settings.libraries = { 5: newLibrary('Music', 'artist', 'music') }
  return { files, app, settings }
}

const link = (key: string) => `https://app.plex.tv/desktop/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F${key}`

beforeEach(() => {
  responses.clear()
  sent.length = 0
  responses.set('/identity', { MediaContainer: { machineIdentifier: 'abc' } })
  responses.set('/playlists', { MediaContainer: { Metadata: [] } })
  responses.set('/library/metadata/100,101,7', { MediaContainer: { Metadata: [
    { ratingKey: '100', type: 'track', title: 'Karma Police', grandparentTitle: 'Radiohead' },
    { ratingKey: '101', type: 'track', title: 'Airbag', grandparentTitle: 'Radiohead' },
    { ratingKey: '7', type: 'movie', title: 'Heat' },
  ] } })
})

describe('Plex playlists from a Base', () => {
  it('finds each note\'s song from its Plex link, or the item tied to it', () => {
    const { settings } = setup({})
    settings.merged = { 102: { path: 'Music/Intro.md' } } as never
    expect(songKeyOf({ Link: link('100') }, 'Music/a.md', settings)).toBe('100')
    expect(songKeyOf({ Link: 'https://store.steampowered.com/app/10/' }, 'Music/b.md', settings)).toBeNull()
    expect(songKeyOf({}, 'Music/Intro.md', settings)).toBe('102')
  })

  it('makes a new playlist of the songs in the Base\'s order, leaving out what isn\'t a song in Plex', async () => {
    const { files, app, settings } = setup({
      'Music/Karma Police.md': { Link: link('100') },
      'Music/No link.md': {},
      'Music/Airbag.md': { Link: link('101') },
      'Music/Airbag again.md': { Link: link('101') },
      'Movies/Heat.md': { Link: link('7') },
    })
    const plan = await planPlaylist(app as never, settings, 'Road trip', files as never)
    expect(plan.songs.map(s => s.title)).toEqual(['Karma Police (Radiohead)', 'Airbag (Radiohead)'])
    expect(plan.leftOut).toEqual([
      { path: 'Music/No link.md', reason: 'no Plex link' },
      { path: 'Music/Airbag again.md', reason: 'same song as a note above' },
      { path: 'Movies/Heat.md', reason: 'not a song in Plex' },
    ])
    expect(plan.existing).toBeNull()
    sent.length = 0
    await sendPlaylist(settings, plan)
    expect(sent).toEqual(['GET /identity', 'POST /playlists?type=audio&smart=0&title=Road trip&uri=server://abc/com.plexapp.plugins.library/library/metadata/100,101'])
  })

  it('empties and refills a playlist of that name that Plex already has', async () => {
    const { files, app, settings } = setup({ 'Music/Airbag.md': { Link: link('101') }, 'Music/Karma Police.md': { Link: link('100') } })
    responses.set('/library/metadata/101,100', responses.get('/library/metadata/100,101,7'))
    responses.set('/playlists', { MediaContainer: { Metadata: [{ ratingKey: '55', title: 'Road trip', smart: false, leafCount: 2 }] } })
    responses.set('/playlists/55/items', { MediaContainer: { Metadata: [{ playlistItemID: 1 }, { playlistItemID: 2 }] } })
    const plan = await planPlaylist(app as never, settings, 'Road trip', files as never)
    expect(plan.existing).toEqual({ ratingKey: '55', count: 2 })
    sent.length = 0
    await sendPlaylist(settings, plan)
    expect(sent).toEqual([
      'GET /identity',
      'GET /playlists/55/items',
      'DELETE /playlists/55/items/1',
      'DELETE /playlists/55/items/2',
      'PUT /playlists/55/items?uri=server://abc/com.plexapp.plugins.library/library/metadata/101,100',
    ])
  })

  it('won\'t fill a smart playlist', async () => {
    const { files, app, settings } = setup({ 'Music/Airbag.md': { Link: link('101') } })
    responses.set('/library/metadata/101', responses.get('/library/metadata/100,101,7'))
    responses.set('/playlists', { MediaContainer: { Metadata: [{ ratingKey: '55', title: 'Road trip', smart: true }] } })
    await expect(planPlaylist(app as never, settings, 'Road trip', files as never)).rejects.toThrow('smart playlist')
  })
})
