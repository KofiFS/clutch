# Contributing to Clutch

Thanks for helping. Clutch aims to be light, reliable and easy for everyone to use, and every
change is judged against that.

## Getting started

```bash
npm install
npm run dev
```

You need Windows 10/11, Node 22+, and FFmpeg on `PATH` (`winget install Gyan.FFmpeg`).
To work on the cloud features, run the server too:

```bash
cd server
cp .env.example .env      # set DEV_LOGIN=1 for the test login
npm run dev
```

Then point the app at `http://127.0.0.1:8787` under Settings → Account.

## Before you open a pull request

- `npm run typecheck` passes.
- You tried the change in the running app, not just in the editor.
- Recording stays cheap: no infinite CSS animations inside glass panels (they make the GPU re-blur
  every frame), and no polling the OS every few seconds in a new process.
- New settings have plain-language labels and a sensible default; power-user options go under
  "Advanced".
- Nothing in `src/renderer` handles tokens or secrets; that belongs in `src/main`.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened. Include the
**Settings → Health check** results and, if recording failed, the Activity panel lines from Home.
Please don't attach clips that show private chats or personal information.

## Security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree your work is released under the GPL-3.0-or-later, the same license as
the project.
