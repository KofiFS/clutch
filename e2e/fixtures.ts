import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const FFMPEG = path.join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')

export interface SeedClip { id: string; title: string; game: string; tags?: string[]; favorite?: boolean; daysAgo?: number; seconds?: number; trigger?: string }

export const SEED: SeedClip[] = [
  { id: 'clip-mc', title: 'Creeper blew up my house', game: 'Minecraft', tags: ['funny'], daysAgo: 0 },
  { id: 'clip-val', title: 'ACE on Haven', game: 'VALORANT', tags: ['clutch'], favorite: true, daysAgo: 2 },
  { id: 'clip-fn', title: 'Victory Royale', game: 'Fortnite', daysAgo: 1, trigger: 'voice' },
  { id: 'clip-long', title: 'Full session', game: 'Minecraft', daysAgo: 20, seconds: 4, trigger: 'long' }
]

/** A throwaway data folder with settings that keep a test copy quiet, plus a few real clips. */
export function makeWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clutch-e2e-'))
  const userData = path.join(dir, 'data')
  const clipsDir = path.join(dir, 'clips')
  const cloudDir = path.join(dir, 'MyCloud')
  for (const d of [userData, clipsDir, cloudDir, path.join(userData, 'thumbnails')]) fs.mkdirSync(d, { recursive: true })

  const clips = SEED.map((s) => {
    const gameDir = path.join(clipsDir, s.game)
    fs.mkdirSync(gameDir, { recursive: true })
    const file = path.join(gameDir, `${s.id}.mp4`)
    const thumb = path.join(userData, 'thumbnails', `${s.id}.jpg`)
    const sec = s.seconds ?? 2
    // A real, tiny H.264 clip with a tone, so playback and copying work like the real thing.
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', thumb])
    return {
      id: s.id, file, thumbnail: thumb, createdAt: new Date(Date.now() - (s.daysAgo ?? 0) * 86400_000).toISOString(),
      durationSec: sec, sizeBytes: fs.statSync(file).size, game: s.game, title: s.title, trigger: s.trigger ?? 'hotkey',
      tags: s.tags ?? [], favorite: !!s.favorite, width: 320, height: 180, fps: 30, uploads: []
    }
  })
  fs.writeFileSync(path.join(userData, 'clips.json'), JSON.stringify(clips, null, 2))
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { onboarded: true, autoStart: 'off', launchAtLogin: false, miniWidget: false, showAds: false, minimizeToTray: false, overlayToasts: false, startMinimized: false, trayHintShown: true },
    startBufferOnLaunch: false,
    capture: { outputDir: clipsDir },
    voiceCommands: { enabled: false },
    hype: { enabled: false },
    storage: { shrink: 'off', maxGB: 0 },
    cloud: { serverUrl: '' }
  }, null, 2))
  return { dir, userData, clipsDir, cloudDir, clips, cleanup: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}

export type World = ReturnType<typeof makeWorld>

/** Launch the built app against a world. The main window is the cf://app page (overlays are data: pages). */
export async function launch(world: World): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...env, CLUTCH_USER_DATA: world.userData, CLUTCH_TEST_NO_BROWSER: '1', CLIPFORGE_TEST_WEBHOOK_HOST: '' }
  })
  const isMain = (p: Page) => p.url().startsWith('cf://app/') && !p.url().includes('#mini')
  let page = app.windows().find(isMain)
  while (!page) page = await app.waitForEvent('window').then((p) => (isMain(p) ? p : undefined))
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => !!(window as unknown as { cf?: unknown }).cf)
  return { app, page, errors }
}

export const test = base.extend<{ world: World; clutch: { app: ElectronApplication; page: Page; errors: string[] } }>({
  world: async ({}, use) => {
    const w = makeWorld()
    await use(w)
    w.cleanup()
  },
  clutch: async ({ world }, use) => {
    const c = await launch(world)
    await use(c)
    await c.app.close().catch(() => undefined)
  }
})
export { expect } from '@playwright/test'

/** Click a sidebar page by its label. */
export async function goTo(page: Page, label: 'Home' | 'Clips' | 'What to clip' | 'Uploads' | 'Settings') {
  await page.getByRole('button', { name: label, exact: true }).first().click()
}
