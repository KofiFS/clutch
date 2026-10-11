# ClipForge

A Medal-style game clip recorder for Windows that you can *tell what to clip*.

- **Replay buffer** keeps the last N seconds of your screen on disk (hardware encoded, NVENC/AMF/QSV).
- **Hotkey** saves the last X seconds + the next Y seconds (like Medal's F8).
- **"Watch the screen for moments"**: write rules in plain English ("clip my kills, never clip menus") and Claude checks low-rate screenshots and saves a clip when the on-screen evidence matches.
- **"Only when people talk"**: saves a clip of every stretch of conversation on your mic and/or voice chat (system audio).
- **Per-game allow/block lists**, framerate (30-144), resolution scale, encoder and constant-quality settings.
- **Library** with thumbnails, hover preview, search, filters (game / trigger / favorites), tags, trim, delete.
- **YouTube uploads** (your own OAuth app) with a daily schedule that drip-feeds your favorite clips.

## Requirements

- Windows 10/11, Node 22+, and `ffmpeg` + `ffprobe` on `PATH` (a full build with `ddagrab` and the NVENC/AMF/QSV encoders, e.g. gyan.dev "full"). For a packaged build put them in `resources/ffmpeg/ffmpeg.exe` and `ffprobe.exe`.
- An NVIDIA / AMD / Intel GPU for hardware encoding (software x264 works but is CPU heavy).
- Optional: an Anthropic API key for the vision trigger, a Google OAuth client for YouTube uploads.

## Run it

```bash
npm install
npm run build
npx electron .
```

`npm run dev` starts it with hot reload. `npm run dist` makes an installer under `release/` (bundle ffmpeg first, see above).

## How capture works

One FFmpeg process does everything:

```
screen (ddagrab, stays on the GPU) ─┐
microphone (dshow) ─────────────────┼─► ffmpeg ─► buffer/seg000123.ts (2 s MPEG-TS segments, pruned)
system audio (Electron loopback → stdin) ┘       └─► stdout: 1 JPEG every few seconds for the vision trigger
```

Saving a clip concatenates the right segments with stream copy, so it is instant and never re-encodes. Cuts land on
2-second keyframe boundaries. Screens wider than 4096 px (ultrawide, 5K) automatically use HEVC or AV1 because
H.264 hardware encoders cannot go bigger.

System audio comes from Chromium's WASAPI loopback (`getDisplayMedia` + `audio: 'loopback'`), converted to PCM by an
audio worklet in the renderer and piped into FFmpeg. If the renderer stops delivering audio, silence is written so the
muxer never stalls. Desktop duplication is torn down when a game toggles fullscreen; the buffer restarts itself.

## Triggers

| Trigger | Where | Notes |
|---|---|---|
| Hotkey | Settings → Clip hotkey | Electron accelerator syntax. Medal also grabs F8, so pick something else if both run. |
| Vision rules | What to clip → Watch the screen | Sends the previous + newest downscaled screenshot to `claude-opus-5-5` with your rules; structured verdict `{clip, event, confidence, secondsAgo}`. 20 s cooldown between auto clips. Costs one API call per interval while on. |
| Voice | What to clip → Only when people talk | Loudness on mic (from FFmpeg `astats`) and/or system audio (from the loopback). Threshold, start/stop timing and max length are adjustable. |

Allow/block lists apply to the automatic triggers; the hotkey always works.

## YouTube

1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. Credentials → **OAuth client ID** → type **Desktop app**.
3. Settings → Accounts → paste client ID and secret → Connect. Tokens are stored in `%APPDATA%\clipforge\youtube-token.json`.
4. Upload a clip from its player ("Upload to YouTube now") or turn on **Uploads → Auto-upload schedule**: at each time of day the oldest favorite (or tagged) clip that hasn't gone out yet is uploaded.

TikTok and Twitch have no public clip-upload API, so they are listed but disabled.

## Layout

```
src/main/
  index.ts             window, IPC, cf:// protocol, hotkey, single-instance lock
  recorder.ts          ties buffer + triggers + library together
  capture/replayBuffer.ts   FFmpeg ring buffer, clip export, snapshots, auto-restart
  capture/ffmpeg.ts    encoder detection, device list, probe, thumbnails, trim
  capture/foreground.ts     foreground game detection (PowerShell)
  triggers/vision.ts   Claude vision judge
  triggers/voice.ts    talk detector state machine
  library/index.ts     clips.json index
  upload/youtube.ts    OAuth + resumable upload
  upload/scheduler.ts  queue + daily schedule
src/renderer/          React + Tailwind UI (Dashboard, Clips, What to clip, Uploads, Settings)
src/shared/types.ts    settings + clip types shared by both sides
```

Data lives in `%APPDATA%\clipforge\` (settings, index, thumbnails, buffer) and clips in `Videos\ClipForge\<game>\`.
