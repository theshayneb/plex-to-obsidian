import { moment, normalizePath, Notice, Plugin, TFile } from 'obsidian'
import { EmbeddedCard } from './embed-cards'
import { EMBED_LANGUAGE } from './embed-spec'
import { AddModal } from './add-modal'
import { CheckModal, checkableProperties, SyncModal, UnmatchedModal } from './check-modal'
import { askApproval, askOwner } from './approval-modal'
import { ExplainModal } from './explain-modal'
import { TieModal } from './tie-modal'
import { plexReady } from './config'
import { PlexClient } from './plex'
import { defaultSettings, loadSettings, type PlexNotesSettings } from './config'
import { errorMessage, PlexNotesSettingTab } from './settings'
import { displayName, ratingKeyFromLink, type PlexItem } from './notes'
import { PlexSync } from './sync'
import { DEFAULT_TAGS } from './properties'
import { PLAYLIST_VIEW, playlistView } from './playlist-view'
import { RECOMMEND_VIEW, RecommendView } from './recommend-view'
import { FinishedModal, ReactionModal, type ReactionAnswer } from './reaction-modal'
import { vaultPropertyValues } from './property-suggest'
import type { Finished } from './reactions'
import { RelatedModal, type RelatedAnswer } from './related-modal'
import { checkInDue, dayOf } from './schedule'
import { planRevisit, REVISIT_PLAYLIST, sendRevisit } from './playlist'
import { minutesOf } from './daily-episodes'

/**
 * The progress message in the corner during a sync or check. It comes back if it was closed (a
 * click hides a notice) or pushed out, so the progress stays in view to the end.
 */
class ProgressNotice {
  private notice: Notice

  constructor(message: string) {
    this.notice = new Notice(message, 0)
  }

  set(message: string): void {
    const el = (this.notice as { messageEl?: HTMLElement }).messageEl
    if (el && !el.isConnected) this.notice = new Notice(message, 0)
    else this.notice.setMessage(message)
  }

  hide(): void {
    this.notice.hide()
  }
}

