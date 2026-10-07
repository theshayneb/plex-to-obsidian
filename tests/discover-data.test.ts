import { describe, expect, it } from 'vitest'
import { hltbFound, omdbFound, omdbItem, openLibraryDescription, openLibraryFound, parseMinutes, steamFound } from '../src/discover-data'
import { itemKeys, ratingKeyFromLink } from '../src/notes'

describe('OMDb', () => {
  it('lists movies and shows', () => {
    const found = omdbFound({ Title: 'Inception', Year: '2010', imdbID: 'tt1375666', Type: 'movie', Poster: 'https://m.media-amazon.com/x_SX300.jpg' })
    expect(found).toMatchObject({ detail: 'Movie · 2010', source: 'OMDb', thumb: 'https://m.media-amazon.com/x_SX300.jpg' })
    expect(found.item).toMatchObject({ ratingKey: 'imdb-tt1375666', type: 'movie', year: 2010, webLink: 'https://www.imdb.com/title/tt1375666/' })
    expect(omdbFound({ Title: 'Severance', Year: '2022–', imdbID: 'tt11280740', Type: 'series' }).item).toMatchObject({ type: 'show', year: 2022 })
  })

  it('reads the details, leaving out what OMDb marks N/A', () => {
    const item = omdbItem({
      Title: 'Inception', Year: '2010', imdbID: 'tt1375666', Type: 'movie', Rated: 'PG-13', Released: '16 Jul 2010',
      Runtime: '148 min', Genre: 'Action, Adventure, Sci-Fi', Director: 'Christopher Nolan', Writer: 'N/A',
      Actors: 'Leonardo DiCaprio, Joseph Gordon-Levitt', Plot: 'A thief…', Country: 'United States, United Kingdom',
      imdbRating: '8.8', Poster: 'https://m.media-amazon.com/x_SX300.jpg', totalSeasons: 'N/A',
    })
    expect(item).toMatchObject({
      originallyAvailableAt: '2010-07-16', duration: 148 * 60_000, contentRating: 'PG-13', summary: 'A thief…',
      Genre: [{ tag: 'Action' }, { tag: 'Adventure' }, { tag: 'Sci-Fi' }], Director: [{ tag: 'Christopher Nolan' }], Writer: [],
      audienceRating: 8.8, portrait: 'https://m.media-amazon.com/x_SX600.jpg', Guid: [{ id: 'imdb://tt1375666' }],
    })
    expect(item.childCount).toBeUndefined()
  })

  it('reads runtimes', () => {
    expect(parseMinutes('148 min')).toBe(148)
    expect(parseMinutes('1 h 55 min')).toBe(115)
    expect(parseMinutes('N/A')).toBeUndefined()
  })
})

describe('Open Library', () => {
  it('lists books with authors, year, pages, a few subjects and the cover', () => {
    const found = openLibraryFound({
      key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, cover_i: 11481354,
      number_of_pages_median: 604, isbn: ['0441013597', '9780441013593'], subject: ['Science fiction', 'Dune (Imaginary place)', 'Fiction', 'Ecology', 'Deserts', 'Messiahs'],
    })!
    expect(found.detail).toBe('Frank Herbert · 1965')
    expect(found.item).toMatchObject({
      ratingKey: 'ol-OL893415W', type: 'book', title: 'Dune', year: 1965, authors: ['Frank Herbert'], pages: 604, isbn: '9780441013593',
      portrait: 'https://covers.openlibrary.org/b/id/11481354-L.jpg', webLink: 'https://openlibrary.org/works/OL893415W',
    })
    expect(found.item.Genre).toHaveLength(5)
    expect(openLibraryFound({ title: 'No key' })).toBeNull()
  })

  it('cleans up descriptions', () => {
    expect(openLibraryDescription({ description: { value: 'A desert planet.\r\n----------\r\nSee also: …' } })).toBe('A desert planet.')
    expect(openLibraryDescription({ description: 'Plain.' })).toBe('Plain.')
    expect(openLibraryDescription(null)).toBeUndefined()
  })
})

describe('games', () => {
  it('lists Steam games, not soundtracks or bundles', () => {
    expect(steamFound({ id: 367520, name: 'Hollow Knight', type: 'app', tiny_image: 't' })!.item).toEqual({ ratingKey: 'steam-367520', type: 'game', title: 'Hollow Knight', steamAppId: 367520 })
    expect(steamFound({ id: 1, name: 'Bundle', type: 'sub' })).toBeNull()
  })

  it('lists HowLongToBeat games for other platforms', () => {
    const found = hltbFound({ game_id: 68151, game_name: 'Zelda: Tears of the Kingdom', release_world: 2023, comp_main: 199800, game_image: 'totk.jpg', profile_platform: 'Nintendo Switch' })
    expect(found.detail).toBe('Nintendo Switch · 2023')
    expect(found.item).toMatchObject({ ratingKey: 'hltb-68151', type: 'game', year: 2023, platforms: ['Nintendo Switch'], webLink: 'https://howlongtobeat.com/game/68151', hltb: { main: 3330 } })
  })
})

describe('links', () => {
  it('reads IMDb, Open Library and HowLongToBeat links back', () => {
    expect(ratingKeyFromLink('https://www.imdb.com/title/tt1375666/')).toBe('imdb-tt1375666')
    expect(ratingKeyFromLink('https://openlibrary.org/works/OL893415W')).toBe('ol-OL893415W')
    expect(ratingKeyFromLink('https://howlongtobeat.com/game/68151')).toBe('hltb-68151')
  })

  it('knows a Plex item by its IMDb ID too', () => {
    expect(itemKeys({ ratingKey: '5', type: 'movie', title: 'Inception', Guid: [{ id: 'imdb://tt1375666' }, { id: 'tmdb://27205' }] })).toEqual(['5', 'imdb-tt1375666'])
  })
})
