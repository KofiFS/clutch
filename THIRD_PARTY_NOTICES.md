# Third-party notices

Clutch is licensed under the GNU General Public License v3.0 or later (see `LICENSE`).
It builds on the following projects.

## Bundled in the installer

| Component | License | Notes |
|---|---|---|
| **FFmpeg** (`ffmpeg.exe`, `ffprobe.exe`) | GPL-3.0-or-later (these builds include GPL components such as x264/x265) | Run as a separate program. Source: https://ffmpeg.org/download.html. CI uses the Windows builds from https://github.com/BtbN/FFmpeg-Builds, whose release pages link the exact FFmpeg commit and build scripts. Its license file ships next to the executables in `resources/ffmpeg/LICENSE.txt`. |
| Electron / Chromium / Node.js | MIT and Chromium's licenses | `LICENSES.chromium.html` ships with the app. |
| React, React DOM | MIT | |
| Tailwind CSS | MIT | Build-time only. |
| lucide-react (icons) | ISC | |
| @anthropic-ai/sdk | MIT | Only used when you add an Anthropic API key. |
| googleapis | Apache-2.0 | YouTube uploads. |
| zod | MIT | |
| Orbitron font | SIL Open Font License 1.1 | via @fontsource/orbitron |
| Space Grotesk font | SIL Open Font License 1.1 | via @fontsource-variable/space-grotesk |

## Distributing builds (GPL obligations)

If you publish an installer, you must make the corresponding source available to everyone who gets
it. For Clutch that means this repository at the tag you built from; for FFmpeg it means a link to
the source of the exact FFmpeg build you bundled (the BtbN release page and FFmpeg commit are enough
when you use `scripts/fetch-ffmpeg.ps1`). The GitHub release created by `.github/workflows/build.yml`
sits next to the tagged source, which covers Clutch itself.

## Trademarks

Discord, YouTube, Google, Twitch, NVIDIA, AMD, Intel, Medal and OBS are trademarks of their
respective owners. Clutch is not affiliated with or endorsed by any of them.
