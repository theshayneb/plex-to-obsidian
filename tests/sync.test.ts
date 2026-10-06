import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal stand-ins for the Obsidian API the sync uses.
const responses = new Map<string, unknown>()
const requested: string[] = []

const { TFile, TFolder } = vi.hoisted(() => {
  class TAbstractFile { constructor(public path: string) {} }
  class TFile extends TAbstractFile {
    get basename(): string { return this.path.split('/').pop()!.replace(/\.[^.]+$/, '') }
    get extension(): string { return this.path.split('.').pop()! }
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

import type { PlexNotesSettings } from '../src/config'

const { PlexSync } = await import('../src/sync')
const { defaultSettings, loadSettings, newLibrary } = await import('../src/config')

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
      renameFile: (f: { path: string }, to: string) => {
        files.delete(f.path)
        frontmatter.set(to, frontmatter.get(f.path)!)
        frontmatter.delete(f.path)
        f.path = to
        files.set(to, f)
        return Promise.resolve()
      },
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

const tracks = [
  { ratingKey: '100', type: 'track', title: 'Karma Police', grandparentTitle: 'Radiohead', parentTitle: 'OK Computer',
    parentRatingKey: '90', index: 6, duration: 264000, parentThumb: '/library/metadata/90/thumb/1' },
  { ratingKey: '101', type: 'track', title: 'Airbag', grandparentTitle: 'Radiohead', parentTitle: 'OK Computer',
    parentRatingKey: '90', index: 1, duration: 287000, parentThumb: '/library/metadata/90/thumb/1' },
  { ratingKey: '102', type: 'track', title: 'Intro', grandparentTitle: 'Various Artists', originalTitle: 'DJ X',
    parentTitle: 'Mix', parentRatingKey: '91', index: 1 },
  // Same artist and title as 101, on another album.
  { ratingKey: '103', type: 'track', title: 'Airbag', grandparentTitle: 'Radiohead', parentTitle: 'Live',
    parentRatingKey: '92', index: 3 },
]

beforeEach(() => {
  responses.clear()
  requested.length = 0
  responses.set('/identity', { MediaContainer: { machineIdentifier: 'srv' } })
  responses.set('/library/sections', { MediaContainer: { Directory: [
    { key: '1', title: 'Movies', type: 'movie' },
    { key: '2', title: 'TV Shows', type: 'show' },
    { key: '3', title: "Shayne's Music", type: 'artist' },
    { key: '4', title: 'Documentaries', type: 'movie' },
    { key: '5', title: 'Photos', type: 'photo' },
  ] } })
  responses.set('/library/sections/1/all', { MediaContainer: { Metadata: movies } })
  responses.set('/library/sections/2/all', { MediaContainer: { Metadata: [
    { ratingKey: '10', type: 'show', title: 'Severance', year: 2022 },
  ] } })
  responses.set('/library/sections/3/all', { MediaContainer: { Metadata: tracks } })
  responses.set('/library/sections/4/all', { MediaContainer: { Metadata: [] } })
  responses.set('/library/metadata/1', { MediaContainer: { Metadata: [{
    ...movies[0], summary: 'Linguist meets aliens.', originallyAvailableAt: '2016-11-11',
    duration: 6960000, viewCount: 2, thumb: '/library/metadata/1/thumb/9', Genre: [{ tag: 'Sci-Fi' }, { tag: 'Drama' }],
  }] } })
  responses.set('/library/metadata/3', { MediaContainer: { Metadata: [{ ...movies[2], Genre: [{ tag: 'Documentary' }, { tag: 'Sport' }] }] } })
  responses.set('/library/metadata/10', { MediaContainer: { Metadata: [{
    ratingKey: '10', type: 'show', title: 'Severance', year: 2022, leafCount: 19, viewedLeafCount: 19,
    originallyAvailableAt: '2022-02-18', duration: 3000000, Genre: [{ tag: 'Thriller' }],
  }] } })
  responses.set('/library/metadata/90', { MediaContainer: { Metadata: [{
    ratingKey: '90', type: 'album', title: 'OK Computer', year: 1997, originallyAvailableAt: '1997-05-21',
    studio: 'Parlophone', Genre: [{ tag: 'Alternative' }], Style: [{ tag: 'Art Rock' }],
  }] } })
})

/** Music libraries start skipped, so the tests switch one on, as the owner would. */
const settingsWith = (extra: object = {}): PlexNotesSettings => ({
  ...defaultSettings(),
  serverUrl: 'plex:32400',
  token: 't',
  libraries: { 3: newLibrary("Shayne's Music", 'artist', 'music') },
  ...extra,
})

describe('PlexSync', () => {
  it('creates notes only for items without one, using each library\'s settings', async () => {
    const { app, files, frontmatter, binaries } = makeApp({
      'Media/Movies/Heat.md': { Status: 'abandoned' },
      'Media/Music/Intro.md': {},
    })
    const settings = settingsWith()
    const save = vi.fn(() => Promise.resolve())

    const result = await new PlexSync(app as never, settings, save).run(() => {})

    expect(result.failed).toEqual([])
    expect(result.skipped).toBe(1)
    expect(result.renamed).toEqual([{ from: 'Media/Movies/Heat.md', to: 'Media/Movies/Heat (1995).md' }])
    expect(files.has('Media/Movies/Heat.md')).toBe(false)
    // Only the empty Link is filled in; Plex has no summary for it here, and Status is left alone.
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toEqual({
      Status: 'abandoned',
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F2',
    })
    expect(result.filled).toEqual(['Media/Movies/Heat (1995).md'])
    expect(result.created.sort()).toEqual([
      'Media/Documentaries/Free Solo (2018).md',
      'Media/Movies/Arrival (2016).md',
      'Media/Music/DJ X - Intro.md',
      'Media/Music/Radiohead - Airbag 2.md',
      'Media/Music/Radiohead - Airbag.md',
      'Media/Music/Radiohead - Karma Police.md',
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
    expect(frontmatter.get('Media/Music/Radiohead - Karma Police.md')).toEqual({
      Artist: 'Radiohead',
      Album: 'OK Computer',
      Track: 6,
      Genre: ['Alternative'],
      Date: '1997-05-21',
      Duration: '4:24',
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F100',
      Image: '[[Media/Music/Images/Radiohead - OK Computer.jpg]]',
      tags: ['music'],
    })
    expect(frontmatter.get('Media/Music/DJ X - Intro.md')).toMatchObject({ Artist: 'DJ X', Album: 'Mix', Genre: [], Image: null })
    expect(binaries.sort()).toEqual(['Media/Movies/Images/Arrival (2016).jpg', 'Media/Music/Images/Radiohead - OK Computer.jpg'])
    expect(requested.filter(u => u.includes('/library/metadata/90')).length).toBe(1)
    expect(requested.some(u => u.includes('/library/metadata/100'))).toBe(false)
    expect(Object.fromEntries(Object.entries(settings.libraries).map(([k, lib]) => [k, lib.target]))).toEqual({
      1: 'movie', 2: 'tv', 3: 'music', 4: 'documentary', 5: 'skip',
    })
    expect(requested.some(u => u.includes('/sections/5/'))).toBe(false)
    expect(requested.find(u => u.includes('/sections/3/all'))).toContain('type=10')
  })

  it('uses each library\'s own folder, file name and properties', async () => {
    const { app, frontmatter } = makeApp({})
    const settings = settingsWith()
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    await sync.run(() => {})
    const music = settings.libraries['3']
    music.folder = 'Songs'
    music.fileNameFormat = '{{track}} {{title}} ({{album}})'
    music.properties = [{ name: 'By', source: 'artist' }]
    music.values.tag = 'song'
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: [
      { ratingKey: '104', type: 'track', title: 'Lucky', grandparentTitle: 'Radiohead', parentTitle: 'OK Computer', parentRatingKey: '90', index: 11 },
    ] } })
    const result = await sync.run(() => {})
    expect(result.created).toEqual(['Songs/11 Lucky (OK Computer).md'])
    expect(frontmatter.get('Songs/11 Lucky (OK Computer).md')).toEqual({ By: 'Radiohead' })
  })

  it('fills in only the chosen properties, and only where empty', async () => {
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{
      ...movies[1], summary: 'Cops and robbers.', Genre: [{ tag: 'Crime' }], studio: 'Warner',
    }] } })
    const { app, frontmatter } = makeApp({
      'Media/Movies/Heat (1995).md': { Summary: '', Link: 'my own link', Genre: ['Mine'] },
    })
    const settings = settingsWith()
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    await sync.run(() => {})
    const movieLib = settings.libraries['1']
    movieLib.properties.push({ name: 'Studio', source: 'studio', fill: true })
    movieLib.properties.find(m => m.name === 'Genre')!.fill = true
    await sync.run(() => {})
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toEqual({
      Summary: 'Cops and robbers.',
      Link: 'my own link',
      Genre: ['Mine'],
      Studio: 'Warner',
    })
  })

  it('matches only by Plex link when a library is set to', async () => {
    const { app } = makeApp({ 'Media/Movies/Heat.md': {} })
    const settings = settingsWith()
    settings.libraries['1'] = newLibrary('Movies', 'movie', 'movie')
    settings.libraries['1'].matchBy = 'link'
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(result.renamed).toEqual([])
    expect(result.created).toContain('Media/Movies/Heat (1995).md')
  })

  it('updates play counts on every sync only when switched on', async () => {
    const { app, frontmatter } = makeApp({ 'Media/Movies/Heat (1995).md': { Plays: 1, Status: 'revisit' } })
    const settings = settingsWith()
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    await sync.run(() => {})
    settings.libraries['1'].properties.push({ name: 'Plays', source: 'viewCount' })
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], viewCount: 4 }] } })

    expect((await sync.run(() => {})).playCounts).toEqual([])
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Plays).toBe(1)

    settings.updatePlayCounts = true
    expect((await sync.run(() => {})).playCounts).toEqual(['Media/Movies/Heat (1995).md'])
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toMatchObject({ Plays: 4, Status: 'revisit' })
    expect((await sync.run(() => {})).playCounts).toEqual([])
  })

  it('only updates play counts in the background mode', async () => {
    const { app, files, frontmatter } = makeApp({ 'Media/Movies/Heat.md': { Plays: 0 } })
    const settings = settingsWith()
    settings.libraries['1'] = newLibrary('Movies', 'movie', 'movie')
    settings.libraries['1'].properties.push({ name: 'Plays', source: 'viewCount' })
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], viewCount: 2 }, movies[0]] } })
    const save = vi.fn(() => Promise.resolve())

    const result = await new PlexSync(app as never, settings, save).run(() => {}, 'playCounts')

    expect(result).toMatchObject({ created: [], renamed: [], filled: [], playCounts: ['Media/Movies/Heat.md'] })
    expect(frontmatter.get('Media/Movies/Heat.md')).toEqual({ Plays: 2 })
    expect(files.has('Media/Movies/Arrival (2016).md')).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('leaves names alone when renaming is off', async () => {
    const { app, files } = makeApp({ 'Media/Movies/Heat.md': {} })
    const result = await new PlexSync(app as never, settingsWith({ renameExistingNotes: false }), () => Promise.resolve()).run(() => {})
    expect(result.renamed).toEqual([])
    expect(files.has('Media/Movies/Heat.md')).toBe(true)
    expect(result.created).not.toContain('Media/Movies/Heat (1995).md')
  })

  it('does nothing on a second run, even with duplicate track names', async () => {
    const { app } = makeApp({})
    const sync = new PlexSync(app as never, settingsWith({ serverUrl: 'http://plex:32400/' }), () => Promise.resolve())
    expect((await sync.run(() => {})).created).toHaveLength(8)
    const again = await sync.run(() => {})
    expect(again.created).toHaveLength(0)
    expect(again.renamed).toEqual([])
    expect(again.failed).toEqual([])
    expect(again.skipped).toBe(8)
  })

  it('starts a new music library as skipped, with music defaults once switched on', async () => {
    const { app } = makeApp({})
    const settings = { ...defaultSettings(), serverUrl: 'plex:32400', token: 't' }
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(settings.libraries['3'].target).toBe('skip')
    expect(result.created.some(p => p.startsWith('Media/Music/'))).toBe(false)
    const { retarget } = await import('../src/config')
    retarget(settings.libraries['3'], 'music')
    expect(settings.libraries['3']).toMatchObject({ folder: 'Media/Music', fileNameFormat: '{{artist}} - {{title}}', values: { tag: 'music' } })
    expect(settings.libraries['3'].properties.map(p => p.name)).toEqual(['Artist', 'Album', 'Track', 'Genre', 'Date', 'Duration', 'Link', 'Image', 'tags'])
  })

  it('moves settings from older versions into each library', () => {
    const settings = loadSettings({
      serverUrl: 'x', token: 'y', moviesFolder: 'Films', fileNameFormat: '{{title}}',
      properties: [{ name: 'G', source: 'genres' }],
      values: { watched: 'seen', tags: { movie: 'film' } },
      libraries: {
        1: { title: 'Movies', type: 'movie', target: 'movie' },
        3: { title: 'Music', type: 'artist', target: 'skip' },
      },
    })
    expect(settings.libraries['1']).toEqual({
      title: 'Movies', type: 'movie', target: 'movie', folder: 'Films', fileNameFormat: '{{title}}', matchBy: 'loose',
      properties: [{ name: 'G', source: 'genres' }],
      values: { watched: 'seen', started: 'started', unwatched: 'pending', tag: 'film' },
    })
    expect(settings.libraries['3']).toMatchObject({ target: 'skip' })
    expect(settings.serverUrl).toBe('x')
  })
})
