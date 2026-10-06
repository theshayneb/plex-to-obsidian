import { describe, expect, it } from 'vitest'
import { gameItem, parseSteamAccount, parseSteamDate, plainText, portraitCandidates, withDetails } from '../src/steam-data'

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
