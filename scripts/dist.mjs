// Builds the Windows installer. Signs it with Azure Artifact (Trusted) Signing when these are set:
//   AZURE_SIGN_ENDPOINT    e.g. https://eus.codesigning.azure.net/
//   AZURE_SIGN_ACCOUNT     your code signing account name
//   AZURE_SIGN_PROFILE     your certificate profile name
//   AZURE_SIGN_PUBLISHER   the publisher name on the certificate (your name or company)
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   an app registration allowed to sign
// Without them the installer is built unsigned (Windows SmartScreen will warn people).
//
//   node scripts/dist.mjs              build into release/
//   node scripts/dist.mjs --publish    build and publish a GitHub release (needs GH_TOKEN), which
//                                      is what the in-app auto-updater downloads from
import { build, Platform } from 'electron-builder'

const env = process.env
const publish = process.argv.includes('--publish') ? 'always' : 'never'
const sign = env.AZURE_SIGN_ENDPOINT && env.AZURE_SIGN_ACCOUNT && env.AZURE_SIGN_PROFILE && env.AZURE_SIGN_PUBLISHER

if (!sign) console.warn('[dist] Azure signing is not configured: building an UNSIGNED installer.')
if (sign && !(env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET)) {
  console.error('[dist] AZURE_SIGN_* is set but AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET are missing.')
  process.exit(1)
}

await build({
  targets: Platform.WINDOWS.createTarget(),
  publish,
  config: sign
    ? {
        win: {
          azureSignOptions: {
            endpoint: env.AZURE_SIGN_ENDPOINT,
            codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
            certificateProfileName: env.AZURE_SIGN_PROFILE,
            publisherName: env.AZURE_SIGN_PUBLISHER
          }
        }
      }
    : undefined
})
console.log(`[dist] done${sign ? ' (signed)' : ' (unsigned)'}${publish === 'always' ? ', published to GitHub Releases' : ''}`)
