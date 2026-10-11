import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Clip, Platform, Settings, UploadRecord } from '../../shared/types'
import type { Library } from '../library'
import { YouTubeUploader } from './youtube'

/**
 * Upload queue + daily schedule.
 *  - `enqueue` puts a clip on a platform's queue for a given time (default: now).
 *  - When `upload.schedule.enabled`, each configured time of day picks the next favorite/tagged
 *    clip that hasn't been uploaded yet and queues it, so a backlog of good clips drip-feeds out.
 */
export class UploadScheduler extends EventEmitter<{ log: [string]; change: [] }> {
  private timer: NodeJS.Timeout | null = null
  private firedSlots = new Set<string>()
  private uploading = false

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

  youtube(): YouTubeUploader {
    const y = this.getSettings().upload.youtube
    return new YouTubeUploader(this.dataDir, y.clientId, y.clientSecret)
  }

  enqueue(clipId: string, platform: Platform, scheduledAt = new Date()): UploadRecord | undefined {
    const clip = this.library.get(clipId)
    if (!clip) return
    const rec: UploadRecord = { id: randomUUID(), platform, status: 'queued', scheduledAt: scheduledAt.toISOString(), progress: 0 }
    this.library.update(clipId, { uploads: [...clip.uploads.filter((u) => !(u.platform === platform && u.status === 'queued')), rec] })
    this.emit('log', `Queued "${clip.title}" for ${platform} at ${scheduledAt.toLocaleString()}`)
    this.emit('change')
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
      const fill = (t: string) => t.replace('{game}', clip.game).replace('{title}', clip.title).replace('{event}', clip.event ?? '').replace('{date}', new Date(clip.createdAt).toLocaleDateString())
      let lastEmit = 0
      const { url } = await yt.upload({
        file: clip.file,
        title: fill(s.youtube.titleTemplate),
        description: fill(s.youtube.descriptionTemplate),
        tags: s.youtube.tags,
        privacy: s.youtube.privacy,
        onProgress: (f) => {
          if (Date.now() - lastEmit > 500) { lastEmit = Date.now(); this.setUpload(clip, rec, { progress: f }) }
        }
      })
      this.setUpload(clip, rec, { status: 'done', progress: 1, url })
      this.emit('log', `Uploaded "${clip.title}" to YouTube: ${url}`)
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
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const slotKey = `${now.toDateString()} ${hhmm}`
    if (!sch.times.includes(hhmm) || this.firedSlots.has(slotKey)) return
    this.firedSlots.add(slotKey)
    for (const platform of sch.platforms) {
      const next = this.library
        .query({ favoritesOnly: sch.source === 'favorites', tag: sch.source === 'tag' ? sch.tag : undefined, sort: 'oldest' })
        .find((c) => !c.uploads.some((u) => u.platform === platform && u.status !== 'failed'))
      if (next) this.enqueue(next.id, platform, now)
      else this.emit('log', `Scheduled ${platform} upload at ${hhmm}: nothing left to upload`)
    }
  }
}
