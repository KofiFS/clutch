# ClipForge

A Medal-style game clip recorder for Windows that you can *tell what to clip*.

- **Replay buffer** keeps the last N seconds of your screen on disk (hardware encoded, NVENC/AMF/QSV).
- **Hotkey** saves the last X seconds + the next Y seconds (like Medal's F8).
- **"Watch the screen for moments"**: write rules in plain English ("clip my kills, never clip menus") and Claude checks low-rate screenshots and saves a clip when the on-screen evidence matches.
- **"Only when people talk"**: saves a clip of every stretch of conversation on your mic and/or voice chat (system audio).
- **Game detection**: starts recording by itself when a game opens (Steam, Epic, Xbox, GOG, Battle.net, fullscreen windows), tags clips with the game's icon, and can switch capture profiles per game.
- **Library** with game strip, thumbnails, hover preview, search, filters, favorites, tags, multi-select with bulk actions, trash with undo.
- **Clip viewer / editor**: timeline trim with draggable handles, keyboard shortcuts, per-clip share panel.
- **YouTube uploads** (your own OAuth app) now or scheduled, plus a daily schedule that drip-feeds your favorite clips.
- **Desktop polish**: first-run wizard, system tray, on-screen "Clipped!" overlay, chime, health check, frameless window.

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

`npm run dev` starts it with hot reload. `npm run dist` makes an installer under `release/` (bundle ffmpeg first, see above). `node scripts/make-icon.mjs` regenerates the app icon.

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
| Hotkey | Settings → Clip hotkey | Press-to-record field. Letters need a modifier; F-keys work alone. Medal grabs F8, so pick another if both run. |
| Vision rules | What to clip → Watch the screen | Sends the previous + newest downscaled screenshot to `claude-opus-5-5` with your rules; structured verdict `{clip, event, confidence, secondsAgo}`. 20 s cooldown between auto clips. Costs one API call per interval while on. |
| Voice | What to clip → Only when people talk | Loudness on mic (from FFmpeg `astats`) and/or system audio (from the loopback). Threshold, start/stop timing and max length are adjustable; live meters show the threshold line. |

Allow/block lists and per-game profiles live under "What to clip". Lists apply to the automatic triggers; the hotkey always works.

## Clip viewer shortcuts

`Space`/`K` play · `←`/`→` 1 s (`Shift` 5 s) · `,`/`.` one frame · `I`/`O` set trim in/out · `F` favorite · `M` mute · `[`/`]` previous/next clip · `Delete` trash · `Esc` close.
Library: `/` search · `Ctrl+A` select all · `Delete` trash selection · `Shift+click` range select. `Ctrl+1…5` switch pages.

## YouTube

1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. Credentials → **OAuth client ID** → type **Desktop app**.
3. Settings → Accounts → paste client ID and secret → Connect. Tokens are stored in `%APPDATA%\clipforge\youtube-token.json`.
4. Upload from a clip's Share tab (now or scheduled, with its own title/description/tags/visibility) or turn on **Uploads → Auto-upload schedule**: at each time of day the oldest favorite (or tagged) clip that hasn't gone out yet is uploaded.

TikTok and Twitch have no public clip-upload API, so they are listed but disabled.

## Layout

```
src/main/
  index.ts             window (frameless), IPC, cf:// protocol, hotkey, tray, overlay, single-instance lock
  recorder.ts          ties buffer + triggers + game detection + profiles + library together
  capture/replayBuffer.ts   FFmpeg ring buffer, clip export, snapshots, auto-restart
  capture/ffmpeg.ts    encoder detection, device list, probe, thumbnails, trim
  capture/foreground.ts     foreground app, game heuristics, exe icon extraction, running apps
  triggers/vision.ts   Claude vision judge
  triggers/voice.ts    talk detector state machine
  library/index.ts     clips.json index, trash/restore, bulk edits
  upload/youtube.ts    OAuth + resumable upload
  upload/scheduler.ts  queue + daily schedule + per-upload metadata
  health.ts            health check (ffmpeg, encoder, mic, loopback, hotkey, disk, AI, YouTube)
  tray.ts / overlay.ts system tray, on-screen "Clipped!" window
src/renderer/          React + Tailwind UI
  pages/               Onboarding, Dashboard, Library, Rules, Uploads, Settings
  components/          ui kit, ClipViewer (editor), SharePanel, GamePicker, HotkeyInput, Toasts
src/shared/types.ts    settings + clip types shared by both sides
```

Data lives in `%APPDATA%\clipforge\` (settings, index, thumbnails, icons, buffer) and clips in `Videos\ClipForge\<game>\`
(deleted clips go to `Videos\ClipForge\.trash` for 30 days).
