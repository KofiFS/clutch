import fs from 'node:fs'
import path from 'node:path'
import { expect, goTo, test } from './fixtures'

type CF = Window & { cf: any }

test.describe('app shell', () => {
  test('starts, shows every page, and logs no errors', async ({ clutch }) => {
    const { page, errors } = clutch
    await expect(page).toHaveTitle(/Clutch/)
    for (const label of ['Home', 'Clips', 'What to clip', 'Uploads', 'Settings'] as const) {
      await goTo(page, label)
      await page.waitForTimeout(300)
    }
    await goTo(page, 'Settings')
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    expect(errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e))).toEqual([])
  })

  test('the window is sandboxed: no Node.js in the page', async ({ clutch }) => {
    const r = await clutch.page.evaluate(() => ({ process: typeof (window as any).process, require: typeof (window as any).require, cf: typeof (window as any).cf }))
    expect(r).toEqual({ process: 'undefined', require: 'undefined', cf: 'object' })
  })
})

test.describe('library', () => {
  test('lists the clips and plays one', async ({ clutch }) => {
    const { page } = clutch
    await goTo(page, 'Clips')
    await expect(page.getByText('Creeper blew up my house')).toBeVisible()
    await expect(page.getByText('ACE on Haven')).toBeVisible()
    await page.getByRole('button', { name: 'Open Creeper blew up my house' }).click()
    const video = page.locator('video').first()
    await expect(video).toBeVisible()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  })

  test('search ignores case, forgives typos and understands plain English', async ({ clutch }) => {
    const { page } = clutch
    await goTo(page, 'Clips')
    const box = page.getByPlaceholder(/Search/)
    const titles = async () => (await page.evaluate(async (q) => (await (window as CF).cf.library.query({ text: q, sort: 'relevance' })).map((c: { title: string }) => c.title), await box.inputValue())) as string[]

    await box.fill('MINECRAF')
    await expect(page.getByText('Creeper blew up my house')).toBeVisible()
    await expect(page.getByText('ACE on Haven')).toHaveCount(0)
    expect(await titles()).toContain('Creeper blew up my house')

    await box.fill('valroant')
    await expect(page.getByText('ACE on Haven')).toBeVisible()

    await box.fill('favorites')
    expect(await titles()).toEqual(['ACE on Haven'])

    await box.fill('minecraft today')
    expect(await titles()).toEqual(['Creeper blew up my house'])

    await box.fill('win')
    expect(await titles()).toContain('Victory Royale')
  })

  test('renaming and favoriting a clip sticks', async ({ clutch, world }) => {
    const { page } = clutch
    const updated = await page.evaluate(() => (window as CF).cf.library.update('clip-fn', { title: 'Renamed win', favorite: true }))
    expect(updated.title).toBe('Renamed win')
    expect(updated.favorite).toBe(true)
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(world.userData, 'clips.json'), 'utf8')).find((c: { id: string }) => c.id === 'clip-fn').title).toBe('Renamed win')
  })
})

