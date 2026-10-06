import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import {
  DEFAULT_FILE_NAMES,
  DEFAULT_FOLDERS,
  DEFAULT_MATCH_BY,
  mergeLibraries,
  retarget,
  type LibrarySetting,
} from './config'
import { OTHER_CHARS, renderFileName, REPLACEABLE_CHARS, type LibraryTarget, type MatchBy, type PlexItem } from './notes'
import { PlexClient } from './plex'
import { PropertyNameSuggest } from './property-suggest'
import { defaultProperties, defaultValues, FIELD_SOURCES, type FieldSource } from './properties'

const PREVIEW_ITEMS: PlexItem[] = [
  { ratingKey: '1', type: 'movie', title: 'Mission: Impossible' },
  { ratingKey: '2', type: 'movie', title: 'Face/Off' },
  { ratingKey: '3', type: 'movie', title: 'What About Bob?' },
]

const MATCH_LABELS: Record<MatchBy, string> = {
  loose: 'Plex link, title, title and year, or file name',
  format: 'Plex link or file name',
  link: 'Plex link only',
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
  skip: 'Skip',
}

export class PlexNotesSettingTab extends PluginSettingTab {
  /** Library sections the user has expanded, kept open across redraws. */
  private readonly openLibraries = new Set<string>()

  constructor(app: App, private readonly plugin: PlexMediaNotesPlugin) {
    super(app, plugin)
  }

  private save(): Promise<void> {
    return this.plugin.saveSettings()
  }

  display(): void {
    const { containerEl } = this
    const settings = this.plugin.settings
    containerEl.empty()

    new Setting(containerEl).setName('Plex server').setHeading()

    new Setting(containerEl)
      .setName('Server address')
      .setDesc('For example http://192.168.1.10:32400')
      .addText(text => text
        .setPlaceholder('http://192.168.1.10:32400')
        .setValue(settings.serverUrl)
        .onChange(async value => {
          settings.serverUrl = value.trim()
          await this.save()
        }))

    new Setting(containerEl)
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

    new Setting(containerEl).setName('Libraries').setHeading()

    new Setting(containerEl)
      .setDesc('Load your Plex libraries, then open each one to choose its type, folder, file names and properties.')
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

    for (const [key, lib] of Object.entries(settings.libraries)) this.displayLibrary(key, lib)

    this.displayGeneral()
  }

  private displayLibrary(key: string, lib: LibrarySetting): void {
    const details = this.containerEl.createEl('details')
    details.open = this.openLibraries.has(key)
    details.addEventListener('toggle', () => {
      if (details.open) this.openLibraries.add(key)
      else this.openLibraries.delete(key)
    })
    details.createEl('summary', { text: `${lib.title} (${TARGET_LABELS[lib.target]})` })
    const el = details.createDiv()

    new Setting(el)
      .setName('Type')
      .setDesc('What this library holds. Skipped libraries get no notes.')
      .addDropdown(dropdown => {
        for (const [value, label] of Object.entries(TARGET_LABELS)) dropdown.addOption(value, label)
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
      .setDesc('How a note already in the folder is recognised as this Plex item, so no second note is made. Case, accents and punctuation are ignored in names. A note linking to a different Plex item never matches by name.')
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
    if (!music) {
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

  private displayGeneral(): void {
    const { containerEl } = this
    const settings = this.plugin.settings

    new Setting(containerEl).setName('All libraries').setHeading()

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
    for (const { key, label } of chars) {
      new Setting(containerEl)
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

    new Setting(containerEl)
      .setName('Detect documentaries by genre')
      .setDesc('Movies and shows in the documentary genre get their notes from your documentaries library\'s settings (folder, file name and properties), whichever library they are in.')
      .addToggle(toggle => toggle
        .setValue(settings.useDocumentaryGenre)
        .onChange(async value => {
          settings.useDocumentaryGenre = value
          await this.save()
        }))
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
