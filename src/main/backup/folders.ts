import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CloudFolder } from '../../shared/types'

/**
 * Finds the folders that cloud apps already sync on this PC (Google Drive for desktop, OneDrive,
 * Dropbox, iCloud). Clutch copies clips into one of them and the cloud app uploads them to the
 * user's own account. Clutch never signs in anywhere and never sees the account.
 */
export function detectCloudFolders(): CloudFolder[] {
  const home = os.homedir()
  const out: CloudFolder[] = []
  const seen = new Set<string>()
  const add = (provider: CloudFolder['provider'], label: string, dir: string | undefined) => {
    if (!dir) return
    const key = path.resolve(dir).toLowerCase()
    if (seen.has(key) || !isDir(dir)) return
    seen.add(key)
    out.push({ provider, label, path: path.resolve(dir) })
  }

  // Google Drive for desktop: a virtual drive (G: by default) with "My Drive", or a mirrored folder.
  for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') add('google', 'Google Drive', `${letter}:\\My Drive`)
  add('google', 'Google Drive', path.join(home, 'My Drive'))
  add('google', 'Google Drive', path.join(home, 'Google Drive'))

  // OneDrive sets these for the signed-in personal and work accounts.
  add('onedrive', 'OneDrive', process.env.OneDriveConsumer)
  add('onedrive', 'OneDrive (work or school)', process.env.OneDriveCommercial)
  add('onedrive', 'OneDrive', process.env.OneDrive)

  // Dropbox writes its folder locations to info.json.
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!base) continue
    try {
      const info = JSON.parse(fs.readFileSync(path.join(base, 'Dropbox', 'info.json'), 'utf8')) as Record<string, { path?: string }>
      add('dropbox', 'Dropbox', info.personal?.path)
      add('dropbox', 'Dropbox (business)', info.business?.path)
    } catch { /* not installed */ }
  }
  add('dropbox', 'Dropbox', path.join(home, 'Dropbox'))

  add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'))
  return out
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/** Where each provider's desktop app comes from, for the "not installed" hint. */
export const CLOUD_APPS: Record<Exclude<CloudFolder['provider'], 'folder'>, { name: string; url: string }> = {
  google: { name: 'Google Drive for desktop', url: 'https://www.google.com/drive/download/' },
  onedrive: { name: 'OneDrive', url: 'https://www.microsoft.com/microsoft-365/onedrive/download' },
  dropbox: { name: 'Dropbox', url: 'https://www.dropbox.com/install' },
  icloud: { name: 'iCloud for Windows', url: 'https://apps.microsoft.com/detail/9pktq5699m62' }
}