test.describe('security', () => {
  test('the UI cannot point a clip at another file', async ({ clutch, world }) => {
    const before = world.clips.find((c) => c.id === 'clip-mc')!.file
    const r = await clutch.page.evaluate(() => (window as CF).cf.library.update('clip-mc', { file: 'C:\\Windows\\win.ini', thumbnail: 'C:\\Windows\\win.ini', title: 'ok' }))
    expect(r.file).toBe(before)
    expect(r.title).toBe('ok')
  })

  test('links only open in the browser when they are web links', async ({ clutch }) => {
    const r = await clutch.page.evaluate(async () => ({
      file: await (window as CF).cf.system.openExternal('file:///C:/Windows/System32/calc.exe'),
      msSettings: await (window as CF).cf.system.openExternal('ms-settings:privacy'),
      search: await (window as CF).cf.system.openExternal('search-ms:query=secret'),
      junk: await (window as CF).cf.system.openExternal('not a url')
    }))
    expect(r).toEqual({ file: false, msSettings: false, search: false, junk: false })
  })

  test('cf:// serves clips but never settings, tokens or logs', async ({ clutch, world }) => {
    const enc = (p: string) => 'cf://file/' + encodeURIComponent(p)
    const clip = world.clips[0].file
    // Asks the cf:// handler directly (the page itself can't read cf://file with fetch at all since
    // Electron 42; it only plays clips in <video> and <img>). A blocked request answers 403 or fails.
    const res = await clutch.app.evaluate(async ({ session }, urls) => Promise.all(urls.map(async (u) => { try { return (await session.defaultSession.fetch(u)).status } catch { return 'failed' } })), [
      enc(clip),
      enc(path.join(world.userData, 'settings.json')),
      enc(path.join(world.userData, 'clips.json')),
      enc('C:\\Windows\\win.ini'),
      'cf://app/../../package.json'
    ])
    expect(res[0]).toBe(200)
    expect(res.slice(1, 4)).toEqual([403, 403, 403])
    expect(res[4]).not.toBe(200)
    // Script in the page can't read the bytes of a clip either (CVE-2026-70604).
    const pageRead = await clutch.page.evaluate(async (u) => { try { return (await fetch(u)).status } catch { return 'blocked' } }, enc(clip))
    expect(pageRead).toBe('blocked')
  })

  test('secrets are encrypted on disk, not in settings.json', async ({ clutch, world }) => {
    const hook = 'https://discord.com/api/webhooks/123456/abcDEF-secret'
    await clutch.page.evaluate(async (h) => {
      const s = await (window as CF).cf.settings.get()
      await (window as CF).cf.settings.set({ discord: { ...s.discord, webhookUrl: h }, ai: { ...s.ai, anthropicApiKey: 'sk-ant-test-not-real' } })
    }, hook)
    const raw = fs.readFileSync(path.join(world.userData, 'settings.json'), 'utf8')
    expect(raw).not.toContain('abcDEF-secret')
    expect(raw).not.toContain('sk-ant-test-not-real')
    const bin = fs.readFileSync(path.join(world.userData, 'secrets.bin'))
    expect(bin.toString('latin1')).not.toContain('abcDEF-secret')
    // ...and the app still has them.
    const back = await clutch.page.evaluate(() => (window as CF).cf.settings.get())
    expect(back.discord.webhookUrl).toBe(hook)
  })

  test('settings from the UI cannot plant a command, a program to open or a foreign server', async ({ clutch }) => {
    const r = await clutch.page.evaluate(async () => {
      const cf = (window as CF).cf
      const s = await cf.settings.get()
      const app = (id: string, process: string) => ({ id, kind: 'app' as const, process, name: id, enabled: true, volume: 1, ownTrack: true })
      await cf.settings.set({
        capture: { ...s.capture, outputDir: 'C:\\Windows\\System32\\calc.exe', audioSources: [...s.capture.audioSources, app('evil', '$(Start-Process calc.exe)'), app('ok', 'Discord')] },
        libraries: [{ id: 'evil', name: 'x', path: 'C:\\Windows\\System32\\calc.exe', kind: 'folder', addedAt: '' }],
        cloud: { ...s.cloud, serverUrl: 'http://attacker.example' }
      } as never)
      const after = await cf.settings.get()
      return {
        outputDirKept: after.capture.outputDir === s.capture.outputDir,
        evil: after.capture.audioSources.find((a) => a.id === 'evil'),
        ok: after.capture.audioSources.find((a) => a.id === 'ok')?.process,
        librariesKept: JSON.stringify(after.libraries) === JSON.stringify(s.libraries),
        serverKept: after.cloud.serverUrl === s.cloud.serverUrl
      }
    })
    expect(r.outputDirKept).toBe(true)
    expect(r.evil?.process).toBeUndefined()
    expect(r.evil?.enabled).toBe(false)
    expect(r.ok).toBe('Discord')
    expect(r.librariesKept).toBe(true)
    expect(r.serverKept).toBe(true)
  })

  test('the window cannot be navigated away from Clutch', async ({ clutch }) => {
    const { page } = clutch
    const before = page.url()
    await page.evaluate(() => { window.location.href = 'https://example.com/' })
    await page.waitForTimeout(800)
    expect(page.url()).toBe(before)
  })
})

test.describe('your cloud', () => {
  test('copies a clip into the chosen cloud folder and never overwrites', async ({ clutch, world }) => {
    const { page } = clutch
    await page.evaluate((folder) => (window as CF).cf.ownCloud.set({ folder, provider: 'folder', enabled: false, mode: 'manual' }), world.cloudDir)
    const n = await page.evaluate(() => (window as CF).cf.ownCloud.save(['clip-mc']))
    expect(n).toBe(1)
    const dest = path.join(world.cloudDir, 'Clutch', 'Minecraft', 'clip-mc.mp4')
    await expect.poll(() => fs.existsSync(dest), { timeout: 20_000 }).toBe(true)
    expect(fs.statSync(dest).size).toBe(fs.statSync(world.clips[0].file).size)
    expect(fs.existsSync(world.clips[0].file)).toBe(true) // original kept
    expect(await page.evaluate(() => (window as CF).cf.ownCloud.savedFor('clip-mc'))).toBe(dest)
    // Saving again does nothing (already there).
    expect(await page.evaluate(() => (window as CF).cf.ownCloud.save(['clip-mc']))).toBe(0)
  })

  test('favorites mode copies favorites automatically, skipping full-length recordings', async ({ clutch, world }) => {
    const { page } = clutch
    await page.evaluate((folder) => (window as CF).cf.ownCloud.set({ folder, provider: 'folder', enabled: true, mode: 'favorites' }), world.cloudDir)
    await page.evaluate(() => (window as CF).cf.library.update('clip-long', { favorite: true }))
    const fav = path.join(world.cloudDir, 'Clutch', 'VALORANT', 'clip-val.mp4')
    await expect.poll(() => fs.existsSync(fav), { timeout: 30_000 }).toBe(true)
    expect(fs.existsSync(path.join(world.cloudDir, 'Clutch', 'Minecraft', 'clip-long.mp4'))).toBe(false)
  })

  test('the Settings page offers it', async ({ clutch }) => {
    const { page } = clutch
    await goTo(page, 'Settings')
    await expect(page.getByText('Your cloud', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Another folder/ })).toBeVisible()
  })

  test('the clip share panel offers "Save to my cloud"', async ({ clutch }) => {
    const { page } = clutch
    await goTo(page, 'Clips')
    await page.getByRole('button', { name: 'Open ACE on Haven' }).click()
    await page.getByRole('button', { name: /^share$/i }).click()
    await expect(page.getByRole('button', { name: /Save to my cloud/ })).toBeVisible()
  })
})
