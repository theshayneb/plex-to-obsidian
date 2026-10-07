import { Notice, Plugin } from 'obsidian'
import { askApproval, askOwner } from './approval-modal'
import { ExplainModal } from './explain-modal'
import { defaultSettings, loadSettings, type PlexNotesSettings } from './config'
import { errorMessage, PlexNotesSettingTab } from './settings'
import { PlexSync } from './sync'

export default class PlexMediaNotesPlugin extends Plugin {
  settings: PlexNotesSettings = defaultSettings()
  private plexSyncRunning = false
  /** Earliest time to try a background play count update again after one failed (ms). */
  private playCountRetryAt = 0

  async onload(): Promise<void> {
    await this.loadSettings()

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
    const { updatePlayCounts, playCountHours, lastPlayCountUpdate } = this.settings
    if (!updatePlayCounts || !playCountHours || this.plexSyncRunning) return
    const now = Date.now()
    if (now - lastPlayCountUpdate < playCountHours * 3600 * 1000 || now < this.playCountRetryAt) return
    this.plexSyncRunning = true
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request)).run(() => {}, 'playCounts')
      this.settings.lastPlayCountUpdate = now
      await this.saveSettings()
      if (result.playCounts.length) console.log('Media import and sync: updated play counts', result.playCounts)
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
      if (result.playCounts.length) parts.push(`updated ${result.playCounts.length} play count${result.playCounts.length === 1 ? '' : 's'}`)
      if (result.filled.length) {
        parts.push(`filled in ${result.filled.length}`)
        console.log('Media import and sync: filled in', result.filled)
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
