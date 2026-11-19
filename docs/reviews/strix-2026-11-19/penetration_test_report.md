# Security Penetration Test Report

**Generated:** 2026-11-19 17:13:20 UTC

# Executive Summary

A white-box review of the Clutch desktop app (Electron 37 / React 19) and its cloud server found **no unauthenticated remote code execution, authentication bypass or cross-user data access**. It did find one high-severity weakness in the desktop app and several medium and low issues.

**Overall posture:** Reasonable, and fixable before launch. The 2026-11-18 fixes mostly hold. Two of them were incomplete (the DEV_LOGIN guard and the ad-id check).

**Key findings**
- **High: PowerShell command injection in the desktop app.** A compromised or script-injected renderer can run arbitrary commands in the main process. It does this through the unvalidated `settings:set` channel (the audio-source process name). Several other desktop issues share that root cause: the session token can be sent to an attacker-chosen server, and an attacker-chosen path can be launched with `shell.openPath`.
- **Medium, cloud server:** The DEV_LOGIN "loopback only" fix checks only the configured `PUBLIC_URL`, while the server listens on all interfaces. A network client can therefore sign in as any account with no password.
- **Medium, cloud server:** The storage quota can be bypassed. An upload left in flight can overwrite a completed clip. Tiny clips can also be completed at a fraction of their declared size, with no cap on clip count.
- **Medium, cloud server:** Ad click and impression counters can be inflated without authentication or limits.
- **Dependency risk:** Electron 37 is end-of-life and carries several advisories (context-isolation and contextBridge bypasses, and others). Each needs a separate renderer-compromise primitive to matter, and none was found. Upgrading Electron is the single change that clears most of them.

**Business impact:** The desktop weaknesses matter only if an attacker already controls the renderer, for example through XSS. No XSS sink was found, and the renderer CSP is strict. If that premise ever holds, the result is code execution on the user's PC and theft of the cloud session token. The server issues mostly affect cost, quota and the integrity of ad metrics. The DEV_LOGIN issue is serious only if the server is run with that flag on a reachable network.

**Verified as holding:** `openExternal` protocol allow-list, `library:update` field allow-list, `cf://` media-only and path containment, sandboxed windows and navigation locks, loopback sign-in nonce and OAuth state, DPAPI secret storage, `deepMerge` prototype-key skipping, atomic AI daily limits, S3 presign signing, download content-type headers, and share-link expiry.

# Methodology

**Approach:** White-box review of the repository, with dynamic validation where the sandbox allowed it. Guided by OWASP WSTG and ASVS, with Electron hardening guidance for the desktop app.

**Scope:** `src/main`, `src/preload`, `src/renderer`, `src/shared`, `server/`, and the lockfiles. The prior review in `docs/reviews/2026-11-18-security.md` was used as a checklist.

