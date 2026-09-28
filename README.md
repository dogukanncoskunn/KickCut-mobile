# KickCut for Android

The KickCut desktop app on a phone: download a Kick broadcast - all of it, or
the three hours in the middle you actually want - as an MP4 that opens cleanly
in an editor. Same screens, same controls, same engine behaviour as the
[Windows](https://github.com/dogukanncoskunn/KickCut) and
[macOS](https://github.com/dogukanncoskunn/KickCut-macOS) builds.

## Using it

1. **Broadcasts** - type a channel name to list its recent broadcasts, or paste
   a VOD link for anything older.
2. **Download** - pick a quality and set the range: drag the ends of the
   timeline or type `02:00:00` and `05:30:00`. Amber marks are breaks in the
   broadcast.
3. Choose a folder and a file name, then **add it to the queue**. The download
   keeps running with the screen off, shown in a notification.
4. Pause whenever you like, including by closing the app. Resuming carries on
   from the segment it reached.

## What is different from the desktop

- **FFmpeg is built in.** Android will not run a program an app downloads, so
  there is no install step; Settings shows the build instead.
- **"Open" instead of "Show in folder"**: a finished video opens in your video
  player, and can be shared.
- **Disk space is checked first.** For a moment a download needs about three
  times its own size - the segments, the joined stream and the finished file.
- **Android 15 limits background downloads to six hours a day.** When the
  system says time is up the job pauses; resume it and nothing is lost.
- No self-updater: install new builds by hand.

## What it sends

No analytics, no telemetry, no crash reporting. Two hosts:

| Host | Why |
|---|---|
| `kick.com` | broadcast list and VOD metadata |
| `stream.kick.com` | the playlists and the video segments |

## Building it

Needs Node 22, JDK 17 and the Android SDK. It uses a native module, so Expo Go
will not run it - it is a development build.

```bash
npm install
npx expo prebuild -p android      # android/ is generated, never committed
npx expo run:android
```

Checks, all of which CI runs:

```bash
npm run typecheck
npm run test:engine               # the desktop's Rust tests, ported to JUnit
```

The download engine lives in `modules/kickcut-engine` and is a Kotlin port of
the desktop's Rust (`hls.rs`, `download.rs`, `mux.rs`, `rate.rs`). The ffmpeg
arguments are the desktop's, pinned by the same tests; a fix to one belongs in
the other.

## A note on what you download

This is a tool for keeping your own broadcasts, or content you have permission
to keep. It downloads what Kick already serves to any viewer and does not
circumvent any protection. What you do with the file is your responsibility.

---

made by unsatisfied0
