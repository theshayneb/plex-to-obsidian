import { Platform } from 'obsidian'
import { accountId, collectionsByGame, steamFolders } from './steam-data'

interface NodeFs { existsSync(path: string): boolean, readFileSync(path: string, encoding: 'utf8'): string }
interface NodeOs { homedir(): string, platform(): string }

/**
 * Your Steam collections by game, read from the Steam client's files on this computer: desktop
 * only (null on phones, or when the file isn't found). `folder` is the Steam folder from the
 * settings; when empty, the usual places are tried.
 */
export function readSteamCollections(steamId: string, folder: string): Map<number, string[]> | null {
  if (!Platform.isDesktopApp) return null
  const load = (window as unknown as { require?: (id: string) => unknown }).require
  const fs = load?.('fs') as NodeFs | undefined
  const os = load?.('os') as NodeOs | undefined
  if (!fs || !os) return null
  const folders = folder.trim() ? [folder.trim()] : steamFolders(os.platform(), os.homedir())
  const separator = os.platform() === 'win32' ? '\\' : '/'
  for (const steam of folders) {
    const path = [steam.replace(/[\\/]+$/, ''), 'userdata', accountId(steamId), 'config', 'cloudstorage', 'cloud-storage-namespace-1.json'].join(separator)
    try {
      if (!fs.existsSync(path)) continue
      return collectionsByGame(JSON.parse(fs.readFileSync(path, 'utf8')))
    } catch (err) {
      console.warn('Media import and sync: could not read Steam collections from', path, err)
    }
  }
  return null
}
