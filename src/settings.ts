import { App, normalizePath, Notice, Platform, PluginSettingTab, Setting } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import { cleanOmdbKey } from './discover-data'
import { testGoogleBooks, testOmdbKey } from './discover'
import { steamGridCovers } from './steamgriddb'
import { testLastfmKey } from './lastfm'
import {
  DEFAULT_FILE_NAMES,
  DEFAULT_FOLDERS,
  DEFAULT_MATCH_BY,
  BOOKS_LIBRARY,
  ensureSteamLibrary,
  mergeLibraries,
  retarget,
  STEAM_LIBRARY,
  type LibrarySetting,
} from './config'
import { OTHER_CHARS, ratingKeyFromLink, renderFileName, REPLACEABLE_CHARS, type LibraryTarget, type MatchBy, type PlexItem } from './notes'
import { PlexClient } from './plex'
import { SteamClient } from './steam'
import { readSteamCollections } from './steam-local'
import { PropertyNameSuggest } from './property-suggest'
import { defaultProperties, defaultValues, FIELD_SOURCES, linkPropertyNames, collectionStatusText, parseCollectionStatus, type FieldSource } from './properties'
import { groupByKind, keptEntries, kindOfLibrary, kindOfPath, OTHER_KIND, type KeptEntry } from './remembered'

const noteName = (path: string): string => path.split('/').pop()!.replace(/\.md$/, '')
const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/')

const PREVIEW_ITEMS: PlexItem[] = [
  { ratingKey: '1', type: 'movie', title: 'Mission: Impossible' },
  { ratingKey: '2', type: 'movie', title: 'Face/Off' },
  { ratingKey: '3', type: 'movie', title: 'What About Bob?' },
]

const MATCH_LABELS: Record<MatchBy, string> = {
  loose: 'Link, title, title and year, or file name',
  format: 'Link or file name',
  link: 'Link only',
}

const PLAY_COUNT_SCHEDULE: Record<string, string> = {
  0: 'Off',
  1: 'Every hour',
  6: 'Every 6 hours',
  12: 'Every 12 hours',
  24: 'Once a day',
}

const TARGET_LABELS: Record<LibraryTarget, string> = {
  movie: 'Movies',
  tv: 'TV shows',
  documentary: 'Documentaries',
  music: 'Music (one note per track)',
  game: 'Video games',
  book: 'Books',
  skip: 'Skip',
}

/** Which types each kind of library can be: Steam only holds games, Plex never does. */
function targetChoices(key: string): [string, string][] {
  const only = key === STEAM_LIBRARY ? 'game' : key === BOOKS_LIBRARY ? 'book' : null
  return Object.entries(TARGET_LABELS).filter(([target]) =>
    only ? target === only || target === 'skip' : target !== 'game' && target !== 'book')
}

export class PlexNotesSettingTab extends PluginSettingTab {
  /** Library sections the user has expanded, kept open across redraws. */
  private readonly openLibraries = new Set<string>()
  /** Collapsible sections the user has opened (Setup, All libraries, Merged, Skipped every time). */
  private readonly openSections = new Set<string>()

  constructor(app: App, private readonly plugin: PlexMediaNotesPlugin) {
    super(app, plugin)
  }

  private save(): Promise<void> {
    return this.plugin.saveSettings()
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    this.displaySetup(this.section(containerEl, 'setup', 'Connections', 'Plex, Steam and the other sources, with a test for each.'))
    this.displaySyncing(this.section(containerEl, 'syncing', 'Syncing', 'What a sync may change in your notes, and when.'))
    this.displayNewNotes(this.section(containerEl, 'general', 'New notes', 'Genres, file names and images, in every library.'))
    this.displayLibraries(containerEl)
    this.displayRemembered(this.section(containerEl, 'remembered', 'Remembered choices', 'What the plugin remembers from your answers in pop-ups, to forget.'))
  }

  /** A collapsible section, closed until opened and kept as it was across redraws. */
  private section(parent: HTMLElement, key: string, title: string, desc?: string, cls?: string): HTMLElement {
    const details = parent.createEl('details', { cls: cls ? ['pmn-section', cls] : 'pmn-section' })
    details.open = this.openSections.has(key)
    details.addEventListener('toggle', () => {
      if (details.open) this.openSections.add(key)
      else this.openSections.delete(key)
    })
    const summary = details.createEl('summary', { cls: 'pmn-section-title' })
    summary.createSpan({ text: title })
    if (desc) summary.createSpan({ cls: 'pmn-section-desc', text: desc })
    return details.createDiv('pmn-section-body')
  }

