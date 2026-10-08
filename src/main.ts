import { Notice, Plugin, TFile } from 'obsidian'
import { AddModal } from './add-modal'
import { askApproval, askOwner } from './approval-modal'
import { ExplainModal } from './explain-modal'
import { defaultSettings, loadSettings, type PlexNotesSettings } from './config'
import { errorMessage, PlexNotesSettingTab } from './settings'
import type { PlexItem } from './notes'
import { PlexSync } from './sync'

export default class PlexMediaNotesPlugin extends Plugin {
  settings: PlexNotesSettings = defaultSettings()
  private plexSyncRunning = false
  /** Earliest time to try a background play count update again after one failed (ms). */
  private playCountRetryAt = 0

  async onload(): Promise<void> {
    await this.loadSettings()

    // Notes chosen with "Use an existing note" stay tied to their item when renamed or moved.
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const moved = Object.values(this.settings.merged).filter(m => m.path === oldPath)
      if (!moved.length) return
      for (const m of moved) m.path = file.path
      void this.saveSettings()
    }))

    this.addRibbonIcon('clapperboard', 'Import and sync media', () => {
      void this.syncFromPlex()
    })

    this.addCommand({
      id: 'create-notes-from-plex',
      name: 'Import and sync media',
      callback: () => {
        void this.syncFromPlex()
      },
    })

    this.addCommand({
      id: 'add-new',
      name: 'Add something new (not in Plex or Steam)',
      callback: () => {
        new AddModal(this.app, this.settings, () => this.saveSettings(), (item, libraryKey) => this.addNew(item, libraryKey)).open()
      },
    })

    this.addCommand({
      id: 'explain-item',
      name: 'Explain why an item is or isn\'t imported',
      callback: () => {
        new ExplainModal(this.app, (query, progress) =>
          new PlexSync(this.app, this.settings, () => this.saveSettings()).explain(query, progress)).open()
      },
    })

    this.addSettingTab(new PlexNotesSettingTab(this.app, this))

    // Background play count updates: check at startup and every 10 minutes whether one is due.
    // The last run time is saved, so the schedule survives restarts and is shared by synced devices.
    this.app.workspace.onLayoutReady(() => void this.updatePlayCountsIfDue())
    this.registerInterval(window.setInterval(() => void this.updatePlayCountsIfDue(), 10 * 60 * 1000))
  }

  async updatePlayCountsIfDue(): Promise<void> {
    const { updatePlayCounts, updateRatings, playCountHours, lastPlayCountUpdate } = this.settings
    if (!(updatePlayCounts || updateRatings) || !playCountHours || this.plexSyncRunning) return
    const now = Date.now()
    if (now - lastPlayCountUpdate < playCountHours * 3600 * 1000 || now < this.playCountRetryAt) return
    this.plexSyncRunning = true
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request)).run(() => {}, 'playCounts')
      this.settings.lastPlayCountUpdate = now
      await this.saveSettings()
      if (result.playCounts.length) console.log('Media import and sync: updated play counts or ratings', result.playCounts)
      if (result.failed.length) console.error('Media import and sync: failed items', result.failed)
    } catch (err) {
      // Plex or Steam may be out of reach (say, a phone away from home); quietly try again in an hour.
      this.playCountRetryAt = now + 3600 * 1000
      console.warn('Media import and sync: background play count update failed', err)
    } finally {
      this.plexSyncRunning = false
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = loadSettings(await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /** Makes a note for an item picked in "Add something new", or opens the one it already has. */
  async addNew(item: PlexItem, libraryKey: string): Promise<void> {
    try {
      const sync = new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request))
      const { created, existing } = await sync.addNew(item, libraryKey)
      const path = created ?? existing
      if (existing) new Notice(`It already has a note: ${existing}`)
      if (!path) return
      const file = this.app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file)
    } catch (err) {
      new Notice(`Couldn't add it: ${errorMessage(err)}`, 10000)
    }
  }

  async syncFromPlex(): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('Media sync is already running')
      return
    }
    this.plexSyncRunning = true
    const notice = new Notice('Starting…', 0)
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request))
        .run(message => notice.setMessage(message))
      notice.hide()

      const parts = [`Created ${result.created.length} note${result.created.length === 1 ? '' : 's'}`]
      if (result.renamed.length) {
        parts.push(`renamed ${result.renamed.length}`)
        console.log('Media import and sync: renamed', result.renamed)
      }
      if (result.playCounts.length) parts.push(`updated ${this.settings.updateRatings ? 'play counts or ratings in ' : 'play counts in '}${result.playCounts.length}`)
      if (result.filled.length) {
        parts.push(`filled in ${result.filled.length}`)
        console.log('Media import and sync: filled in', result.filled)
      }
      if (result.merged.length) {
        parts.push(`matched ${result.merged.length} to existing notes`)
        console.log('Media import and sync: matched to existing notes', result.merged)
      }
      parts.push(`${result.skipped} already had one`)
      if (result.declined) parts.push(`${result.declined} skipped by you`)
      if (result.ignored) parts.push(`${result.ignored} skipped every time`)
      if (result.stopped) parts.push('stopped')
      if (result.failed.length) {
        parts.push(`${result.failed.length} failed`)
        console.error('Media import and sync: failed items', result.failed)
      }
      new Notice(parts.join(', '), 8000)
    } catch (err) {
      notice.hide()
      new Notice(`Media sync failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
    }
  }
}
