#!/usr/bin/env bash
# The app's privacy promises, checked against the built release APK and the
# source. Run from the repo root after `./gradlew assembleRelease`:
#
#   bash scripts/privacy-gate.sh android/app/build/outputs/apk/release/app-release.apk
#
# Any failure exits non-zero; CI runs this on every push.
set -euo pipefail

APK="${1:?usage: privacy-gate.sh <release apk>}"
fail=0
bad() { echo "FAIL: $*"; fail=1; }
ok() { echo "ok:   $*"; }

AAPT="$(ls -d "${ANDROID_HOME:?ANDROID_HOME not set}"/build-tools/*/ | sort -V | tail -1)aapt2"
[ -x "$AAPT" ] || AAPT="$AAPT.exe"

# 1. Permissions: exactly these, nothing more.
ALLOWED="android.permission.INTERNET
android.permission.FOREGROUND_SERVICE
android.permission.FOREGROUND_SERVICE_DATA_SYNC
android.permission.POST_NOTIFICATIONS
com.unsatisfied0.kickcut.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
extra="$("$AAPT" dump permissions "$APK" | sed -n "s/.*name='\([^']*\)'.*/\1/p" | grep -v -x -F "$ALLOWED" || true)"
[ -z "$extra" ] && ok "permissions are the allowed four" || bad "unexpected permissions: $extra"

# 2. Manifest: no backup of app data, no cleartext traffic.
manifest="$("$AAPT" dump xmltree "$APK" --file AndroidManifest.xml)"
echo "$manifest" | grep -q 'allowBackup.*=false' && ok "allowBackup is off" || bad "allowBackup is not false"
echo "$manifest" | grep -q 'usesCleartextTraffic.*=true' && bad "cleartext traffic allowed" || ok "no cleartext traffic"

# 3. No analytics, crash reporting, ads or dev tooling compiled in.
tmp="$(mktemp -d)"
unzip -q -o "$APK" 'classes*.dex' -d "$tmp"
TRACKERS='com/google/firebase|com/google/android/gms/(ads|analytics|measurement)|com/crashlytics|io/sentry|com/microsoft/appcenter|com/facebook/(appevents|ads)|com/amplitude|com/mixpanel|com/segment|com/onesignal|com/bugsnag|io/branch|com/adjust|com/appsflyer|expo/modules/updates'
found="$(cat "$tmp"/classes*.dex | grep -a -o -E "L($TRACKERS)/" | sort -u || true)"
[ -z "$found" ] && ok "no tracker SDKs" || bad "tracker SDKs found: $found"
rm -rf "$tmp"

# 4. The source names only Kick's hosts.
HOSTS='^(kick\.com|stream\.kick\.com|images\.kick\.com|schemas\.android\.com)$'
hosts="$(grep -r -h -o -E 'https?://[a-zA-Z0-9.-]+' src modules/kickcut-engine/android/src/main \
  | sed -E 's#https?://##' | sort -u | grep -v -E "$HOSTS" || true)"
[ -z "$hosts" ] && ok "source only names Kick hosts" || bad "unexpected hosts in source: $hosts"

# 5. ffmpeg-kit is the exact artifact that was reviewed.
PINNED="$(tr -d '[:space:]' < scripts/ffmpeg-kit.sha256)"
aar="$(find "${GRADLE_USER_HOME:-$HOME/.gradle}/caches" -name 'ffmpeg-kit-full-gpl-*.aar' | head -1)"
got="$(sha256sum "$aar" | cut -c1-64)"
[ "$got" = "$PINNED" ] && ok "ffmpeg-kit matches the pinned hash" || bad "ffmpeg-kit hash $got != pinned $PINNED"

exit $fail
