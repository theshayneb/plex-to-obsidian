import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import { defaultLibraryTarget, type LibraryTarget } from './notes'
import { PlexClient } from './plex'
import {
  DEFAULT_PROPERTIES,
  DEFAULT_VALUES,
  FIELD_SOURCES,
  type FieldSource,
  type PropertyMapping,
  type PropertyValues,
} from './properties'

export interface LibrarySetting {
  title: string
  type: string
  target: LibraryTarget
}

export interface PlexNotesSettings {
  serverUrl: string
  token: string
  moviesFolder: string
  tvFolder: string
  documentariesFolder: string
  /** Subfolder of each media folder that downloaded posters go in. */
  imagesSubfolder: string
  fileNameFormat: string
  useDocumentaryGenre: boolean
  /** Keyed by Plex library section key. */
  libraries: Record<string, LibrarySetting>
  /** Frontmatter properties written to new notes, in order. */
  properties: PropertyMapping[]
  values: PropertyValues
}

export const DEFAULT_SETTINGS: PlexNotesSettings = {
  serverUrl: '',
  token: '',
  moviesFolder: 'Media/Movies',
  tvFolder: 'Media/TV Shows',
  documentariesFolder: 'Media/Documentaries',
  imagesSubfolder: 'Images',
  fileNameFormat: '{{title}} ({{year}})',
  useDocumentaryGenre: true,
  libraries: {},
  properties: DEFAULT_PROPERTIES,
  values: DEFAULT_VALUES,
}

/** Fresh copy of the defaults, so editing settings never changes them. */
export function defaultSettings(): PlexNotesSettings {
  return structuredClone(DEFAULT_SETTINGS)
}

const TARGET_LABELS: Record<LibraryTarget, string> = {
  movie: 'Movies',
  tv: 'TV shows',
  documentary: 'Documentaries',
  skip: 'Skip',
}

