import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Clip, Platform, Settings, UploadRecord } from '../../shared/types'
import type { Library } from '../library'
import { YouTubeUploader } from './youtube'

export interface EnqueueOptions {
  scheduledAt?: Date
  title?: string
  description?: string
  tags?: string[]
  privacy?: 'private' | 'unlisted' | 'public'
}

/**
 * Upload queue + daily schedule.
 *  - `enqueue` puts a clip on a platform's queue for a given time (default: now) with optional metadata.
 *  - When `upload.schedule.enabled`, each configured time of day picks the next favorite/tagged
 *    clip that hasn't been uploaded yet and queues it, so a backlog of good clips drip-feeds out.
 */
export class UploadScheduler extends EventEmitter<{ log: [string]; change: []; done: [{ clip: Clip; upload: UploadRecord }] }> {
  private timer: NodeJS.Timeout | null = null
  private firedSlots = new Set<string>()
  private uploading = false

  /** Auto-uploads need a Clutch account; the plan decides how many times a day. */
  gate: () => { ok: boolean; slots: number } = () => ({ ok: true, slots: 99 })

  constructor(private library: Library, private getSettings: () => Settings, private dataDir: string) {
    super()
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 20_000)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Set by the main process: access tokens from the Clutch account (one-click YouTube). */
  youtubeAccountToken: (() => Promise<string>) | null = null

  youtube(): YouTubeUploader {
    const y = this.getSettings().upload.youtube
    const viaAccount = y.via === 'account' && this.youtubeAccountToken
    return new YouTubeUploader(this.dataDir, y.clientId, y.clientSecret, viaAccount ? this.youtubeAccountToken! : undefined)
  }

  /** Fill the title/description templates for a clip. */
  fill(template: string, clip: Clip): string {
    return template
      .replace(/\{game\}/g, clip.game)
      .replace(/\{title\}/g, clip.title)
      .replace(/\{event\}/g, clip.event ?? '')
      .replace(/\{date\}/g, new Date(clip.createdAt).toLocaleDateString())
      .trim()
  }

  enqueue(clipId: string, platform: Platform, opts: EnqueueOptions = {}): UploadRecord | undefined {
    const clip = this.library.get(clipId)
    if (!clip) return
    const scheduledAt = opts.scheduledAt ?? new Date()
    const rec: UploadRecord = {
      id: randomUUID(),
      platform,
      status: 'queued',
      scheduledAt: scheduledAt.toISOString(),
      progress: 0,
      title: opts.title,
      description: opts.description,
      tags: opts.tags,
      privacy: opts.privacy
    }
    this.library.update(clipId, { uploads: [...clip.uploads.filter((u) => !(u.platform === platform && u.status === 'queued')), rec] })
    this.emit('log', scheduledAt.getTime() - Date.now() > 60_000 ? `Scheduled "${clip.title}" for ${platform} at ${scheduledAt.toLocaleString()}` : `Queued "${clip.title}" for ${platform}`)
    this.emit('change')
    void this.tick()
    return rec
  }

  cancel(clipId: string, uploadId: string) {
    const clip = this.library.get(clipId)
    if (!clip) return
    this.library.update(clipId, { uploads: clip.uploads.filter((u) => u.id !== uploadId || u.status === 'done') })
    this.emit('change')
  }

  /** Everything queued/uploading/done, newest first. */
  list(): { clip: Clip; upload: UploadRecord }[] {
    return this.library
      .all()
      .flatMap((clip) => clip.uploads.map((upload) => ({ clip, upload })))
      .sort((a, b) => b.upload.scheduledAt.localeCompare(a.upload.scheduledAt))
  }

  private async tick() {
    this.fireSchedule()
    if (this.uploading) return
    const now = Date.now()
    const due = this.list()
      .filter(({ upload }) => upload.status === 'queued' && Date.parse(upload.scheduledAt) <= now)
      .sort((a, b) => a.upload.scheduledAt.localeCompare(b.upload.scheduledAt))[0]
    if (!due) return
    this.uploading = true
    try {
      await this.runUpload(due.clip, due.upload)
    } finally {
      this.uploading = false
    }
  }

  private setUpload(clip: Clip, rec: UploadRecord, patch: Partial<UploadRecord>) {
    const fresh = this.library.get(clip.id)
    if (!fresh) return
    Object.assign(rec, patch)
    this.library.update(clip.id, { uploads: fresh.uploads.map((u) => (u.id === rec.id ? { ...u, ...patch } : u)) })
    this.emit('change')
  }

  private async runUpload(clip: Clip, rec: UploadRecord) {
    const s = this.getSettings().upload
    this.setUpload(clip, rec, { status: 'uploading', progress: 0 })
    try {
      if (rec.platform !== 'youtube') throw new Error(`${rec.platform} uploads are not available yet (no public upload API)`)
      const yt = this.youtube()
      let lastEmit = 0
      const { url } = await yt.upload({
        file: clip.file,
        title: rec.title || this.fill(s.youtube.titleTemplate, clip),
        description: rec.description ?? this.fill(s.youtube.descriptionTemplate, clip),
        tags: rec.tags ?? s.youtube.tags,
        privacy: rec.privacy ?? s.youtube.privacy,
        onProgress: (f) => {
          if (Date.now() - lastEmit > 500) { lastEmit = Date.now(); this.setUpload(clip, rec, { progress: f }) }
        }
      })
      this.setUpload(clip, rec, { status: 'done', progress: 1, url })
      this.emit('log', `Uploaded "${clip.title}" to YouTube: ${url}`)
      this.emit('done', { clip, upload: rec })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.setUpload(clip, rec, { status: 'failed', error: msg })
      this.emit('log', `Upload failed for "${clip.title}": ${msg}`)
    }
  }

  /** At each configured HH:MM, queue the next eligible clip for every selected platform. */
  private fireSchedule() {
    const sch = this.getSettings().upload.schedule
    if (!sch.enabled) return
    const g = this.gate()
    if (!g.ok) return
    const times = [...sch.times].sort().slice(0, g.slots)
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const slotKey = `${now.toDateString()} ${hhmm}`
    if (!times.includes(hhmm) || this.firedSlots.has(slotKey)) return
    this.firedSlots.add(slotKey)
    for (const platform of sch.platforms) {
      const next = this.nextScheduled(platform)
      if (next) this.enqueue(next.id, platform, { scheduledAt: now })
      else this.emit('log', `Scheduled ${platform} upload at ${hhmm}: nothing left to upload`)
    }
  }

  /** The clip the schedule would pick next for a platform (shown in the UI as "up next"). */
  nextScheduled(platform: Platform): Clip | undefined {
    const sch = this.getSettings().upload.schedule
    return this.library
      .query({ favoritesOnly: sch.source === 'favorites', tag: sch.source === 'tag' ? sch.tag : undefined, sort: 'oldest' })
      .find((c) => !c.uploads.some((u) => u.platform === platform && u.status !== 'failed'))
  }
}
