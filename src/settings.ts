import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type PlexMediaNotesPlugin from './main'
import { defaultLibraryTarget, type LibraryTarget } from './notes'
import { PlexClient } from './plex'

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
  postersFolder: string
  fileNameFormat: string
  useDocumentaryGenre: boolean
  /** Keyed by Plex library section key. */
  libraries: Record<string, LibrarySetting>
}

export const DEFAULT_SETTINGS: PlexNotesSettings = {
  serverUrl: '',
  token: '',
  moviesFolder: 'Media/Movies',
  tvFolder: 'Media/TV Shows',
  documentariesFolder: 'Media/Documentaries',
  postersFolder: 'Media/Posters',
  fileNameFormat: '{{title}} ({{year}})',
  useDocumentaryGenre: true,
  libraries: {},
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
    this.addFolderSetting('Posters folder', 'postersFolder', 'Downloaded posters are saved here and linked from the Image property.')

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
  }

  private addFolderSetting(
    name: string,
    key: 'moviesFolder' | 'tvFolder' | 'documentariesFolder' | 'postersFolder',
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
