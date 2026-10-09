import { Notice, Plugin, TFile } from 'obsidian'
import { AddModal } from './add-modal'
import { CheckModal, checkableProperties, UnmatchedModal } from './check-modal'
import { askApproval, askOwner } from './approval-modal'
import { ExplainModal } from './explain-modal'
import { defaultSettings, loadSettings, type PlexNotesSettings } from './config'
import { errorMessage, PlexNotesSettingTab } from './settings'
import type { PlexItem } from './notes'
import { PlexSync } from './sync'
import { PLAYLIST_VIEW, playlistView } from './playlist-view'

export default class PlexMediaNotesPlugin extends Plugin {
  settings: PlexNotesSettings = defaultSettings()
  private plexSyncRunning = false
  /** The "Check against sources: <property>" commands there are now, by command id. */
  private propertyCommands = new Map<string, string>()
  /** Earliest time to try a background play count update again after one failed (ms). */
  private playCountRetryAt = 0

  async onload(): Promise<void> {
    await this.loadSettings()

    // Notes chosen with "Use an existing note" stay tied to their item when renamed or moved.
    // So do notes you chose to always ignore when they match nothing.
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const moved = Object.values(this.settings.merged).filter(m => m.path === oldPath)
      for (const m of moved) m.path = file.path
      const ignored = this.settings.unmatchedIgnored.indexOf(oldPath)
      if (ignored >= 0) this.settings.unmatchedIgnored[ignored] = file.path
      if (moved.length || ignored >= 0) void this.saveSettings()
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
      id: 'check-notes',
      name: 'Check existing notes against sources',
      callback: () => {
        new CheckModal(this.app, this.settings, properties => void this.checkNotes(properties)).open()
      },
    })

    this.refreshPropertyCommands()

    this.addCommand({
      id: 'check-this-note',
      name: 'Check this note against sources',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== 'md') return false
        if (!checking) void this.checkThisNote(file)
        return true
      },
    })

    this.addCommand({
      id: 'check-year-only-dates',
      name: 'Check notes with a year-only date against sources',
      callback: () => {
        const { paths, properties } = new PlexSync(this.app, this.settings, () => this.saveSettings()).vagueDateNotes()
        if (!paths.size) {
          new Notice('No notes have a year-only date')
          return
        }
        new Notice(`${paths.size} note${paths.size === 1 ? ' has' : 's have'} a year-only date; checking ${paths.size === 1 ? 'it' : 'them'}…`)
        void this.checkNotes(properties, paths)
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

    // A "Plex playlist" view for Bases (Obsidian 1.10 and later): sends a Base's songs to Plex.
    if (typeof this.registerBasesView === 'function') {
      this.registerBasesView(PLAYLIST_VIEW, {
        name: 'Plex playlist',
        icon: 'list-music',
        factory: (controller, containerEl) => playlistView(controller, containerEl, () => this.settings),
        options: () => [{ type: 'text', key: 'playlistName', displayName: 'Playlist name in Plex', placeholder: 'This view\'s name' }],
      })
    }

    this.addSettingTab(new PlexNotesSettingTab(this.app, this))

    // Background play count updates: check at startup and every 10 minutes whether one is due.
    // The last run time is saved, so the schedule survives restarts and is shared by synced devices.
    this.app.workspace.onLayoutReady(() => void this.updatePlayCountsIfDue())
    this.registerInterval(window.setInterval(() => void this.updatePlayCountsIfDue(), 10 * 60 * 1000))
  }

  async updatePlayCountsIfDue(): Promise<void> {
    const { updatePlayCounts, updateRatings, updateStatus, playCountHours, lastPlayCountUpdate } = this.settings
    if (!(updatePlayCounts || updateRatings || updateStatus) || !playCountHours || this.plexSyncRunning) return
    const now = Date.now()
    if (now - lastPlayCountUpdate < playCountHours * 3600 * 1000 || now < this.playCountRetryAt) return
    this.plexSyncRunning = true
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request)).run(() => {}, 'playCounts')
      this.settings.lastPlayCountUpdate = now
      await this.saveSettings()
      if (result.playCounts.length) console.log('Media import and sync: kept up to date (play counts, ratings, status)', result.playCounts)
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
    this.refreshPropertyCommands()
  }

  /**
   * One "Check against sources: <property>" command per property a check can compare: every note,
   * that property only, so "Apply to all the rest" can be used for a property it gets right and
   * another reviewed note by note. Kept in step with the libraries' properties.
   */
  private refreshPropertyCommands(): void {
    const wanted = new Map<string, string>()
    for (const { name } of checkableProperties(this.settings)) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property'
      let id = `check-property-${slug}`
      for (let n = 2; wanted.has(id); n++) id = `check-property-${slug}-${n}`
      wanted.set(id, name)
    }
    for (const [id, name] of this.propertyCommands) {
      if (wanted.get(id) === name) continue
      // Obsidian before 1.7.2 can't remove a command; it stays until Obsidian restarts.
      if (typeof this.removeCommand === 'function') this.removeCommand(id)
      this.propertyCommands.delete(id)
    }
    for (const [id, name] of wanted) {
      if (this.propertyCommands.has(id)) continue
      this.addCommand({ id, name: `Check against sources: ${name}`, callback: () => void this.checkNotes([name]) })
      this.propertyCommands.set(id, name)
    }
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

  /**
   * "Check existing notes against sources": compares the chosen properties of every existing note
   * with its source and asks about each difference, then lists the notes nothing matched. Slow:
   * every item's full details are fetched, Steam's spaced out.
   * @param only just these notes, not every note.
   */
  async checkNotes(properties: string[], only?: Set<string>): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('Media sync is already running')
      return
    }
    await this.saveSettings()
    this.plexSyncRunning = true
    const notice = new Notice('Starting…', 0)
    try {
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request))
        .run(message => notice.setMessage(message), 'check', properties, only)
      notice.hide()
      const parts = [`Changed ${result.corrected.length} note${result.corrected.length === 1 ? '' : 's'}`]
      if (result.keptLinks) parts.push(`${result.keptLinks} value${result.keptLinks === 1 ? '' : 's'} kept as they were`)
      if (result.declined) parts.push(`${result.declined} skipped`)
      if (result.stopped) parts.push('stopped')
      if (result.failed.length) {
        parts.push(`${result.failed.length} failed (see the developer console)`)
        console.error('Media import and sync: failed items', result.failed)
      }
      new UnmatchedModal(this.app, 'Check finished', `${parts.join(', ')}.`, result.unmatched, path => this.ignoreUnmatched(path)).open()
    } catch (err) {
      notice.hide()
      new Notice(`Checking failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
    }
  }

  /**
   * "Check this note against sources": the full check (every property) of the open note alone.
   * Its source is still found by listing Plex and Steam, so it takes as long as their listings do.
   */
  async checkThisNote(file: TFile): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('Media sync is already running')
      return
    }
    this.plexSyncRunning = true
    const notice = new Notice(`Checking ${file.basename}…`, 0)
    try {
      const properties = checkableProperties(this.settings).map(p => p.name)
      const result = await new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request))
        .run(message => notice.setMessage(message), 'check', properties, new Set([file.path]))
      notice.hide()
      if (result.failed.length) {
        console.error('Media import and sync: failed items', result.failed)
        new Notice(`Checking failed: ${result.failed.map(f => f.error).join('; ')}`, 10000)
      } else if ([...result.corrected, ...result.links, ...result.sentRatings].includes(file.path)) new Notice(`${file.basename}: changed`)
      else if (result.declined || result.keptLinks || result.stopped) new Notice(`${file.basename}: left as it was`)
      else if (result.checked.includes(file.path)) new Notice(`${file.basename} already matches its source`)
      else new Notice(`${file.basename} matches nothing in Plex, Steam or Open Library (or its library isn't synced)`, 8000)
    } catch (err) {
      notice.hide()
      new Notice(`Checking failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
    }
  }

  /** "Always ignore" for a note that matches nothing: it isn't pointed out again. */
  private async ignoreUnmatched(path: string): Promise<void> {
    if (!this.settings.unmatchedIgnored.includes(path)) this.settings.unmatchedIgnored.push(path)
    await this.saveSettings()
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
      if (result.playCounts.length) parts.push(`kept ${result.playCounts.length} up to date`)
      if (result.filled.length) {
        parts.push(`filled in ${result.filled.length}`)
        console.log('Media import and sync: filled in', result.filled)
      }
      if (result.sentRatings.length) {
        parts.push(`sent ${result.sentRatings.length} rating${result.sentRatings.length === 1 ? '' : 's'} to Plex`)
        console.log('Media import and sync: ratings sent to Plex', result.sentRatings)
      }
      if (result.corrected.length) {
        parts.push(`corrected ${result.corrected.length} duration${result.corrected.length === 1 ? '' : 's'}`)
        console.log('Media import and sync: corrected durations', result.corrected)
      }
      if (result.links.length) {
        parts.push(`fixed ${result.links.length} link${result.links.length === 1 ? '' : 's'}`)
        console.log('Media import and sync: replaced links', result.links)
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
      if (result.unmatched.length) parts.push(`${result.unmatched.length} note${result.unmatched.length === 1 ? '' : 's'} ${result.unmatched.length === 1 ? 'matches' : 'match'} nothing`)
      new Notice(parts.join(', '), 8000)
      if (result.unmatched.length) new UnmatchedModal(this.app, 'Notes that match nothing', null, result.unmatched, path => this.ignoreUnmatched(path)).open()
    } catch (err) {
      notice.hide()
      new Notice(`Media sync failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
    }
  }
}
