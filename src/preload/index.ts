import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityEvent, BufferStatus, Clip, Platform, Settings, UploadRecord } from '../shared/types'

export interface LibraryQuery {
  text?: string
  game?: string
  trigger?: string
  favoritesOnly?: boolean
  tag?: string
  sort?: 'newest' | 'oldest' | 'longest' | 'largest'
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pickFolder')
  },
  system: {
    audioDevices: (): Promise<string[]> => ipcRenderer.invoke('system:audioDevices'),
    encoders: (): Promise<{ available: string[]; best: string }> => ipcRenderer.invoke('system:encoders'),
    openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url)
  },
  buffer: {
    start: (): Promise<void> => ipcRenderer.invoke('buffer:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('buffer:stop'),
    status: (): Promise<BufferStatus> => ipcRenderer.invoke('buffer:status'),
    clipNow: (): Promise<Clip | undefined> => ipcRenderer.invoke('clip:now')
  },
  activity: { list: (): Promise<ActivityEvent[]> => ipcRenderer.invoke('activity:list') },
  audio: { push: (pcm: ArrayBuffer, levelDb: number) => ipcRenderer.send('audio:push', pcm, levelDb) },
  library: {
    query: (q: LibraryQuery): Promise<Clip[]> => ipcRenderer.invoke('library:query', q),
    games: (): Promise<string[]> => ipcRenderer.invoke('library:games'),
    tags: (): Promise<string[]> => ipcRenderer.invoke('library:tags'),
    update: (id: string, patch: Partial<Clip>): Promise<Clip | undefined> => ipcRenderer.invoke('library:update', id, patch),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('library:remove', id),
    reveal: (file: string) => ipcRenderer.invoke('library:reveal', file),
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    trim: (id: string, startSec: number, endSec: number): Promise<Clip | null> => ipcRenderer.invoke('library:trim', id, startSec, endSec)
  },
  youtube: {
    connect: (): Promise<{ channelTitle: string }> => ipcRenderer.invoke('youtube:connect'),
    disconnect: (): Promise<void> => ipcRenderer.invoke('youtube:disconnect')
  },
  upload: {
    enqueue: (clipId: string, platform: Platform, at?: string): Promise<UploadRecord | undefined> => ipcRenderer.invoke('upload:enqueue', clipId, platform, at),
    cancel: (clipId: string, uploadId: string): Promise<void> => ipcRenderer.invoke('upload:cancel', clipId, uploadId),
    list: (): Promise<{ clip: Clip; upload: UploadRecord }[]> => ipcRenderer.invoke('upload:list')
  },
  on: (channel: 'status' | 'activity' | 'library-changed' | 'uploads-changed', fn: (payload: never) => void) => {
    const handler = (_e: unknown, payload: unknown) => fn(payload as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

export type ClipForgeApi = typeof api
contextBridge.exposeInMainWorld('cf', api)
