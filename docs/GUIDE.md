# Clutch user guide

## Triggers

| Trigger | Where | How it works |
|---|---|---|
| Hotkey | Settings → Hotkey & game detection | Press-to-record field. Letters need a modifier; F-keys work alone. Medal also uses F8, so pick another key if both run. |
| Clip length in game | Settings → Change clip length in game | Alt+PageUp / Alt+PageDown step through 10 s, 20 s, 30 s, 1 min, 2 min. Extra hotkeys can each have their own length. |
| Long recording | Alt+F9 | Keeps everything from start to stop and saves one file. Alt+F8 adds bookmarks. |
| Hype moments | What to clip | No AI. Learns your normal loudness and clips sudden spikes (15 s cooldown). |
| When people talk | What to clip | No AI. One clip per stretch of conversation on your mic and/or voice chat. |
| Watch the screen | What to clip | Optional AI. Your plain-English rules are checked against a screenshot every few seconds (20 s cooldown between clips). Needs an Anthropic API key; costs one small request per check. |

Game not detected (for example one running in a window)? Add it under What to clip → **Treat as a
game**, or right-click the tray icon right after playing and pick **Treat … as a game**. Once a game
has been in front, Clutch keeps recording it while it runs, even when you click into another window.

Allow/block lists and per-game profiles are under "What to clip". Lists only affect automatic
triggers; the hotkey always works.

## Bring your settings from Medal, OBS or NVIDIA

Settings → **Bring your settings**. Screenshot the other app's settings (Win+Shift+S), then paste
with Ctrl+V or drop the picture in. Up to 4 pictures, for example its Recorder and Hotkeys pages.

- Clutch reads the text with Windows' built-in text recognition, on your PC, with no account or AI.
  It understands frame rate, resolution, quality or bitrate, clip and replay length, the clip
  hotkey, the save folder, the mic and game audio.
- You see every change with a checkbox before anything is applied. The save folder is never
  changed unless you tick it.
- OBS installed? **Import from OBS on this PC** reads its profile files directly.
- If a screenshot is hard to read, **smart read** asks Claude instead: with your own key under AI,
  or through your Clutch account (3 a day on Free, 25 on Pro).

## Mini controller while recording

When recording starts, Clutch tucks itself away and a small controller appears in the top-right
corner. Only you see it: Windows leaves it (and the "Clipped!" popup) out of every screen capture,
so it never shows up in clips.

- **Buttons:** Clip, Pause/Resume, Stop, and Expand.
- **Double-click** it (or press Expand) to see a still from the actual recording, what is being
  captured, the video settings and live audio meters. Double-click again to shrink it.
- **Pause** stops capturing completely. What is already in the buffer and any long recording are
  kept, and the paused time is left out of the long recording. Clip while paused saves the moments
  right before the pause.
- **Drag** it anywhere; it remembers the spot. **Open Clutch** brings the full window back.
- Turn it off under Settings → Notifications & window → "Shrink to a mini controller while recording".

## Recording area and audio

- **Settings → Recording area:** Full screen, Game window (crops to the game in front when recording starts),
  A window, or Custom area (drag on screen, or use presets such as "16:9 centered" for ultrawide monitors).
- **Settings → Audio sources:** add mics or virtual cables, set each volume, and turn on "Separate track"
  to keep a source on its own track. Track 1 is always the mix. To put Discord on its own track, send
  Discord's output to a virtual cable (VB-Cable, Voicemeeter) and add that cable here.

## Keyboard shortcuts

- Anywhere: `Ctrl+K` search · `Ctrl+1…5` switch pages.
- Clip viewer: `Space`/`K` play · `←`/`→` 1 s (`Shift` 5 s) · `,`/`.` one frame · `I`/`O` trim in/out ·
  `F` favorite · `M` mute · `[`/`]` previous/next · `Delete` trash · `Esc` close. Drag the timeline to scrub.
- Clips page: `/` search · `Ctrl+A` select all · `Delete` trash selection · `Shift+click` range select.

## Discord

1. In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
2. Clutch → Settings → Discord → paste → Save & test. Testing reads the webhook's name and posts nothing.
3. Post from a clip's Share tab, the bulk bar in Clips, or the Clip of the day card.

Big or HEVC clips get an H.264 copy sized to the server's upload limit so they play inline.

## YouTube

1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. Credentials → **OAuth client ID** → type **Desktop app**.
3. Clutch → Settings → Accounts → paste the client ID and secret → Connect.
4. Upload from a clip's Share tab, or turn on **Uploads → Auto-upload schedule** (needs a Clutch account).

## Clip of the day scoring

Favorite +50; trigger (AI moment 25, hype 22, hotkey 15, voice 10, manual 8); up to 3 tags ×4; up to
5 views ×3; hype loudness up to +20; an event label +6; watchable length (8–45 s) +10; very short
(<4 s) −15; trimmed +5. Long recordings and desktop clips only win if nothing else was recorded that day.

## Where things are stored

Clips go to the folder under Settings → Storage, one sub-folder per game; deleted clips sit in a
`.trash` folder next to them for 30 days. Settings, the clip index, thumbnails and the replay buffer
are in `%APPDATA%\clipforge\`.
