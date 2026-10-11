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
    AbstractInputSuggest: Unused,
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

// Steam's local files (desktop only) are read through this; each test says what it finds.
vi.mock('../src/steam-local', () => ({ readSteamCollections: vi.fn(() => null) }))
// Music files' own tags (desktop only) are read through this; each test says what it finds.
vi.mock('../src/music-files', () => ({ readFileTags: vi.fn(() => null), readLyrics: vi.fn(() => null) }))

import type { ApprovalRequest, Choice, Decision, OwnerRequest } from '../src/approval-modal'
import type { PlexNotesSettings } from '../src/config'

const { PlexSync } = await import('../src/sync')
const { readSteamCollections } = await import('../src/steam-local')
const { readFileTags, readLyrics } = await import('../src/music-files')
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
  // Keep every genre, unless a test is about "Genres to keep".
  allowedGenres: [],
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
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F90&track=100',
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

  it('writes only the genres to keep', async () => {
    const { app, frontmatter } = makeApp({})
    const settings = settingsWith({ allowedGenres: ['Sci-Fi', 'Action'] })
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Genre).toEqual(['Sci-Fi'])
  })

  it('moves statuses forward only when switched on, never back and never from your own', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Status: 'pending' },
      'Media/Movies/Heat (1995).md': { Status: 'revisit' },
      'Media/Movies/Free Solo (2018).md': { Status: 'completed' },
    })
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Status', source: 'status' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
      { ...movies[0], viewCount: 1 }, { ...movies[1], viewCount: 2 }, { ...movies[2], viewCount: 0, viewOffset: 60_000 },
    ] } })
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())

    expect((await sync.run(() => {})).playCounts).toEqual([])
    settings.updateStatus = true
    expect((await sync.run(() => {})).playCounts).toEqual(['Media/Movies/Arrival (2016).md'])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Status).toBe('completed')
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Status).toBe('revisit')
    expect(frontmatter.get('Media/Movies/Free Solo (2018).md')!.Status).toBe('completed')
  })

  it('offers to send a rating made in a note to Plex, and stops overwriting it with Plex\'s', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Rating: 4 },
      'Media/Movies/Heat (1995).md': { Rating: 2 },
    })
    const settings = settingsWith({ sendRatings: true, updateRatings: true, ratingsSeen: { 2: 4 } })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Rating', source: 'userRating' }]
    // Arrival isn't rated in Plex; Heat was 4 stars in both, then changed to 2 in the note.
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], { ...movies[1], userRating: 8 }] } })
    responses.set('/:/rate', {})
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: [] })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    expect(requests.filter(r => r.action === 'change').map(r => [r.path, r.lines])).toEqual([
      ['Media/Movies/Arrival (2016).md', [{ key: 'plexRating', label: 'Your rating in Plex', current: null, value: '⭐⭐⭐⭐ (4 stars in Plex)', edit: 'text', unticked: false }]],
      ['Media/Movies/Heat (1995).md', [{ key: 'plexRating', label: 'Your rating in Plex', current: '⭐⭐⭐⭐ (4 stars in Plex)', value: '⭐⭐ (2 stars in Plex)', edit: 'text', unticked: false }]],
    ])
    expect(requested.filter(u => u.includes('/:/rate'))).toEqual([
      'http://plex:32400/:/rate?key=1&identifier=com.plexapp.plugins.library&rating=8',
      'http://plex:32400/:/rate?key=2&identifier=com.plexapp.plugins.library&rating=4',
    ])
    // The note's rating was kept, not overwritten with Plex's.
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Rating).toBe(2)
    expect(result.sentRatings).toEqual(['Media/Movies/Arrival (2016).md', 'Media/Movies/Heat (1995).md'])
    expect(settings.ratingsSeen).toMatchObject({ 1: 4, 2: 2 })
  })

  it('gives a track its own moods when it has them, else its album\'s', async () => {
    const { app, frontmatter } = makeApp({})
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 3: newLibrary("Shayne's Music", 'artist', 'music') }
    settings.libraries['3'].target = 'music'
    settings.libraries['3'].properties = [{ name: 'Mood', source: 'moods' }]
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: tracks.slice(0, 2) } })
    responses.set('/library/metadata/100', { MediaContainer: { Metadata: [{ ...tracks[0], Mood: [{ tag: 'Brooding' }] }] } })
    responses.set('/library/metadata/90', { MediaContainer: { Metadata: [{ ratingKey: '90', type: 'album', title: 'OK Computer', Mood: [{ tag: 'Melancholy' }] }] } })
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Music/Radiohead - Karma Police.md')).toEqual({ Mood: ['Brooding'] })
    expect(frontmatter.get('Media/Music/Radiohead - Airbag.md')).toEqual({ Mood: ['Melancholy'] })
  })

  it('offers a rating written in an older scale in the star scale, once per note', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Rating: '⭐⭐⭐' },
      'Media/Movies/Heat (1995).md': { Rating: '🩷' },
    })
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Rating', source: 'userRatingEmoji' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[0], userRating: 8 }, { ...movies[1], userRating: 10 }] } })
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: [] })
    })
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    // ⭐⭐⭐ was 4 stars in the old scale: offered as ⭐⭐⭐⭐. 🩷 is the same in both: just marked reviewed.
    expect(requests.filter(r => r.action === 'change').map(r => [r.path, r.lines])).toEqual([
      ['Media/Movies/Arrival (2016).md', [{ key: 'rescale:Rating', label: 'Rating', current: '⭐⭐⭐', value: '⭐⭐⭐⭐', edit: 'text', unticked: false }]],
    ])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Rating).toBe('⭐⭐⭐⭐')
    expect(settings.ratingsReviewed).toEqual({ 1: true, 2: true })
    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(requests.filter(r => r.action === 'change')).toEqual([])
  })

  it('sends Plex the rating as you edited it, on its own line or the note\'s', async () => {
    const { app } = makeApp({
      'Media/Movies/Arrival (2016).md': { Rating: '⭐⭐⭐' },
      'Media/Movies/Heat (1995).md': { Rating: '⭐⭐⭐' },
    })
    const settings = settingsWith({ sendRatings: true })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Rating', source: 'userRatingEmoji' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], movies[1]] } })
    responses.set('/:/rate', {})
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      // Arrival: the converted rating edited back to ⭐⭐⭐. Heat: "2" typed on the Plex line.
      const edits: Record<string, string> = r.path.includes('Arrival') ? { 'rescale:Rating': '⭐⭐⭐' } : { plexRating: '2' }
      return Promise.resolve({ choice: 'apply', excluded: [], edits })
    })
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(requested.filter(u => u.includes('/:/rate')).sort()).toEqual([
      'http://plex:32400/:/rate?key=1&identifier=com.plexapp.plugins.library&rating=6',
      'http://plex:32400/:/rate?key=2&identifier=com.plexapp.plugins.library&rating=4',
    ])
  })

  it('never applies what would start unticked through "Apply to all the rest"', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Summary: 'Mine.' },
      'Media/Movies/Heat (1995).md': { Summary: 'Also mine.', Status: 'revisit' },
    })
    const settings = settingsWith({ tickDifferences: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Summary', source: 'summary' }, { name: 'Status', source: 'status' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], { ...movies[1], viewCount: 1 }] } })
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{ ...movies[1], viewCount: 1, summary: 'Cops and robbers.' }] } })
    // "Apply to all the rest" on the first pop-up, leaving everything as offered.
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> =>
      Promise.resolve({ choice: 'all', excluded: r.lines.filter(l => l.unticked).map(l => l.key) }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary', 'Status'])
    expect(approve).toHaveBeenCalledTimes(1)
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toEqual({ Summary: 'Also mine.', Status: 'revisit' })
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
      'https://api.steampowered.com/IStoreBrowseService/GetItems': { response: { store_items: [{ tagids: [1664, 5716, 19] }] } },
      'https://api.steampowered.com/IStoreService/GetTagList': { response: { tags: [{ tagid: 19, name: 'Action' }, { tagid: 1664, name: 'Puzzle' }, { tagid: 5716, name: 'Mystery' }] } },
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
    // Store tags count as genres when they're kept: Puzzle is, Mystery isn't.
    const settings = settingsWith({ serverUrl: '', token: '', allowedGenres: ['Action', 'Adventure', 'Puzzle'], steam: { apiKey: 'k', account: 'gabelogannewell', includeFreeGames: true } })
    settings.libraries = {}

    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})

    expect(result.failed).toEqual([])
    expect(settings.libraries.steam).toMatchObject({ title: 'Steam', target: 'game', folder: 'Media/Video Games' })
    expect(result.created).toEqual(['Media/Video Games/Portal 2 (2011).md'])
    expect(frontmatter.get('Media/Video Games/Portal 2 (2011).md')).toEqual({
      Genre: ['Action', 'Adventure', 'Puzzle'],
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
    expect(requested.some(u => u.includes('include_played_free_games=1') && u.includes('include_free_sub=1') && u.includes('skip_unvetted_apps=0'))).toBe(true)
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

  it('counts a game linked from a note as yours even when Steam leaves it out (free and never played)', async () => {
    steamResponses = {
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 120 }] } },
      'https://store.steampowered.com/api/appdetails?appids=1713610': { 1713610: { success: true, data: {
        name: 'Purrgatory', short_description: 'Cats.', genres: [{ description: 'Indie' }], release_date: { date: '1 Jan, 2022' },
      } } },
    }
    const { app } = makeApp({
      'Media/Video Games/Portal 2.md': { Link: 'https://store.steampowered.com/app/620/' },
      'Media/Video Games/Purrgatory.md': { Link: 'https://store.steampowered.com/app/1713610/Purrgatory/', 'Total Playtime': 3 },
    })
    const settings = settingsWith({ serverUrl: '', token: '', updatePlayCounts: true, steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: true } })
    settings.libraries = {}
    const { ensureSteamLibrary } = await import('../src/config')
    ensureSteamLibrary(settings)
    const sync = new PlexSync(app as never, settings, () => Promise.resolve())
    const { withNotes } = await sync.libraryItems(() => {})
    expect(withNotes.map(w => [w.item.title, w.path])).toEqual([
      ['Portal 2', 'Media/Video Games/Portal 2.md'],
      ['Purrgatory', 'Media/Video Games/Purrgatory.md'],
    ])
    // Matching needs only the link: the Steam Store isn't asked about it on every sync.
    expect(requested.some(u => u.includes('appdetails'))).toBe(false)
    // Its playtime (none, as far as Steam's list goes) never lowers the note's.
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {}, 'playCounts')
    expect(result.playCounts).toEqual(['Media/Video Games/Portal 2.md'])
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
    const settings = settingsWith({ tickDifferences: false, serverUrl: '', token: '', steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: false } })
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

  it('offers an empty playtime property once, not as a fill-in and an update both', async () => {
    steamResponses = {
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 90 }] } },
      'https://store.steampowered.com/api/appdetails?appids=620': { 620: { success: true, data: { name: 'Portal 2' } } },
    }
    const { app } = makeApp({ 'Media/Video Games/Portal 2.md': { Link: 'https://store.steampowered.com/app/620/' } })
    const settings = settingsWith({ serverUrl: '', token: '', updatePlayCounts: true, steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: false } })
    settings.libraries = {}
    const { ensureSteamLibrary } = await import('../src/config')
    ensureSteamLibrary(settings)
    settings.libraries.steam.properties = [{ name: 'Progress', source: 'playtime', fill: true }]
    const approve = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'skip' as const, excluded: [] }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(approve.mock.calls[0][0].lines.map(l => l.label)).toEqual(['Progress'])
  })

  it('offers to fix durations that differ: hours ticked, other differences unticked and remembered', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Duration: 1.9 },
      'Media/Movies/Heat (1995).md': { Duration: 150 },
    })
    const settings = settingsWith({ tickDifferences: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Duration', source: 'durationMinutes' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
      { ...movies[0], duration: 116 * 60_000 }, { ...movies[1], duration: 170 * 60_000 },
    ] } })
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})

    expect(requests.filter(r => r.action === 'change').map(r => r.lines)).toEqual([
      [{ key: 'fix:Duration', label: 'Duration', current: '1.9', value: '116', edit: 'number', unticked: false }],
      [{ key: 'fix:Duration', label: 'Duration', current: '150', value: '170', edit: 'number', unticked: true }],
    ])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Duration).toBe(116)
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Duration).toBe(150)
    expect(result.corrected).toEqual(['Media/Movies/Arrival (2016).md'])

    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {})
    expect(requests.filter(r => r.action === 'change')).toEqual([])
  })

  it('checks the genres of existing notes, always asking, and keeps only kept genres', async () => {
    const { app, frontmatter, files } = makeApp({
      'Media/Movies/Arrival (2016).md': { Genre: ['Drama', 'Family', 'Sci-Fi', 'Mystery'] },
      'Media/Movies/Heat (1995).md': { Genre: ['Crime'] },
    })
    const settings = settingsWith({ askBeforeChanges: false, allowedGenres: ['Sci-Fi', 'Crime', 'Mystery'] })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Genre'])

    // Arrival: its own kept genres (Sci-Fi, Mystery) plus Plex's kept ones (Sci-Fi). Heat already matches.
    expect(requests.map(r => r.lines)).toEqual([[{
      key: 'fix:Genre', label: 'Genre', current: 'Drama, Family, Sci-Fi, Mystery', value: 'Sci-Fi, Mystery', edit: 'list', items: ['Sci-Fi', 'Mystery'], unticked: false,
    }]])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Genre).toEqual(['Sci-Fi', 'Mystery'])
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Genre).toEqual(['Crime'])
    expect(result.corrected).toEqual(['Media/Movies/Arrival (2016).md'])
    // Nothing else happens: no new notes, no renames.
    expect(result.created).toEqual([])
    expect([...files.keys()].filter(p => p.endsWith('.md')).sort()).toEqual(['Media/Movies/Arrival (2016).md', 'Media/Movies/Heat (1995).md'])
  })

  it('checks book genres against Open Library, finding books without a link by title and author', async () => {
    steamResponses = {
      'https://openlibrary.org/works/OL893415W.json': { subjects: ['Science fiction', 'genre:Fiction', 'Deserts'] },
      'https://openlibrary.org/search.json?q=': { docs: [{ key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965 }] },
      'https://openlibrary.org/search.json?title=': { docs: [{ key: '/works/OL27448W', title: 'The Hobbit', author_name: ['J.R.R. Tolkien'], first_publish_year: 1937 }] },
      'https://openlibrary.org/works/OL27448W.json': { subjects: ['Fantasy fiction', 'Fantasy', 'Dragons'] },
    }
    const { app, frontmatter } = makeApp({
      'Media/Books/Dune by Frank Herbert.md': { Author: ['Frank Herbert'], Genre: ['Classics'], Link: 'https://openlibrary.org/works/OL893415W' },
      'Media/Books/The Hobbit by J.R.R. Tolkien.md': { Author: '[[J.R.R. Tolkien]]', Genre: [] },
    })
    const settings = settingsWith({ allowedGenres: ['Sci-Fi', 'Fiction', 'Fantasy'] })
    settings.libraries = {}
    const { addLibrary } = await import('../src/config')
    addLibrary(settings, 'book')
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Genre'])

    expect(requests.map(r => r.path)).toEqual(['Media/Books/Dune by Frank Herbert.md', 'Media/Books/The Hobbit by J.R.R. Tolkien.md'])
    expect(requests[0].note).toBeUndefined()
    expect(requests[1].note).toBe('Found on Open Library: The Hobbit by J.R.R. Tolkien, 1937. Make sure it\'s the same book; if it isn\'t, press Skip.')
    expect(requested.some(u => u.includes('search.json?title=The%20Hobbit&author=J.R.R.%20Tolkien'))).toBe(true)
    expect(frontmatter.get('Media/Books/Dune by Frank Herbert.md')!.Genre).toEqual(['Sci-Fi'])
    expect(frontmatter.get('Media/Books/The Hobbit by J.R.R. Tolkien.md')).toMatchObject({ Genre: ['Fantasy'], Link: 'https://openlibrary.org/works/OL27448W' })
    expect(result.links).toEqual(['Media/Books/The Hobbit by J.R.R. Tolkien.md'])
  })

  it('asks about books grouped by what changes, with "Apply to the rest of this group"', async () => {
    steamResponses = {
      'https://openlibrary.org/works/OL893415W.json': { subjects: ['Science fiction'] },
      'https://openlibrary.org/works/OL27448W.json': { subjects: ['Fantasy'] },
      'https://openlibrary.org/search.json?title=': { docs: [{ key: '/works/OL1W', title: 'Emma', author_name: ['Jane Austen'], first_publish_year: 1815 }] },
      'https://openlibrary.org/works/OL1W.json': { subjects: ['Romance'] },
      'https://openlibrary.org/search.json?q=': { docs: [
        { key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965 },
        { key: '/works/OL27448W', title: 'The Hobbit', author_name: ['J.R.R. Tolkien'], first_publish_year: 1937 },
      ] },
    }
    const { app, frontmatter } = makeApp({
      'Media/Books/Emma by Jane Austen.md': { Author: ['Jane Austen'], Genre: [] },
      'Media/Books/Dune by Frank Herbert.md': { Author: ['Frank Herbert'], Genre: [], Link: 'https://openlibrary.org/works/OL893415W' },
      'Media/Books/The Hobbit by J.R.R. Tolkien.md': { Author: ['J.R.R. Tolkien'], Genre: [], Link: 'https://openlibrary.org/works/OL27448W' },
    })
    const settings = settingsWith({ allowedGenres: ['Sci-Fi', 'Fantasy', 'Romance'] })
    settings.libraries = {}
    const { addLibrary } = await import('../src/config')
    addLibrary(settings, 'book')
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: r.groupLeft ? 'group' : 'apply', excluded: [] })
    })
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Genre'])
    // The two books changing only Genre come first, as one group; the first answer covers both.
    expect(requests.map(r => [r.path, r.group, r.groupLeft])).toEqual([
      ['Media/Books/Dune by Frank Herbert.md', `${settings.libraries.books.title} · Genre (1 of 2)`, 1],
      ['Media/Books/Emma by Jane Austen.md', `${settings.libraries.books.title} · Genre, Link (1 of 1)`, 0],
    ])
    expect(frontmatter.get('Media/Books/The Hobbit by J.R.R. Tolkien.md')!.Genre).toEqual(['Fantasy'])
  })

  it('checks existing notes against sources: empty values ticked, other differences unticked, unmatched notes listed', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Summary: 'My own summary.', Date: '', Duration: 116, Status: 'revisit' },
      'Media/Movies/Old film I deleted.md': {},
    })
    const settings = settingsWith({ tickDifferences: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary', 'Date', 'Duration', 'Status'])

    // Status is compared too, but a status of your own ("revisit") is only replaced if you tick it.
    expect(requests.map(r => r.lines.map(l => [l.label, l.unticked]))).toEqual([[['Summary', true], ['Date', false], ['Status', true]]])
    // The rest of the note is shown too, unchanged.
    expect(requests[0].unchanged).toMatchObject([{ label: 'File name', value: 'Arrival (2016)', key: 'own-file' }, { label: 'Duration', value: '116', key: 'own:Duration', edit: 'number' }])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toEqual({ Summary: 'My own summary.', Date: '2016-11-11', Duration: 116, Status: 'revisit' })
    expect(Object.keys(settings.keptValues).sort()).toEqual(['1|Status', '1|Summary'])
    expect(result.unmatched).toEqual(['Media/Movies/Old film I deleted.md'])

    // Kept: not offered again while the source offers the same; offered again once it offers something else.
    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(requests).toEqual([])
    responses.set('/library/metadata/1', { MediaContainer: { Metadata: [{ ...movies[0], summary: 'A corrected summary.' }] } })
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(requests.map(r => r.lines.map(l => [l.label, l.value]))).toEqual([[['Summary', 'A corrected summary.']]])
    // A value kept before offers were remembered stays kept whatever the offer.
    settings.keptValues = { '1|Summary': 'My own summary.' }
    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(requests).toEqual([])
  })

  it('checks just the notes asked for, and replaces a year-only date with the full one, ticked', async () => {
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Date: '2016' },
      'Media/Movies/Heat (1995).md': { Date: '1995-01-01' },
      'Media/Movies/Old film I deleted.md': { Date: '2001' },
    })
    const settings = settingsWith({ tickDifferences: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], movies[1]] } })
    const sync = new PlexSync(app as never, settings, () => Promise.resolve(), r => Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) }))

    const vague = sync.vagueDateNotes()
    expect([...vague.paths]).toEqual(['Media/Movies/Arrival (2016).md', 'Media/Movies/Heat (1995).md', 'Media/Movies/Old film I deleted.md'])
    expect(vague.properties).toEqual(['Date'])

    const result = await sync.run(() => {}, 'check', ['Date'], new Set(['Media/Movies/Arrival (2016).md']))
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toEqual({ Date: '2016-11-11' })
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toEqual({ Date: '1995-01-01' })
    expect(result.checked).toEqual(['Media/Movies/Arrival (2016).md'])
    expect(result.unmatched).toEqual([])
  })

  it('writes what you edit in the pop-up among the properties it wasn\'t changing, file name included', async () => {
    const { app, files, frontmatter } = makeApp({ 'Media/Movies/Arrival (2016).md': { Duration: '1h 56m', Summary: 'Mine.', Genre: ['Drama'] } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const approve = (r: ApprovalRequest): Promise<Decision> => Promise.resolve({
      choice: 'apply', excluded: r.lines.map(l => l.key),
      edits: { 'own:Duration': '116', 'own:Genre': ['Drama', 'Sci-Fi'], 'own-file': 'Arrival' },
    })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(files.has('Media/Movies/Arrival.md')).toBe(true)
    expect(frontmatter.get('Media/Movies/Arrival.md')).toEqual({ Duration: 116, Summary: 'Mine.', Genre: ['Drama', 'Sci-Fi'] })
    expect(result.corrected).toEqual(['Media/Movies/Arrival.md'])
  })

  it('offers, ticked, to replace a song\'s old link to the track with its album page link', async () => {
    const old = 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F100'
    const { app, frontmatter } = makeApp({ 'Media/Music/Radiohead - Karma Police.md': { Link: old } })
    const settings = settingsWith({})
    settings.libraries = { 3: newLibrary('Music', 'artist', 'music') }
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: [tracks[0]] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked).map(l => l.key) })
    }
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Link'])
    expect(requests[0].lines.map(l => [l.label, l.unticked])).toEqual([['Link', false]])
    expect(frontmatter.get('Media/Music/Radiohead - Karma Police.md')!.Link).toBe('https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F90&track=100')
  })

  it('asks about like changes together: by library, then fewest properties changing first', async () => {
    // Arrival needs its summary and date; Heat only its summary. Heat comes first.
    const { app } = makeApp({ 'Media/Movies/Arrival (2016).md': {}, 'Media/Movies/Heat (1995).md': { Date: '1995-01-01' } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], movies[1]] } })
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{ ...movies[1], summary: 'Cops and robbers.' }] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'skip', excluded: [] })
    }
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary', 'Date'])
    expect(requests.map(r => [r.path, r.group, r.position, r.total])).toEqual([
      ['Media/Movies/Heat (1995).md', 'Movies · Summary (1 of 1)', 1, 2],
      ['Media/Movies/Arrival (2016).md', 'Movies · Date, Summary (1 of 1)', 2, 2],
    ])
  })

  it('applies to the rest of a group only, then asks again for the next group', async () => {
    // Arrival and Heat both need only a summary (one group); Free Solo needs a summary and a date.
    const { app, frontmatter } = makeApp({
      'Media/Movies/Arrival (2016).md': { Date: '2016-11-11' },
      'Media/Movies/Heat (1995).md': { Date: '1995-01-01' },
      'Media/Movies/Free Solo (2018).md': {},
    })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: movies } })
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{ ...movies[1], summary: 'Cops and robbers.' }] } })
    responses.set('/library/metadata/3', { MediaContainer: { Metadata: [{ ...movies[2], summary: 'A climb.', originallyAvailableAt: '2018-09-28' }] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: requests.length === 1 ? 'group' : 'skip', excluded: [] })
    }
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary', 'Date'])
    expect(requests.map(r => [r.group, r.groupLeft])).toEqual([['Movies · Summary (1 of 2)', 1], ['Movies · Date, Summary (1 of 1)', 0]])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Summary).toBe('Linguist meets aliens.')
    expect(frontmatter.get('Media/Movies/Heat (1995).md')!.Summary).toBe('Cops and robbers.')
    expect(frontmatter.get('Media/Movies/Free Solo (2018).md')!.Summary).toBeUndefined()
  })

  it('lists Plex items with no note, and makes a note for one with its Plex link', async () => {
    const { app, frontmatter } = makeApp({ 'Media/Movies/Arrival (2016).md': {} })
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], movies[1]] } })
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{ ...movies[1], summary: 'Cops and robbers.' }] } })
    const missing = await new PlexSync(app as never, settings, () => Promise.resolve()).withoutNotes(() => {})
    expect(missing.map(m => [m.item.title, m.libraryKey, m.kind])).toEqual([['Heat', '1', 'movie']])
    const { created } = await new PlexSync(app as never, settings, () => Promise.resolve()).addNew(missing[0].item, '1')
    expect(created).toBe('Media/Movies/Heat (1995).md')
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toMatchObject({
      Summary: 'Cops and robbers.',
      Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F2',
    })
  })

  it('fills song properties from the tags in the file Plex has for the track', async () => {
    vi.mocked(readFileTags).mockImplementation(path => path === '/music/Radiohead/Karma Police.mp3'
      ? { 'TXXX:songs-db_tempo': ['76'], 'TXXX:mood': ['Brooding'] } : null)
    const { app, frontmatter } = makeApp({ 'Media/Music/Radiohead - Karma Police.md': { Link: 'http://plex:32400/library/metadata/100' } })
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 3: newLibrary('Music', 'artist', 'music') }
    settings.libraries[3].properties.push({ name: 'Tempo', source: 'fileTag', text: 'songs-db_tempo', fill: true }, { name: 'Mood', source: 'fileTag', text: 'TXXX/Mood', fill: true })
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: [{ ...tracks[0], Media: [{ Part: [{ file: '/music/Radiohead/Karma Police.mp3' }] }] }] } })
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Music/Radiohead - Karma Police.md')).toMatchObject({ Tempo: 76, Mood: 'Brooding' })
    // Background updates never read the files.
    vi.mocked(readFileTags).mockClear()
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {}, 'playCounts')
    expect(readFileTags).not.toHaveBeenCalled()
    vi.mocked(readFileTags).mockReset()
    vi.mocked(readFileTags).mockReturnValue(null)
  })

  it('fills a song\'s lyrics from the text file beside its music file, exactly as written', async () => {
    const lyrics = 'Karma police, arrest this man\nHe talks in maths\n\n  (chorus)\nThis is what you get'
    vi.mocked(readLyrics).mockImplementation(path => path === '/music/Radiohead/Karma Police.mp3' ? lyrics : null)
    const { app, frontmatter } = makeApp({ 'Media/Music/Radiohead - Karma Police.md': { Link: 'http://plex:32400/library/metadata/100' } })
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 3: newLibrary('Music', 'artist', 'music') }
    settings.libraries[3].properties.push({ name: 'Lyrics', source: 'lyricsFile', fill: true })
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: [{ ...tracks[0], Media: [{ Part: [{ file: '/music/Radiohead/Karma Police.mp3' }] }] }] } })
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Music/Radiohead - Karma Police.md')!.Lyrics).toBe(lyrics)
    expect(readFileTags).not.toHaveBeenCalled()
    vi.mocked(readLyrics).mockReset()
    vi.mocked(readLyrics).mockReturnValue(null)
  })

  it('matches a song note linked to its album, or named after a featured artist, by name', async () => {
    const { app, files } = makeApp({
      'Media/Music/Uptown Funk by Mark Ronson.md': { Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F72153' },
      'Media/Music/Treasure by Bruno Mars.md': {},
    })
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 3: newLibrary('Music', 'artist', 'music') }
    settings.libraries[3].fileNameFormat = '{{title}} by {{artist}}'
    responses.set('/library/sections/3/all', { MediaContainer: { Metadata: [
      { ratingKey: '72154', parentRatingKey: '72153', type: 'track', title: 'Uptown Funk', originalTitle: 'Mark Ronson/Bruno Mars', grandparentTitle: 'Mark Ronson', parentTitle: 'Uptown Special' },
      { ratingKey: '72200', type: 'track', title: 'Treasure (feat. Bruno Mars)', grandparentTitle: 'Somebody Else', parentTitle: 'Covers' },
    ] } })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(result.unmatched.filter(path => path.startsWith('Media/Music/'))).toEqual([])
    expect(result.created.filter(path => path.startsWith('Media/Music/'))).toEqual([])
    // Matched, so renamed to the library's format rather than joined by new notes.
    expect([...files.keys()].filter(path => path.startsWith('Media/Music/') && path.endsWith('.md'))).toHaveLength(2)
  })

  it('never changes a property locked for a note, and stops asking about it', async () => {
    const { app, frontmatter } = makeApp({ 'Media/Movies/Arrival (2016).md': { Link: 'http://plex:32400/library/metadata/1', Summary: 'Mine.', Date: '1999-01-02' } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const requests: ApprovalRequest[] = []
    // The first pop-up locks Summary and applies the rest.
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve(requests.length === 1
        ? { choice: 'apply', excluded: ['fix:Summary'], locked: ['Summary'] }
        : { choice: 'apply', excluded: [] })
    }
    const saved: string[] = []
    await new PlexSync(app as never, settings, () => {
      saved.push(JSON.stringify(settings.lockedProperties))
      return Promise.resolve()
    }, approve).run(() => {}, 'check', ['Summary', 'Date'])
    expect(requests[0].lines.map(l => l.label).sort()).toEqual(['Date', 'Summary'])
    expect(settings.lockedProperties).toEqual({ 'Media/Movies/Arrival (2016).md': ['Summary'] })
    // Saved to the plugin's settings at once.
    expect(saved).toContain(JSON.stringify({ 'Media/Movies/Arrival (2016).md': ['Summary'] }))
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Summary).toBe('Mine.')
    // Next time Summary isn't offered, and a check of Summary alone asks nothing.
    requests.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(requests).toEqual([])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')!.Summary).toBe('Mine.')
  })

  it('stops asking once told to stop (the plugin reloaded)', async () => {
    const { app } = makeApp({
      'Media/Movies/Arrival (2016).md': { Link: 'http://plex:32400/library/metadata/1', Summary: 'Mine.' },
      'Media/Movies/Heat (1995).md': { Link: 'http://plex:32400/library/metadata/2', Summary: 'Mine too.' },
    })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0], movies[1]] } })
    const requests: ApprovalRequest[] = []
    const sync: InstanceType<typeof PlexSync> = new PlexSync(app as never, settings, () => Promise.resolve(), r => {
      requests.push(r)
      sync.stop()
      return Promise.resolve({ choice: 'skip', excluded: [] })
    })
    const result = await sync.run(() => {}, 'check', ['Summary'])
    expect(requests).toHaveLength(1)
    expect(result.stopped).toBe(true)
  })

  it('checks only the libraries chosen', async () => {
    const { app } = makeApp({ 'Media/Movies/Arrival (2016).md': { Link: 'http://plex:32400/library/metadata/1', Summary: 'Mine.' } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie'), 3: newLibrary('Music', 'artist', 'music') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'skip', excluded: [] })
    }
    requested.length = 0
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'], undefined, new Set(['3']))
    expect(requests).toEqual([])
    expect(requested.some(url => url.includes('/library/sections/1/'))).toBe(false)
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'], undefined, new Set(['1']))
    expect(requests.map(r => r.path)).toEqual(['Media/Movies/Arrival (2016).md'])
  })

  it('points out a duration that isn\'t a number in the pop-up', async () => {
    const { app } = makeApp({ 'Media/Movies/Arrival (2016).md': { Duration: '1h 56m', Summary: 'Mine.' } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'skip', excluded: [] })
    }
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(requests[0].unchanged?.find(u => u.label === 'Duration')).toMatchObject({ label: 'Duration', value: '1h 56m', warn: 'Not a number' })
  })

  it('renames a note in a check only when the file name is checked, and shows the rest of the note', async () => {
    const { app, files } = makeApp({ 'Media/Movies/arrival.md': { Link: 'http://plex:32400/library/metadata/1', Summary: 'Mine.' } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const requests: ApprovalRequest[] = []
    const approve = (r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: [] })
    }

    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(files.has('Media/Movies/arrival.md')).toBe(true)
    expect(requests.flatMap(r => r.unchanged ?? []).find(u => u.label === 'File name')).toMatchObject({ label: 'File name', value: 'arrival' })

    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['File name'])
    expect(result.renamed).toEqual([{ from: 'Media/Movies/arrival.md', to: 'Media/Movies/Arrival (2016).md' }])
  })

  it('says why a note with a link matches nothing', async () => {
    const { app } = makeApp({
      'Media/Movies/Aurora by Juanes.md': { Link: 'https://app.plex.tv/desktop/#!/server/srv/details?key=%2Flibrary%2Fmetadata%2F103528' },
      'Media/Movies/Old film I deleted.md': {},
    })
    const settings = settingsWith({ askBeforeChanges: false })
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    responses.set('/library/metadata/103528', { MediaContainer: { Metadata: [{ ratingKey: '103528', type: 'album', title: 'Aurora', parentTitle: 'Juanes' }] } })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(result.unmatched).toEqual(['Media/Movies/Aurora by Juanes.md', 'Media/Movies/Old film I deleted.md'])
    expect(result.unmatchedWhy['Media/Movies/Aurora by Juanes.md']).toContain('That\'s a link to an album. Music notes are made for each track.')
    expect(result.unmatchedWhy['Media/Movies/Old film I deleted.md']).toContain('no Plex or Steam link')
  })

  it('points out notes in the libraries\' folders that match nothing, unless always ignored', async () => {
    const { app } = makeApp({
      'Media/Movies/Heat (1995).md': {},
      'Media/Movies/Old film I deleted.md': {},
      'Media/Movies/Movies index.md': {},
      'Notes/Elsewhere.md': {},
    })
    const settings = settingsWith({ askBeforeChanges: false, unmatchedIgnored: ['Media/Movies/Movies index.md'] })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(result.unmatched).toEqual(['Media/Movies/Old film I deleted.md'])
  })

  it('starts every offered difference ticked by default', async () => {
    const { app } = makeApp({ 'Media/Movies/Arrival (2016).md': { Summary: 'My own summary.', Duration: 150 } })
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [movies[0]] } })
    const approve = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'skip' as const, excluded: [] }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary', 'Duration'])
    expect(approve.mock.calls[0][0].lines.map(l => [l.label, l.unticked])).toEqual([['Summary', false], ['Duration', false]])
  })

  it('adds Romance to the kept genres, left out of music, once', () => {
    const saved = {
      allowedGenres: ['Action', 'Comedy'],
      libraries: { 3: { title: 'Music', type: 'artist', target: 'music', folder: 'Media/Music', fileNameFormat: '{{title}}', matchBy: 'loose', properties: [], values: { watched: '', started: '', unwatched: '', tag: 'music' } } },
    }
    const once = loadSettings(saved)
    expect(once.allowedGenres).toEqual(['Action', 'Comedy', 'Romance'])
    expect(once.libraries['3'].leaveOutGenres).toEqual(['Romance'])
    const again = loadSettings({ ...saved, migrations: once.migrations })
    expect(again.allowedGenres).toEqual(['Action', 'Comedy'])
  })

  it('drops Duration from saved music libraries and renames book Pages to Duration, once', () => {
    const saved = {
      libraries: {
        3: { title: 'Music', type: 'artist', target: 'music', folder: 'Media/Music', fileNameFormat: '{{title}}', matchBy: 'loose',
          properties: [{ name: 'Artist', source: 'artist' }, { name: 'Duration', source: 'durationClock' }], values: { watched: '', started: '', unwatched: '', tag: 'music' } },
        books: { title: 'Books', type: 'books', target: 'book', folder: 'Media/Books', fileNameFormat: '{{title}}', matchBy: 'loose',
          properties: [{ name: 'Author', source: 'authors' }, { name: 'Pages', source: 'pages' }], values: { watched: '', started: '', unwatched: 'pending', tag: 'book' } },
      },
    }
    const once = loadSettings(saved)
    expect(once.libraries['3'].properties.map(p => p.name)).toEqual(['Artist'])
    expect(once.libraries.books.properties).toEqual([{ name: 'Author', source: 'authors' }, { name: 'Duration', source: 'pages' }])
    // Put back by hand afterwards: left alone.
    const again = loadSettings({ ...saved, migrations: once.migrations })
    expect(again.libraries['3'].properties.map(p => p.name)).toEqual(['Artist', 'Duration'])
    expect(again.libraries.books.properties.map(p => p.name)).toEqual(['Author', 'Pages'])
  })

  it('keeps a game\'s Steam collections in step, and leaves them alone when they can\'t be read', async () => {
    steamResponses = {
      'https://api.steampowered.com/IPlayerService/GetOwnedGames': { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 0 }] } },
    }
    const { app, frontmatter } = makeApp({ 'Media/Video Games/Portal 2.md': { Link: 'https://store.steampowered.com/app/620/', Collections: ['Old one'] } })
    const settings = settingsWith({ serverUrl: '', token: '', askBeforeChanges: false, steam: { apiKey: 'k', account: '76561197960287930', includeFreeGames: false } })
    settings.libraries = {}
    const { ensureSteamLibrary } = await import('../src/config')
    ensureSteamLibrary(settings)
    settings.libraries.steam.properties = [{ name: 'Link', source: 'plexLink' }, { name: 'Collections', source: 'steamCollections' }]

    // On a phone (or with Steam's files not found): left alone.
    vi.mocked(readSteamCollections).mockReturnValueOnce(null)
    await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Video Games/Portal 2.md')!.Collections).toEqual(['Old one'])

    vi.mocked(readSteamCollections).mockReturnValueOnce(new Map([[620, ['Cozy', 'Favorites']]]))
    const result = await new PlexSync(app as never, settings, () => Promise.resolve()).run(() => {})
    expect(frontmatter.get('Media/Video Games/Portal 2.md')!.Collections).toEqual(['Cozy', 'Favorites'])
    expect(result.playCounts).toEqual(['Media/Video Games/Portal 2.md'])
    expect(vi.mocked(readSteamCollections)).toHaveBeenLastCalledWith('76561197960287930', '')
  })

  it('takes a book\'s summary from Google Books, else Open Library\'s', async () => {
    steamResponses = {
      'https://openlibrary.org/search.json?q=': { docs: [{ key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, isbn: ['9780441172719'] }] },
      'https://openlibrary.org/works/OL893415W.json': { description: 'A bad summary.' },
      'https://www.googleapis.com/books/v1/volumes?q=isbn': { items: [{ volumeInfo: { title: 'Dune', description: 'Set on the desert planet Arrakis…' } }] },
    }
    const { app, frontmatter } = makeApp({ 'Media/Books/Dune by Frank Herbert.md': { Author: ['Frank Herbert'], Summary: 'A bad summary.', Link: 'https://openlibrary.org/works/OL893415W' } })
    const settings = settingsWith()
    settings.libraries = {}
    const { addLibrary } = await import('../src/config')
    addLibrary(settings, 'book')
    const approve = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'apply' as const, excluded: [] }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Summary'])
    expect(frontmatter.get('Media/Books/Dune by Frank Herbert.md')!.Summary).toBe('Set on the desert planet Arrakis…')
    expect(requested.some(u => u.startsWith('https://www.googleapis.com/books/v1/volumes?q=isbn%3A9780441172719'))).toBe(true)
  })

  it('offers a cover you set yourself (a [[link]] to a vault image) unticked in a check', async () => {
    steamResponses = {
      'https://openlibrary.org/search.json?q=key%3A%2Fworks%2FOL1W': { docs: [{ key: '/works/OL1W', title: 'Dune', cover_i: 11 }] },
      'https://openlibrary.org/search.json?q=key%3A%2Fworks%2FOL2W': { docs: [{ key: '/works/OL2W', title: 'Emma', cover_i: 22 }] },
    }
    const { app } = makeApp({
      'Media/Books/Dune.md': { Image: '[[Media/Books/Images/My Dune cover.jpg]]', Link: 'https://openlibrary.org/works/OL1W' },
      'Media/Books/Emma.md': { Image: 'https://example.com/old.jpg', Link: 'https://openlibrary.org/works/OL2W' },
    })
    const settings = settingsWith()
    settings.libraries = {}
    const { addLibrary } = await import('../src/config')
    addLibrary(settings, 'book')
    const approve = vi.fn((_r: ApprovalRequest) => Promise.resolve({ choice: 'skip' as const, excluded: [] }))
    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Image'])
    expect(approve.mock.calls.map(c => [c[0].path, c[0].lines.map(l => l.unticked)])).toEqual([
      ['Media/Books/Dune.md', [true]],
      ['Media/Books/Emma.md', [false]],
    ])
  })

  it('checks ratings both ways, adds missing tags and fills an empty poster in a check', async () => {
    const { app, frontmatter, binaries } = makeApp({
      'Media/Movies/Heat (1995).md': { Rating: 2, tags: ['favourites'], Image: '' },
    })
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Rating', source: 'userRating' }, { name: 'tags', source: 'typeTag' }, { name: 'Image', source: 'poster' }]
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [{ ...movies[1], userRating: 8, thumb: '/library/metadata/2/thumb/1' }] } })
    responses.set('/library/metadata/2', { MediaContainer: { Metadata: [{ ...movies[1], userRating: 8, thumb: '/library/metadata/2/thumb/1' }] } })
    responses.set('/:/rate', {})
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      // Tick sending the note's rating to Plex; keep the rest as offered.
      return Promise.resolve({ choice: 'apply', excluded: r.lines.filter(l => l.unticked && l.key !== 'plexRating').map(l => l.key) })
    })

    await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Rating', 'tags', 'Image'])

    expect(requests[0].lines.map(l => [l.key, l.value, l.unticked])).toEqual([
      ['fix:Rating', '4', true],
      ['fix:tags', 'favourites, movie', false],
      ['fix:Image', 'poster downloaded from Plex', false],
      ['plexRating', '⭐⭐ (2 stars in Plex)', true],
    ])
    expect(frontmatter.get('Media/Movies/Heat (1995).md')).toMatchObject({ Rating: 2, tags: ['favourites', 'movie'], Image: '[[Media/Movies/Images/Heat (1995).jpg]]' })
    expect(binaries).toContain('Media/Movies/Images/Heat (1995).jpg')
    expect(requested.some(u => u.includes('/:/rate?key=2') && u.endsWith('rating=4'))).toBe(true)
  })

  it('offers book ratings in the star scale in a check, found on Open Library or not', async () => {
    steamResponses = {
      'https://openlibrary.org/search.json?q=': { docs: [{ key: '/works/OL1W', title: 'Dune' }] },
      'https://openlibrary.org/search.json?title=': { docs: [] },
    }
    const { app, frontmatter } = makeApp({
      'Media/Books/Dune.md': { Rating: '⭐⭐', Link: 'https://openlibrary.org/works/OL1W' },
      'Media/Books/My zine.md': { Rating: '⭐' },
      'Media/Books/Bad book.md': { Rating: '💣' },
    })
    const settings = settingsWith()
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries['1'].properties = [{ name: 'Rating', source: 'userRatingEmoji' }]
    const { addLibrary } = await import('../src/config')
    addLibrary(settings, 'book')
    const requests: ApprovalRequest[] = []
    const approve = vi.fn((r: ApprovalRequest): Promise<Decision> => {
      requests.push(r)
      return Promise.resolve({ choice: 'apply', excluded: [] })
    })
    const result = await new PlexSync(app as never, settings, () => Promise.resolve(), approve).run(() => {}, 'check', ['Genre', 'Rating'])
    expect(requests.map(r => [r.path, r.lines.map(l => [l.key, l.current, l.value])]).sort()).toEqual([
      ['Media/Books/Dune.md', [['rescale:Rating', '⭐⭐', '⭐⭐⭐']]],
      // Not on Open Library: its rating is still converted.
      ['Media/Books/My zine.md', [['rescale:Rating', '⭐', '⭐⭐']]],
    ])
    expect(frontmatter.get('Media/Books/Dune.md')!.Rating).toBe('⭐⭐⭐')
    expect(frontmatter.get('Media/Books/My zine.md')!.Rating).toBe('⭐⭐')
    // 💣 is one star in both scales: nothing to offer, just marked reviewed.
    expect(settings.ratingsReviewed).toMatchObject({ 'book:Media/Books/Dune.md': true, 'book:Media/Books/My zine.md': true, 'book:Media/Books/Bad book.md': true })
    expect(result.unmatched).toContain('Media/Books/My zine.md')
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
        Author: ['Frank Herbert'], Genre: ['Sci-Fi'], Year: 1965, Duration: 604, Summary: 'A desert planet.', Status: 'pending',
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
    expect(settings.libraries['3'].properties.map(p => p.name)).toEqual(['Artist', 'Album', 'Track', 'Genre', 'Date', 'Link', 'Image', 'tags'])
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

describe('file name brackets', () => {
  it('turns square brackets into round ones by default, for new and saved settings, unless set', () => {
    expect(loadSettings({}).fileNameReplacements).toMatchObject({ '[': '(', ']': ')' })
    expect(loadSettings({ serverUrl: 'x', fileNameReplacements: { ':': '-' } }).fileNameReplacements).toEqual({ ':': '-', '[': '(', ']': ')' })
    expect(loadSettings({ serverUrl: 'x', fileNameReplacements: { '[': '' } }).fileNameReplacements['[']).toBe('')
  })
})

describe('recommendation data from Plex', () => {
  it('takes a note\'s director and cast from its Plex item, without writing them to the note', async () => {
    const { itemEntry, noteEntries, withItem } = await import('../src/recommend-data')
    const { app, frontmatter } = makeApp({ 'Media/Movies/Arrival (2016).md': { Genre: ['Sci-Fi'] } })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    responses.set('/library/sections/1/all', { MediaContainer: { Metadata: [
      { ...movies[0], Director: [{ tag: 'Denis Villeneuve' }], Role: [{ tag: 'Amy Adams' }], Genre: [{ tag: 'Drama' }] },
      movies[1],
    ] } })
    const { withNotes, withoutNotes } = await new PlexSync(app as never, settings, () => Promise.resolve()).libraryItems(() => {})
    expect(withNotes.map(w => [w.path, w.item.title])).toEqual([['Media/Movies/Arrival (2016).md', 'Arrival']])
    expect(withoutNotes.map(w => w.item.title)).toEqual(['Heat'])
    const [note] = noteEntries(app as never, settings)
    const merged = withItem(note, itemEntry(withNotes[0].item, 'movie'))
    expect([merged.genres, merged.people]).toEqual([['Sci-Fi', 'Drama'], ['Denis Villeneuve', 'Amy Adams']])
    expect(frontmatter.get('Media/Movies/Arrival (2016).md')).toEqual({ Genre: ['Sci-Fi'] })
  })

  it('takes a book\'s author from a "Title by Author" file name', async () => {
    const { noteEntries } = await import('../src/recommend-data')
    const { app } = makeApp({ 'Media/Books/Dune by Frank Herbert.md': {} })
    const settings = settingsWith({})
    settings.libraries = { books: { ...newLibrary('Books', 'book', 'book'), properties: [] } }
    expect(noteEntries(app as never, settings).map(e => e.people)).toEqual([['Frank Herbert']])
  })
})

describe('recommendation data', () => {
  it('reads ratings (old and new scales), statuses, genres and people from notes', async () => {
    const { noteEntries } = await import('../src/recommend-data')
    const { app } = makeApp({
      'Media/Movies/Arrival (2016).md': { Genre: ['Sci-Fi'], Rating: '⭐⭐⭐', Director: ['[[Denis Villeneuve]]'], Status: 'completed' },
      'Media/Movies/Dune (2021).md': { Genre: ['Sci-Fi'], Status: 'pending' },
    })
    const settings = settingsWith({})
    settings.libraries = { 1: newLibrary('Movies', 'movie', 'movie') }
    settings.libraries[1].properties.push({ name: 'Rating', source: 'userRatingEmoji' }, { name: 'Director', source: 'directors' })
    const entries = noteEntries(app as never, settings)
    // ⭐⭐⭐ is four stars in the old emoji scale, until the note's rating is reviewed.
    expect(entries.map(e => [e.title, e.level, e.unseen, e.genres, e.people])).toEqual([
      ['Arrival (2016)', 4, false, ['Sci-Fi'], ['Denis Villeneuve']],
      ['Dune (2021)', null, true, ['Sci-Fi'], []],
    ])
  })
})