export class PlexNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PlexMediaNotesPlugin) {
    super(app, plugin)
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
          await this.plugin.saveSettings()
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
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Libraries')
      .setDesc('Load your Plex libraries, then choose where each one goes.')
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
            this.display()
          }
        }))

    for (const [key, library] of Object.entries(settings.libraries)) {
      new Setting(containerEl)
        .setName(library.title)
        .setDesc(library.type === 'show' ? 'TV library' : library.type === 'movie' ? 'Movie library' : `${library.type} library`)
        .addDropdown(dropdown => {
          for (const [value, label] of Object.entries(TARGET_LABELS)) dropdown.addOption(value, label)
          dropdown
            .setValue(library.target)
            .onChange(async value => {
              settings.libraries[key].target = value as LibraryTarget
              await this.plugin.saveSettings()
            })
        })
    }

    new Setting(containerEl).setName('Notes').setHeading()

    this.addFolderSetting('Movies folder', 'moviesFolder')
    this.addFolderSetting('TV shows folder', 'tvFolder')
    this.addFolderSetting('Documentaries folder', 'documentariesFolder')
    this.addFolderSetting('Images subfolder', 'imagesSubfolder', 'Posters are saved in this subfolder of the movies, TV shows or documentaries folder, for properties set to "Poster image".')

    new Setting(containerEl)
      .setName('File name')
      .setDesc('Use {{title}} and {{year}}. Empty brackets are dropped when an item has no year.')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.fileNameFormat)
        .setValue(settings.fileNameFormat)
        .onChange(async value => {
          settings.fileNameFormat = value.trim() || DEFAULT_SETTINGS.fileNameFormat
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Detect documentaries by genre')
      .setDesc('Items in the documentary genre go to the documentaries folder, whichever library they are in.')
      .addToggle(toggle => toggle
        .setValue(settings.useDocumentaryGenre)
        .onChange(async value => {
          settings.useDocumentaryGenre = value
          await this.plugin.saveSettings()
        }))

    this.displayProperties()
  }

  private displayProperties(): void {
    const { containerEl } = this
    const settings = this.plugin.settings
    const save = () => this.plugin.saveSettings()

    new Setting(containerEl).setName('Properties').setHeading()
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Properties added to new notes, in this order. Choose the name of each property and the Plex information that fills it. Properties Plex has no value for are added empty, for you to fill in.',
    })

    settings.properties.forEach((mapping, index) => {
      const row = new Setting(containerEl)
        .addText(text => text
          .setPlaceholder('Property name')
          .setValue(mapping.name)
          .onChange(async value => {
            mapping.name = value
            await save()
          }))
        .addDropdown(dropdown => {
          for (const [value, label] of Object.entries(FIELD_SOURCES)) dropdown.addOption(value, label)
          dropdown
            .setValue(mapping.source)
            .onChange(async value => {
              mapping.source = value as FieldSource
              await save()
              this.display()
            })
        })
      if (mapping.source === 'text') {
        row.addText(text => text
          .setPlaceholder('Value')
          .setValue(mapping.text ?? '')
          .onChange(async value => {
            mapping.text = value
            await save()
          }))
      }
      row
        .addExtraButton(button => button
          .setIcon('arrow-up')
          .setTooltip('Move up')
          .setDisabled(index === 0)
          .onClick(() => this.moveProperty(index, -1)))
        .addExtraButton(button => button
          .setIcon('arrow-down')
          .setTooltip('Move down')
          .setDisabled(index === settings.properties.length - 1)
          .onClick(() => this.moveProperty(index, 1)))
        .addExtraButton(button => button
          .setIcon('trash')
          .setTooltip('Remove')
          .onClick(async () => {
            settings.properties.splice(index, 1)
            await save()
            this.display()
          }))
    })

    new Setting(containerEl)
      .addButton(button => button
        .setButtonText('Add property')
        .setCta()
        .onClick(async () => {
          settings.properties.push({ name: '', source: 'summary' })
          await save()
          this.display()
        }))
      .addButton(button => button
        .setButtonText('Reset to defaults')
        .onClick(async () => {
          settings.properties = structuredClone(DEFAULT_PROPERTIES)
          await save()
          this.display()
        }))

    new Setting(containerEl).setName('Property values').setHeading()

    this.addValueSetting('Watched', 'For "Watched status": a movie that has been played, or a show with every episode watched.',
      () => settings.values.watched, v => { settings.values.watched = v || DEFAULT_VALUES.watched })
    this.addValueSetting('Started', 'For "Watched status": a movie stopped part way, or a show with some episodes watched.',
      () => settings.values.started, v => { settings.values.started = v || DEFAULT_VALUES.started })
    this.addValueSetting('Not watched', 'For "Watched status": everything else.',
      () => settings.values.unwatched, v => { settings.values.unwatched = v || DEFAULT_VALUES.unwatched })
    this.addValueSetting('Movie tag', 'For "Type tag".',
      () => settings.values.tags.movie, v => { settings.values.tags.movie = v || DEFAULT_VALUES.tags.movie })
    this.addValueSetting('TV show tag', 'For "Type tag".',
      () => settings.values.tags.tv, v => { settings.values.tags.tv = v || DEFAULT_VALUES.tags.tv })
    this.addValueSetting('Documentary tag', 'For "Type tag".',
      () => settings.values.tags.documentary, v => { settings.values.tags.documentary = v || DEFAULT_VALUES.tags.documentary })
  }

  private async moveProperty(index: number, by: number): Promise<void> {
    const list = this.plugin.settings.properties
    const [moved] = list.splice(index, 1)
    list.splice(index + by, 0, moved)
    await this.plugin.saveSettings()
    this.display()
  }

  private addValueSetting(name: string, desc: string, get: () => string, set: (value: string) => void): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => text
        .setValue(get())
        .onChange(async value => {
          set(value.trim())
          await this.plugin.saveSettings()
        }))
  }

  private addFolderSetting(
    name: string,
    key: 'moviesFolder' | 'tvFolder' | 'documentariesFolder' | 'imagesSubfolder',
    desc?: string,
  ): void {
    const setting = new Setting(this.containerEl).setName(name)
    if (desc) setting.setDesc(desc)
    setting.addText(text => text
      .setPlaceholder(DEFAULT_SETTINGS[key])
      .setValue(this.plugin.settings[key])
      .onChange(async value => {
        this.plugin.settings[key] = value.trim() || DEFAULT_SETTINGS[key]
        await this.plugin.saveSettings()
      }))
  }

  private async loadLibraries(): Promise<void> {
    const { serverUrl, token } = this.plugin.settings
    if (!serverUrl || !token) throw new Error('enter the server address and token first')
    const libraries = await new PlexClient(serverUrl, token).libraries()
    mergeLibraries(this.plugin.settings, libraries)
    await this.plugin.saveSettings()
  }
}

/** Adds libraries Plex reports that the settings don't know yet, keeping existing choices. */
export function mergeLibraries(settings: PlexNotesSettings, libraries: { key: string, title: string, type: string }[]): void {
  for (const lib of libraries) {
    const existing = settings.libraries[lib.key]
    settings.libraries[lib.key] = existing
      ? { ...existing, title: lib.title, type: lib.type }
      : { title: lib.title, type: lib.type, target: defaultLibraryTarget(lib.type, lib.title) }
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
