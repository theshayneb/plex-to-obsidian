import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal stand-ins for the Obsidian API the sync uses.
const responses = new Map<string, unknown>()
const requested: string[] = []
/** Steam answers, by the start of the request URL. */
let steamResponses: Record<string, unknown> = {}
const portraits = new Set<string>()

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
    Modal: Unused,
    FuzzySuggestModal: Unused,
    Platform: { isDesktopApp: false },
    PluginSettingTab: Unused,
    Setting: Unused,
    normalizePath: (p: string) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
    requestUrl: vi.fn(({ url, method }: { url: string, method?: string }) => {
      requested.push(url)
      if (url.startsWith('https://')) {
        if (method === 'HEAD') return Promise.resolve({ status: portraits.has(url) ? 200 : 404, headers: {} })
        const key = Object.keys(steamResponses).find(k => url.startsWith(k))
        return Promise.resolve(key
          ? { status: 200, json: steamResponses[key], text: JSON.stringify(steamResponses[key]), headers: {} }
          : { status: 404, json: {}, text: '{}', headers: {} })
      }
      const path = url.replace('http://plex:32400', '').split('?')[0]
      if (path.startsWith('/photo/')) {
        return Promise.resolve({ status: 200, arrayBuffer: new ArrayBuffer(4), headers: { 'content-type': 'image/jpeg' } })
      }
      const body = responses.get(path)
      return Promise.resolve(body ? { status: 200, json: body, headers: {} } : { status: 404, json: {}, headers: {} })
    }),
  }
})

import type { ApprovalRequest, Choice, Decision, OwnerRequest } from '../src/approval-modal'
import type { PlexNotesSettings } from '../src/config'

