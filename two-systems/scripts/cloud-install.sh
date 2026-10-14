#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# The onboarding snapshot retains this verified Debian JDK and the supplied Maven toolchain.
export JAVA_HOME=/workspace/scratch/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
export MAVEN_EXECUTABLE=/workspace/scratch/tooling/apache-maven-3.9.11/bin/mvn
export MAVEN_SETTINGS=/workspace/scratch/maven-settings.xml
test -x "$JAVA_HOME/bin/javac"
test -x "$MAVEN_EXECUTABLE"
node "$ROOT/scripts/configure-maven.mjs" "$MAVEN_SETTINGS" /workspace/scratch/m2
sh "$ROOT/scripts/build.sh"
cd "$ROOT/bridge"
npm test
