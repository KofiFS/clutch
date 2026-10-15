import { contextBridge, ipcRenderer } from 'electron'
import type { AccountState, ActivityEvent, AdCard, BufferStatus, Clip, EditOptions, GameInfo, ShrinkProgress, GameSummary, HealthItem, ImportChange, ImportResult, MonitorInfo, LibraryInfo, Platform, RunningApp, Settings, UpdateState, UploadRecord } from '../shared/types'

export interface LibraryQuery {
  text?: string
  game?: string
  trigger?: string
  favoritesOnly?: boolean
  tag?: string
  sort?: 'newest' | 'oldest' | 'longest' | 'largest'
  trashed?: boolean
  /** 'clutch' = recorded by Clutch, otherwise a library id. */
  source?: string
}

export interface EnqueueOpts {
  scheduledAt?: string
  title?: string
  description?: string
  tags?: string[]
  privacy?: 'private' | 'unlisted' | 'public'
}

type Channel = 'status' | 'activity' | 'library-changed' | 'uploads-changed' | 'clip-saved' | 'game' | 'upload-done' | 'clip-of-the-day' | 'open-clip' | 'settings-changed' | 'navigate' | 'levels' | 'account' | 'cloud-progress' | 'open-pro' | 'mini-expanded' | 'update' | 'editor-progress' | 'shrink-progress' | 'libraries' | 'voice-heard'

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
    diskFree: (dir?: string): Promise<number | null> => ipcRenderer.invoke('system:diskFree', dir ?? ''),
    diskInfo: (dir?: string): Promise<{ free: number; total: number } | null> => ipcRenderer.invoke('system:diskInfo', dir ?? ''),
    canLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke('system:canLaunchAtLogin')
  },
  account: {
    get: (): Promise<AccountState> => ipcRenderer.invoke('account:get'),
    refresh: (): Promise<AccountState> => ipcRenderer.invoke('account:refresh'),
    providers: (): Promise<{ id: string; label: string }[]> => ipcRenderer.invoke('account:providers'),
    signIn: (provider: string): Promise<AccountState> => ipcRenderer.invoke('account:signIn', provider),
    lastAuthUrl: (): Promise<string> => ipcRenderer.invoke('account:lastAuthUrl'),
    signOut: (): Promise<void> => ipcRenderer.invoke('account:signOut'),
    checkout: (): Promise<void> => ipcRenderer.invoke('account:checkout'),
    portal: (): Promise<void> => ipcRenderer.invoke('account:portal'),
    devPlan: (plan: 'free' | 'pro'): Promise<void> => ipcRenderer.invoke('account:devPlan', plan)
  },
  cloud: {
    share: (clipId: string): Promise<{ id: string; shareUrl: string; expires: number | null }> => ipcRenderer.invoke('cloud:share', clipId),
    unshare: (clipId: string): Promise<void> => ipcRenderer.invoke('cloud:unshare', clipId)
  },
  ads: {
    get: (placement: string): Promise<AdCard[]> => ipcRenderer.invoke('ads:get', placement),
    open: (ad: AdCard): Promise<void> => ipcRenderer.invoke('ads:open', { id: ad.id, url: ad.url })
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
    /** Record a game that is already open (wherever its window is). */
    useGame: (app: RunningApp): Promise<BufferStatus> => ipcRenderer.invoke('game:use', app),
    toggleLong: (): Promise<unknown> => ipcRenderer.invoke('long:toggle'),
    bookmark: (): Promise<void> => ipcRenderer.invoke('bookmark:add'),
    togglePause: (): Promise<unknown> => ipcRenderer.invoke('buffer:togglePause')
  },
  updates: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install')
  },
  editor: {
    captionModelReady: (): Promise<boolean> => ipcRenderer.invoke('editor:captionModel'),
    downloadCaptionModel: (): Promise<boolean> => ipcRenderer.invoke('editor:downloadCaptionModel'),
    export: (clipId: string, opts: EditOptions): Promise<Clip> => ipcRenderer.invoke('editor:export', clipId, opts),
    join: (ids: string[]): Promise<Clip> => ipcRenderer.invoke('editor:join', ids)
  },
  /** Bring settings over from another recorder. */
  importer: {
    hasObs: (): Promise<boolean> => ipcRenderer.invoke('import:hasObs'),
    obs: (): Promise<ImportResult> => ipcRenderer.invoke('import:obs'),
    screenshots: (images: ArrayBuffer[]): Promise<ImportResult> => ipcRenderer.invoke('import:screenshots', images),
    smart: (images: ArrayBuffer[]): Promise<ImportResult> => ipcRenderer.invoke('import:smart', images),
    apply: (changes: ImportChange[]): Promise<Settings> => ipcRenderer.invoke('import:apply', changes)
  },
  /** The corner recording controller. */
  mini: {
    expand: (on?: boolean): Promise<boolean> => ipcRenderer.invoke('mini:expand', on),
    openMain: (): Promise<void> => ipcRenderer.invoke('mini:openMain'),
    drag: (phase: 'start' | 'move' | 'end') => ipcRenderer.send('mini:drag', phase),
    preview: (): Promise<{ dataUrl: string; atMs: number } | null> => ipcRenderer.invoke('mini:preview')
  },
  activity: { list: (): Promise<ActivityEvent[]> => ipcRenderer.invoke('activity:list') },
  audio: { push: (pcm: ArrayBuffer, levelDb: number) => ipcRenderer.send('audio:push', pcm, levelDb) },
  voiceCommands: {
    test: (seconds?: number): Promise<{ seconds: number; mic: string | null; unavailable: string | null }> => ipcRenderer.invoke('voice:test', seconds)
  },
  libraries: {
    list: (): Promise<LibraryInfo[]> => ipcRenderer.invoke('libraries:list'),
    detectMedal: (): Promise<{ path: string; added: boolean } | null> => ipcRenderer.invoke('libraries:detectMedal'),
    addMedal: (): Promise<LibraryInfo> => ipcRenderer.invoke('libraries:addMedal'),
    addFolder: (): Promise<LibraryInfo | null> => ipcRenderer.invoke('libraries:addFolder'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('libraries:remove', id),
    rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke('libraries:rename', id, name),
    rescan: (id?: string): Promise<void> => ipcRenderer.invoke('libraries:rescan', id),
    open: (id: string): Promise<void> => ipcRenderer.invoke('libraries:open', id)
  },
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
    viewed: (id: string): Promise<void> => ipcRenderer.invoke('library:viewed', id),
    waveform: (id: string): Promise<number[]> => ipcRenderer.invoke('library:waveform', id),
    exportCompatible: (id: string): Promise<string | null> => ipcRenderer.invoke('library:exportCompatible', id),
    exportCompatibleMany: (ids: string[]): Promise<{ folder: string; count: number } | null> => ipcRenderer.invoke('library:exportCompatibleMany', ids),
    shrinkState: (): Promise<{ progress: ShrinkProgress; existingCount: number; existingBytes: number }> => ipcRenderer.invoke('storage:shrinkState'),
    shrinkExisting: (): Promise<void> => ipcRenderer.invoke('storage:shrinkExisting')
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
    connect: (mode: 'account' | 'own' = 'account'): Promise<{ channelTitle: string }> => ipcRenderer.invoke('youtube:connect', mode),
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
