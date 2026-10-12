# Clutch cloud server

The small backend behind Clutch's optional cloud features. The desktop app works fully without it;
you only need it for **sign-in, share links, cloud storage, auto-upload accounts, Clutch Pro and
the sponsored-card feed**.

No npm dependencies: plain Node (22.13 or newer) with the built-in `http`, `sqlite` and `crypto`.

```bash
cd server
cp .env.example .env    # then fill it in
npm start
```

## What it does

| Endpoint | Purpose |
|---|---|
| `GET /auth/providers` | Which sign-in buttons the app should show |
| `GET /auth/:provider/start?redirect=…` | Starts Discord / Google (YouTube) / Twitch sign-in. Only `http://127.0.0.1:<port>` redirects are accepted, so tokens only ever go back to the app on the same PC |
| `GET /api/me` | Account, plan, features, cloud usage |
| `POST /api/clips` → upload → `POST /api/clips/:id/complete` | Cloud upload with quota and per-clip size checks |
| `GET /s/:id` | Public watch page with Open Graph video tags, so links play inline in Discord |
| `POST /api/billing/checkout`, `/api/billing/portal`, `/webhooks/stripe` | Clutch Pro via Stripe |
| `GET /api/ads?placement=home` | Sponsored cards from `ads.json` (no tracking, aggregate impression/click counts only) |

Plans and limits live in `src/plans.mjs`. Free share links expire after 30 days; an hourly job
deletes expired links and abandoned uploads.

## Setting up sign-in

Create an OAuth app for each provider you want and set its redirect URL to
`PUBLIC_URL/auth/<provider>/callback`:

- **Discord** – discord.com/developers/applications → OAuth2. Scopes: `identify email`.
- **Google / YouTube** – console.cloud.google.com → Credentials → OAuth client (Web application).
  Scopes: `openid email profile`. (YouTube uploads are a separate, per-user connection in the app.)
- **Twitch** – dev.twitch.tv/console → Register application.

Put the client id and secret in `.env`. `DEV_LOGIN=1` adds a type-your-name test login; never enable
it on a public server.

## Storage

- `STORAGE=local` keeps files in `DATA_DIR/files`. Fine for testing or a small VPS.
- `STORAGE=s3` works with any S3-compatible bucket. **Cloudflare R2 is recommended** because it
  charges nothing for downloads, which is most of a share link's cost. The server only hands out
  short-lived presigned URLs; video bytes go straight between the app/viewer and the bucket.
  The S3 driver is implemented with SigV4 presigning but has not yet been run against a live bucket.

## Subscriptions

1. Create a product "Clutch Pro" with a recurring price in Stripe; put its price id in `STRIPE_PRICE_ID`.
2. Add a webhook endpoint `PUBLIC_URL/webhooks/stripe` for `checkout.session.completed`,
   `customer.subscription.updated` and `customer.subscription.deleted`; put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
3. Enable the Billing Portal in Stripe so "Manage subscription" works.

## Deploying

Any host that runs Node 22 works (a small VPS, Fly.io, Railway, Render). Put it behind HTTPS, set
`PUBLIC_URL` to the public address, set a long random `JWT_SECRET`, and keep `DATA_DIR` on a
persistent disk (it holds the SQLite database). Then set `OFFICIAL_CLOUD_URL` in
`src/shared/types.ts` of the desktop app to that address before building the installer.

## Smart read (settings import)

`POST /api/import/read` reads screenshots of another recorder's settings with Claude for signed-in
users (the app tries Windows' offline text recognition first and only offers this when that comes up
short). Set `ANTHROPIC_API_KEY` to turn it on; `SMART_READ_MODEL` picks the model. Limits come from
`smartReadsPerDay` in `src/plans.mjs` (3 on Free, 25 on Pro). This feature adds the server's only
dependencies (`@anthropic-ai/sdk`, `zod`), so run `npm install` in `server/` before starting it.
