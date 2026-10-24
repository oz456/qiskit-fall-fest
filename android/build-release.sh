#!/usr/bin/env bash
# Usage: ./build-release.sh https://qff-api-xxxxx.a.run.app
# Produces a signed release APK pointing at your deployed backend.
set -euo pipefail
API="${1:?pass the Cloud Run URL, e.g. https://qff-api-xxxx.a.run.app}"
[[ "$API" == https://* ]] || { echo "API URL must be https"; exit 1; }
cd "$(dirname "$0")"
./gradlew --no-daemon :app:assembleRelease -PapiBase="$API"
mkdir -p ../android-artifacts
OUT="../android-artifacts/qff-2026.apk"
cp app/build/outputs/apk/release/app-release.apk "$OUT"
cp "$OUT" ../server/public/downloads/qff-2026.apk   # served by /downloads
sha256sum "$OUT" | cut -d" " -f1 > ../server/public/downloads/qff-2026.apk.sha256   # shown on the download page so people can verify what they installed
"${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/35.0.0/apksigner verify --print-certs "$OUT" | head -2
echo "APK: $(cd .. && pwd)/android-artifacts/qff-2026.apk"
