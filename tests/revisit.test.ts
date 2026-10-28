import { describe, expect, it } from 'vitest'
import { revisitPicks, revisitSeeds } from '../src/revisit'
import type { PlexItem } from '../src/notes'

const now = 1_800_000_000
const day = 86400
const song = (key: string, artist: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey: key, type: 'track', title: `Song ${key}`, grandparentTitle: artist, ...extra })

describe('the Revisit playlist', () => {
  it('starts from favorites (⭐⭐⭐⭐ or 🩷 in Plex), at random', () => {
    const tracks = [song('1', 'A', { userRating: 10 }), song('2', 'A', { userRating: 6 }), song('3', 'B', { userRating: 8 })]
    expect(revisitSeeds(tracks, 5).map(t => t.ratingKey).sort()).toEqual(['1', '3'])
    expect(revisitSeeds(tracks, 1)).toHaveLength(1)
  })

  it('picks forgotten songs that sound like the most favorites, never recent ones, at most three per artist', () => {
    const fav1 = song('f1', 'Lana Del Rey', { userRating: 10, lastViewedAt: now - day })
    const fav2 = song('f2', 'Lorde', { userRating: 8, lastViewedAt: now - 400 * day })
    const old = (key: string, artist: string, distance: number) => ({ ...song(key, artist, { lastViewedAt: now - 365 * day }), distance })
    const picks = revisitPicks([
      { seed: fav1, similar: [old('a', 'Lorde', 0.1), old('b', 'Sia', 0.2), { ...song('recent', 'Sia', { lastViewedAt: now - 3 * day }), distance: 0.05 }, { ...song('never', 'Mitski'), distance: 0.2 }] },
      { seed: fav2, similar: [old('a', 'Lorde', 0.15), old('c', 'Lorde', 0.2), old('d', 'Lorde', 0.2), old('e', 'Lorde', 0.2)] },
    ], now)
    const keys = picks.map(p => p.ratingKey)
    // Like both favorites first; the forgotten favorite itself is in; a song played 3 days ago isn't.
    expect(keys[0]).toBe('a')
    expect(keys).toContain('f2')
    expect(keys).toContain('never')
    expect(keys).not.toContain('recent')
    expect(keys).not.toContain('f1')
    expect(picks.filter(p => p.grandparentTitle === 'Lorde')).toHaveLength(3)
  })
})
