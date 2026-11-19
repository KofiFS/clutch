# Microsoft Store release

Clutch ships to the Store as an MSIX package. The Store signs it, so no code-signing certificate is needed.

## One-time (owner, in Partner Center)

1. **Apps and games → New product → MSIX or PWA app**, and reserve the name **Clutch**. If it's taken, reserve something like "Clutch Clip Recorder"; the name in the app can stay "Clutch".
2. Open the product, then **Product management → Product identity**, and copy three values into `build/store-identity.json`:
   - `Package/Identity/Name` → `identityName`
   - `Package/Identity/Publisher` (starts with `CN=`) → `publisher`
   - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`
3. Fill in the listing:
   - **Privacy policy URL** (required: Clutch records the screen and mic).
   - **Screenshots** (at least 1, 1366×768 or larger).
   - **Category:** Photo & video.
   - **Age rating:** questionnaire.
4. Under **Properties**, declare:
   - It captures the screen and the microphone.
   - It uses `runFullTrust` (a desktop app). The reason to give: "Records gameplay with FFmpeg and Windows Graphics Capture; needs full desktop access to capture games and system audio."

## Each release

```bash
npm test
npm run dist:store
```

Upload `release/Clutch-Store-<version>.appx` under **Packages** in a new submission.

## How the Store copy differs

The app checks for these with `process.windowsStore`:

- **Updates:** the Store installs them. The in-app updater shows "The Microsoft Store keeps this copy up to date".
- **Start with Windows:** not available yet. MSIX can't use the Run key. A StartupTask would need the app to tell a login launch apart from a normal one, because a StartupTask can't pass `--hidden`.
- **Data:** settings and the clip index live in the package's own AppData, which Windows virtualizes. Clips still go to `Videos\Clutch`.
  - A user who also has the installer version gets a separate settings set.
  - Their clips folder stays the same. They can add it under Settings → Libraries.

## Testing the package before upload

The `.appx` is unsigned (the Store signs it), so Windows won't install it by double-click. Before uploading, run the **Windows App Certification Kit** (`appcert.exe` in the Windows SDK, under `App Certification Kit`). It runs the same automated checks as Store certification. After the Store approves a submission, you can install it from a private "hidden" listing to test the real Store copy before going public.