  /** Everything needed to reach Plex, Steam and the databases "Add something new" searches. */
  private displaySetup(el: HTMLElement): void {
    const settings = this.plugin.settings
    new Setting(el).setName('Plex server').setHeading()

    new Setting(el)
      .setName('Server address')
      .setDesc('For example http://192.168.1.10:32400')
      .addText(text => text
        .setPlaceholder('http://192.168.1.10:32400')
        .setValue(settings.serverUrl)
        .onChange(async value => {
          settings.serverUrl = value.trim()
          await this.save()
        }))

    new Setting(el)
      .setName('Token')
      .setDesc('Your X-Plex-Token. In Plex Web, open any item, choose "Get info" and then "View XML", and copy the value after X-Plex-Token= in the address bar.')
      .addText(text => {
        text.inputEl.type = 'password'
        text
          .setValue(settings.token)
          .onChange(async value => {
            settings.token = value.trim()
            await this.save()
          })
      })

    new Setting(el)
      .setName('Test Plex')
      .setDesc('Connects to the server with the address and token, to check them.')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          button.setDisabled(true)
          try {
            if (!settings.serverUrl || !settings.token) throw new Error('enter the server address and token first')
            const plex = new PlexClient(settings.serverUrl, settings.token)
            await plex.machineIdentifier()
            const libraries = await plex.libraries()
            new Notice(`Plex: connected, ${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} found`, 8000)
          } catch (err) {
            new Notice(`Plex: ${errorMessage(err)}`, 10000)
          } finally {
            button.setDisabled(false)
          }
        }))

    this.displaySteam(el)
    this.displayOtherSources(el)
  }

  private displayLibraries(parent: HTMLElement): void {
    new Setting(parent).setName('Libraries').setHeading()
    const el = parent.createDiv('pmn-indent')

    new Setting(el)
      .setDesc('Load your Plex libraries, then open each one (and the Steam and books libraries) to choose what it holds, where its notes go and what they contain.')
      .addButton(button => button
        .setButtonText('Load libraries')
        .onClick(async () => {
          button.setDisabled(true)
          try {
            await this.loadLibraries()
            new Notice('Plex libraries loaded')
          } catch (err) {
            new Notice(`Could not reach Plex: ${errorMessage(err)}`)
          } finally {
            button.setDisabled(false)
            this.refresh()
          }
        }))

    for (const [key, lib] of Object.entries(this.plugin.settings.libraries)) this.displayLibrary(el, key, lib)
  }

  private displayLibrary(parent: HTMLElement, key: string, lib: LibrarySetting): void {
    const details = parent.createEl('details', { cls: 'pmn-library' })
    details.open = this.openLibraries.has(key)
    details.addEventListener('toggle', () => {
      if (details.open) this.openLibraries.add(key)
      else this.openLibraries.delete(key)
    })
    details.createEl('summary', { cls: 'pmn-library-title', text: `${lib.title} (${TARGET_LABELS[lib.target]})` })
    const el = details.createDiv('pmn-library-body')

    new Setting(el)
      .setName('Type')
      .setDesc('What this library holds. Skipped libraries get no notes.')
      .addDropdown(dropdown => {
        for (const [value, label] of targetChoices(key)) dropdown.addOption(value, label)
        dropdown
          .setValue(lib.target)
          .onChange(async value => {
            retarget(lib, value as LibraryTarget)
            await this.save()
            this.refresh()
          })
      })
    if (lib.target === 'skip') return
    const kind = lib.target
    const music = kind === 'music'
    const game = kind === 'game'
    const book = kind === 'book'

    new Setting(el)
      .setName('Folder')
      .setDesc('New notes go here. Existing notes are looked for here too, including subfolders.')
      .addText(text => text
        .setPlaceholder(DEFAULT_FOLDERS[kind])
        .setValue(lib.folder)
        .onChange(async value => {
          lib.folder = value.trim() || DEFAULT_FOLDERS[kind]
          await this.save()
        }))

    new Setting(el)
      .setName('File name')
      .setDesc(music
        ? 'Use {{artist}}, {{title}}, {{album}}, {{albumartist}}, {{track}}, {{disc}} and {{year}}. Empty brackets and dangling dashes are dropped.'
        : book
          ? 'Use {{title}}, {{author}} and {{year}}. Empty brackets are dropped when a book has no year, and a trailing "by" when it has no author.'
          : 'Use {{title}} and {{year}}. Empty brackets are dropped when an item has no year.')
      .addText(text => text
        .setPlaceholder(DEFAULT_FILE_NAMES[kind])
        .setValue(lib.fileNameFormat)
        .onChange(async value => {
          lib.fileNameFormat = value.trim() || DEFAULT_FILE_NAMES[kind]
          await this.save()
        }))

    new Setting(el)
      .setName('Recognise existing notes by')
      .setDesc('How a note already in the folder is recognised as this item, so no second note is made. The link is the Plex address or Steam Store page in the note. Case, accents and punctuation are ignored in names. A note linking to a different item never matches by name.')
      .addDropdown(dropdown => {
        for (const [value, label] of Object.entries(MATCH_LABELS)) dropdown.addOption(value, label)
        dropdown
          .setValue(lib.matchBy ?? DEFAULT_MATCH_BY[kind])
          .onChange(async value => {
            lib.matchBy = value as MatchBy
            await this.save()
          })
      })

    new Setting(el)
      .setName('Genres to leave out')
      .setDesc('Genres never written in this library, even ones in "Genres to keep" (under New notes). Separate them with commas.')
      .addText(text => text
        .setPlaceholder('For example romance, horror')
        .setValue((lib.leaveOutGenres ?? []).join(', '))
        .onChange(async value => {
          lib.leaveOutGenres = [...new Set(value.split(',').map(g => g.trim()).filter(Boolean))]
          await this.save()
        }))

    this.displayProperties(el, lib)

    new Setting(el).setName('Status and tag values').setHeading()
    const defaults = defaultValues(kind)
    if (book) {
      this.addValueSetting(el, 'New book', 'For "Watched or played status": the status a new book note starts with.',
        () => lib.values.unwatched, v => { lib.values.unwatched = v || defaults.unwatched })
    } else if (game) {
      this.addValueSetting(el, 'Played', 'For "Watched or played status": a game with any playtime. Steam can\'t tell when a game is finished, so set that by hand.',
        () => lib.values.started, v => { lib.values.started = v || defaults.started })
      this.addValueSetting(el, 'Not played', 'For "Watched or played status": a game never played.',
        () => lib.values.unwatched, v => { lib.values.unwatched = v || defaults.unwatched })
      new Setting(el)
        .setName('Status from Steam collections')
        .setDesc('One per line, "collection: status". A game in one of these Steam collections gets that status instead of the played or not played one, the first line that applies winning. A line ending in "(until started)" only counts for a game you haven\'t started (no playtime, and its status empty or not played), so a started game is never set back to, say, planned. A sync asks before changing a note\'s status this way, even backwards (say, completed to revisit); one you leave unticked isn\'t offered again until the collection changes. Collections are only read on a computer with Steam.')
        .addTextArea(text => {
          text.inputEl.rows = 6
          text.setPlaceholder('Collection: status')
            .setValue(collectionStatusText(lib.values.collectionStatus))
            .onChange(async value => {
              lib.values.collectionStatus = parseCollectionStatus(value)
              await this.save()
            })
        })
    } else if (!music) {
      this.addValueSetting(el, 'Watched', 'For "Watched or played status": a movie that has been played, or a show with every episode watched.',
        () => lib.values.watched, v => { lib.values.watched = v || defaults.watched })
      this.addValueSetting(el, 'Started', 'For "Watched or played status": a movie stopped part way, or a show with some episodes watched.',
        () => lib.values.started, v => { lib.values.started = v || defaults.started })
      this.addValueSetting(el, 'Not watched', 'For "Watched or played status": everything else.',
        () => lib.values.unwatched, v => { lib.values.unwatched = v || defaults.unwatched })
    }
    this.addValueSetting(el, 'Type tag', 'For "Type tag".',
      () => lib.values.tag, v => { lib.values.tag = v || defaults.tag })
  }

  private displayProperties(el: HTMLElement, lib: LibrarySetting): void {
    new Setting(el).setName('Properties').setHeading()
    el.createEl('p', {
      cls: 'setting-item-description',
      text: 'What new notes contain, in this order: each property\'s name (start typing to pick one already in your vault) and where its value comes from. Ones the source has no value for are left empty. Switch on a property\'s toggle to also fill it in on existing notes where it\'s missing or empty.',
    })

    lib.properties.forEach((mapping, index) => {
      const row = new Setting(el)
        .addText(text => {
          text
            .setPlaceholder('Property name')
            .setValue(mapping.name)
            .onChange(async value => {
              mapping.name = value
              await this.save()
            })
          new PropertyNameSuggest(this.app, text.inputEl)
        })
        .addDropdown(dropdown => {
          for (const [value, label] of Object.entries(FIELD_SOURCES)) dropdown.addOption(value, label)
          dropdown
            .setValue(mapping.source)
            .onChange(async value => {
              const typed = (source: string) => source === 'text' || source === 'fileTag'
              const textChanged = typed(mapping.source) !== typed(value)
              mapping.source = value as FieldSource
              await this.save()
              // Only the "Fixed text" choice changes the row's layout.
              if (textChanged) this.refresh()
            })
        })
      if (mapping.source === 'text' || mapping.source === 'fileTag') {
        row.addText(text => text
          .setPlaceholder(mapping.source === 'fileTag' ? 'Tag, e.g. songs-db_tempo' : 'Value')
          .setValue(mapping.text ?? '')
          .onChange(async value => {
            mapping.text = value
            await this.save()
          }))
      }
      row.addToggle(toggle => {
        toggle
          .setTooltip('Fill in on existing notes when empty')
          .setValue(mapping.fill ?? false)
          .onChange(async value => {
            mapping.fill = value
            await this.save()
          })
      })
      row
        .addExtraButton(button => button
          .setIcon('arrow-up')
          .setTooltip('Move up')
          .setDisabled(index === 0)
          .onClick(() => this.moveProperty(lib, index, -1)))
        .addExtraButton(button => button
          .setIcon('arrow-down')
          .setTooltip('Move down')
          .setDisabled(index === lib.properties.length - 1)
          .onClick(() => this.moveProperty(lib, index, 1)))
        .addExtraButton(button => button
          .setIcon('trash')
          .setTooltip('Remove')
          .onClick(async () => {
            lib.properties.splice(index, 1)
            await this.save()
            this.refresh()
          }))
    })

    new Setting(el)
      .addButton(button => button
        .setButtonText('Add property')
        .setCta()
        .onClick(async () => {
          lib.properties.push({ name: '', source: 'summary' })
          await this.save()
          this.refresh()
        }))
      .addButton(button => button
        .setButtonText('Reset to defaults')
        .onClick(async () => {
          if (lib.target === 'skip') return
          lib.properties = defaultProperties(lib.target)
          await this.save()
          this.refresh()
        }))
  }

  private displayNewNotes(containerEl: HTMLElement): void {
    const settings = this.plugin.settings

    new Setting(containerEl)
      .setName('Images folder')
      .setDesc('Plex posters are downloaded into this folder inside each library\'s folder, for properties set to "Poster image". The tracks of an album share one cover.')
      .addText(text => text
        .setPlaceholder('Images')
        .setValue(settings.imagesSubfolder)
        .onChange(async value => {
          settings.imagesSubfolder = value.trim() || 'Images'
          await this.save()
        }))

    const preview = new Setting(containerEl).setName('Characters in file names')
    const updatePreview = () => {
      const naming = { format: '{{title}}', replacements: settings.fileNameReplacements }
      const examples = PREVIEW_ITEMS.map(item => `${item.title} → ${renderFileName(naming, item)}`)
      preview.setDesc(`These characters can't be in file names. Choose what each becomes, or leave it empty to drop it. For example: ${examples.join(';  ')}`)
    }
    updatePreview()

    const chars: { key: string, label: string }[] = [
      ...REPLACEABLE_CHARS.map(char => ({ key: char, label: `Replace ${char}` })),
      { key: 'other', label: `Replace ${OTHER_CHARS}` },
    ]
    const charsEl = containerEl.createDiv('pmn-indent')
    for (const { key, label } of chars) {
      new Setting(charsEl)
        .setName(label)
        .addText(text => text
          .setPlaceholder('Dropped')
          .setValue(settings.fileNameReplacements[key] ?? '')
          .onChange(async value => {
            settings.fileNameReplacements[key] = value
            await this.save()
            updatePreview()
          }))
    }

    new Setting(containerEl)
      .setName('Genres to keep')
      .setDesc('Only these genres are written to notes; an item\'s others are left out (Drama, Sci-Fi and Family becomes just Sci-Fi). Other names count too, such as "Science fiction" for Sci-Fi. One per line or separated by commas; empty keeps every genre.')
      .addTextArea(text => {
        text.inputEl.rows = 8
        text.inputEl.addClass('pmn-genres')
        text
          .setValue(settings.allowedGenres.join('\n'))
          .onChange(async value => {
            settings.allowedGenres = [...new Set(value.split(/[\n,]/).map(g => g.trim()).filter(Boolean))]
            await this.save()
          })
      })
  }

  private displaySyncing(containerEl: HTMLElement): void {
    const settings = this.plugin.settings

    new Setting(containerEl)
      .setName('Watched episodes in daily notes')
      .setDesc('After each sync (and with the background update), the TV episodes you watched in Plex are added to that day\'s daily note, under the line below: "▶️ [[Show]]: S02E05 – Title", one line per show, a second episode that day added to its line. Nothing in the note is changed or removed, nothing is added twice, and a daily note that doesn\'t exist isn\'t created (its day is tried again later, for up to a week).')
      .addToggle(toggle => toggle
        .setValue(settings.dailyEpisodes)
        .onChange(async value => {
          settings.dailyEpisodes = value
          await this.save()
        }))
    new Setting(containerEl)
      .setClass('pmn-indent')
      .setName('Under the line')
      .setDesc('The daily note line episodes go under (and under the empty quote line right below it), as its text without quote markers, such as "[!writing] Journaling".')
      .addText(text => text
        .setPlaceholder('Callout line')
        .setValue(settings.dailyAnchor)
        .onChange(async value => {
          settings.dailyAnchor = value.trim() || '[!writing] Journaling'
          await this.save()
        }))
    new Setting(containerEl)
      .setClass('pmn-indent')
      .setName('Quote markers')
      .setDesc('What each episode line starts with, before "- ▶️", such as "> >".')
      .addText(text => text
        .setPlaceholder('> >')
        .setValue(settings.dailyQuote)
        .onChange(async value => {
          settings.dailyQuote = value.trim()
          await this.save()
        }))
    new Setting(containerEl)
      .setClass('pmn-indent')
      .setName('Link in a property')
      .setDesc('Every movie and show watched that day is also linked in this property of the daily note, added to what\'s there. Leave empty for none.')
      .addText(text => text
        .setPlaceholder('Related')
        .setValue(settings.dailyRelated)
        .onChange(async value => {
          settings.dailyRelated = value.trim()
          await this.save()
        }))
    new Setting(containerEl)
      .setClass('pmn-indent')
      .setName('Daily notes folder and date format')
      .setDesc('Leave empty to use the settings of Obsidian\'s daily notes plugin. The format is the file name\'s, such as "YYYY-MM-DD".')
      .addText(text => text
        .setPlaceholder('Folder')
        .setValue(settings.dailyFolder)
        .onChange(async value => {
          settings.dailyFolder = value.trim()
          await this.save()
        }))
      .addText(text => text
        .setPlaceholder('Date format')
        .setValue(settings.dailyFormat)
        .onChange(async value => {
          settings.dailyFormat = value.trim()
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Ask before every change')
      .setDesc('Show each new note, and each change to an existing one, in a pop-up to approve, untick or edit first. Checks against sources always ask.')
      .addToggle(toggle => toggle
        .setValue(settings.askBeforeChanges)
        .onChange(async value => {
          settings.askBeforeChanges = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Start replacements ticked')
      .setDesc('When a pop-up offers to replace a value already in a note, it starts ticked, so applying uses it. Switched off, only clear-cut fixes start ticked (empty values, durations in hours, search links, genres) and other differences are kept unless you tick them.')
      .addToggle(toggle => toggle
        .setValue(settings.tickDifferences)
        .onChange(async value => {
          settings.tickDifferences = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Rename notes to the file name format')
      .setDesc('Each sync renames existing notes whose name doesn\'t follow their library\'s file name format (for example, adding the year). A note that could belong to more than one item is left alone.')
      .addToggle(toggle => toggle
        .setValue(settings.renameExistingNotes)
        .onChange(async value => {
          settings.renameExistingNotes = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Update play counts')
      .setDesc('Each sync copies play counts (and games\' playtime) from Plex and Steam into existing notes.')
      .addToggle(toggle => toggle
        .setValue(settings.updatePlayCounts)
        .onChange(async value => {
          settings.updatePlayCounts = value
          await this.save()
          this.refresh()
        }))

    new Setting(containerEl)
      .setName('Update ratings from Plex')
      .setDesc('Each sync copies a rating you changed in Plex into the note. A rating you changed in the note is never overwritten, and a note keeps its rating when Plex has none.')
      .addToggle(toggle => toggle
        .setValue(settings.updateRatings)
        .onChange(async value => {
          settings.updateRatings = value
          await this.save()
          this.refresh()
        }))

    new Setting(containerEl)
      .setName('Send ratings to Plex')
      .setDesc('When you change a rating in a note, the sync\'s pop-up offers to send it to Plex (so only with "Ask before every change" on).')
      .addToggle(toggle => toggle
        .setValue(settings.sendRatings)
        .onChange(async value => {
          settings.sendRatings = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Move statuses forward')
      .setDesc('Each sync moves a note\'s status forward as you watch or play: not watched, then started, then watched (games: not played, then played), using each library\'s status values. It never moves back, and a status of your own (such as revisit) is never changed.')
      .addToggle(toggle => toggle
        .setValue(settings.updateStatus)
        .onChange(async value => {
          settings.updateStatus = value
          await this.save()
          this.refresh()
        }))

    const kept = [settings.updatePlayCounts && 'play counts', settings.updateRatings && 'ratings', settings.updateStatus && 'statuses'].filter(Boolean)
    if (kept.length) {
      new Setting(containerEl)
        .setName('Update in the background')
        .setDesc(`Also update ${kept.join(' and ').replace(/ and (?=.* and )/, ', ')} (and Steam collections) while Obsidian is open. Nothing else happens in the background; new notes are only made when you sync.`)
        .addDropdown(dropdown => {
          for (const [value, label] of Object.entries(PLAY_COUNT_SCHEDULE)) dropdown.addOption(value, label)
          dropdown
            .setValue(String(settings.playCountHours))
            .onChange(async value => {
              settings.playCountHours = Number(value)
              await this.save()
              void this.plugin.updatePlayCountsIfDue()
            })
        })
    }
  }

  private displaySteam(containerEl: HTMLElement): void {
    const steam = this.plugin.settings.steam
    new Setting(containerEl).setName('Steam').setHeading()

    const changed = async () => {
      ensureSteamLibrary(this.plugin.settings)
      await this.save()
    }
    new Setting(containerEl)
      .setName('Steam Web API key')
      .setDesc('Get one at steamcommunity.com/dev/apikey (any domain name will do). Your profile\'s "Game details" privacy setting needs to be Public for Steam to list your games.')
      .addText(text => {
        text.inputEl.type = 'password'
        text.setValue(steam.apiKey).onChange(async value => {
          steam.apiKey = value.trim()
          await changed()
        })
      })
    new Setting(containerEl)
      .setName('Steam account')
      .setDesc('Your 17-digit Steam ID, your profile address, or your custom profile name.')
      .addText(text => text
        .setPlaceholder('steamcommunity.com/id/yourname')
        .setValue(steam.account)
        .onChange(async value => {
          steam.account = value.trim()
          await changed()
        }))
    new Setting(containerEl)
      .setName('Include free-to-play games')
      .setDesc('Also list free games in your library, played or not.')
      .addToggle(toggle => toggle
        .setValue(steam.includeFreeGames)
        .onChange(async value => {
          steam.includeFreeGames = value
          await this.save()
        }))
    new Setting(containerEl)
      .setName('SteamGridDB API key')
      .setDesc('Optional. You can get a free key in your SteamGridDB profile preferences. With a key, the approval pop-up also offers covers from SteamGridDB to pick from, along with the Steam and HowLongToBeat covers. HowLongToBeat times need no key. They are looked up by name for the properties that use them, which are in the game defaults.')
      .addText(text => {
        text.inputEl.type = 'password'
        text.setValue(steam.gridKey ?? '').onChange(async value => {
          steam.gridKey = value.trim()
          await this.save()
        })
      })
      .addButton(button => button.setButtonText('Test').onClick(async () => {
        const key = (steam.gridKey ?? '').trim()
        if (!key) {
          new Notice('Paste your SteamGridDB API key first')
          return
        }
        button.setDisabled(true)
        try {
          const covers = await steamGridCovers(key, 620)
          new Notice(`SteamGridDB: the key works (${covers.length} covers for Portal 2)`, 8000)
        } catch (err) {
          new Notice(`SteamGridDB: ${errorMessage(err)}`, 10000)
        } finally {
          button.setDisabled(false)
        }
      }))
    new Setting(containerEl)
      .setName('Steam folder')
      .setDesc('Desktop only, for the "Games: your Steam collections" source: where Steam is installed on this computer, if it isn\'t in the usual place (Program Files on Windows, Application Support on a Mac). Your collections are read from Steam\'s own files there.')
      .addText(text => text
        .setPlaceholder('Usual place')
        .setValue(steam.folder ?? '')
        .onChange(async value => {
          steam.folder = value.trim()
          await this.save()
        }))
    new Setting(containerEl)
      .setName('Test Steam')
      .setDesc('Reads your games list once, to check the key and account, and adds the Steam library to the libraries below.')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          button.setDisabled(true)
          try {
            const client = new SteamClient(steam.apiKey, steam.account, steam.includeFreeGames)
            const games = await client.ownedGames()
            ensureSteamLibrary(this.plugin.settings)
            await this.save()
            const collections = Platform.isDesktopApp ? readSteamCollections(await client.steamId(), steam.folder ?? '') : null
            const names = collections ? new Set([...collections.values()].flat()).size : 0
            new Notice(`Steam: found ${games.length} games${!Platform.isDesktopApp ? '' : collections ? `, and ${names} collection${names === 1 ? '' : 's'} on this computer` : '; your collections weren\'t found on this computer (check the Steam folder)'}`, 8000)
          } catch (err) {
            new Notice(`Steam: ${errorMessage(err)}`, 10000)
          } finally {
            button.setDisabled(false)
            this.refresh()
          }
        }))
  }

  /** Keys for the databases "Add something new" searches. */
  private displayOtherSources(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    new Setting(containerEl).setName('Other sources').setHeading()
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '"Add a movie, show, game or book" searches OMDb (movies and shows), Steam and HowLongToBeat (games) and Open Library (books, with summaries and dates from Google Books). Checks use them too. Last.fm is only used by the recommendations page.',
    })
    new Setting(containerEl)
      .setName('OMDb API key')
      .setDesc('Needed for movies and TV shows. Get a free key at omdbapi.com, good for 1,000 searches a day. Paste the key or the link from OMDb\'s email; spaces and other stray characters are removed.')
      .addText(text => {
        text.setPlaceholder('For example a1b2c3d4').setValue(settings.omdbKey ?? '').onChange(async value => {
          settings.omdbKey = cleanOmdbKey(value)
          await this.save()
        })
      })
      .addButton(button => button.setButtonText('Test').onClick(async () => {
        button.setDisabled(true)
        new Notice(await testOmdbKey(settings.omdbKey ?? ''), 10_000)
        button.setDisabled(false)
      }))
    new Setting(containerEl)
      .setName('Google Books API key')
      .setDesc('Optional. Book summaries come from Google Books (the publisher\'s description), with Open Library\'s when Google Books has none. It works without a key; one (free, from the Google Cloud console, with the Books API enabled) only raises the daily limit.')
      .addText(text => text
        .setPlaceholder('Optional')
        .setValue(settings.googleBooksKey ?? '')
        .onChange(async value => {
          settings.googleBooksKey = value.trim()
          await this.save()
        }))
      .addButton(button => button.setButtonText('Test').onClick(async () => {
        button.setDisabled(true)
        new Notice(await testGoogleBooks(settings.googleBooksKey ?? ''), 10_000)
        button.setDisabled(false)
      }))
    new Setting(containerEl)
      .setName('Last.fm API key')
      .setDesc('Optional. The recommendations page asks Last.fm for songs like your ⭐⭐⭐⭐ and 🩷 ones, and lists those you don\'t have, by any artist. Get a free key by creating an API account at last.fm/api.')
      .addText(text => text
        .setPlaceholder('Optional')
        .setValue(settings.lastfmKey ?? '')
        .onChange(async value => {
          settings.lastfmKey = value.trim()
          await this.save()
        }))
      .addButton(button => button.setButtonText('Test').onClick(async () => {
        button.setDisabled(true)
        new Notice(await testLastfmKey(settings.lastfmKey ?? ''), 10_000)
        button.setDisabled(false)
      }))
    new Setting(containerEl)
      .setName('Last.fm username')
      .setDesc('Optional, with the key. A song\'s play count on Last.fm is offered beside Plex\'s in syncs and checks whenever the two differ, for you to choose which goes in the note.')
      .addText(text => text
        .setPlaceholder('Optional')
        .setValue(settings.lastfmUser ?? '')
        .onChange(async value => {
          settings.lastfmUser = value.trim()
          await this.save()
        }))
  }

  /**
   * Everything remembered from answers in pop-ups, each to forget: one collapsible section per
   * kind of choice, its entries under their kind of media, in alphabetical order.
   */
  private displayRemembered(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const notes = this.notesByItem()
    this.displayMerged(this.section(containerEl, 'remembered-merged', `Notes you chose for items (${Object.keys(settings.merged).length})`, 'Use an existing note, and Tie this note to a Plex item.', 'pmn-subsection'))
    this.displayIgnored(this.section(containerEl, 'remembered-ignored', `Skipped every time (${Object.keys(settings.ignored).length})`, undefined, 'pmn-subsection'))
    this.displayUnmatchedIgnored(this.section(containerEl, 'remembered-unmatched', `Notes that match nothing, ignored (${settings.unmatchedIgnored.length})`, undefined, 'pmn-subsection'))
    const kept = keptEntries(settings.keptValues, settings.keptLinks)
    this.displayKept(this.section(containerEl, 'remembered-kept', `Kept as they were (${kept.length})`, undefined, 'pmn-subsection'), kept, notes)
    const locked = Object.values(settings.lockedProperties).reduce((sum, names) => sum + names.length, 0)
    this.displayLocked(this.section(containerEl, 'remembered-locked', `Never changed (${locked})`, undefined, 'pmn-subsection'))
    this.displayNotInterested(this.section(containerEl, 'remembered-not-interested', `Not interested (${settings.notInterested.length})`, undefined, 'pmn-subsection'))
  }

  /** A heading for one kind of media within a remembered-choices section. */
  private kindHeading(containerEl: HTMLElement, kind: string, count: number): void {
    new Setting(containerEl).setName(`${kind} (${count})`).setHeading().setClass('pmn-kind-heading')
  }

  /** The notes in the libraries' folders by the item their link (or a tie) points to. */
  private notesByItem(): Map<string, string> {
    const settings = this.plugin.settings
    const libraries = Object.values(settings.libraries).filter(lib => lib.target !== 'skip')
    const linkNames = [...new Set(libraries.flatMap(lib => linkPropertyNames(lib.properties)))]
    const folders = [...new Set(libraries.map(lib => normalizePath(lib.folder)))]
    const notes = new Map<string, string>()
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!folders.some(folder => file.path.startsWith(`${folder}/`))) continue
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      for (const name of linkNames) {
        const key = ratingKeyFromLink(frontmatter[name])
        if (key && !notes.has(key)) notes.set(key, file.path)
      }
    }
    for (const [key, item] of Object.entries(settings.merged)) notes.set(key, item.path)
    return notes
  }

  /** Properties you said never to change in a note ("Never for this note" in a pop-up), each to forget. */
  private displayLocked(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const entries = Object.entries(settings.lockedProperties)
      .flatMap(([path, names]) => names.map(name => ({ path, name })))
    new Setting(containerEl).setDesc(entries.length
      ? 'Properties you locked in a pop-up: syncs and checks never change them in that note. Forget one to have it offered again.'
      : 'Nothing yet. Press the lock next to a line in a change pop-up to never change that property in that note.')
    for (const [kind, list] of groupByKind(entries, e => kindOfPath(settings.libraries, e.path), e => noteName(e.path), e => e.name)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const { path, name } of list) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(noteName(path))
          .setDesc(`${name} · ${folderOf(path)}`)
          .addButton(button => button
            .setButtonText('Forget')
            .onClick(async () => {
              const left = (settings.lockedProperties[path] ?? []).filter(n => n !== name)
              if (left.length) settings.lockedProperties[path] = left
              else delete settings.lockedProperties[path]
              await this.save()
              this.refresh()
            }))
      }
    }
  }

  /** Recommendations you said "Not interested" to: notes by name, items without notes counted. */
  private displayNotInterested(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const count = settings.notInterested.length
    new Setting(containerEl)
      .setDesc(count
        ? 'Suggestions you said "Not interested" to on the recommendations page aren\'t suggested again. Forget one to see it again.'
        : 'Nothing yet. Suggestions you say "Not interested" to on the recommendations page show up here.')
      .addButton(button => button
        .setButtonText('Forget all')
        .setDisabled(!count)
        .onClick(async () => {
          settings.notInterested = []
          await this.save()
          this.refresh()
        }))
    const paths = settings.notInterested.filter(id => id.startsWith('note:')).map(id => id.slice('note:'.length))
    for (const [kind, list] of groupByKind(paths, path => kindOfPath(settings.libraries, path), noteName)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const path of list) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(noteName(path))
          .setDesc(folderOf(path))
          .addButton(button => button
            .setButtonText('Forget')
            .onClick(async () => {
              settings.notInterested = settings.notInterested.filter(id => id !== `note:${path}`)
              await this.save()
              this.refresh()
            }))
      }
    }
    const lastfm = settings.notInterested.filter(id => id.startsWith('lastfm:'))
    if (lastfm.length) {
      this.kindHeading(containerEl, 'Last.fm', lastfm.length)
      const label = (id: string) => id.replace(/^lastfm:(track|artist):/, '')
      for (const id of [...lastfm].sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }))) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(label(id))
          .setDesc(id.startsWith('lastfm:artist:') ? 'Artist' : 'Song')
          .addButton(button => button
            .setButtonText('Forget')
            .onClick(async () => {
              settings.notInterested = settings.notInterested.filter(n => n !== id)
              await this.save()
              this.refresh()
            }))
      }
    }
    const items = settings.notInterested.length - paths.length - lastfm.length
    if (items) {
      new Setting(containerEl)
        .setName(`${items} item${items === 1 ? '' : 's'} without a note`)
        .setDesc('Plex items and Steam games you have no note for; only "Forget all" brings them back.')
    }
  }

  /** Values and links you chose to keep in pop-ups, which aren't offered again while they stay the same. */
  private displayKept(containerEl: HTMLElement, kept: KeptEntry[], notes: Map<string, string>): void {
    const settings = this.plugin.settings
    new Setting(containerEl)
      .setDesc(kept.length
        ? 'Values and links you left unticked in a pop-up are kept and not offered again while they stay the same. Forget one to have syncs and checks offer it again.'
        : 'Nothing yet. Values and links you leave unticked in a pop-up are kept, and listed here.')
      .addButton(button => button
        .setButtonText('Forget all')
        .setDisabled(!kept.length)
        .onClick(async () => {
          settings.keptValues = {}
          settings.keptLinks = {}
          await this.save()
          this.refresh()
        }))
    const pathOf = (entry: KeptEntry): string | null =>
      entry.item.startsWith('book:') ? entry.item.slice('book:'.length) : notes.get(entry.item) ?? null
    const nameOf = (entry: KeptEntry): string => {
      const path = pathOf(entry)
      return path ? noteName(path) : `Item ${entry.item} (no note found)`
    }
    const kindOf = (entry: KeptEntry): string => {
      const path = pathOf(entry)
      return path ? kindOfPath(settings.libraries, path) : OTHER_KIND
    }
    for (const [kind, list] of groupByKind(kept, kindOf, nameOf, e => e.property)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const entry of list) {
        const offer = entry.offered === null ? '' : ` over "${entry.offered}"`
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(nameOf(entry))
          .setDesc(`${entry.property}: kept "${entry.kept}"${offer}`)
          .addButton(button => button
            .setButtonText('Forget')
            .onClick(async () => {
              if (entry.links) delete settings.keptLinks[entry.key]
              else delete settings.keptValues[entry.key]
              await this.save()
              this.refresh()
            }))
      }
    }
  }

  /** Items tied to existing notes with "Use an existing note", each with a button to undo it. */
  private displayMerged(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const entries = Object.entries(settings.merged)
    new Setting(containerEl).setDesc(entries.length
      ? 'Items you chose "Use an existing note" for. Syncs treat that note as theirs (filling in, play counts and ratings as usual) and never rename it. Unmerge one to have syncs match it by name again, or offer to create it.'
      : 'Nothing yet. Choose "Use an existing note" in the approval pop-up to tie an item to a note you already have, when their names differ.')
    for (const [kind, list] of groupByKind(entries, ([, item]) => kindOfLibrary(settings.libraries, item.libraryKey, item.library), ([, item]) => item.name)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const [key, item] of list) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(item.name)
          .setDesc(`${item.library} → ${item.path.replace(/\.md$/, '')}`)
          .addButton(button => button
            .setButtonText('Unmerge')
            .onClick(async () => {
              delete settings.merged[key]
              await this.save()
              this.refresh()
            }))
      }
    }
  }

  /** Items "Skip every time" was chosen for, each with a button to un-ignore it. */
  private displayIgnored(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const entries = Object.entries(settings.ignored)
    const heading = new Setting(containerEl)
      .setDesc(entries.length
        ? 'Plex items you chose "Skip every time" for. Syncs pass over them completely: no new notes, renames, fill-ins or play counts. Un-ignore one to be asked about it again on the next sync.'
        : 'Nothing yet. Choose "Skip every time" in the approval pop-up to have syncs pass over an item.')
    if (entries.length > 1) {
      heading.addButton(button => button
        .setButtonText('Un-ignore all')
        .onClick(async () => {
          settings.ignored = {}
          await this.save()
          this.refresh()
        }))
    }
    for (const [kind, list] of groupByKind(entries, ([, item]) => kindOfLibrary(settings.libraries, undefined, item.library), ([, item]) => item.name)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const [key, item] of list) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(item.name)
          .setDesc(`${item.library}, since ${new Date(item.since).toLocaleDateString()}`)
          .addButton(button => button
            .setButtonText('Un-ignore')
            .onClick(async () => {
              delete settings.ignored[key]
              await this.save()
              this.refresh()
            }))
      }
    }
  }

  /** Notes "Always ignore" was chosen for when a sync said they match nothing, each to stop ignoring. */
  private displayUnmatchedIgnored(containerEl: HTMLElement): void {
    const settings = this.plugin.settings
    const notes = settings.unmatchedIgnored
    new Setting(containerEl).setDesc(notes.length
      ? 'Notes you chose "Always ignore" for when a sync pointed out that they match nothing in Plex, Steam or Open Library. Stop ignoring one to have it pointed out again.'
      : 'Nothing yet. Choose "Always ignore" for a note a sync says matches nothing to stop it being pointed out.')
    for (const [kind, list] of groupByKind(notes, path => kindOfPath(settings.libraries, path), noteName)) {
      this.kindHeading(containerEl, kind, list.length)
      for (const path of list) {
        new Setting(containerEl)
          .setClass('pmn-ignored-item')
          .setName(noteName(path))
          .setDesc(folderOf(path))
          .addButton(button => button
            .setButtonText('Stop ignoring')
            .onClick(async () => {
              settings.unmatchedIgnored = settings.unmatchedIgnored.filter(p => p !== path)
              await this.save()
              this.refresh()
            }))
      }
    }
  }

  /** Redraws the page without losing the scroll position. */
  private refresh(): void {
    const scrollers: HTMLElement[] = []
    for (let el: HTMLElement | null = this.containerEl; el; el = el.parentElement) {
      if (el.scrollTop > 0) scrollers.push(el)
    }
    const positions = scrollers.map(el => el.scrollTop)
    this.display()
    scrollers.forEach((el, i) => { el.scrollTop = positions[i] })
  }

  private async moveProperty(lib: LibrarySetting, index: number, by: number): Promise<void> {
    const [moved] = lib.properties.splice(index, 1)
    lib.properties.splice(index + by, 0, moved)
    await this.save()
    this.refresh()
  }

  private addValueSetting(el: HTMLElement, name: string, desc: string, get: () => string, set: (value: string) => void): void {
    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addText(text => text
        .setValue(get())
        .onChange(async value => {
          set(value.trim())
          await this.save()
        }))
  }

  private async loadLibraries(): Promise<void> {
    const { serverUrl, token } = this.plugin.settings
    if (!serverUrl || !token) throw new Error('enter the server address and token first')
    const libraries = await new PlexClient(serverUrl, token).libraries()
    mergeLibraries(this.plugin.settings, libraries)
    await this.save()
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
