import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import { cleanOmdbKey } from './discover-data'
import { testOmdbKey } from './discover'
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
import { OTHER_CHARS, renderFileName, REPLACEABLE_CHARS, type LibraryTarget, type MatchBy, type PlexItem } from './notes'
import { PlexClient } from './plex'
import { SteamClient } from './steam'
import { PropertyNameSuggest } from './property-suggest'
import { defaultProperties, defaultValues, FIELD_SOURCES, type FieldSource } from './properties'

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
  /** Collapsible sections the user has opened (Setup, All libraries, Skipped every time). */
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

    this.displaySetup(this.section(containerEl, 'setup', 'Setup', 'Servers, accounts and API keys.'))
    this.displayGeneral(this.section(containerEl, 'general', 'All libraries', 'File names, images, approvals and play counts.'))
    this.displayLibraries(containerEl)
    this.displayIgnored(this.section(containerEl, 'ignored', 'Skipped every time'))
  }

  /** A collapsible section, closed until opened and kept as it was across redraws. */
  private section(parent: HTMLElement, key: string, title: string, desc?: string): HTMLElement {
    const details = parent.createEl('details', { cls: 'pmn-section' })
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

    this.displaySteam(el)
    this.displayOtherSources(el)
  }

  private displayLibraries(parent: HTMLElement): void {
    new Setting(parent).setName('Libraries').setHeading()
    const el = parent.createDiv('pmn-indent')

    new Setting(el)
      .setDesc('Load your Plex libraries, then open each one (and Steam, once it is set up) to choose its type, folder, file names and properties.')
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
      .setName('Match existing notes by')
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

    this.displayProperties(el, lib)

    new Setting(el).setName('Property values').setHeading()
    const defaults = defaultValues(kind)
    if (book) {
      this.addValueSetting(el, 'New book', 'For "Watched or played status": the status a new book note starts with.',
        () => lib.values.unwatched, v => { lib.values.unwatched = v || defaults.unwatched })
    } else if (game) {
      this.addValueSetting(el, 'Played', 'For "Watched or played status": a game with any playtime. Steam can\'t tell when a game is finished, so set that by hand.',
        () => lib.values.started, v => { lib.values.started = v || defaults.started })
      this.addValueSetting(el, 'Not played', 'For "Watched or played status": a game never played.',
        () => lib.values.unwatched, v => { lib.values.unwatched = v || defaults.unwatched })
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
      text: 'Properties added to new notes, in this order. Choose the name of each property (start typing to pick from the properties already in your vault) and the Plex information that fills it. Properties Plex has no value for are added empty, for you to fill in. Switch on the toggle next to a property to also add a property to existing notes that match a Plex item, when it is missing or empty there; nothing else in those notes changes.',
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
              const textChanged = (mapping.source === 'text') !== (value === 'text')
              mapping.source = value as FieldSource
              await this.save()
              // Only the "Fixed text" choice changes the row's layout.
              if (textChanged) this.refresh()
            })
        })
      if (mapping.source === 'text') {
        row.addText(text => text
          .setPlaceholder('Value')
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

  private displayGeneral(containerEl: HTMLElement): void {
    const settings = this.plugin.settings

    new Setting(containerEl)
      .setName('Images subfolder')
      .setDesc('Posters are saved in this subfolder of each library folder, for properties set to "Poster image". Every track on an album shares one cover.')
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
      .setName('Ask before every change')
      .setDesc('Before creating a note, or changing an existing one in any way (renaming it, filling in properties, updating play counts), show what will happen and ask. This includes background play count updates.')
      .addToggle(toggle => toggle
        .setValue(settings.askBeforeChanges)
        .onChange(async value => {
          settings.askBeforeChanges = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Fix names of existing notes')
      .setDesc('Rename notes that already exist for a Plex item to their library\'s file name format, for example adding the year. Only the file name changes. A note that could belong to more than one Plex item is left alone.')
      .addToggle(toggle => toggle
        .setValue(settings.renameExistingNotes)
        .onChange(async value => {
          settings.renameExistingNotes = value
          await this.save()
        }))

    new Setting(containerEl)
      .setName('Keep play counts up to date')
      .setDesc('Every sync also updates properties set to "Play count" in existing notes, in all libraries. This is the only property whose value in an existing note is ever replaced.')
      .addToggle(toggle => toggle
        .setValue(settings.updatePlayCounts)
        .onChange(async value => {
          settings.updatePlayCounts = value
          await this.save()
          this.refresh()
        }))

    if (settings.updatePlayCounts) {
      new Setting(containerEl)
        .setName('Update play counts automatically')
        .setDesc('Also update play counts in the background while the app is open. Nothing else happens in the background. New notes are only made when you run the sync.')
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
      .setDesc('Also list free games you have played.')
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
    new Setting(containerEl)
      .setName('Check Steam')
      .setDesc('Reads your games list once, to check the key and account, and adds the Steam library to the libraries below.')
      .addButton(button => button
        .setButtonText('Check')
        .onClick(async () => {
          button.setDisabled(true)
          try {
            const games = await new SteamClient(steam.apiKey, steam.account, steam.includeFreeGames).ownedGames()
            ensureSteamLibrary(this.plugin.settings)
            await this.save()
            new Notice(`Steam: found ${games.length} games`)
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
    new Setting(containerEl).setName('Adding things not in Plex or Steam').setHeading()
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The "Add something new" command finds movies and TV shows on OMDb, games on Steam and HowLongToBeat, and books on Open Library. The note goes in the library you choose, with its properties. Once the item is in Plex or Steam, syncing recognises the note.',
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
  }

  /** Items "Skip every time" was chosen for, each with a button to un-ignore it. */
  private displayIgnored(containerEl: HTMLElement): void {
    const ignored = this.plugin.settings.ignored
    const entries = Object.entries(ignored).sort((a, b) => a[1].name.localeCompare(b[1].name))

    const heading = new Setting(containerEl)
      .setDesc(entries.length
        ? 'Plex items you chose "Skip every time" for. Syncs pass over them completely: no new notes, renames, fill-ins or play counts. Un-ignore one to be asked about it again on the next sync.'
        : 'Nothing yet. Choose "Skip every time" in the approval pop-up to have syncs pass over an item.')
    if (entries.length > 1) {
      heading.addButton(button => button
        .setButtonText('Un-ignore all')
        .onClick(async () => {
          this.plugin.settings.ignored = {}
          await this.save()
          this.refresh()
        }))
    }

    for (const [key, item] of entries) {
      new Setting(containerEl)
        .setClass('pmn-ignored-item')
        .setName(item.name)
        .setDesc(`${item.library}, since ${new Date(item.since).toLocaleDateString()}`)
        .addButton(button => button
          .setButtonText('Un-ignore')
          .onClick(async () => {
            delete this.plugin.settings.ignored[key]
            await this.save()
            this.refresh()
          }))
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