const { PlexSync } = await import('../src/sync')
const { SteamClient } = await import('../src/steam')
SteamClient.storeGapMs = 0
const { HltbClient } = await import('../src/hltb')
HltbClient.gapMs = 0
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
  responses.set('/library/sections/1/all', { MediaContainer: { Metadata: movies.slice(0, 2) } })
  responses.set('/library/sections/2/all', { MediaContainer: { Metadata: [
    { ratingKey: '10', type: 'show', title: 'Severance', year: 2022 },
  ] } })
  responses.set('/library/sections/3/all', { MediaContainer: { Metadata: tracks } })
  responses.set('/library/sections/4/all', { MediaContainer: { Metadata: [movies[2]] } })
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

  it('updates ratings on every sync only when switched on, and never clears them', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Heat (1995).md': { Rating: 3, Stars: '⭐⭐⭐', Plays: 1 },
      'Media/Movies/Arrival (2016).md': { Rating: 4 },
    })
    const settings = settingsWith()
    settings.libraries['1'] = newLibrary('Movies', 'movie', 'movie')
    settings.libraries['1'].properties.push({ name: 'Rating', source: 'userRating' }, { name: 'Stars', source: 'userRatingEmoji' }, { name: 'Plays', source: 'viewCount' })
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], userRating: 10, viewCount: 4 }, movies[0]] } })
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())

    expect((await sync.run(() => {})).playCounts).toEqual([])
    settings.updateRatings = true
    expect((await sync.run(() => {})).playCounts).toEqual(['Media/Movies/Heat (1995).md'])
    // Play counts stay as they were: only ratings are switched on.
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toMatchObject({ Rating: 5, Stars: '🩷', Plays: 1 })
    // Arrival has no rating in Plex, so its note keeps the one it has.
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toMatchObject({ Rating: 4 })
  })

  it('ties an item to a note you already have with "Use an existing note"', async () => {
    const mine = 'Media/Movies/My favourite film.md'
    const { app, files, frontmatter } = makeApp({ [mine]: { Status: 'revisit' } })
    const settings = settingsWith()
    const asked: string[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      asked.push(`${r.action} ${r.path}`)
      if (r.action === 'create' && r.path === 'Media/Movies/Arrival (2016).md') return Promise.resolve({ choice: 'merge', excluded: [], mergeWith: mine })
      if (r.action === 'change' && r.path === mine) return Promise.resolve({ choice: 'apply', excluded: ['add:Image'] })
      return Promise.resolve({ choice: 'skip', excluded: [] })
    })
    const save = vi.fn(() => Promise.resolve())
    const result = await new PlexSync(app as never, settings, save, approve).run(() => {})

    expect(result.merged).toEqual([mine])
    expect(result.filled).toEqual([mine])
    expect(files.has('Media/Movies/Arrival (2016).md')).toBe(false)
    // Everything missing is filled in; what was there stays.
    expect(frontmatter.get(mine)).toMatchObject({
      Status: 'revisit', Genre: ['Sci-Fi', 'Drama'], Summary: 'Linguist meets aliens.', tags: ['movie'],
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F1',
    })
    expect(frontmatter.get(mine)!.Image).toBeUndefined()
    expect(settings.merged['1']).toMatchObject({ path: mine, name: 'Arrival (2016)', library: 'Movies', libraryKey: '1' })
    expect(save).toHaveBeenCalled()

    // From now on it's Arrival's note: not offered again, and never renamed.
    asked.length = 0
    await new PlexSync(app as never, settings, save, approve).run(() => {})
    expect(asked.filter(a => a.includes('Arrival') || a.includes('My favourite film'))).toEqual([])
    expect(files.has(mine)).toBe(true)
  })

  it('shows the play count now and after', async () => {
    const { app } = makeApp({ 'Media/Movies/Heat (1995).md': { Plays: 1 } })
    const settings = settingsWith({ updatePlayCounts: true })
    settings.libraries['1'] = newLibrary('Movies', 'movie', 'movie')
    settings.libraries['1'].properties = [{ name: 'Plays', source: 'viewCount' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], viewCount: 3 }] } })
    const approve = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'stop' as const, excluded: [] }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(approve.mock.calls[0][0].lines).toEqual([{ key: 'update:Plays', label: 'Plays', current: '1', value: '3', edit: 'number' }])
  })

  it('only updates play counts in the background mode', async () => {
    const { app, files, frontmatter } = makeApp({ 'Media/Movies/Heat.md': { Plays: 0 } })
    const settings = settingsWith({ updatePlayCounts: true })
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

  it('asks before every change and creation, and does nothing it was not allowed to', async () => {
    const { app, files, frontmatter, binaries } = makeApp({ 'Media/Movies/Heat.md': {} })
    const settings = settingsWith()
    settings.libraries = {}
    const asked: string[] = []
    // Skip the change to Heat; skip Arrival; then create everything else.
    const answers: Record<string, string> = {
      'change Media/Movies/Heat.md': 'skip',
      'create Media/Movies/Arrival (2016).md': 'skip',
      'create Media/TV Shows/Severance (2022).md': 'all',
    }
    const approve = vi.fn((r: ApprovalRequest) => {
      asked.push(`${r.action} ${r.path}`)
      return Promise.resolve({ choice: (answers[`${r.action} ${r.path}`] ?? 'stop') as Choice, excluded: [] })
    })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    expect(approve.mock.calls[0][0].lines).toEqual([
      { key: 'rename', label: 'File name', current: 'Heat', value: 'Heat (1995)', edit: 'text' },
      { key: 'add:Link', label: 'Link', current: null, value: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F2', edit: 'text', items: undefined },
    ])
    const arrival = approve.mock.calls.find(c => c[0].path === 'Media/Movies/Arrival (2016).md')![0]
    expect(arrival.lines).toContainEqual({ key: 'prop:Image', label: 'Image', value: 'poster downloaded from Plex' })
    expect(arrival.lines).toContainEqual({ key: 'prop:Genre', label: 'Genre', value: 'Sci-Fi, Drama', edit: 'list', items: ['Sci-Fi', 'Drama'] })
    expect(arrival.lines[0]).toEqual({ key: 'file', label: 'File name', value: 'Arrival (2016)', edit: 'text', required: true })
    expect(files.has('Media/Movies/Heat.md')).toBe(true)
    expect(frontmatter.get('Media/Movies/Heat.md')).toEqual({})
    expect(files.has('Media/Movies/Arrival (2016).md')).toBe(false)
    expect(binaries).toEqual([])
    expect(result.created).toEqual(['Media/TV Shows/Severance (2022).md', 'Media/Documentaries/Free Solo (2018).md'])
    expect(result.declined).toBe(2)
    expect(result.stopped).toBe(false)
    // "Create all the rest" covered the documentary too: no more questions after Severance.
    expect(asked).toEqual([
      'change Media/Movies/Heat.md',
      'create Media/Movies/Arrival (2016).md',
      'create Media/TV Shows/Severance (2022).md',
    ])
  })

  it('leaves out the lines that were unticked, and remembers them for "all the rest"', async () => {
    const { app, files, frontmatter, binaries } = makeApp({ 'Media/Movies/Heat.md': {} })
    const settings = settingsWith()
    settings.libraries = {}
    const approve = vi.fn((r: ApprovalRequest) => Promise.resolve(r.action === 'change'
      ? { choice: 'apply' as const, excluded: ['rename'] }
      : { choice: 'all' as const, excluded: ['prop:Image', 'prop:Genre'] }))
    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    // Heat keeps its name but gets its Link.
    expect(result.renamed).toEqual([])
    expect(files.has('Media/Movies/Heat.md')).toBe(true)
    expect(frontmatter.get('Media/Movies/Heat.md')).toEqual({ Link: expect.stringContaining('metadata%2F2') as string })
    // New notes: asked once, then the same unticked properties for the rest; left empty, no posters.
    expect(approve.mock.calls.filter(c => c[0].action === 'create')).toHaveLength(1)
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toMatchObject({ Genre: [], Image: null, Summary: 'Linguist meets aliens.' })
    expect(frontmatter.get('Media/TV Shows/Severance (2022).md')).toMatchObject({ Genre: [] })
    expect(binaries).toEqual([])
  })

  it('saves what was edited in the pop-up', async () => {
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{
      ...movies[1], summary: 'Cops and robbers.', Genre: [{ tag: 'Crime' }, { tag: 'Drama' }],
    }] } })
    const { app, files, frontmatter } = makeApp({ 'Media/Movies/Heat.md': { Plays: 0 } })
    const settings = settingsWith({ updatePlayCounts: true })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    const movieLib = settings.libraries['1']
    movieLib.properties.find(m => m.name === 'Genre')!.fill = true
    movieLib.properties.push({ name: 'Plays', source: 'viewCount' })
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], viewCount: 2 }, movies[0]] } })
    const change: Decision = { choice: 'apply', excluded: [], edits: {
      rename: 'Heat: Director\'s Cut', 'add:Genre': ['Crime'], 'add:Summary': '  My summary  ', 'update:Plays': '5',
    } }
    const create: Decision = { choice: 'apply', excluded: [], edits: { file: 'Arrival', 'prop:Genre': ['Drama'], 'prop:Duration': '120' } }
    const approve = vi.fn((r: ApprovalRequest) => Promise.resolve(r.action === 'change' ? change : create))

    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    expect(files.has('Media/Movies/Heat Director\'s Cut.md')).toBe(true)
    expect(frontmatter.get('Media/Movies/Heat Director\'s Cut.md')).toMatchObject({ Genre: ['Crime'], Summary: 'My summary', Plays: 5 })
    expect(frontmatter.get('Media/Movies/Arrival.md')).toMatchObject({ Genre: ['Drama'], Duration: 120, Summary: 'Linguist meets aliens.' })
  })

  it('"Skip every time" ignores an item in every later sync, until un-ignored', async () => {
    const { app, files } = makeApp({})
    const settings = settingsWith()
    settings.libraries = {}
    const save = vi.fn(() => Promise.resolve())
    let ignoreArrival = true
    const decide = (r: ApprovalRequest): Choice => (ignoreArrival && r.path.includes('Arrival') ? 'ignore' : 'apply')
    const approve = vi.fn((r: ApprovalRequest) => Promise.resolve({ choice: decide(r), excluded: [] }))
    const sync = () => new PlexSync(app as never, settings, save, approve).run(() => {})

    const first = await sync()
    expect(first.newlyIgnored).toEqual(['Arrival (2016)'])
    expect(settings.ignored['1']).toMatchObject({ name: 'Arrival (2016)', library: 'Movies' })
    expect(files.has('Media/Movies/Arrival (2016).md')).toBe(false)
    expect(save).toHaveBeenCalled()

    approve.mockClear()
    const second = await sync()
    expect(second.ignored).toBe(1)
    expect(second.created).toEqual([])
    expect(approve.mock.calls.some(c => c[0].path.includes('Arrival'))).toBe(false)

    delete settings.ignored['1']
    ignoreArrival = false
    const third = await sync()
    expect(approve.mock.calls.some(c => c[0].path.includes('Arrival'))).toBe(true)
    expect(third.created).toEqual(['Media/Movies/Arrival (2016).md'])
  })

  it('never changes an ignored item\'s note, or lets another item claim it', async () => {
    const { app, files, frontmatter } = makeApp({ 'Media/Movies/Heat.md': { Plays: 0 } })
    const settings = settingsWith({ updatePlayCounts: true, askBeforeChanges: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties.push({ name: 'Plays', source: 'viewCount' })
    settings.ignored = { 2: { name: 'Heat (1995)', library: 'Movies', since: 0 } }
    // A second "Heat" that would otherwise be the only item matching Heat.md by title.
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
      { ...movies[1], viewCount: 3 }, { ratingKey: '9', type: 'movie', title: 'Heat', year: 1986 },
    ] } })

    const full = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    const background = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {}, 'playCounts')

    expect(files.has('Media/Movies/Heat.md')).toBe(true)
    expect(frontmatter.get('Media/Movies/Heat.md')).toEqual({ Plays: 0 })
    expect(full.renamed).toEqual([])
    expect(full.ignored).toBe(1)
    expect(background.playCounts).toEqual([])
  })

  it('makes notes for Steam games, alongside Plex or on its own', async () => {
    steamResponses = {
      'https://api.steampowered.com/ISteamUser/ResolveVanityURL': { response: { success: 1, steamid: '76561197960287930' } },
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [
        { appid: 620, name: 'Portal 2', playtime_forever: 754 },
        { appid: 440, name: 'Team Fortress 2', playtime_forever: 0 },
      ] } },
      'https://api.steampowered.com/IStoreBrowseService/GetItems': { response: { store_items: [{}] } },
      'https://store.steampowered.com/api/appdetails?appids=620': { 620: { success: true, data: {
        short_description: 'Puzzles.', header_image: 'https://cdn/620/header.jpg',
        genres: [{ description: 'Action' }, { description: 'Adventure' }], release_date: { date: '18 Apr, 2011' },
      } } },
      'https://store.steampowered.com/api/appdetails?appids=440': { 440: { success: false } },
      'https://howlongtobeat.com/api/search/site/init': { token: 't0k' },
      'https://howlongtobeat.com/api/search/site': { data: [
        { game_id: 7232, game_name: 'Portal 2: Peer Review', comp_main: 11784 },
        { game_id: 7231, game_name: 'Portal 2', release_world: 2011, comp_main: 30885, comp_plus: 49567, comp_100: 82549, game_image: 'Portal2cover.jpg' },
      ] },
    }
    portraits.clear()
    portraits.add('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg')
    const { app, frontmatter } = makeApp({ 'Media/Video Games/Team Fortress 2.md': { Status: 'abandoned' } })
    const settings = settingsWith({ serverUrl: '', token: '', steam: { apiKey: 'k', account: 'gabelogannewell', includeFreeGames: true } })
    settings.libraries = {}

    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})

    expect(result.failed).toEqual([])
    expect(settings.libraries.steam).toMatchObject({ title: 'Steam', target: 'game', folder: 'Media/Video Games' })
    expect(result.created).toEqual(['Media/Video Games/Portal 2 (2011).md'])
    expect(frontmatter.get('Media/Video Games/Portal 2 (2011).md')).toEqual({
      Genre: ['Action', 'Adventure'],
      'Release Date': '2011-04-18',
      'Total Playtime': 12.6,
      Status: 'started',
      Link: 'https://store.steampowered.com/app/620/',
      Image: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg',
      WideImage: 'https://cdn/620/header.jpg',
      'Main Story': 515,
      tags: ['video_game'],
    })
    // The existing note was matched by title: it gets its Link filled in and nothing else.
    expect(frontmatter.get('Media/Video Games/Team Fortress 2.md')).toEqual({ Status: 'abandoned', Link: 'https://store.steampowered.com/app/440/' })
    expect(requested.some(u => u.includes('include_played_free_games=1'))).toBe(true)
    expect(requested.some(u => u.startsWith('http://plex'))).toBe(false)
  })

  it('keeps game playtime up to date like play counts', async () => {
    steamResponses = {
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 120 }] } },
    }
    const { app, frontmatter } = makeApp({ 'Media/Video Games/Portal 2.md': { Link: 'https://store.steampowered.com/app/620/', 'Total Playtime': 1 } })
    const settings = settingsWith({ serverUrl: '', token: '', updatePlayCounts: true, steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: false } })
    settings.libraries = {}
    const { ensureSteamLibrary } = await import('../src/config')
    ensureSteamLibrary(settings)

    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {}, 'playCounts')

    expect(result.playCounts).toEqual(['Media/Video Games/Portal 2.md'])
    expect(frontmatter.get('Media/Video Games/Portal 2.md')!['Total Playtime']).toBe(2)
    expect(requested.some(u => u.includes('appdetails'))).toBe(false)
  })

  it('offers the right link for a note linking elsewhere: search links ticked, others unticked and remembered', async () => {
    steamResponses = {
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [
        { appid: 763890, name: 'Wildermyth', playtime_forever: 0 },
        { appid: 1145360, name: 'Hades', playtime_forever: 0 },
        { appid: 620, name: 'Portal 2', playtime_forever: 0 },
      ] } },
    }
    const search = '[https://store.steampowered.com/search/?term=](https://store.steampowered.com/search/?term=Wildermyth)'
    const hltb = 'https://www.pcgamingwiki.com/wiki/Hades'
    const { app, frontmatter } = makeApp({
      'Media/Video Games/Wildermyth.md': { Link: search },
      'Media/Video Games/Hades.md': { Link: hltb },
      'Media/Video Games/Portal 2.md': { Link: 'https://store.steampowered.com/app/620/Portal_2/' },
    })
    const settings = settingsWith({ serverUrl: '', token: '', steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: false } })
    settings.libraries = {}
    const { ensureSteamLibrary } = await import('../src/config')
    ensureSteamLibrary(settings)
    settings.libraries.steam.properties = [{ name: 'Link', source: 'plexLink' }]
    const requests: ApprovalRequest[] = []
    // Like pressing Apply without touching the ticks.
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    expect(requests.map(r => r.path)).toEqual(['Media/Video Games/Wildermyth.md', 'Media/Video Games/Hades.md'])
    expect(requests[0].lines).toEqual([{ key: 'link:Link', label: 'Link', current: search, value: 'https://store.steampowered.com/app/763890/', edit: 'text', unticked: false }])
    expect(requests[1].lines[0]).toMatchObject({ key: 'link:Link', current: hltb, unticked: true })
    expect(frontmatter.get('Media/Video Games/Wildermyth.md')!.Link).toBe('https://store.steampowered.com/app/763890/')
    expect(frontmatter.get('Media/Video Games/Hades.md')!.Link).toBe(hltb)
    expect(result.links).toEqual(['Media/Video Games/Wildermyth.md'])
    expect(settings.keptLinks).toEqual({ 'steam-1145360': hltb })

    // Kept links aren't offered again.
    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(requests).toEqual([])
  })

  describe('a note whose name matches two items', () => {
    const blackSheep = [
      { ratingKey: '53792', type: 'movie', title: 'Black Sheep', year: 2006 },
      { ratingKey: '600', type: 'movie', title: 'Black Sheep', year: 1996 },
    ]
    const setup = () => {
      responses.set('/library/sections/1/all', { MediaContainer: { Metadata: blackSheep } })
      const made = makeApp({ 'Media/Movies/Black Sheep.md': { Status: 'completed' } })
      const settings = settingsWith()
      settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
      return { ...made, settings }
    }
    const apply = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'apply' as const, excluded: [] }))

    it('asks which item it is for, then treats it as that item\'s note', async () => {
      const { app, files, frontmatter, settings } = setup()
      const choose = vi.fn((_r: OwnerRequest) => Promise.resolve('53792'))
      const result = await new PlexSync(app as never, settings, () => Promise.resolve(), apply, choose).run(() => {})

      expect(choose.mock.calls[0][0]).toEqual({ path: 'Media/Movies/Black Sheep.md', candidates: [
        { key: '53792', name: 'Black Sheep (2006)', library: 'Movies' },
        { key: '600', name: 'Black Sheep (1996)', library: 'Movies' },
      ] })
      expect(result.renamed).toEqual([{ from: 'Media/Movies/Black Sheep.md', to: 'Media/Movies/Black Sheep (2006).md' }])
      expect(frontmatter.get('Media/Movies/Black Sheep (2006).md')).toMatchObject({ Status: 'completed', Link: expect.stringContaining('metadata%2F53792') as string })
      expect(result.created.filter(p => p.startsWith('Media/Movies/'))).toEqual(['Media/Movies/Black Sheep (1996).md'])
      expect(files.has('Media/Movies/Black Sheep.md')).toBe(false)
    })

    it('makes notes for both when it\'s for neither, and leaves everything when skipped', async () => {
      const none = setup()
      const r1 = await new PlexSync(none.app as never, none.settings, () => Promise.resolve(), apply, () => Promise.resolve('none')).run(() => {})
      expect(r1.created.filter(p => p.startsWith('Media/Movies/')).sort()).toEqual(['Media/Movies/Black Sheep (1996).md', 'Media/Movies/Black Sheep (2006).md'])
      expect(none.files.has('Media/Movies/Black Sheep.md')).toBe(true)

      const skip = setup()
      const r2 = await new PlexSync(skip.app as never, skip.settings, () => Promise.resolve(), apply, () => Promise.resolve(null)).run(() => {})
      expect(r2.created.filter(p => p.startsWith('Media/Movies/'))).toEqual([])
      expect(r2.renamed).toEqual([])
    })

    it('is explained', async () => {
      const { app, settings } = setup()
      const reports = await new PlexSync(app as never, settings, () => Promise.resolve())
        .explain('https://app.plex.tv/desktop/#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F53792', () => {})
      expect(reports).toHaveLength(1)
      expect(reports[0][0]).toBe('Black Sheep (2006) (in Movies)')
      expect(reports[0].join(' ')).toContain('Media/Movies/Black Sheep.md')
      expect(reports[0].join(' ')).toContain('Black Sheep (1996) matches the same note')
    })
  })

  it('explains items that aren\'t being synced', async () => {
    const { app } = makeApp({})
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'skip') }
    responses.set('/library/metadata/77', { MediaContainer: { Metadata: [{
      ratingKey: '77', type: 'movie', title: 'Hidden', year: 2000, librarySectionID: 1, librarySectionTitle: 'Movies',
    }] } })
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    expect((await sync.explain('https://app.plex.tv/desktop/#!/server/x/details?key=%2Flibrary%2Fmetadata%2F77', () => {}))[0])
      .toEqual(['Hidden (2000)', 'It\'s in "Movies", which is set to Skip, so no notes are made for it. Choose a type for that library in the settings.'])
    expect((await sync.explain('https://app.plex.tv/desktop/#!/server/x/details?key=%2Flibrary%2Fmetadata%2F999', () => {}))[0][0])
      .toContain('Plex has no item with that link')
    expect((await sync.explain('Severance', () => {}))[0][0]).toBe('Severance (2022) (in TV Shows)')
  })

  describe('adding something new', () => {
    const asked: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest) => { asked.push(r); return Promise.resolve({ choice: 'apply' as const, excluded: [] }) }

    it('makes a book note in the Books library, with a linked cover', async () => {
      const { app, frontmatter } = makeApp({})
      const settings = loadSettings({})
      const item = { ratingKey: 'ol-OL893415W', type: 'book', title: 'Dune', year: 1965, authors: ['Frank Herbert'], pages: 604,
        Genre: [{ tag: 'Science fiction' }], summary: 'A desert planet.', portrait: 'https://covers/x-L.jpg', webLink: 'https://openlibrary.org/works/OL893415W' }
      const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).addNew(item, 'books')
      expect(result.created).toBe('Media/Books/Dune (1965).md')
      expect(frontmatter.get('Media/Books/Dune (1965).md')).toEqual({
        Author: ['Frank Herbert'], Genre: ['Science fiction'], Year: 1965, Pages: 604, Summary: 'A desert planet.', Status: 'pending',
        Link: 'https://openlibrary.org/works/OL893415W', Image: 'https://covers/x-L.jpg', tags: ['book'],
      })
    })

    it('makes a movie note that Plex recognises once it has the movie', async () => {
      const { app, frontmatter, files } = makeApp({})
      const settings = settingsWith()
      settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
      const inception = { ratingKey: 'imdb-tt1375666', type: 'movie', title: 'Inception', year: 2010, Guid: [{ id: 'imdb://tt1375666' }],
        summary: 'A thief…', portrait: 'https://m/x_SX600.jpg', webLink: 'https://www.imdb.com/title/tt1375666/' }
      const added = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).addNew(inception, '1')
      expect(added.created).toBe('Media/Movies/Inception (2010).md')
      expect(frontmatter.get('Media/Movies/Inception (2010).md')).toMatchObject({ Link: 'https://www.imdb.com/title/tt1375666/', Image: 'https://m/x_SX600.jpg', Status: 'pending' })

      // Later Plex has it, under another title even: it's matched by its IMDb ID, not made again.
      responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
        { ratingKey: '900', type: 'movie', title: 'Inception: The Movie', year: 2010, Guid: [{ id: 'imdb://tt1375666' }] },
      ] } })
      const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
      expect(result.created.filter(p => p.startsWith('Media/Movies/'))).toEqual([])
      // Matched through its IMDb link, so it's renamed to Plex's title; its IMDb Link stays (never overwritten).
      expect(result.renamed).toEqual([{ from: 'Media/Movies/Inception (2010).md', to: 'Media/Movies/Inception The Movie (2010).md' }])
      expect(files.has('Media/Movies/Inception The Movie (2010).md')).toBe(true)
      expect(frontmatter.get('Media/Movies/Inception The Movie (2010).md')!.Link).toBe('https://www.imdb.com/title/tt1375666/')
    })

    it('says when a note already exists', async () => {
      const { app } = makeApp({ 'Media/Books/Dune.md': {} })
      const settings = loadSettings({})
      const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve)
        .addNew({ ratingKey: 'ol-OL1W', type: 'book', title: 'Dune', year: 1965 }, 'books')
      expect(result).toEqual({ existing: 'Media/Books/Dune.md' })
    })

    it('fills in a game found on Steam from the store, without Steam set up', async () => {
      steamResponses = {
        'https://store.steampowered.com/api/appdetails?appids=367520': { 367520: { success: true, data: {
          genres: [{ description: 'Action' }], release_date: { date: 'Feb 24, 2017' }, header_image: 'https://h.jpg' } } },
        'https://api.steampowered.com/IStoreBrowseService/GetItems': { response: { store_items: [{}] } },
      }
      portraits.clear()
      const { app, frontmatter } = makeApp({})
      const settings = loadSettings({})
      const { addLibrary } = await import('../src/config')
      addLibrary(settings, 'game')
      settings.libraries.steam.properties = settings.libraries.steam.properties.filter(m => m.source !== 'hltbMain')
      const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve)
        .addNew({ ratingKey: 'steam-367520', type: 'game', title: 'Hollow Knight', steamAppId: 367520 }, 'steam')
      expect(result.created).toBe('Media/Video Games/Hollow Knight (2017).md')
      expect(frontmatter.get(result.created!)).toMatchObject({ Genre: ['Action'], 'Release Date': '2017-02-24', Status: 'pending', Link: 'https://store.steampowered.com/app/367520/' })
    })
  })

  it('stops when told to', async () => {
    const { app, files } = makeApp({})
    const approve = vi.fn(() => Promise.resolve({ choice: 'stop' as const, excluded: [] }))
    const result = await new PlexSync(app as never, settingsWith(), () => Promise.resolve(), approve).run(() => {})
    expect(approve).toHaveBeenCalledTimes(1)
    expect(result.stopped).toBe(true)
    expect(result.created).toEqual([])
    expect([...files.keys()].filter(p => p.endsWith('.md'))).toEqual([])
  })

  it('does not ask when asking is switched off', async () => {
    const { app } = makeApp({})
    const approve = vi.fn(() => Promise.resolve({ choice: 'skip' as const, excluded: [] }))
    const result = await new PlexSync(app as never, settingsWith({ askBeforeChanges: false }), () => Promise.resolve(), approve).run(() => {})
    expect(approve).not.toHaveBeenCalled()
    expect(result.created.length).toBeGreaterThan(0)
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
    // Properties whose source was dropped (Main + Extras, Completionist) are removed.
    const steam = loadSettings({ libraries: { steam: {
      title: 'Steam', type: 'steam', target: 'game', folder: 'G', fileNameFormat: '{{title}}', matchBy: 'loose',
      properties: [{ name: 'Main Story', source: 'hltbMain' }, { name: 'Main + Extras', source: 'hltbExtra' }, { name: 'Completionist', source: 'hltbComplete' }],
      values: { watched: 'a', started: 'b', unwatched: 'c', tag: 'd' },
    } } })
    expect(steam.libraries.steam.properties).toEqual([{ name: 'Main Story', source: 'hltbMain' }])
    expect(loadSettings({ ignored: { 5: { name: 'X', library: 'Movies', since: 1 } } }).ignored).toEqual({ 5: { name: 'X', library: 'Movies', since: 1 } })
    expect(loadSettings({}).ignored).toEqual({})
  })
})
