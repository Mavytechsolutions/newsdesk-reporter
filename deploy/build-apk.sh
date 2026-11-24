#!/bin/bash
# Builds the MAVY NEWS Android APK inside a container (Hostinger VPS, project "mavy-apk").
# Result: /out/mavy-news.apk and a download page /out/index.html (served on port 8475).
set -eo pipefail
OUT=/out
mkdir -p "$OUT"
page() {
  cat > "$OUT/index.html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAVY NEWS app</title><style>body{font-family:sans-serif;background:#0B1F3A;color:#fff;text-align:center;padding:40px 20px}
a.b{display:inline-block;background:#16A34A;color:#fff;padding:18px 28px;border-radius:14px;font-size:20px;text-decoration:none;font-weight:bold}
p{opacity:.85;line-height:1.6}</style></head><body><h1>MAVY <span style="color:#16A34A">NEWS</span></h1>$1</body></html>
HTML
}
page "<h2>Building the app…</h2><p>Started $(date '+%d %b %Y %H:%M') UTC.<br>This takes about 20–40 minutes.<br>Refresh this page later.</p>"
trap 'page "<h2>Build failed</h2><p>$(date)</p><p>Claude will check the log and fix it.</p>"' ERR

echo "== installing Java and tools"
apt-get update -qq
apt-get install -y -qq openjdk-17-jdk-headless unzip >/dev/null

export ANDROID_HOME=/cache/android-sdk ANDROID_SDK_ROOT=/cache/android-sdk GRADLE_USER_HOME=/cache/gradle
export JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(which javac)")")")
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "== downloading Android SDK tools"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl -4 -fsSL --retry 8 --retry-delay 5 -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
set +o pipefail
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1
set -o pipefail
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" >/dev/null

echo "== installing app packages"
cd /src/apps/mobile
npm install --no-audit --no-fund --loglevel=error

echo "== preparing Android project (server: $API_URL)"
export EXPO_PUBLIC_API_URL="$API_URL" CI=1
npx expo prebuild --platform android --no-install --clean

cd android
# Download Gradle with curl (retries) instead of the wrapper's 10-second timeout, and keep it for next builds.
DIST=$(grep '^distributionUrl=' gradle/wrapper/gradle-wrapper.properties | cut -d= -f2- | sed 's#\\:#:#g')
NAME=$(basename "$DIST")
[ -s "/cache/$NAME" ] || curl -4 -fL --retry 8 --retry-delay 5 --connect-timeout 30 -o "/cache/$NAME" "$DIST"
sed -i "s#^distributionUrl=.*#distributionUrl=file\\:/cache/$NAME#" gradle/wrapper/gradle-wrapper.properties
export JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"
printf '\norg.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1g\nreactNativeArchitectures=arm64-v8a,armeabi-v7a\norg.gradle.parallel=true\nsystemProp.org.gradle.internal.http.connectionTimeout=120000\nsystemProp.org.gradle.internal.http.socketTimeout=120000\nsystemProp.org.gradle.internal.repository.max.retries=8\n' >> gradle.properties
# ---- Play Store signing: upload key lives only on the VPS (/keys), never in GitHub ----
mkdir -p /keys && chmod 700 /keys
if [ ! -s /keys/upload.jks ]; then
  echo "== creating the Play Store upload key (first time only)"
  head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > /keys/upload.pass
  keytool -genkeypair -keystore /keys/upload.jks -alias mavyupload -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$(cat /keys/upload.pass)" -keypass "$(cat /keys/upload.pass)" \
    -dname "CN=MAVY TECH SOLUTIONS PVT LTD, O=MAVY TECH SOLUTIONS PVT LTD, L=Anantapur, ST=Andhra Pradesh, C=IN" >/dev/null
  chmod 600 /keys/upload.jks /keys/upload.pass
fi
keytool -list -keystore /keys/upload.jks -storepass "$(cat /keys/upload.pass)" -alias mavyupload | grep -i "SHA-256\|SHA256" || true
# every build gets a higher version number (Play requires it)
VC=$(( $(date +%s) / 60 - 29900000 ))
node - "$VC" <<'NODE'
const fs = require('fs'); const vc = process.argv[2];
const f = 'app/build.gradle'; let g = fs.readFileSync(f, 'utf8');
g = g.replace(/versionCode \d+/, `versionCode ${vc}`).replace(/versionName "[^"]*"/, `versionName "1.0.${vc}"`);
g = g.replace(/signingConfigs \{/, `signingConfigs {
        upload {
            storeFile file('/keys/upload.jks')
            storePassword new File('/keys/upload.pass').text.trim()
            keyAlias 'mavyupload'
            keyPassword new File('/keys/upload.pass').text.trim()
        }`);
g = g.replace(/(release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.upload');
if (!g.includes('signingConfigs.upload')) { console.error('could not set release signing'); process.exit(1); }
fs.writeFileSync(f, g);
console.log('version', vc);
NODE
echo "== compiling APK + Play Store bundle (longest step)"
./gradlew assembleRelease bundleRelease --no-daemon --console=plain -q

mkdir -p "$OUT/release"
cp app/build/outputs/bundle/release/app-release.aab "$OUT/release/mavy-news.aab"
echo "$VC" > "$OUT/release/version.txt"
cp app/build/outputs/apk/release/app-release.apk "$OUT/mavy-news.apk"
SIZE=$(du -m "$OUT/mavy-news.apk" | cut -f1)
page "<p>Version 1.0.${VC} · ${SIZE} MB · built $(date '+%d %b %Y %H:%M') UTC</p><p><a class=b href=\"mavy-news.apk\">⬇ Download MAVY NEWS app</a></p><p>After downloading, open the file and tap <b>Install</b>.<br>If Android asks, allow installing from this source.</p>"
echo "== APK READY: $SIZE MB"
