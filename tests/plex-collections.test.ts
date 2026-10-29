import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plex's answers by path, and every request sent (method and path, with its query).
const responses = new Map<string, unknown>()
const sent: string[] = []

vi.mock('obsidian', () => ({
  normalizePath: (p: string) => p.replace(/\/+$/, ''),
  requestUrl: vi.fn(({ url, method }: { url: string, method?: string }) => {
    const full = decodeURIComponent(url.replace('http://plex:32400', ''))
    sent.push(`${method ?? 'GET'} ${full}`)
    const body = method && method !== 'GET' ? { MediaContainer: { Metadata: [{ ratingKey: '900' }] } } : responses.get(full.split('?')[0])
    return Promise.resolve(body ? { status: 200, json: body, headers: {} } : { status: 404, json: {}, headers: {} })
  }),
}))

const { planCollections, sendCollections } = await import('../src/plex-collections')
const { defaultSettings, newLibrary } = await import('../src/config')

const link = (key: string) => `https://app.plex.tv/desktop/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F${key}`

function setup(notes: Record<string, Record<string, unknown>>) {
  const app = {
    vault: { getMarkdownFiles: () => Object.keys(notes).map(path => ({ path, basename: path.split('/').pop()!.replace(/\.md$/, '') })) },
    metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: notes[f.path] }) },
  }
  const settings = { ...defaultSettings(), serverUrl: 'http://plex:32400', token: 't', collectionRules: 'Comfort: comfort\nFound family: found family' }
  settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
  return { app, settings }
}

beforeEach(() => {
  responses.clear()
  sent.length = 0
  responses.set('/identity', { MediaContainer: { machineIdentifier: 'abc' } })
  responses.set('/library/metadata/1,2,3,4', { MediaContainer: { Metadata: [
    { ratingKey: '1', type: 'movie', title: 'Heat', librarySectionID: 1 },
    { ratingKey: '2', type: 'movie', title: 'Paddington', librarySectionID: 1 },
    { ratingKey: '3', type: 'movie', title: 'Elf', librarySectionID: 1 },
    { ratingKey: '4', type: 'episode', title: 'Pilot', librarySectionID: 2 },
  ] } })
  responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
    { ratingKey: '50', title: 'Heists' },
    { ratingKey: '51', title: 'Comfort', smart: 1 },
  ] } })
  responses.set('/library/collections/50/children', { MediaContainer: { Metadata: [
    { ratingKey: '1', title: 'Heat' }, { ratingKey: '9', title: 'Ronin' },
  ] } })
})

describe('Plex collections from notes', () => {
  it('plans each named and tagged collection, what it adds and removes, and leaves smart ones alone', async () => {
    const { app, settings } = setup({
      'Media/Movies/Heat (1995).md': { Link: link('1'), Collections: ['Heists', 'Michael Mann'] },
      'Media/Movies/Paddington (2014).md': { Link: link('2'), tags: ['movie', 'comfort'], collections: 'Bears' },
      'Media/Movies/Elf (2003).md': { Link: link('3'), tags: ['#comfort'], Themes: ['Found Family'] },
      'Media/Movies/Pilot.md': { Link: link('4'), Collections: ['Heists'] },
      'Media/Movies/No link.md': { Collections: ['Heists'] },
      'Media/Movies/Nothing.md': { Link: link('5') },
    })
    const { plans, leftOut, unchanged } = await planCollections(app as never, settings)
    expect(plans.map(p => [p.name, p.existing, p.add.map(a => a.title), p.remove.map(r => r.title), p.auto])).toEqual([
      ['Bears', null, ['Paddington (2014)'], [], false],
      ['Found family', null, ['Elf (2003)'], [], true],
      ['Heists', '50', [], ['Ronin'], false],
      ['Michael Mann', null, ['Heat (1995)'], [], false],
    ])
    expect(unchanged).toBe(0)
    expect(leftOut.map(l => l.reason)).toEqual([
      'no Plex link',
      'its Link is to an episode in Plex, not a movie or show',
      '"Comfort" in Movies is a smart collection in Plex, which can\'t be filled from notes',
    ])
    // Only the automatic ones (Comfort is smart, so just Found family).
    expect((await planCollections(app as never, settings, 'auto')).plans.map(p => p.name)).toEqual(['Found family'])
    sent.length = 0

    await sendCollections(settings, plans)
    expect(sent.filter(r => !r.startsWith('GET'))).toEqual([
      'POST /library/collections?type=1&smart=0&sectionId=1&title=Bears&uri=server://abc/com.plexapp.plugins.library/library/metadata/2',
      'POST /library/collections?type=1&smart=0&sectionId=1&title=Found family&uri=server://abc/com.plexapp.plugins.library/library/metadata/3',
      'DELETE /library/collections/50/items/9',
      'POST /library/collections?type=1&smart=0&sectionId=1&title=Michael Mann&uri=server://abc/com.plexapp.plugins.library/library/metadata/1',
    ])
  })
})
