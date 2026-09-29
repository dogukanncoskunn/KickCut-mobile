# Security and privacy

KickCut downloads Kick broadcasts to your phone. It has no accounts, no server
of its own, and no reason to know anything about you. This page says what that
means concretely, how it is checked, and how to report a problem.

## What the app does and does not do

| Promise | How it is kept | How it is checked |
|---|---|---|
| Talks only to Kick | The only hosts in the code are `kick.com`, `images.kick.com`, `stream.kick.com` | CI greps the source for any other host; a release build was run through a logging proxy and connected to those three and nothing else |
| Sends nothing while idle | No timers talk to anything except the channel refresh you asked for | Release build left open for 60 s after launch and 90 s after a download: zero bytes on the app's network counter |
| No tracking of any kind | No analytics, crash reporting, ads or update SDKs | CI scans the release APK's bytecode for known tracker packages |
| Minimal permissions | Internet, a foreground service for downloads, its notification | CI fails if the release APK asks for anything else |
| Your data stays on the phone | Job records and in-progress segments live in private app storage, excluded from device backup | CI checks `allowBackup=false` in the release manifest |
| No cleartext traffic | Every Kick URL is HTTPS; cleartext is off by default for the target SDK | CI checks the release manifest |
| No file written outside the folder you chose | Output goes through Android's document picker; titles are sanitised before becoming file names | Unit test feeds `../`, absolute paths and control characters to the sanitiser |

## Third-party code worth knowing about

**FFmpegKit** (`dev.ffmpegkit-maintained:ffmpeg-kit-full-gpl`) is the one large
binary dependency: it joins the downloaded segments into an MP4. The original
FFmpegKit was retired in 2025; this is a community fork published by a single
maintainer. What was checked:

- The artifact on Maven Central carries a valid PGP signature from the fork's
  key (`78A42CD0B30609B4`, "FFmpegKit Maintained").
- Its Java sources were read. The fork adds optional subtitle-translation
  classes that can call Google Translate, DeepL or LibreTranslate. They only
  run when an app calls them with an API key; KickCut never does, and the
  proxy measurement above confirms no such traffic.
- The native libraries contain no hosts beyond FFmpeg's own documentation and
  standards URLs.
- The exact artifact reviewed is pinned by SHA-256 in `scripts/ffmpeg-kit.sha256`;
  CI fails if a different file is ever resolved under the same version.

## Checking it yourself

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease && cd ..
bash scripts/privacy-gate.sh android/app/build/outputs/apk/release/app-release.apk
```

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability) rather than a public issue.
