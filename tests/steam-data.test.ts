import { describe, expect, it } from 'vitest'
import { accountId, collectionsByGame, gameItem, parseSteamAccount, parseSteamDate, plainText, portraitCandidates, steamFolders, withDetails } from '../src/steam-data'

describe('parseSteamAccount', () => {
  it('reads IDs, profile addresses and custom names', () => {
    expect(parseSteamAccount('76561197960287930')).toEqual({ steamId: '76561197960287930' })
    expect(parseSteamAccount('https://steamcommunity.com/profiles/76561197960287930/')).toEqual({ steamId: '76561197960287930' })
    expect(parseSteamAccount('https://steamcommunity.com/id/gabelogannewell')).toEqual({ vanity: 'gabelogannewell' })
    expect(parseSteamAccount('gabelogannewell')).toEqual({ vanity: 'gabelogannewell' })
    expect(parseSteamAccount('  ')).toBeNull()
    expect(parseSteamAccount('not a name!')).toBeNull()
  })
})

describe('parseSteamDate', () => {
  it('handles the store\'s date styles', () => {
    expect(parseSteamDate('21 Aug, 2012')).toEqual({ date: '2012-08-21', year: 2012 })
    expect(parseSteamDate('Aug 21, 2012')).toEqual({ date: '2012-08-21', year: 2012 })
    expect(parseSteamDate('1 Sept, 2020')).toEqual({ date: '2020-09-01', year: 2020 })
    expect(parseSteamDate('Q4 2024')).toEqual({ year: 2024 })
    expect(parseSteamDate('Coming soon')).toEqual({})
    expect(parseSteamDate(undefined)).toEqual({})
  })
})

describe('plainText', () => {
  it('strips HTML and decodes entities', () => {
    expect(plainText('Portal&trade; <b>2</b> &amp; friends&#39; &quot;co-op&quot;<br>Play now')).toBe('Portal™ 2 & friends\' "co-op"\nPlay now')
    expect(plainText('')).toBeUndefined()
  })
})

describe('games', () => {
  const owned = gameItem({ appid: 620, name: 'Portal 2', playtime_forever: 754, playtime_2weeks: 30, rtime_last_played: 1700000000 })

  it('turns an owned game into an item', () => {
    expect(owned).toEqual({
      ratingKey: 'steam-620', type: 'game', title: 'Portal 2', steamAppId: 620,
      playtimeMinutes: 754, recentMinutes: 30, lastViewedAt: 1700000000,
    })
    expect(gameItem({ appid: 9 }).title).toBe('Steam app 9')
  })

  it('adds the store details', () => {
    const item = withDetails(owned, {
      short_description: 'A <i>puzzle</i> game.',
      header_image: 'https://example/header.jpg',
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: [{ description: 'Action' }, { description: 'Adventure' }],
      release_date: { date: '18 Apr, 2011' },
      metacritic: { score: 95 },
      platforms: { windows: true, mac: true, linux: false },
    })
    expect(item).toMatchObject({
      summary: 'A puzzle game.',
      Genre: [{ tag: 'Action' }, { tag: 'Adventure' }],
      originallyAvailableAt: '2011-04-18',
      year: 2011,
      developers: ['Valve'],
      platforms: ['Windows', 'macOS'],
      metacritic: 95,
      wideImage: 'https://example/header.jpg',
    })
    expect(withDetails(owned, null)).toBe(owned)
  })

  it('lists where the portrait cover may be, newest address first', () => {
    expect(portraitCandidates(620, 'steam/apps/620/${FILENAME}?t=1', 'abc/library_600x900.jpg')[0])
      .toBe('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/abc/library_600x900.jpg?t=1')
    expect(portraitCandidates(620)).toHaveLength(2)
  })
})

describe('Steam collections', () => {
  const entry = (key: string, value: object, deleted = false) => [key, { key, timestamp: 1, value: JSON.stringify(value), version: '1', ...deleted ? { is_deleted: true } : {} }]
  it('lists each game\'s collections from Steam\'s local cloud storage file', () => {
    const file = [
      entry('user-collections.uc-a', { id: 'uc-a', name: 'Cozy', added: [620, 1145360], removed: [] }),
      entry('user-collections.uc-b', { id: 'uc-b', name: 'Couch co-op', added: [620], removed: [] }),
      entry('user-collections.favorite', { id: 'favorite', added: [1145360], removed: [] }),
      entry('user-collections.hidden', { id: 'hidden', added: [440], removed: [] }),
      entry('user-collections.uc-c', { id: 'uc-c', name: 'Unplayed', filterSpec: { nFormatVersion: 2 } }),
      entry('user-collections.uc-d', { id: 'uc-d', name: 'Gone', added: [620] }, true),
      ['showcases.1', { value: '{}' }],
    ]
    const byGame = collectionsByGame(file)
    expect(byGame.get(620)).toEqual(['Couch co-op', 'Cozy'])
    expect(byGame.get(1145360)).toEqual(['Cozy', 'Favorites'])
    expect(byGame.has(440)).toBe(false)
    expect(collectionsByGame(null).size).toBe(0)
  })
  it('finds Steam\'s folders', () => {
    expect(accountId('76561197960287930')).toBe('22202')
    expect(steamFolders('win32', 'C:\\Users\\me')[0]).toBe('C:\\Program Files (x86)\\Steam')
    expect(steamFolders('darwin', '/Users/me')).toEqual(['/Users/me/Library/Application Support/Steam'])
  })
})
