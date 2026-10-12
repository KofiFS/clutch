# Launch checklist (owner tasks)

Everything below needs your accounts, money or decisions. The code for each is already in place;
this is what switches it on.

## 1. Code signing (removes the Windows "unsafe app" warning)

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
