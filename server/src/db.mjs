import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { config } from './config.mjs'

/** SQLite via Node's built-in driver: one file, no native modules to build. */
export const db = new DatabaseSync(path.join(config.dataDir, 'clutch.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    email TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_until INTEGER,
    stripe_customer TEXT,
    stripe_subscription TEXT,
    created INTEGER NOT NULL,
    UNIQUE (provider, provider_id)
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    share_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    game TEXT,
    duration REAL,
    width INTEGER,
    height INTEGER,
    size INTEGER NOT NULL DEFAULT 0,
    video_key TEXT NOT NULL,
    thumb_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created INTEGER NOT NULL,
    expires INTEGER,
    views INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS clips_user ON clips(user_id);
  CREATE TABLE IF NOT EXISTS ad_stats (ad_id TEXT PRIMARY KEY, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0);
`)

export const users = {
  get: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  byCustomer: (cus) => db.prepare('SELECT * FROM users WHERE stripe_customer = ?').get(cus),
  upsert({ provider, providerId, name, avatar, email }) {
    const existing = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId)
    if (existing) {
      db.prepare('UPDATE users SET name = ?, avatar = ?, email = COALESCE(?, email) WHERE id = ?').run(name, avatar ?? null, email ?? null, existing.id)
      return users.get(existing.id)
    }
    const id = randomUUID()
    db.prepare('INSERT INTO users (id, provider, provider_id, name, avatar, email, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, provider, providerId, name, avatar ?? null, email ?? null, Date.now())
    return users.get(id)
  },
  setPlan(id, plan, extra = {}) {
    db.prepare('UPDATE users SET plan = ?, plan_until = ?, stripe_customer = COALESCE(?, stripe_customer), stripe_subscription = COALESCE(?, stripe_subscription) WHERE id = ?')
      .run(plan, extra.until ?? null, extra.customer ?? null, extra.subscription ?? null, id)
  }
}

export const clips = {
  get: (id) => db.prepare('SELECT * FROM clips WHERE id = ?').get(id),
  byShare: (shareId) => db.prepare("SELECT c.*, u.name AS user_name, u.avatar AS user_avatar FROM clips c JOIN users u ON u.id = c.user_id WHERE c.share_id = ? AND c.status = 'ready'").get(shareId),
  list: (userId) => db.prepare("SELECT * FROM clips WHERE user_id = ? AND status = 'ready' ORDER BY created DESC").all(userId),
  usedBytes: (userId) => db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM clips WHERE user_id = ? AND status != 'deleted'").get(userId).n,
  create(row) {
    db.prepare('INSERT INTO clips (id, user_id, share_id, title, game, duration, width, height, size, video_key, thumb_key, status, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.userId, row.shareId, row.title, row.game ?? null, row.duration ?? null, row.width ?? null, row.height ?? null, row.size, row.videoKey, row.thumbKey ?? null, 'pending', Date.now(), row.expires ?? null)
    return clips.get(row.id)
  },
  ready: (id, size) => db.prepare("UPDATE clips SET status = 'ready', size = ? WHERE id = ?").run(size, id),
  remove: (id) => db.prepare("UPDATE clips SET status = 'deleted' WHERE id = ?").run(id),
  view: (id) => db.prepare('UPDATE clips SET views = views + 1 WHERE id = ?').run(id),
  expired: () => db.prepare("SELECT * FROM clips WHERE status != 'deleted' AND expires IS NOT NULL AND expires < ?").all(Date.now()),
  /** Upload tickets that were never completed (e.g. the app closed mid-upload). */
  stalePending: () => db.prepare("SELECT * FROM clips WHERE status = 'pending' AND created < ?").all(Date.now() - 6 * 3600_000)
}

export const adStats = {
  bump(adId, field) {
    db.prepare('INSERT INTO ad_stats (ad_id) VALUES (?) ON CONFLICT(ad_id) DO NOTHING').run(adId)
    db.prepare(`UPDATE ad_stats SET ${field === 'click' ? 'clicks = clicks + 1' : 'impressions = impressions + 1'} WHERE ad_id = ?`).run(adId)
  }
}