**Activities**
- Shared threat model: renderer treated as potentially compromised; local processes and the internet as attackers.
- Desktop IPC: every handler was cross-checked against the preload surface, and the real main-process code was driven with a stubbed Electron.
- `cf://` and file handling: containment was tested under Windows path semantics (traversal, UNC, `\\?\`, ADS, trailing characters, case).
- Spawned processes: FFmpeg and PowerShell argument construction was reviewed, with a logging fake FFmpeg.
- Secrets and OAuth: DPAPI storage, and the OAuth and sign-in loopback servers.
- Renderer: XSS sinks and CSP.
- Cloud server: run locally (DEV_LOGIN, loopback URL, local storage) with two test users. Tested JWT validation, token-kind confusion, per-object authorization, share links, SQL injection, XSS in pages, Stripe webhook signatures, upload and quota flows, race conditions on AI limits, S3 presigning and SSRF surfaces.
- Dependencies: SCA and secret scanning (trivy, gitleaks, trufflehog, npm audit) with reachability analysis.

**Constraints:** The sandbox is Linux, so Windows-only behaviour (the actual program launch via `shell.openPath`, DPAPI, installer signing) and a real Electron session could not be exercised. No real S3, Google or Anthropic access was available, and no external hosts were contacted.

# Technical Analysis

**Severity model:** Exploitability × demonstrated impact. Desktop findings that require a compromised renderer are rated by what that renderer can then do; no renderer-compromise primitive was found.

**Findings**
1. **High:** PowerShell command injection via `capture.audioSources[].process`. The value is interpolated into a double-quoted PowerShell `-Filter` string, where `$(...)` is still evaluated. It is reachable through the unvalidated `settings:set` channel. The PoC ran the real settings store and function and wrote a marker file.
2. **Medium:** Cloud session token sent to any `cloud.serverUrl` set through `settings:set`. The token is not bound to the server that issued it. A listener captured the Bearer token.
3. **Medium:** `settings:set` can set `libraries[].path` and `capture.outputDir`, which are passed to `shell.openPath`, so a renderer can launch an arbitrary file or program. The call was confirmed with a stubbed Electron. The actual launch on Windows was not.
4. **Medium:** DEV_LOGIN guard checks only the `PUBLIC_URL` string while the listener binds all interfaces. From a non-loopback address a tester signed in as an existing account and upgraded it to Pro. Binding `127.0.0.1` when DEV_LOGIN is on blocks the PoC.
5. **Medium:** Storage quota bypass on the local driver. An upload left open across `/complete` replaces the completed file with a larger one. Separately, `MIN_CLIP_BYTES` is enforced only on the declared size, so a 1-byte upload declared as 20,000 bytes completes. About 4,100 times the quota-accounted size was written to disk in testing, with no cap on clip count.
6. **Medium:** Unauthenticated, unlimited ad click and impression inflation for real ad ids.
7. **Dependency CVEs (Electron 37.10.3):** Context-isolation bypass and contextBridge prototype-setter copying (medium). The `cf` scheme registered with `supportFetchAPI` but not `corsEnabled` (low). Unquoted login-item path (low). Only latent unless a renderer script-execution primitive exists.
8. **Informational:** `@anthropic-ai/sdk` 0.80.0 and `zod` 3.25.76 advisories; the vulnerable code paths are not used.

**Systemic root causes**
- **Unvalidated `settings:set`:** The renderer can write the whole settings object, including fields the main process later trusts (paths, URLs, process names). Fixing it once with a schema and main-managed fields closes the first three findings.
- **Guards that check configuration rather than behaviour:** The DEV_LOGIN fix looks at a URL string, and the ad-id fix checks only existence. Neither restricts who can use the feature, or how often.
- **Quota accounting at a single point in time:** The size is read at `/complete`, but the file can still change or be tiny afterwards.
- **End-of-life runtime:** Electron 37 will not receive the contextBridge and context-isolation fixes.

**Open proof gaps (not demonstrated, recorded for follow-up)**
- Whether the page CSP is enforced for the UI served from `cf://app`, since the scheme is registered with `bypassCSP`. This needs a real Electron run.
- Updater integrity. The distribution script builds an unsigned installer when the signing variables are unset, and the build config has no `publisherName`.
- The YouTube happy path (needs real Google access). The server-side `/auth/youtube/callback` route is shadowed by the generic provider callback, which is a functional bug.
- The S3 driver was only inspected, not run against a live bucket.
- A possible race between `/complete` and DELETE on S3.

**Known gaps from the prior review, still open:** per-IP rate limits, session revocation (`token_version`), and the session token in the sign-in redirect URL.

# Recommendations

**Immediate (before shipping)**
1. Add schema validation to `settings:set` in the main process.
   - Reject unknown keys and main-managed fields such as `libraries`.
   - Validate `audioSources[].process` against a file-name character set, and stop building the PowerShell command from strings.
   - Require `https` for `cloud.serverUrl`, and accept path changes only from a native folder dialog.
   - Check that paths are directories before calling `shell.openPath`.
2. Bind the cloud session token to its issuing server origin, and clear it when the server URL changes.
3. Bind the server listener to `127.0.0.1` whenever DEV_LOGIN is enabled.
4. Re-check the clip is still pending when a local upload finishes. Enforce the minimum size on the actual uploaded size at `/complete`, and add a per-account clip-count cap.

**Short-term**
5. Upgrade Electron to a supported major (39.8.10 or later, ideally 41.x or newer). Drop `supportFetchAPI` from the `cf` scheme if it is not needed.
6. Add authentication, deduplication and per-client limits to the ad click and impression endpoints. Add per-IP rate limits on unauthenticated endpoints.
7. Fix the route order so `/auth/youtube/callback` is matched before `/auth/:provider/callback`.
8. Add sender-frame URL checks to the IPC handlers.
9. Confirm the shipped installer is code-signed and that the update metadata carries a publisher name.
10. Bump `@anthropic-ai/sdk` and `zod` when convenient.

**Medium-term**
11. Implement session revocation with `token_version`, and move the session token out of the sign-in redirect URL.
12. Test the CSP actually in force on `cf://app`.
13. Test the S3 driver against a mock or real bucket, including the DELETE-versus-complete race.
14. Handle the null-body 500s in the webhook and clip-creation routes.

**Retest and validation:** Re-run the filed proof-of-concept scripts against the patched code. Re-run `npm run test:e2e` and `cd server && npm test`, then perform a Windows build test of the `shell.openPath` and PowerShell paths and the updater signing path.

