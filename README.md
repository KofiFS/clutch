# Clutch

A Medal-style game clip recorder for Windows that you can *tell what to clip*.

- **Replay buffer** keeps the last N seconds of your screen on disk (hardware encoded, NVENC/AMF/QSV).
- **Hotkey** saves the last X seconds + the next Y seconds (like Medal's F8).
- **"Watch the screen for moments"**: write rules in plain English ("clip my kills, never clip menus") and Claude checks low-rate screenshots and saves a clip when the on-screen evidence matches.
- **"Only when people talk"**: saves a clip of every stretch of conversation on your mic and/or voice chat (system audio).
- **"Hype moments"** (no AI): learns how loud you normally are and clips sudden spikes - yelling, laughing, "NO WAY".
- **Discord**: post any clip to a channel through a webhook (no bot, no login). Big or HEVC clips get an H.264 copy sized to the server's upload limit so they play inline.
- **Clip of the day** (no AI): the best clip of each day is picked by a simple score and shown on Home, announced with a Windows notification, and optionally posted to Discord at a set time.
- **Game detection**: starts recording by itself when a game opens (Steam, Epic, Xbox, GOG, Battle.net, fullscreen windows), tags clips with the game's icon, and can switch capture profiles per game.
- **Library** with game strip, thumbnails, hover preview, search, filters, favorites, tags, multi-select with bulk actions, trash with undo.
- **Clip viewer / editor**: timeline trim with draggable handles, keyboard shortcuts, per-clip share panel.
- **YouTube uploads** (your own OAuth app) now or scheduled, plus a daily schedule that drip-feeds your favorite clips.
- **Desktop polish**: first-run wizard, system tray, on-screen "Clipped!" overlay, chime, health check, frameless window.
- **Change clip length in game**: Alt+PageUp / Alt+PageDown step through 10 s, 20 s, 30 s, 1 min, 2 min with an on-screen confirmation, extra clip hotkeys can each have their own length (e.g. Shift+F8 = 1 min), and the tray has a Clip length menu.
- **Liquid HUD design**: liquid-glass panels (iOS 26 / One UI style) with a light sci-fi HUD layer, optional Windows 11 acrylic see-through window, and a Lite mode with no blur.

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

`npm run dev` starts it with hot reload. `npm run dist` makes an installer under `release/` (bundle ffmpeg first, see above). `python scripts/import-icon.py resources/logo-source.webp resources` rebuilds every icon size (and the .ico) from the logo.

## AI is optional

Everything works without AI. With an Anthropic API key you can add:

- **Screen watching** - plain-English rules, judged on a screenshot every few seconds. When it is off, FFmpeg's graph has no screenshot branch at all.
- **Auto-titles** - one small request per new clip, using its thumbnail. Never overwrites a name you typed.

## Efficiency

Measured on this PC (RTX 5090, 5120x1440 @ 60 fps, HEVC NVENC, window hidden in the tray while recording):

| Process | CPU (share of one core) | RAM |
|---|---|---|
| FFmpeg (capture + encode) | ~3% | ~190 MB |
| Clutch (Electron, hidden) | ~1.6% | ~650 MB |
| Clutch window open while recording (Liquid glass) | ~5% GPU process + ~5% window | |

Frames stay on the GPU from capture to encoder. Game detection uses one long-lived PowerShell helper instead of spawning a process every few seconds. Nothing animates forever inside a glass panel: an infinite animation under backdrop-filter made the GPU re-blur the panel every frame (about one full core), so status dots pulse three times and then hold a steady glow. The wallpaper behind the glass is static for the same reason.

## Clip of the day scoring

Favorite +50, trigger (AI moment 25, hype 22, hotkey 15, voice 10, manual 8), up to 3 tags x4, up to 5 views x3, hype loudness up to +20, an AI/hype event label +6, watchable length (8-45 s) +10, very short (<4 s) -15, trimmed +5. Desktop clips only win if nothing else was recorded that day.

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
| Hype | What to clip → Hype moments | No AI. Rolling loudness baseline per source; fires when a level is `spikeDb` above it and above `minDb`, with a 15 s cooldown. Mic on by default; voice chat optional because game sound counts too. |
| Voice | What to clip → Only when people talk | Loudness on mic (from FFmpeg `astats`) and/or system audio (from the loopback). Threshold, start/stop timing and max length are adjustable; live meters show the threshold line. |

Allow/block lists and per-game profiles live under "What to clip". Lists apply to the automatic triggers; the hotkey always works.

## Clip viewer shortcuts

`Space`/`K` play · `←`/`→` 1 s (`Shift` 5 s) · `,`/`.` one frame · `I`/`O` set trim in/out · `F` favorite · `M` mute · `[`/`]` previous/next clip · `Delete` trash · `Esc` close.
Library: `/` search · `Ctrl+A` select all · `Delete` trash selection · `Shift+click` range select. `Ctrl+1…5` switch pages.

## Discord

1. In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
2. Clutch → Settings → Discord → paste → Save & test. Testing reads the webhook's name and posts nothing.
3. Post from a clip's Share tab, the bulk bar in Clips, or the Clip of the day card. Turn on "Post my clip of the day" to have it posted daily.

Only `discord.com` webhook URLs are accepted.

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
  triggers/hype.ts     no-AI loudness spike detector
  triggers/titler.ts   optional AI clip titles
  share/discord.ts     webhook check, Discord-sized H.264 copy, post
  highlights.ts        clip scoring, clip of the day, daily digest timer
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

Data lives in `%APPDATA%\clipforge\` (settings, index, thumbnails, icons, buffer; the folder keeps its pre-rename name) and clips in `Videos\Clutch\<game>\` for new installs
(deleted clips go to a `.trash` folder next to them for 30 days).
