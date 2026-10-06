import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal stand-ins for the Obsidian API the sync uses.
const responses = new Map<string, unknown>()
const requested: string[] = []

const { TFile, TFolder } = vi.hoisted(() => {
  class TAbstractFile { constructor(public path: string) {} }
  class TFile extends TAbstractFile {
    get basename(): string { return this.path.split('/').pop()!.replace(/\.[^.]+$/, '') }
  }
  class TFolder extends TAbstractFile {}
  return { TFile, TFolder }
})

vi.mock('obsidian', () => {
  class Unused {}
  return {
    TFile,
    TFolder,
    Notice: Unused,
    PluginSettingTab: Unused,
    Setting: Unused,
    normalizePath: (p: string) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
    requestUrl: vi.fn(({ url }: { url: string }) => {
      requested.push(url)
      const path = url.replace('http://plex:32400', '').split('?')[0]
      if (path.startsWith('/photo/')) {
        return Promise.resolve({ status: 200, arrayBuffer: new ArrayBuffer(4), headers: { 'content-type': 'image/jpeg' } })
      }
      const body = responses.get(path)
      return Promise.resolve(body ? { status: 200, json: body, headers: {} } : { status: 404, json: {}, headers: {} })
    }),
  }
})

const { PlexSync } = await import('../src/sync')
const { defaultSettings } = await import('../src/settings')

function makeApp(existing: Record<string, Record<string, unknown>>) {
  const files = new Map<string, { path: string }>()
  const frontmatter = new Map<string, Record<string, unknown>>()
  const binaries: string[] = []
  for (const [path, fm] of Object.entries(existing)) {
    files.set(path, new TFile(path))
    frontmatter.set(path, fm)
  }
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()].filter(f => f instanceof TFile && f.path.endsWith('.md')),
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      createFolder: (p: string) => { files.set(p, new TFolder(p)); return Promise.resolve() },
      create: (p: string) => { const f = new TFile(p); files.set(p, f); frontmatter.set(p, {}); return Promise.resolve(f) },
      createBinary: (p: string) => { files.set(p, new TFile(p)); binaries.push(p); return Promise.resolve() },
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => ({ frontmatter: frontmatter.get(f.path) }),
    },
    fileManager: {
      processFrontMatter: (f: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
        fn(frontmatter.get(f.path)!)
        return Promise.resolve()
      },
    },
  }
  return { app, files, frontmatter, binaries }
}

const movies = [
  { ratingKey: '1', type: 'movie', title: 'Arrival', year: 2016 },
  { ratingKey: '2', type: 'movie', title: 'Heat', year: 1995 },
  { ratingKey: '3', type: 'movie', title: 'Free Solo', year: 2018 },
]

beforeEach(() => {
  responses.clear()
  requested.length = 0
  responses.set('/identity', { MediaContainer: { machineIdentifier: 'srv' } })
  responses.set('/library/sections', { MediaContainer: { Directory: [
    { key: '1', title: 'Movies', type: 'movie' },
    { key: '2', title: 'TV Shows', type: 'show' },
    { key: '3', title: 'Music', type: 'artist' },
  ] } })
  responses.set('/library/sections/1/all', { MediaContainer: { Metadata: movies } })
  responses.set('/library/sections/2/all', { MediaContainer: { Metadata: [
    { ratingKey: '10', type: 'show', title: 'Severance', year: 2022 },
  ] } })
  responses.set('/library/metadata/1', { MediaContainer: { Metadata: [{
    ...movies[0], summary: 'Linguist meets aliens.', originallyAvailableAt: '2016-11-11',
    duration: 6960000, viewCount: 2, thumb: '/library/metadata/1/thumb/9', Genre: [{ tag: 'Sci-Fi' }, { tag: 'Drama' }],
  }] } })
  responses.set('/library/metadata/3', { MediaContainer: { Metadata: [{ ...movies[2], Genre: [{ tag: 'Documentary' }, { tag: 'Sport' }] }] } })
  responses.set('/library/metadata/10', { MediaContainer: { Metadata: [{
    ratingKey: '10', type: 'show', title: 'Severance', year: 2022, leafCount: 19, viewedLeafCount: 19,
    originallyAvailableAt: '2022-02-18', duration: 3000000, Genre: [{ tag: 'Thriller' }],
  }] } })
})

describe('PlexSync', () => {
  it('creates notes only for items without one, in the right folders', async () => {
    const { app, frontmatter, binaries } = makeApp({ 'Media/Movies/Heat.md': {} })
    const settings = { ...defaultSettings(), serverUrl: 'plex:32400', token: 't' }
    const save = vi.fn(() => Promise.resolve())

    const result = await new PlexSync(app as never, settings, save).run(() => {})

    expect(result.failed).toEqual([])
    expect(result.skipped).toBe(1)
    expect(result.created.sort()).toEqual([
      'Media/Documentaries/Free Solo (2018).md',
      'Media/Movies/Arrival (2016).md',
      'Media/TV Shows/Severance (2022).md',
    ])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toEqual({
      Genre: ['Sci-Fi', 'Drama'],
      Summary: 'Linguist meets aliens.',
      Date: '2016-11-11',
      Duration: 116,
      Status: 'completed',
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F1',
      Image: '[[Media/Movies/Images/Arrival (2016).jpg]]',
      tags: ['movie'],
    })
    expect(frontmatter.get('Media/TV Shows/Severance (2022).md')).toMatchObject({ Status: 'completed', tags: ['tv_show'] })
    expect(frontmatter.get('Media/Documentaries/Free Solo (2018).md')).toMatchObject({ Genre: ['Sport'], Status: 'pending', tags: ['documentary'] })
    expect(binaries).toEqual(['Media/Movies/Images/Arrival (2016).jpg'])
    expect(settings.libraries).toEqual({
      1: { title: 'Movies', type: 'movie', target: 'movie' },
      2: { title: 'TV Shows', type: 'show', target: 'tv' },
      3: { title: 'Music', type: 'artist', target: 'skip' },
    })
    expect(requested.some(u => u.includes('/sections/3/'))).toBe(false)
  })

  it('does nothing on a second run', async () => {
    const { app } = makeApp({})
    const settings = { ...defaultSettings(), serverUrl: 'http://plex:32400/', token: 't' }
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    expect((await sync.run(() => {})).created).toHaveLength(4)
    const again = await sync.run(() => {})
    expect(again.created).toHaveLength(0)
    expect(again.skipped).toBe(4)
  })
})
