// Plex collections from your notes: the names in a movie or show note's Playlist property, and
// automatic collections of every note with a tag or theme (`settings.collectionRules`). Worked out first
// (`planCollections`), sent afterwards (`sendCollections`); the pure parts are in collections.ts.
import { normalizePath, type App } from 'obsidian'
import { collectionChanges, fitsRule, parseCollectionRules, wantedCollections, type CollectionNote } from './collections'
import { plexReady, type PlexNotesSettings } from './config'
import type { PlexItem } from './notes'
import { PlexClient } from './plex'
import { songKeyOf } from './playlist'

/** What sending one collection to Plex would do. */
export interface CollectionPlan {
  section: string
  library: string
  name: string
  /** Made by a rule (a tag), not only named in notes. */
  auto: boolean
  type: 'movie' | 'show'
  /** The collection of that name already in Plex, if any. */
  existing: string | null
  add: { key: string, title: string }[]
  remove: { key: string, title: string }[]
}

/** Plex sends items in batches this size, so a request's address stays short. */
const BATCH = 100

const listOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? value.split(',') : []).map(v => String(v).trim()).filter(Boolean)

/**
 * The collections your notes ask for, and what sending them would change in Plex, without sending
 * anything. `which: 'auto'` only looks at the automatic ones (with any notes naming the same
 * collection by hand). Collections that already hold just the right items are left out; smart
 * collections are never touched.
 */
export async function planCollections(app: App, settings: PlexNotesSettings, which: 'all' | 'auto' = 'all'): Promise<{ plans: CollectionPlan[], leftOut: { path: string, reason: string }[], unchanged: number }> {
  if (!plexReady(settings)) throw new Error('Set up Plex in the plugin settings first')
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const rules = parseCollectionRules(settings.collectionRules)
  const leftOut: { path: string, reason: string }[] = []
  const wanting: { path: string, title: string, key: string, collections: string[], tags: string[], themes: string[] }[] = []
  const libraries = Object.entries(settings.libraries).filter(([key, lib]) => /^\d+$/.test(key) && ['movie', 'documentary', 'tv'].includes(lib.target))
  const seen = new Set<string>()
  // The property your movie and show notes name their collections in ("Playlist", any case).
  const property = settings.collectionsProperty.trim() || 'Playlist'
  for (const [, lib] of libraries) {
    const folder = `${normalizePath(lib.folder)}/`
    for (const file of app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(folder) || seen.has(file.path)) continue
      seen.add(file.path)
      const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      const name = Object.keys(fm).find(k => k.toLowerCase() === property.toLowerCase())
      const collections = name ? listOf(fm[name]) : []
      const tags = listOf(fm.tags).map(t => t.replace(/^#/, ''))
      const themesKey = Object.keys(fm).find(k => k.toLowerCase() === (settings.themesProperty || 'Themes').toLowerCase())
      const themes = themesKey ? listOf(fm[themesKey]) : []
      const ruled = rules.some(r => fitsRule({ tags, themes }, r))
      if (!collections.length && !ruled) continue
      const key = songKeyOf(fm, file.path, settings)
      if (!key) {
        leftOut.push({ path: file.path, reason: 'no Plex link' })
        continue
      }
      wanting.push({ path: file.path, title: file.basename, key, collections, tags, themes })
    }
  }
  // Which library each item is in (a collection holds one library's items).
  const keys = [...new Set(wanting.map(w => w.key))]
  const items = new Map<string, PlexItem>()
  for (let i = 0; i < keys.length; i += BATCH) for (const item of await plex.items(keys.slice(i, i + BATCH))) items.set(item.ratingKey, item)
  const notes: CollectionNote[] = []
  for (const w of wanting) {
    const item = items.get(w.key)
    if (!item) leftOut.push({ path: w.path, reason: 'not in Plex any more' })
    else if (item.type !== 'movie' && item.type !== 'show') leftOut.push({ path: w.path, reason: `its Link is to ${item.type === 'episode' ? 'an episode' : `a ${item.type ?? 'thing'}`} in Plex, not a movie or show` })
    else if (item.librarySectionID === undefined) leftOut.push({ path: w.path, reason: 'Plex didn\'t say which library it\'s in' })
    else notes.push({ path: w.path, title: w.title, key: w.key, section: String(item.librarySectionID), collections: w.collections, tags: w.tags, themes: w.themes })
  }
  const wanted = wantedCollections(notes, rules).filter(c => which === 'all' || c.auto)
  const plans: CollectionPlan[] = []
  let unchanged = 0
  const inPlex = new Map<string, Awaited<ReturnType<PlexClient['collections']>>>()
  for (const want of wanted) {
    if (!inPlex.has(want.section)) inPlex.set(want.section, await plex.collections(want.section))
    const existing = inPlex.get(want.section)!.find(c => c.title.trim().toLowerCase() === want.name.toLowerCase())
    const library = settings.libraries[want.section]?.title ?? `library ${want.section}`
    if (existing && (existing.smart === true || existing.smart === 1 || existing.smart === '1')) {
      leftOut.push({ path: '', reason: `"${want.name}" in ${library} is a smart collection in Plex, which can't be filled from notes` })
      continue
    }
    const holding = existing ? await plex.collectionItems(existing.ratingKey) : []
    const { add, remove } = collectionChanges(want.keys, holding.map(i => i.ratingKey))
    if (!add.length && !remove.length) {
      unchanged++
      continue
    }
    plans.push({
      section: want.section,
      library,
      name: existing?.title ?? want.name,
      auto: want.auto,
      type: items.get(want.keys[0])?.type === 'show' ? 'show' : 'movie',
      existing: existing?.ratingKey ?? null,
      add: add.map(key => ({ key, title: want.titles.get(key) ?? key })),
      remove: remove.map(key => ({ key, title: holding.find(i => i.ratingKey === key)?.title ?? key })),
    })
  }
  return { plans, leftOut, unchanged }
}

/** Sends planned collections to Plex: new ones made, existing ones have items added and removed until they hold just the notes'. */
export async function sendCollections(settings: PlexNotesSettings, plans: CollectionPlan[]): Promise<void> {
  if (!plans.length) return
  const plex = new PlexClient(settings.serverUrl, settings.token)
  const machineId = await plex.machineIdentifier()
  for (const plan of plans) {
    const keys = plan.add.map(a => a.key)
    let collection = plan.existing
    let start = 0
    if (!collection) {
      collection = await plex.createCollection(plan.section, plan.type, plan.name, machineId, keys.slice(0, BATCH))
      start = BATCH
    }
    for (; start < keys.length; start += BATCH) await plex.addToCollection(collection, machineId, keys.slice(start, start + BATCH))
    for (const r of plan.remove) await plex.removeFromCollection(collection, r.key)
  }
}
