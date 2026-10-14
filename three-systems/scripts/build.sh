#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node "$ROOT/scripts/install-node.mjs"
cd "$ROOT/frontend"
npm run build -- --mode monitor --outDir ../apps/monitor/ui --emptyOutDir
npm run build -- --mode adaptive --outDir ../apps/adaptive/ui --emptyOutDir
npm run build -- --mode prediction --outDir ../apps/prediction/ui --emptyOutDir
cd "$ROOT/backend"
if [ -n "${MAVEN_SETTINGS:-}" ]; then
  "${MAVEN_EXECUTABLE:-mvn}" -s "$MAVEN_SETTINGS" -B package
else
  "${MAVEN_EXECUTABLE:-mvn}" -B package
fi
mkdir -p "$ROOT/shared-runtime"
cp target/data-compress-control-system-v5-5.0.0.jar "$ROOT/shared-runtime/backend.jar"
