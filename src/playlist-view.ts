import { App, BasesView, Modal, Notice, Setting, type QueryController, type TFile } from 'obsidian'
import type { PlexNotesSettings } from './config'
import { planPlaylist, sendPlaylist, songKeyOf, type PlaylistPlan } from './playlist'
import { errorMessage } from './settings'

export const PLAYLIST_VIEW = 'pmn-plex-playlist'

/** Shows what sending a playlist would do; nothing goes to Plex until you press Send. */
class PlaylistModal extends Modal {
  constructor(app: App, private readonly pmnPlan: PlaylistPlan, private readonly pmnSend: () => Promise<void>) {
    super(app)
  }

  onOpen(): void {
    const { songs, leftOut, existing, name } = this.pmnPlan
    this.titleEl.setText(`Send "${name}" to Plex`)
    this.modalEl.addClass('pmn-check')
    const { contentEl } = this
    const count = `${songs.length} song${songs.length === 1 ? '' : 's'}`
    contentEl.createEl('p', {
      text: existing
        ? `Plex already has a music playlist called "${name}" (${existing.count} song${existing.count === 1 ? '' : 's'}). Its songs are replaced with these ${count}, in this order.`
        : `A new music playlist in Plex with these ${count}, in this order.`,
    })
    const list = contentEl.createEl('ol', { cls: 'pmn-playlist-songs' })
    for (const song of songs) list.createEl('li', { text: song.title })
    if (leftOut.length) {
      contentEl.createEl('p', { cls: 'setting-item-description', text: `Left out (${leftOut.length}):` })
      const out = contentEl.createEl('ul', { cls: 'pmn-playlist-songs' })
      for (const { path, reason } of leftOut) out.createEl('li', { text: `${path.split('/').pop()!.replace(/\.md$/, '')}: ${reason}` })
    }
    new Setting(contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Send to Plex').setCta().setDisabled(!songs.length).onClick(async () => {
        b.setDisabled(true)
        await this.pmnSend()
        this.close()
      }))
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

/** Plans a playlist from these notes, asks, then sends it. */
async function offerPlaylist(app: App, settings: PlexNotesSettings, name: string, files: TFile[]): Promise<void> {
  const notice = new Notice('Looking up the songs in Plex…', 0)
  let plan: PlaylistPlan
  try {
    plan = await planPlaylist(app, settings, name, files)
  } catch (err) {
    new Notice(`Couldn't make the playlist: ${errorMessage(err)}`, 10000)
    return
  } finally {
    notice.hide()
  }
  new PlaylistModal(app, plan, async () => {
    try {
      await sendPlaylist(settings, plan)
      new Notice(`Sent "${plan.name}" to Plex (${plan.songs.length} song${plan.songs.length === 1 ? '' : 's'})`)
    } catch (err) {
      new Notice(`Sending the playlist failed: ${errorMessage(err)}`, 10000)
    }
  }).open()
}

/**
 * The "Plex playlist" Bases view: the Base's notes, in its order, with a button that sends them to
 * Plex as a music playlist. Made only when Obsidian has Bases (1.10 and later), so older versions
 * never touch `BasesView`.
 */
export function playlistView(controller: QueryController, containerEl: HTMLElement, settings: () => PlexNotesSettings): BasesView {
  class PlaylistView extends BasesView {
    type = PLAYLIST_VIEW

    constructor(queryController: QueryController) {
      super(queryController)
    }

    onDataUpdated(): void {
      containerEl.empty()
      containerEl.addClass('pmn-playlist')
      const files = this.data.data.map(entry => entry.file)
      const option = this.config.get('playlistName')
      const name = (typeof option === 'string' && option.trim()) || this.config.name
      const header = containerEl.createDiv('pmn-playlist-header')
      header.createDiv({ cls: 'pmn-playlist-name', text: name })
      header.createDiv({ cls: 'pmn-playlist-count', text: `${files.length} note${files.length === 1 ? '' : 's'}` })
      const button = header.createEl('button', { cls: 'mod-cta', text: 'Send to Plex' })
      button.disabled = !files.length
      button.addEventListener('click', () => void offerPlaylist(this.app, settings(), name, files))
      const list = containerEl.createEl('ol', { cls: 'pmn-playlist-songs' })
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
  return new PlaylistView(controller)
}
