import fs from 'node:fs'
import path from 'node:path'

/** Minimal .env loader (KEY=value lines). */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnv(path.resolve(process.cwd(), '.env'))

const env = (k, d = '') => process.env[k] ?? d

export const config = {
  port: Number(env('PORT', '8787')),
  publicUrl: env('PUBLIC_URL', 'http://127.0.0.1:8787').replace(/\/$/, ''),
  jwtSecret: env('JWT_SECRET', ''),
  devLogin: env('DEV_LOGIN', '0') === '1',
  dataDir: path.resolve(env('DATA_DIR', './data')),
  storage: env('STORAGE', 'local'),
  s3: {
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'auto'),
    bucket: env('S3_BUCKET'),
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY')
  },
  providers: {
    discord: { id: env('DISCORD_CLIENT_ID'), secret: env('DISCORD_CLIENT_SECRET') },
    google: { id: env('GOOGLE_CLIENT_ID'), secret: env('GOOGLE_CLIENT_SECRET') },
    twitch: { id: env('TWITCH_CLIENT_ID'), secret: env('TWITCH_CLIENT_SECRET') }
  },
  stripe: { secretKey: env('STRIPE_SECRET_KEY'), priceId: env('STRIPE_PRICE_ID'), webhookSecret: env('STRIPE_WEBHOOK_SECRET') },
  // Optional: smart read of settings screenshots for people importing from Medal/OBS/NVIDIA.
  anthropicKey: env('ANTHROPIC_API_KEY'),
  smartReadModel: env('SMART_READ_MODEL', 'claude-opus-5-5'),
  // Screen watching runs often, so it uses a small, cheap model.
  visionModel: env('VISION_MODEL', 'claude-haiku-5-5')
}

if (!config.jwtSecret || config.jwtSecret.startsWith('change-me')) {
  if (!config.devLogin) {
    console.error('Set JWT_SECRET to a long random string (see .env.example).')
    process.exit(1)
  }
  config.jwtSecret = config.jwtSecret || 'dev-only-secret-' + Math.random().toString(36).slice(2)
  console.warn('[clutch-cloud] Using a temporary JWT secret (DEV_LOGIN=1). Tokens will not survive a restart.')
}
fs.mkdirSync(config.dataDir, { recursive: true })
