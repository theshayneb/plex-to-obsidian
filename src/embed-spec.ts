// The `media-manager` code block that shows a dashboard card in a note: what it says and how it's
// read. No Obsidian imports, so it can be unit tested; the cards are drawn by embed-cards.ts.
import type { MediaKind } from './notes'

export const EMBED_LANGUAGE = 'media-manager'

export const CARDS = ['randomizer', 'worth-a-few-words', 'this-month', 'habits'] as const
export type CardName = typeof CARDS[number]

/** A kind as it may be written ("books", "TV shows", "music"…), or null. */
export function readKind(text: string): MediaKind | 'song' | null {
  const word = text.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  if (/^movies?$/.test(word)) return 'movie'
  if (/^(tv|tv shows?|shows?|series)$/.test(word)) return 'tv'
  if (/^documentar(y|ies)$/.test(word)) return 'documentary'
  if (/^books?$/.test(word)) return 'book'
  if (/^(games?|video games?)$/.test(word)) return 'game'
  if (/^(songs?|music|tracks?)$/.test(word)) return 'song'
  return null
}

/** A code block's "key: value" lines. */
export function readSpec(source: string): { card: string, kind: string } {
  const out: Record<string, string> = {}
  for (const line of source.split('\n')) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return { card: (out.card ?? '').toLowerCase(), kind: out.kind ?? '' }
}

/** A card to embed: which one, and for which kind. */
export interface EmbedSpec {
  card: CardName
  kind: string
}

/** The code block that shows a card in a note. */
export function embedCode(embed: EmbedSpec): string {
  return `\`\`\`${EMBED_LANGUAGE}\ncard: ${embed.card}\nkind: ${embed.kind}\n\`\`\`\n`
}
