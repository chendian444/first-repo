#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -f app.jar ]; then
  mvn -B clean package
  cp target/03-rate-prediction-1.0.0.jar app.jar
fi
exec java -jar app.jar "$@"
