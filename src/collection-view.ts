import { App, BasesView, Notice, type QueryController, type TFile } from 'obsidian'
import { CollectionsModal } from './collections-modal'
import type { PlexNotesSettings } from './config'
import { songKeyOf } from './playlist'
import { planBaseCollection, sendCollections } from './plex-collections'
import { errorMessage } from './settings'

export const COLLECTION_VIEW = 'pmn-plex-collection'

/** Works out the collection from these notes, shows what would change, then sends it once you say so. */
async function offerCollection(app: App, settings: PlexNotesSettings, name: string, files: TFile[]): Promise<void> {
  const notice = new Notice('Looking up the movies and shows in Plex…', 0)
  let planned: Awaited<ReturnType<typeof planBaseCollection>>
  try {
    planned = await planBaseCollection(settings, name, files.map(file => ({ path: file.path, basename: file.basename, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? {} })))
  } catch (err) {
    new Notice(`Couldn't work out the collection: ${errorMessage(err)}`, 10000)
    return
  } finally {
    notice.hide()
  }
  const { plans, leftOut, unchanged } = planned
  if (!plans.length && !leftOut.length) {
    new Notice(unchanged ? `"${name}" in Plex already holds just these` : 'None of these notes is a movie or show in Plex')
    return
  }
  new CollectionsModal(app, plans, leftOut, chosen => {
    if (!chosen?.length) return
    void sendCollections(settings, chosen).then(
      () => new Notice(`Sent "${name}" to Plex`),
      err => new Notice(`Sending the collection failed: ${errorMessage(err)}`, 10000),
    )
  }).open()
}

/**
 * The "Plex collection" Bases view: the Base's movie and show notes, with a button that sends them
 * to Plex as a collection (one per library they're in), like the "Plex playlist" view does for
 * songs. Made only when Obsidian has Bases (1.10 and later).
 */
export function collectionView(controller: QueryController, containerEl: HTMLElement, settings: () => PlexNotesSettings): BasesView {
  class CollectionView extends BasesView {
    type = COLLECTION_VIEW

    constructor(queryController: QueryController) {
      super(queryController)
    }

    onDataUpdated(): void {
      containerEl.empty()
      containerEl.addClass('pmn-playlist')
      const files = this.data.data.map(entry => entry.file)
      const option = this.config.get('collectionName')
      const name = (typeof option === 'string' && option.trim()) || this.config.name
      const header = containerEl.createDiv('pmn-playlist-header')
      header.createDiv({ cls: 'pmn-playlist-name', text: name })
      header.createDiv({ cls: 'pmn-playlist-count', text: `${files.length} note${files.length === 1 ? '' : 's'}` })
      const button = header.createEl('button', { cls: 'mod-cta', text: 'Send to Plex' })
      button.disabled = !files.length
      button.addEventListener('click', () => void offerCollection(this.app, settings(), name, files))
      const list = containerEl.createEl('ul', { cls: 'pmn-playlist-songs' })
      for (const file of files) {
        const row = list.createEl('li')
        const link = row.createEl('a', { cls: 'internal-link', text: file.basename })
        link.addEventListener('click', event => {
          event.preventDefault()
          void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(file)
        })
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
        if (!songKeyOf(frontmatter, file.path, settings())) row.createSpan({ cls: 'pmn-playlist-missing', text: ' (no Plex link, left out)' })
      }
    }
  }
  return new CollectionView(controller)
}
