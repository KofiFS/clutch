import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityEvent, BufferStatus, Clip, GameInfo, GameSummary, HealthItem, MonitorInfo, Platform, RunningApp, Settings, UploadRecord } from '../shared/types'

export interface LibraryQuery {
  text?: string
  game?: string
  trigger?: string
  favoritesOnly?: boolean
  tag?: string
  sort?: 'newest' | 'oldest' | 'longest' | 'largest'
  trashed?: boolean
}

export interface EnqueueOpts {
  scheduledAt?: string
  title?: string
  description?: string
  tags?: string[]
  privacy?: 'private' | 'unlisted' | 'public'
}

type Channel = 'status' | 'activity' | 'library-changed' | 'uploads-changed' | 'clip-saved' | 'game' | 'upload-done' | 'clip-of-the-day' | 'open-clip' | 'settings-changed' | 'navigate' | 'levels'

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder')
  },
  system: {
    audioDevices: (): Promise<string[]> => ipcRenderer.invoke('system:audioDevices'),
    encoders: (): Promise<{ available: string[]; best: string }> => ipcRenderer.invoke('system:encoders'),
    runningApps: (): Promise<RunningApp[]> => ipcRenderer.invoke('system:runningApps'),
    openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),
    health: (): Promise<HealthItem[]> => ipcRenderer.invoke('system:health'),
    testHotkey: (accel: string): Promise<boolean> => ipcRenderer.invoke('system:testHotkey', accel),
    testOverlay: () => ipcRenderer.invoke('system:testOverlay'),
    canAcrylic: (): Promise<boolean> => ipcRenderer.invoke('system:canAcrylic'),
    canLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke('system:canLaunchAtLogin')
  },
  capture: {
    monitors: (): Promise<MonitorInfo[]> => ipcRenderer.invoke('capture:monitors'),
    pickRegion: (monitorIndex: number): Promise<{ x: number; y: number; w: number; h: number } | null> => ipcRenderer.invoke('capture:pickRegion', monitorIndex),
    restart: (): Promise<void> => ipcRenderer.invoke('capture:restart')
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    hide: () => ipcRenderer.invoke('window:hide')
  },
  buffer: {
    start: (): Promise<void> => ipcRenderer.invoke('buffer:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('buffer:stop'),
    status: (): Promise<BufferStatus> => ipcRenderer.invoke('buffer:status'),
    clipNow: (): Promise<Clip | undefined> => ipcRenderer.invoke('clip:now'),
    toggleLong: (): Promise<unknown> => ipcRenderer.invoke('long:toggle'),
    bookmark: (): Promise<void> => ipcRenderer.invoke('bookmark:add')
  },
  activity: { list: (): Promise<ActivityEvent[]> => ipcRenderer.invoke('activity:list') },
  audio: { push: (pcm: ArrayBuffer, levelDb: number) => ipcRenderer.send('audio:push', pcm, levelDb) },
  library: {
    query: (q: LibraryQuery): Promise<Clip[]> => ipcRenderer.invoke('library:query', q),
    get: (id: string): Promise<Clip | undefined> => ipcRenderer.invoke('library:get', id),
    games: (): Promise<GameSummary[]> => ipcRenderer.invoke('library:games'),
    tags: (): Promise<string[]> => ipcRenderer.invoke('library:tags'),
    stats: (): Promise<{ count: number; bytes: number; seconds: number; trashed: number }> => ipcRenderer.invoke('library:stats'),
    update: (id: string, patch: Partial<Clip>): Promise<Clip | undefined> => ipcRenderer.invoke('library:update', id, patch),
    bulk: (ids: string[], patch: { favorite?: boolean; addTags?: string[] }): Promise<void> => ipcRenderer.invoke('library:bulk', ids, patch),
    trash: (ids: string[]): Promise<boolean> => ipcRenderer.invoke('library:trash', ids),
    restore: (ids: string[]): Promise<void> => ipcRenderer.invoke('library:restore', ids),
    remove: (ids: string[]): Promise<void> => ipcRenderer.invoke('library:remove', ids),
    emptyTrash: (): Promise<void> => ipcRenderer.invoke('library:emptyTrash'),
    reveal: (file: string) => ipcRenderer.invoke('library:reveal', file),
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    trim: (id: string, startSec: number, endSec: number, mode: 'new' | 'replace'): Promise<Clip | null> => ipcRenderer.invoke('library:trim', id, startSec, endSec, mode),
    viewed: (id: string): Promise<void> => ipcRenderer.invoke('library:viewed', id)
  },
  highlights: {
    today: (): Promise<{ clip: Clip; score: number } | null> => ipcRenderer.invoke('highlights:today')
  },
  discord: {
    check: (url: string): Promise<{ name: string; channelId: string; guildId?: string }> => ipcRenderer.invoke('discord:check', url),
    post: (clipId: string, opts: { heading?: string; note?: string } = {}): Promise<{ transcoded: boolean }> => ipcRenderer.invoke('discord:post', clipId, opts),
    postToday: (): Promise<Clip> => ipcRenderer.invoke('discord:postToday')
  },
  youtube: {
    connect: (): Promise<{ channelTitle: string }> => ipcRenderer.invoke('youtube:connect'),
    disconnect: (): Promise<void> => ipcRenderer.invoke('youtube:disconnect')
  },
  upload: {
    enqueue: (clipId: string, platform: Platform, opts?: EnqueueOpts): Promise<UploadRecord | undefined> => ipcRenderer.invoke('upload:enqueue', clipId, platform, opts ?? {}),
    cancel: (clipId: string, uploadId: string): Promise<void> => ipcRenderer.invoke('upload:cancel', clipId, uploadId),
    list: (): Promise<{ clip: Clip; upload: UploadRecord }[]> => ipcRenderer.invoke('upload:list'),
    next: (platform: Platform): Promise<Clip | undefined> => ipcRenderer.invoke('upload:next', platform),
    preview: (clipId: string): Promise<{ title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public' } | null> => ipcRenderer.invoke('upload:preview', clipId)
  },
  on: (channel: Channel, fn: (payload: never) => void) => {
    const handler = (_e: unknown, payload: unknown) => fn(payload as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

export type ClipForgeApi = typeof api
contextBridge.exposeInMainWorld('cf', api)
