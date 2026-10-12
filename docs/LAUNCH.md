# Launch checklist (owner tasks)

Everything below needs your accounts, money or decisions. The code for each is already in place;
this is what switches it on.

## 1. Code signing (removes the Windows "unsafe app" warning)

Plan: sign the downloadable installer for free through **SignPath Foundation**, and also list Clutch
in the **Microsoft Store** (free, never shows the warning). **Azure** is the paid fallback.

Any signed download still builds trust with Windows over the first weeks of downloads, so a few
early users may see the warning with any certificate. Store installs never do.

### 1a. SignPath Foundation: free signing for the installer

SignPath signs open-source projects for free. The catch is that Windows shows **"SignPath Foundation"**
as the publisher, not your name.

1. **Push the repo and publish one release first.** SignPath requires the project to be public and
   already released. An unsigned v0.1.0 release on GitHub is enough (see section 2).
2. **Add a code signing policy page.** SignPath requires one on the project's site or README, for
   example a "Code signing policy" section saying:
   - *Free code signing provided by SignPath.io, certificate by SignPath Foundation.*
   - Who can approve releases (you, as the maintainer).
   - That signed builds are made only by GitHub Actions from this repository.
   - A privacy line: Clutch only sends data to services the user turns on (cloud sharing, YouTube,
     AI features).
3. **Apply** at signpath.org (apply page). Name the project Clutch, give the repo URL, license
   GPL-3.0-or-later, and say builds come from GitHub Actions. Their rules exclude projects with
   *commercial dual-licensing*. Clutch is GPL-only (Pro is a hosted service, not a different
   license), so say that clearly in the application.
4. **When approved**, SignPath gives you an organization ID, a project slug and a signing policy.
   Create an API token in SignPath, add it as the GitHub secret `SIGNPATH_API_TOKEN`, and send me
   the organization ID and project slug. I'll add the signing step to the release workflow: the
   build uploads the unsigned installer, SignPath signs it, and the release publishes the signed
   file.
5. Approve each release's signing request in SignPath, if your policy asks for manual approval.

### 1b. Microsoft Store: free, and no warning at all

1. **Register** as an individual developer at storedeveloper.microsoft.com. It's free and uses
   ID verification (photo of your ID plus a selfie).
2. In **Partner Center**, create a new app and **reserve the name "Clutch"**. If it's taken, pick
   the Store name now (for example "Clutch Clips"); the app itself can stay Clutch.
3. Partner Center → the app → **Product identity**. Send me these three values: *Package/Identity/Name*,
   *Package/Identity/Publisher* (starts with `CN=`) and *Package/Properties/PublisherDisplayName*.
   I'll add a Store package (MSIX/AppX) build. The Store signs it, so no certificate is needed for this.
4. Before submitting, I'll test the Store build on your PC: global hotkeys, Start with Windows, game
   detection, per-app audio (Discord track) and window capture, since Store apps run with a few
   extra Windows rules.
5. Upload the package, fill in the listing (description, screenshots, privacy policy URL, age rating)
   and submit for certification. Updates go through the Store after that.

### 1c. Azure Artifact Signing (paid fallback, your own name as publisher)

Use this if SignPath says no, or if you want "Clutch" or your own name shown as the publisher.

1. Azure portal → create an **Artifact Signing** (Trusted Signing) account, Basic plan
   ($9.99/month), and complete **identity validation** (individual or business).
2. Create a **certificate profile** (Public Trust).
3. Create an **app registration** (Microsoft Entra ID), give it the
   *Artifact Signing Certificate Profile Signer* role on the account, and make a client secret.
4. Add these as GitHub repository secrets (and as environment variables to sign locally):
   `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER`,
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

`npm run dist` signs automatically once they're set and builds unsigned until then.

## 2. Releases and auto-update

1. Push the repo to `github.com/KofiFS/clutch` (switch the commit email to your GitHub
   noreply address first if you don't want your Gmail public).
2. Bump `version` in `package.json`, commit, then tag and push: `git tag v0.2.0 && git push --tags`.
   GitHub Actions builds, signs and publishes the release; installed copies update themselves.

## 3. Cloud server (share links, sign-in, Pro, AI features)

1. A small VPS (2 vCPU / 4 GB is plenty) with Node 22.13+, and a domain pointing at it with HTTPS.
2. `cd server && npm install`, copy `.env.example` to `.env`, set `PUBLIC_URL` and a long random
   `JWT_SECRET`.
3. Storage: a Cloudflare R2 bucket and API token → `STORAGE=s3` and the `S3_*` values.
4. Set `OFFICIAL_CLOUD_URL` in `src/shared/types.ts` to your server's URL so the app uses it.

## 4. Sign-in and YouTube

1. **Discord:** discord.com/developers → New Application → OAuth2 → add redirect
   `PUBLIC_URL/auth/discord/callback` → `DISCORD_CLIENT_ID/SECRET`.
2. **Twitch:** dev.twitch.tv/console → register an app, redirect `PUBLIC_URL/auth/twitch/callback`.
3. **Google (sign-in and one-click YouTube):** console.cloud.google.com → new project → enable
   **YouTube Data API v3** → OAuth consent screen → OAuth client ID (**Web application**) with redirects
   `PUBLIC_URL/auth/google/callback` and `PUBLIC_URL/auth/youtube/callback` → `GOOGLE_CLIENT_ID/SECRET`.
4. **Google verification** for the `youtube.upload` scope (needs a privacy policy URL, a short demo
   video and your domain). Until approved, only test users you list can connect.
5. **YouTube quota increase:** the default 10,000 units a day is about 6 uploads a day for *all*
   users together. Apply for more through Google's YouTube API audit form once you have users.

## 5. Payments (Clutch Pro)

Stripe account → product "Clutch Pro" with a monthly (and optionally yearly) price → webhook to
`PUBLIC_URL/webhooks/stripe` → `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.

## 6. AI features through accounts (optional)

An Anthropic API key in the server's `ANTHROPIC_API_KEY` turns on smart read (settings import) and
screen watching for signed-in users without their own key. Limits are in `server/src/plans.mjs`
(screen checks: 60/day Free, 800/day Pro; smart reads: 3/day Free, 25/day Pro). Watch the usage
dashboard for the first weeks and adjust.

## 7. Before announcing

- Privacy policy and terms (needed by Google and Stripe anyway).
- Check the name "Clutch" for conflicts in your country (trademark search).
- Beta testers with AMD and Intel GPUs, and on a 1080p RTX 3060 / RX 6600 class PC. Ask them to run
  `node scripts/benchmark.mjs 60` while playing and send the JSON it saves.
