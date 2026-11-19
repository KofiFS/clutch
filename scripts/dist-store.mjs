// Builds the Microsoft Store package (.msix) into release/.
//
//   npm run dist:store
//
// The Store signs the package itself, so no code-signing certificate is needed. The package
// identity comes from build/store-identity.json (copy it from Partner Center > Product identity
// after reserving the app name). Placeholder values still build, for checking the package, but the
// Store rejects an upload whose identity doesn't match the reservation.
//
// Differences from the installer version, handled in the app with process.windowsStore:
//   - no self-updating (the Store updates it), no "Start with Windows" (no Run key in MSIX)
//   - data lives in the package's own AppData (Windows virtualizes it), so it starts fresh
import fs from 'node:fs'
import { Arch, build, Platform } from 'electron-builder'

// Use the installed Windows SDK's makeappx: the 2019 copy electron-builder downloads is blocked by
// Windows on some PCs ("spawn UNKNOWN"). Set ELECTRON_BUILDER_WINDOWS_KITS_PATH to override.
if (!process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH) {
  const root = 'C:/Program Files (x86)/Windows Kits/10/bin'
  const versions = fs.existsSync(root) ? fs.readdirSync(root).filter((v) => /^10\./.test(v) && fs.existsSync(`${root}/${v}/x64/makeappx.exe`)).sort() : []
  if (versions.length) process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH = `${root}/${versions.at(-1)}/x64`
  else console.warn('[store] No Windows SDK found; install the Windows 10/11 SDK if packaging fails.')
}

const id = JSON.parse(fs.readFileSync(new URL('../build/store-identity.json', import.meta.url), 'utf8'))
const placeholder = /^CN=0{8}-/.test(id.publisher)
if (placeholder) console.warn('[store] build/store-identity.json still has placeholder values: this package is for local checks only.')

await build({
  targets: Platform.WINDOWS.createTarget(['appx'], Arch.x64),
  publish: 'never',
  config: {
    appx: {
      identityName: id.identityName,
      publisher: id.publisher,
      publisherDisplayName: id.publisherDisplayName,
      applicationId: 'Clutch',
      displayName: 'Clutch',
      backgroundColor: 'transparent',
      showNameOnTiles: false,
      languages: ['en-US'],
      addAutoLaunchExtension: false,
      // Window capture (Windows Graphics Capture) and process loopback audio need Windows 10 2004+.
      minVersion: '10.0.19041.0',
      maxVersionTested: '10.0.26100.0',
      artifactName: 'Clutch-Store-${version}.${ext}'
    }
  }
})
console.log(`[store] done: release/Clutch-Store-*.appx${placeholder ? ' (placeholder identity)' : ''}`)
