import { Notice, Plugin } from 'obsidian'
import { defaultSettings, errorMessage, PlexNotesSettingTab, type PlexNotesSettings } from './settings'
import { PlexSync } from './sync'

export default class PlexMediaNotesPlugin extends Plugin {
  settings: PlexNotesSettings = defaultSettings()
  private plexSyncRunning = false

  async onload(): Promise<void> {
    await this.loadSettings()

    this.addRibbonIcon('clapperboard', 'Create notes from Plex', () => {
      void this.syncFromPlex()
    })

    this.addCommand({
      id: 'create-notes-from-plex',
      name: 'Create notes for new Plex movies and shows',
      callback: () => {
        void this.syncFromPlex()
      },
    })

    this.addSettingTab(new PlexNotesSettingTab(this.app, this))
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<PlexNotesSettings> | null
    const defaults = defaultSettings()
    this.settings = {
      ...defaults,
      ...data,
      libraries: { ...data?.libraries },
      properties: Array.isArray(data?.properties) ? data.properties : defaults.properties,
      values: { ...defaults.values, ...data?.values, tags: { ...defaults.values.tags, ...data?.values?.tags } },
    }
    delete (this.settings as Partial<PlexNotesSettings> & { postersFolder?: string }).postersFolder
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  async syncFromPlex(): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('Plex sync is already running')
      return
    }
    this.plexSyncRunning = true
    const notice = new Notice('Connecting to Plex…', 0)
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings())
        .run(message => notice.setMessage(message))
      notice.hide()

      const parts = [`Created ${result.created.length} note${result.created.length === 1 ? '' : 's'}`]
      if (result.renamed.length) {
        parts.push(`renamed ${result.renamed.length}`)
        console.log('Plex media notes: renamed', result.renamed)
      }
      parts.push(`${result.skipped} already had one`)
      if (result.failed.length) {
        parts.push(`${result.failed.length} failed`)
        console.error('Plex media notes: failed items', result.failed)
      }
      new Notice(parts.join(', '), 8000)
    } catch (err) {
      notice.hide()
      new Notice(`Plex sync failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
    }
  }
}
