# Security

If you find a security problem in Clutch or its cloud server, please report it privately using
GitHub's **"Report a vulnerability"** button on the repository's Security tab rather than a public
issue. We'll reply as soon as we can and credit you once it's fixed, if you'd like.

What we care about most:

- Anything that sends a Clutch session token, Discord webhook, YouTube token or API key somewhere
  other than where the user meant it to go.
- The `cf://` file protocol serving files outside the clips and app-data folders.
- Sign-in redirects that could return a token to a non-loopback address.
- Share links exposing clips that weren't shared.

Where secrets live on a user's PC: the Clutch session token is encrypted with Windows DPAPI
(`account.bin`); YouTube tokens and settings are in `%APPDATA%\clipforge\`.
