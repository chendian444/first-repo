#!/usr/bin/env bash
# Dependency-light Android SDK build; no Gradle download required.
set -euo pipefail
if [[ -n "${JAVA_HOME:-}" ]]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
project_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_dir" ]]; then echo 'Set ANDROID_SDK_ROOT to an installed Android SDK.' >&2; exit 1; fi
platform_jar="${ANDROID_PLATFORM_JAR:-$sdk_dir/platforms/android-35/android.jar}"
tools_dir="${ANDROID_BUILD_TOOLS:-$sdk_dir/build-tools/35.0.0}"
output_dir="$project_dir/app/build/sdk"
mkdir -p "$output_dir/classes" "$output_dir/generated" "$output_dir/dex"
"$tools_dir/aapt2" compile --dir "$project_dir/app/src/main/res" -o "$output_dir/resources.zip"
sed 's/<manifest /<manifest package="com.chendian.wheellink" /' "$project_dir/app/src/main/AndroidManifest.xml" > "$output_dir/AndroidManifest.xml"
"$tools_dir/aapt2" link -o "$output_dir/resources.apk" --manifest "$output_dir/AndroidManifest.xml" -I "$platform_jar" --java "$output_dir/generated" "$output_dir/resources.zip" --version-code 1 --version-name 1.0.0
find "$project_dir/app/src/main/java" "$output_dir/generated" -name '*.java' > "$output_dir/sources.txt"
javac -encoding UTF-8 --release 8 -classpath "$platform_jar:$project_dir/app/libs/annotation-1.3.0.jar" -d "$output_dir/classes" @"$output_dir/sources.txt"
jar cf "$output_dir/classes.jar" -C "$output_dir/classes" .
"$tools_dir/d8" --lib "$platform_jar" --min-api 26 --output "$output_dir/dex" "$output_dir/classes.jar"
cp "$output_dir/resources.apk" "$output_dir/unaligned.apk"
(cd "$output_dir/dex" && zip -q "$output_dir/unaligned.apk" classes*.dex)
"$tools_dir/zipalign" -f 4 "$output_dir/unaligned.apk" "$output_dir/aligned.apk"
# Development signing key is kept outside source control; not a release identity.
sign_key="${ANDROID_DEBUG_KEYSTORE:-$output_dir/development.keystore}"
if [[ ! -f "$sign_key" ]]; then
  keytool -genkeypair -keystore "$sign_key" -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 3650 >/dev/null 2>&1
fi
"$tools_dir/apksigner" sign --ks "$sign_key" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$output_dir/wheel-link-debug.apk" "$output_dir/aligned.apk"
"$tools_dir/apksigner" verify --verbose "$output_dir/wheel-link-debug.apk"
echo "APK: $output_dir/wheel-link-debug.apk"
