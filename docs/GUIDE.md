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

Allow/block lists and per-game profiles are under "What to clip". Lists only affect automatic
triggers; the hotkey always works.

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