export default class PlexMediaNotesPlugin extends Plugin {
  settings: PlexNotesSettings = defaultSettings()
  private plexSyncRunning = false
  /** Syncs and checks under way, stopped when the plugin is reloaded or updated. */
  private readonly syncs = new Set<PlexSync>()
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
      const locked = this.settings.lockedProperties[oldPath]
      if (locked) {
        delete this.settings.lockedProperties[oldPath]
        this.settings.lockedProperties[file.path] = locked
      }
      // A book note is remembered by its path (book:<path>), and so are notes set aside on the dashboard.
      let rekeyed = false
      const rekey = <T>(record: Record<string, T>) => {
        for (const key of Object.keys(record)) {
          const rest = key === `book:${oldPath}` ? '' : key.startsWith(`book:${oldPath}|`) ? key.slice(`book:${oldPath}`.length) : null
          if (rest === null) continue
          record[`book:${file.path}${rest}`] = record[key]
          delete record[key]
          rekeyed = true
        }
      }
      rekey(this.settings.keptLinks)
      rekey(this.settings.keptValues)
      rekey(this.settings.ignored)
      rekey(this.settings.ratingsReviewed)
      const skipped = this.settings.reviewSkipped.indexOf(oldPath)
      if (skipped >= 0) {
        this.settings.reviewSkipped[skipped] = file.path
        rekeyed = true
      }
      const passed = this.settings.notInterested.indexOf(`note:${oldPath}`)
      if (passed >= 0) {
        this.settings.notInterested[passed] = `note:${file.path}`
        rekeyed = true
      }
      if (moved.length || ignored >= 0 || locked || rekeyed) void this.saveSettings()
    }))

    this.addRibbonIcon('clapperboard', 'Sync with Plex and Steam', () => {
      this.chooseAndSync()
    })

    this.addCommand({
      id: 'create-notes-from-plex',
      name: 'Sync with Plex and Steam…',
      callback: () => {
        this.chooseAndSync()
      },
    })

    this.addCommand({
      id: 'sync-all-libraries',
      name: 'Sync every library with Plex and Steam',
      callback: () => {
        void this.syncFromPlex()
      },
    })

    this.addCommand({
      id: 'revisit-playlist',
      name: 'Make the "Revisit" playlist in Plex',
      callback: () => {
        const notice = new ProgressNotice('Making the Revisit playlist…')
        void this.makeRevisit(message => notice.set(message)).then(result => {
          notice.hide()
          new Notice(result, 10000)
        })
      },
    })

    this.addCommand({
      id: 'check-in',
      name: 'Check in now (everything waiting for your yes)',
      callback: () => void this.checkInNow(),
    })

    this.addCommand({
      id: 'related-links',
      name: 'Add what you watched to daily notes…',
      callback: () => {
        if (!new PlexSync(this.app, this.settings, () => this.saveSettings()).relatedOffers().length) new Notice('Nothing you watched is waiting to go in your daily notes')
        else void this.askRelated()
      },
    })

    this.addCommand({
      id: 'daily-episodes',
      name: 'Add watched episodes to daily notes',
      callback: async () => {
        if (!this.settings.dailyEpisodes) {
          new Notice('Switch on "Watched episodes in daily notes" in the plugin settings first')
          return
        }
        if (this.plexSyncRunning) {
          new Notice('A sync or check is already running')
          return
        }
        this.plexSyncRunning = true
        try {
          const days = await this.dailyEpisodes(() => {}, true)
          new Notice(days.length ? `Added episodes to ${days.length} daily note${days.length === 1 ? '' : 's'}` : 'No episodes from the last week are missing from your daily notes')
        } finally {
          this.plexSyncRunning = false
          this.syncs.clear()
        }
        void this.askRelated()
      },
    })

    this.addCommand({
      id: 'react-to-note',
      name: 'React to this note…',
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== 'md') return false
        if (!checking) void this.reactTo(file, moment.unix(Math.floor(Date.now() / 1000)).format('YYYY-MM-DD'))
        return true
      },
    })

    this.addCommand({
      id: 'just-finished',
      name: 'React to what you just finished…',
      callback: () => {
        void this.openFinished()
      },
    })

    this.addCommand({
      id: 'check-notes',
      name: 'Check notes against sources…',
      callback: () => {
        new CheckModal(this.app, this.settings, (properties, libraries) => void this.checkNotes(properties, undefined, new Set(libraries))).open()
      },
    })

    this.addCommand({
      id: 'check-this-note',
      name: 'Check this note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== 'md') return false
        if (!checking) void this.checkThisNote(file)
        return true
      },
    })

    this.addCommand({
      id: 'check-year-only-dates',
      name: 'Fix year-only dates',
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
      name: 'Add a movie, show, game or book…',
      callback: () => {
        new AddModal(this.app, this.settings, () => this.saveSettings(), (item, libraryKey, why) => this.addNew(item, libraryKey, why)).open()
      },
    })

    this.addCommand({
      id: 'tie-note',
      name: 'Tie this note to a Plex item…',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== 'md') return false
        if (!checking) new TieModal(this.app, file.basename, link => this.tieCandidates(link), item => this.tieNote(file, item)).open()
        return true
      },
    })

    this.addCommand({
      id: 'explain-item',
      name: 'Why isn\'t this imported?…',
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

    this.registerView(RECOMMEND_VIEW, leaf => new RecommendView(leaf, this))
    // The dashboard's cards in any note (copied with the </> button on a card).
    this.registerMarkdownCodeBlockProcessor(EMBED_LANGUAGE, (source, el, ctx) => {
      ctx.addChild(new EmbeddedCard(el, this, source))
    })
    this.addRibbonIcon('sparkles', 'Open media dashboard', () => void this.openRecommendations())
    this.addCommand({
      id: 'open-recommendations',
      name: 'Open media dashboard',
      callback: () => void this.openRecommendations(),
    })

    this.addSettingTab(new PlexNotesSettingTab(this.app, this))

    // Background play count updates: check at startup and every 10 minutes whether one is due.
    // The last run time is saved, so the schedule survives restarts and is shared by synced devices.
    this.app.workspace.onLayoutReady(() => void this.updatePlayCountsIfDue())
    this.registerInterval(window.setInterval(() => void this.updatePlayCountsIfDue(), 10 * 60 * 1000))
  }

  /**
   * The background update, every `playCountHours`, and the daily check-in (`checkInAt`). With a
   * check-in time and asking on, updates in between ask nothing: what would need your yes (play
   * counts, playtimes, ratings, statuses) is left for the check-in, which runs the update with its
   * pop-ups, then asks about Related links and what you finished, one pop-up after another.
   * Without a check-in time, every update asks, as before.
   */
  async updatePlayCountsIfDue(): Promise<void> {
    if (this.plexSyncRunning || this.checkingIn) return
    // Another device may have changed the settings (say, a lock): start from what's saved, so this
    // run's save doesn't put back an older copy.
    await this.reloadSettings()
    const { updatePlayCounts, updateRatings, updateStatus, playCountHours, lastPlayCountUpdate, dailyEpisodes, reactionInbox } = this.settings
    const updating = updatePlayCounts || updateRatings || updateStatus
    if (!(updating || dailyEpisodes || reactionInbox) || !playCountHours || this.plexSyncRunning) return
    const now = Date.now()
    if (now < this.playCountRetryAt) return
    const dailyCheckIn = minutesOf(this.settings.checkInAt) !== null
    // Not over another pop-up (a reaction, a sync of your own): the next look, 10 minutes on, tries again.
    const checkIn = dailyCheckIn && checkInDue(new Date(now), this.settings.checkInAt, this.settings.lastCheckIn) && !document.querySelector('.modal-container')
    const due = now - lastPlayCountUpdate >= playCountHours * 3600 * 1000
    if (!due && !checkIn) return
    await this.backgroundUpdate(dailyCheckIn ? (checkIn ? 'check-in' : 'quiet') : 'ask')
  }

  /**
   * Makes the "Revisit" playlist in Plex: these songs (the ones shown on the dashboard), else a new
   * mix (`planRevisit`); answers with what happened, to show. Tried at most once a week in the
   * background, even when it fails (say, without sonic analysis).
   */
  async makeRevisit(progress: (message: string) => void = () => {}, songs?: PlexItem[]): Promise<string> {
    this.settings.lastRevisit = Date.now()
    await this.saveSettings()
    try {
      const picks = songs ?? await planRevisit(this.settings, progress)
      progress(`Sending ${picks.length} songs to Plex…`)
      await sendRevisit(this.settings, picks)
      return `Made the ${REVISIT_PLAYLIST} playlist in Plex: ${picks.length} song${picks.length === 1 ? '' : 's'} you haven't played in a while`
    } catch (err) {
      return `Couldn't make the ${REVISIT_PLAYLIST} playlist: ${errorMessage(err)}`
    }
  }

  /** Set while the check-in's questions are being asked, so no update starts in the middle. */
  private checkingIn = false

  /** "Check in now": the daily check-in's questions, straight away. */
  async checkInNow(): Promise<void> {
    if (this.plexSyncRunning || this.checkingIn) {
      new Notice('A sync or check is already running')
      return
    }
    await this.reloadSettings()
    await this.backgroundUpdate('check-in', true)
  }

  /**
   * 'quiet': nothing is asked (with asking on, only daily notes' episode lines are written and
   * Related links saved up); 'check-in': everything is asked, one pop-up after another; 'ask': as
   * before there was a check-in (pop-ups during the update, then Related and a notice).
   */
  private async backgroundUpdate(how: 'quiet' | 'check-in' | 'ask', byHand = false): Promise<void> {
    const now = Date.now()
    const { updatePlayCounts, updateRatings, updateStatus, askBeforeChanges } = this.settings
    const updating = updatePlayCounts || updateRatings || updateStatus
    this.plexSyncRunning = true
    let ran = false
    try {
      // With asking off nothing is asked, so it's done at every update.
      if (updating && (how !== 'quiet' || !askBeforeChanges) && plexReady(this.settings)) {
        const result = await this.newSync().run(() => {}, 'playCounts')
        if (result.playCounts.length) console.log('Media Manager: kept up to date (play counts, ratings, status)', result.playCounts)
        if (result.failed.length) console.error('Media Manager: failed items', result.failed)
      }
      const days = await this.dailyEpisodes(() => {})
      if (days.length) console.log('Media Manager: episodes added to daily notes', days)
      // The Revisit playlist, made again once a week (it asks nothing: it's the plugin's own playlist).
      if (this.settings.revisitWeekly && now - this.settings.lastRevisit >= 7 * 86400 * 1000 && plexReady(this.settings)
        && Object.values(this.settings.libraries).some(lib => lib.target === 'music')) {
        console.log(`Media Manager: ${await this.makeRevisit()}`)
      }
      this.settings.lastPlayCountUpdate = now
      if (how === 'check-in' && !byHand) this.settings.lastCheckIn = dayOf(new Date(now))
      await this.saveSettings()
      ran = true
    } catch (err) {
      // Plex or Steam may be out of reach (say, a phone away from home); quietly try again in an hour.
      this.playCountRetryAt = now + 3600 * 1000
      console.warn('Media Manager: background play count update failed', err)
      if (byHand) new Notice(`Checking in failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
      this.syncs.clear()
    }
    if (!ran) return
    if (how === 'ask') {
      void this.pointOutFinished()
      this.pointOutRelated()
      return
    }
    if (how === 'quiet') return
    this.checkingIn = true
    try {
      const related = await this.askRelated()
      const finished = await this.askFinished()
      if (byHand && !related && !finished) new Notice('Nothing is waiting for you')
    } finally {
      this.checkingIn = false
    }
  }

  /** Related links already pointed out since Obsidian started (not pointed out again until it restarts). */
  private readonly relatedPointedOut = new Set<string>()

  /**
   * After a background update without a check-in time: the "Add to your daily notes?" pop-up,
   * straight away, when shows or movies you watched are waiting to go in Related. "Not now" leaves
   * them until Obsidian restarts; closed any other way (Escape), it opens again after the next update.
   */
  private pointOutRelated(): void {
    const offers = new PlexSync(this.app, this.settings, () => this.saveSettings()).relatedOffers()
    const keys = offers.map(o => `${o.path}|${o.link}`)
    if (!keys.some(key => !this.relatedPointedOut.has(key))) return
    // Not over another pop-up (a reaction, a check): the next update asks instead.
    if (document.querySelector('.modal-container')) return
    void this.askRelated(answer => {
      if (answer === 'later') keys.forEach(key => this.relatedPointedOut.add(key))
    })
  }

  /**
   * "Add to your daily notes?" for what's waiting, if anything; what you tick is added. Resolves
   * once it's answered or closed (false when nothing was waiting).
   */
  askRelated(answered?: (answer: RelatedAnswer) => void): Promise<boolean> {
    const sync = new PlexSync(this.app, this.settings, () => this.saveSettings())
    const offers = sync.relatedOffers()
    if (!offers.length) return Promise.resolve(false)
    return new Promise(resolve => new RelatedModal(this.app, offers, this.settings.dailyRelated, answer => {
      answered?.(answer)
      if (answer === 'later' || answer === 'closed') {
        resolve(true)
        return
      }
      void sync.addRelated(answer.yes, answer.no).then(
        days => { if (days.length) new Notice(`Added to ${this.settings.dailyRelated} in ${days.length} daily note${days.length === 1 ? '' : 's'}`) },
        err => new Notice(`Couldn't add to ${this.settings.dailyRelated}: ${errorMessage(err)}`),
      ).then(() => resolve(true))
    }).open())
  }

  /** At the check-in: "Just finished", when something you finished is waiting; resolves once it's closed (false when nothing was). */
  private async askFinished(): Promise<boolean> {
    if (!this.settings.reactionInbox || !plexReady(this.settings)) return false
    let items: Finished[]
    try {
      items = await this.newSync().finishedItems()
    } catch (err) {
      console.warn('Media Manager: looking for what you finished failed', err)
      return false
    } finally {
      this.syncs.clear()
    }
    if (!items.length) return false
    await new Promise<void>(resolve => new FinishedModal(this.app, items, item => this.reactToFinished(item), resolve).open())
    return true
  }

  /** Finishings already pointed out since Obsidian started (not pointed out again until it restarts). */
  private readonly pointedOut = new Set<string>()

  /** A notice, when something you finished is waiting for your reaction; clicking it opens the list. */
  private async pointOutFinished(): Promise<void> {
    if (!this.settings.reactionInbox) return
    try {
      const items = await this.newSync().finishedItems()
      const fresh = items.filter(item => !this.pointedOut.has(`${item.key}@${item.viewedAt}`))
      if (!fresh.length) return
      items.forEach(item => this.pointedOut.add(`${item.key}@${item.viewedAt}`))
      const notice = new Notice(`${items.length === 1 ? `You finished ${items[0].title}` : `${items.length} things you finished are waiting`}: click to say how ${items.length === 1 ? 'it' : 'they'} went`, 15000)
      notice.messageEl.addEventListener('click', () => void this.openFinished())
    } catch (err) {
      console.warn('Media Manager: looking for what you finished failed', err)
    } finally {
      this.syncs.clear()
    }
  }

  /** "Just finished": what you finished lately, to react to. */
  private async openFinished(): Promise<void> {
    if (!plexReady(this.settings)) {
      new Notice('Connect to Plex in the plugin settings first')
      return
    }
    try {
      const items = await this.newSync().finishedItems()
      new FinishedModal(this.app, items, item => this.reactToFinished(item)).open()
    } catch (err) {
      new Notice(`Couldn't read what you finished: ${errorMessage(err)}`)
    } finally {
      this.syncs.clear()
    }
  }

  /** The reaction pop-up for something you finished; answered or set aside, it isn't offered again. */
  async reactToFinished(item: Finished): Promise<ReactionAnswer> {
    const file = this.app.vault.getAbstractFileByPath(item.path)
    if (!(file instanceof TFile)) return 'never'
    const answer = await this.reactTo(file, moment.unix(item.viewedAt).format('YYYY-MM-DD'), true)
    if (answer !== 'later') await new PlexSync(this.app, this.settings, () => this.saveSettings()).setFinishedDone(item)
    return answer
  }

  /**
   * "Write about it": opens the note with the cursor in its Notes property (any case; added, empty,
   * when the note has none), your lasting take on it. If the properties aren't showing (source
   * mode, or hidden), a notice says where to write instead.
   */
  async openNotes(file: TFile): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const name = Object.keys(fm).find(key => key.toLowerCase() === 'notes') ?? 'Notes'
    if (!(name in fm)) {
      await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
        if (!(name in front)) front[name] = ''
      })
    }
    const leaf = this.app.workspace.getLeaf(false)
    await leaf.openFile(file)
    // The properties are drawn just after the note opens.
    for (let tries = 0; tries < 10; tries++) {
      await new Promise(resolve => window.setTimeout(resolve, 100))
      const property = [...leaf.view.containerEl.querySelectorAll<HTMLElement>('.metadata-property')]
        .find(el => el.dataset.propertyKey?.toLowerCase() === name.toLowerCase())
      const value = property?.querySelector<HTMLElement>('.metadata-property-value [contenteditable="true"], .metadata-property-value input, .metadata-property-value textarea')
      if (value) {
        value.focus()
        // The cursor at the end of what's there.
        const selection = window.getSelection()
        if (selection && value.isContentEditable) {
          selection.selectAllChildren(value)
          selection.collapseToEnd()
        }
        return
      }
    }
    new Notice(`Write in the note's ${name} property (show its properties to see it)`)
  }

  /** The reaction pop-up for a note; a reaction given is added to it. */
  reactTo(file: TFile, date: string, inbox = false): Promise<ReactionAnswer> {
    const sync = new PlexSync(this.app, this.settings, () => this.saveSettings())
    const names = sync.reactionProperties(file)
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const list = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(String)
    const rating: unknown = fm[names.rating]
    const typeTags = new Set([...Object.values(DEFAULT_TAGS), 'song', ...Object.values(this.settings.libraries).map(lib => lib.values.tag)].filter(Boolean).map(t => t.replace(/^#/, '').toLowerCase()))
    return new Promise(resolve => {
      new ReactionModal(this.app, {
        title: file.basename,
        date,
        why: typeof fm[this.settings.whyProperty || 'Why'] === 'string' ? String(fm[this.settings.whyProperty || 'Why']).trim() || undefined : undefined,
        rating: typeof rating === 'string' ? rating.trim() : undefined,
        feelings: this.settings.feelings,
        // Your list of themes; without one, the themes your notes use.
        themes: this.settings.reactionThemes.length ? this.settings.reactionThemes : (vaultPropertyValues(this.app).get(names.themes.toLowerCase()) ?? []).slice(0, 40),
        tags: this.settings.reactionTags,
        // Type tags (movie, tv_show, song…) say what it is, not how it felt: not shown.
        has: { feelings: list(fm[names.feelings]), themes: list(fm[names.themes]), tags: list(fm.tags).map(t => t.replace(/^#/, '')).filter(t => !typeTags.has(t.toLowerCase())) },
      }, answer => {
        // Answered once the reaction is in the note, so whatever shows it can redraw with it.
        if (typeof answer === 'object') {
          void sync.addReactionTo(file, answer.reaction).then(
            () => new Notice(`Reaction added to ${file.basename}`),
            err => new Notice(`Couldn't add the reaction: ${errorMessage(err)}`),
          ).then(() => resolve(answer))
          return
        }
        resolve(answer)
      }, inbox).open()
    })
  }

  /** Episodes watched in Plex, added to their days' daily notes (when switched on); the notes changed. */
  private async dailyEpisodes(progress: (message: string) => void, wholeWeek = false): Promise<string[]> {
    if (!this.settings.dailyEpisodes) return []
    progress('Adding watched episodes to daily notes…')
    try {
      return await this.newSync().writeDailyEpisodes(wholeWeek)
    } catch (err) {
      console.error('Media Manager: adding episodes to daily notes failed', err)
      new Notice(`Adding episodes to daily notes failed: ${errorMessage(err)}`, 10000)
      return []
    }
  }

  /** A sync that asks in pop-ups, stopped if the plugin is unloaded before it ends. */
  private newSync(): PlexSync {
    const sync = new PlexSync(this.app, this.settings, () => this.saveSettings(), request => askApproval(this.app, request), request => askOwner(this.app, request))
    this.syncs.add(sync)
    return sync
  }

  onunload(): void {
    // A sync or check still going (say, while the plugin is updated) stops, so it can't run on
    // alongside the reloaded plugin's.
    for (const sync of this.syncs) sync.stop()
    this.syncs.clear()
  }

  async loadSettings(): Promise<void> {
    this.settings = loadSettings(await this.loadData())
  }

  /**
   * Reads the saved settings again into the same object (so the settings page and anything holding
   * it see them), for when Obsidian Sync brings another device's changes. Not while a sync or check
   * runs: it saves its own copy as it goes.
   */
  async reloadSettings(): Promise<void> {
    if (this.plexSyncRunning) return
    Object.assign(this.settings, loadSettings(await this.loadData()))
  }

  /** Obsidian calls this when the settings file changes on disk, say through Obsidian Sync. */
  async onExternalSettingsChange(): Promise<void> {
    await this.reloadSettings()
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /** Makes a note for an item picked in "Add something new", or opens the one it already has. */
  async addNew(item: PlexItem, libraryKey: string, why?: string): Promise<void> {
    try {
      const sync = this.newSync()
      const { created, existing } = await sync.addNew(item, libraryKey)
      const path = created ?? existing
      if (existing) new Notice(`It already has a note: ${existing}`)
      if (!path) return
      const file = this.app.vault.getAbstractFileByPath(path)
      // Why you wanted it, kept for later (an existing note's own reason is never replaced).
      const name = this.settings.whyProperty || 'Why'
      if (why?.trim() && file instanceof TFile) {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          if (!(typeof fm[name] === 'string' && String(fm[name]).trim())) fm[name] = why.trim()
        })
      }
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
   * @param libraries just these libraries (settings keys), not every library.
   */
  async checkNotes(properties: string[] | Record<string, string[]>, only?: Set<string>, libraries?: Set<string>): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('A sync or check is already running')
      return
    }
    await this.saveSettings()
    this.plexSyncRunning = true
    const notice = new ProgressNotice('Starting…')
    try {
      const result = await this.newSync()
        .run(message => notice.set(message), 'check', properties, only, libraries)
      notice.hide()
      const parts = [`Changed ${result.corrected.length} note${result.corrected.length === 1 ? '' : 's'}`]
      if (result.renamed.length) {
        parts.push(`renamed ${result.renamed.length}`)
        console.log('Media Manager: renamed', result.renamed)
      }
      if (result.keptLinks) parts.push(`${result.keptLinks} value${result.keptLinks === 1 ? '' : 's'} kept as they were`)
      if (result.declined) parts.push(`${result.declined} skipped`)
      if (result.stopped) parts.push('stopped')
      if (result.failed.length) {
        const shown = result.failed.slice(0, 3).map(f => `${f.title}: ${f.error}`).join('; ')
        parts.push(`${result.failed.length} failed (${shown}${result.failed.length > 3 ? '; the rest are in the developer console' : ''})`)
        console.error('Media Manager: failed items', result.failed)
      }
      new UnmatchedModal(this.app, 'Check finished', `${parts.join(', ')}.`, result.unmatched, path => this.ignoreUnmatched(path), result.unmatchedWhy).open()
      if (!result.stopped) void this.askRelated()
    } catch (err) {
      notice.hide()
      new Notice(`Checking failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
      this.syncs.clear()
    }
  }

  /**
   * "Check this note against sources": the full check (every property) of the open note alone.
   * Its source is still found by listing Plex and Steam, so it takes as long as their listings do.
   */
  /** What a pasted Plex link can tie a note to: the item, or an album's songs. */
  private async tieCandidates(link: string): Promise<PlexItem[]> {
    if (!plexReady(this.settings)) throw new Error('Set up Plex in the plugin settings first.')
    const key = /^\s*\d+\s*$/.test(link) ? link.trim() : ratingKeyFromLink(link.trim())
    if (!key || !/^\d+$/.test(key)) throw new Error('That isn\'t a Plex link. Open the item in Plex Web and copy the address from the address bar.')
    const plex = new PlexClient(this.settings.serverUrl, this.settings.token)
    const item = await plex.item(key)
    if (!item) throw new Error('Plex has no item with that link. Check that it\'s from the server set up in the plugin.')
    if (item.type === 'album') {
      // An album's songs don't always say which library they're in; the album does.
      const tracks = (await plex.children(key))
        .filter(track => track.type === 'track')
        .map(track => ({ ...track, librarySectionID: track.librarySectionID ?? item.librarySectionID, librarySectionTitle: track.librarySectionTitle ?? item.librarySectionTitle }))
      if (!tracks.length) throw new Error(`Plex lists no songs on ${item.title}.`)
      return tracks
    }
    if (item.type === 'artist') throw new Error('That\'s an artist\'s page. Paste the album\'s page instead, and pick the song.')
    if (item.type === 'season' || item.type === 'episode') throw new Error('Notes are for whole shows: paste the show\'s page instead.')
    return [item]
  }

  /** Ties a note to a Plex item from now on, as "Use an existing note" does (undone in Settings → Remembered choices). */
  private async tieNote(file: TFile, item: PlexItem): Promise<void> {
    const libraryKey = item.librarySectionID === undefined ? '' : String(item.librarySectionID)
    // One item per note: an earlier tie of this note gives way.
    for (const [key, merged] of Object.entries(this.settings.merged)) {
      if (merged.path === file.path) delete this.settings.merged[key]
    }
    this.settings.merged[item.ratingKey] = {
      name: displayName(item),
      library: this.settings.libraries[libraryKey]?.title ?? item.librarySectionTitle ?? '',
      libraryKey,
      path: file.path,
      since: Date.now(),
    }
    await this.saveSettings()
    new Notice(`Tied "${file.basename}" to ${displayName(item)}. The next sync or check treats it as that item's note.`)
  }

  async checkThisNote(file: TFile): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('A sync or check is already running')
      return
    }
    this.plexSyncRunning = true
    const notice = new ProgressNotice(`Checking ${file.basename}…`)
    try {
      const properties = checkableProperties(this.settings).map(p => p.name)
      // Only the libraries whose folder holds the note are listed (a book needs no Plex or Steam listing at all).
      const inFolder = Object.entries(this.settings.libraries)
        .filter(([, lib]) => lib.target !== 'skip' && lib.folder.trim() && file.path.startsWith(`${normalizePath(lib.folder)}/`))
        .map(([key]) => key)
      const result = await this.newSync()
        .run(message => notice.set(message), 'check', properties, new Set([file.path]), inFolder.length ? new Set(inFolder) : undefined)
      notice.hide()
      if (result.failed.length) {
        console.error('Media Manager: failed items', result.failed)
        new Notice(`Checking failed: ${result.failed.map(f => f.error).join('; ')}`, 10000)
      } else if ([...result.corrected, ...result.links, ...result.sentRatings, ...result.sentToFiles, ...result.renamed.flatMap(r => [r.from, r.to])].includes(file.path)) new Notice(`${file.basename}: changed`)
      else if (result.declined || result.keptLinks || result.stopped) new Notice(`${file.basename}: left as it was`)
      else if (result.checked.includes(file.path)) new Notice(`${file.basename} already matches its source`)
      else new Notice(`${file.basename} matches nothing in Plex, Steam or Open Library (or its library isn't synced)`, 8000)
    } catch (err) {
      notice.hide()
      new Notice(`Checking failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
      this.syncs.clear()
    }
  }

  /** Shows the recommendations dashboard, in its own tab (the one already open, if there is one). */
  private async openRecommendations(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(RECOMMEND_VIEW)[0]
    const leaf = open ?? this.app.workspace.getLeaf('tab')
    if (!open) await leaf.setViewState({ type: RECOMMEND_VIEW, active: true })
    await this.app.workspace.revealLeaf(leaf)
  }

  /** "Always ignore" for a note that matches nothing: it isn't pointed out again. */
  private async ignoreUnmatched(path: string): Promise<void> {
    if (!this.settings.unmatchedIgnored.includes(path)) this.settings.unmatchedIgnored.push(path)
    await this.saveSettings()
  }

  /** Asks which libraries to sync (remembered), then syncs them. */
  chooseAndSync(): void {
    if (this.plexSyncRunning) {
      new Notice('A sync or check is already running')
      return
    }
    new SyncModal(this.app, this.settings, libraries => {
      void this.saveSettings().then(() => this.syncFromPlex(new Set(libraries)))
    }).open()
  }

  /** @param libraries just these libraries (settings keys); every one when left out. */
  async syncFromPlex(libraries?: Set<string>): Promise<void> {
    if (this.plexSyncRunning) {
      new Notice('A sync or check is already running')
      return
    }
    this.plexSyncRunning = true
    const notice = new ProgressNotice('Starting…')
    try {
      const result = await this.newSync()
        .run(message => notice.set(message), 'full', [], undefined, libraries)
      const days = result.stopped ? [] : await this.dailyEpisodes(message => notice.set(message))
      notice.hide()

      const parts = [`Created ${result.created.length} note${result.created.length === 1 ? '' : 's'}`]
      if (days.length) parts.push(`added episodes to ${days.length} daily note${days.length === 1 ? '' : 's'}`)
      if (result.renamed.length) {
        parts.push(`renamed ${result.renamed.length}`)
        console.log('Media Manager: renamed', result.renamed)
      }
      if (result.playCounts.length) parts.push(`kept ${result.playCounts.length} up to date`)
      if (result.filled.length) {
        parts.push(`filled in ${result.filled.length}`)
        console.log('Media Manager: filled in', result.filled)
      }
      if (result.sentRatings.length) {
        parts.push(`sent ${result.sentRatings.length} rating${result.sentRatings.length === 1 ? '' : 's'} to Plex`)
        console.log('Media Manager: ratings sent to Plex', result.sentRatings)
      }
      if (result.sentToFiles.length) {
        parts.push(`wrote ${result.sentToFiles.length} note${result.sentToFiles.length === 1 ? '\'s' : 's\''} values to music or lyrics files`)
        console.log('Media Manager: values written to music or lyrics files', result.sentToFiles)
      }
      if (result.corrected.length) {
        parts.push(`corrected ${result.corrected.length} duration${result.corrected.length === 1 ? '' : 's'}`)
        console.log('Media Manager: corrected durations', result.corrected)
      }
      if (result.links.length) {
        parts.push(`fixed ${result.links.length} link${result.links.length === 1 ? '' : 's'}`)
        console.log('Media Manager: replaced links', result.links)
      }
      if (result.merged.length) {
        parts.push(`matched ${result.merged.length} to existing notes`)
        console.log('Media Manager: matched to existing notes', result.merged)
      }
      parts.push(`${result.skipped} already had one`)
      if (result.declined) parts.push(`${result.declined} skipped by you`)
      if (result.ignored) parts.push(`${result.ignored} skipped every time`)
      if (result.stopped) parts.push('stopped')
      if (result.failed.length) {
        parts.push(`${result.failed.length} failed`)
        console.error('Media Manager: failed items', result.failed)
      }
      if (result.unmatched.length) parts.push(`${result.unmatched.length} note${result.unmatched.length === 1 ? '' : 's'} ${result.unmatched.length === 1 ? 'matches' : 'match'} nothing`)
      new Notice(parts.join(', '), 8000)
      if (result.unmatched.length) new UnmatchedModal(this.app, 'Notes that match nothing', null, result.unmatched, path => this.ignoreUnmatched(path), result.unmatchedWhy).open()
    } catch (err) {
      notice.hide()
      new Notice(`Sync failed: ${errorMessage(err)}`, 10000)
    } finally {
      this.plexSyncRunning = false
      this.syncs.clear()
    }
  }
}
