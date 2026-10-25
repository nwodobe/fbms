#!/usr/bin/env bash
# Bout en bout format 2 : vraie chaîne de publication Node + vrai Java de l'APK + vrai HTTPS local.
# Tout se passe dans un dossier temporaire : copie isolée du dépôt, clés de TEST jetables,
# certificat TLS de test. Rien n'est écrit dans le dépôt, rien n'est publié.
# Prérequis : JDK 17+, Node 22, git, keytool, org.json Android (apt install libandroid-json-java).
# Usage : android/tests/jvm/run-format2-e2e.sh [dossier où copier les résultats]
set -euo pipefail
cd "$(dirname "$0")"; HERE=$(pwd); A=$HERE/../..; REPO=$(cd "$A/.." && pwd)
JSON_JAR=${JSON_JAR:-/usr/share/java/com.android.json.jar}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
CLONE=$WORK/depot; mkdir -p "$CLONE"

# 1. Copie isolée de l'état courant du dépôt (fichiers suivis + nouveaux non ignorés), nouveau dépôt Git
( cd "$REPO" && git ls-files -co --exclude-standard -z | tar --null -cf - -T - ) | ( cd "$CLONE" && tar -xf - )
[[ -d "$A/.vendor-cache" ]] && cp -r "$A/.vendor-cache" "$CLONE/android/.vendor-cache"
git -C "$CLONE" init -q
git -C "$CLONE" -c user.email=test@example.invalid -c user.name=test add -A
git -C "$CLONE" -c user.email=test@example.invalid -c user.name=test commit -qm "base de test"

# 2. APK simulé : paquet embarqué construit sur ce commit (même code que l'APK réel)
( cd "$CLONE" && node android/scripts/prepare-web.mjs >/dev/null )

# 3. Clés de TEST (hors copie du dépôt) et certificat TLS de test pour localhost
node "$CLONE/android/scripts/sign-web-bundle.mjs" --generate-keys "$WORK/cles-test" >/dev/null
node -e "const c=require('crypto'),fs=require('fs');process.stdout.write(c.createPublicKey(fs.readFileSync(process.argv[1],'utf8')).export({type:'spki',format:'der'}).toString('hex'))" "$WORK/cles-test/web-bundle-public.pem" > "$WORK/pub.hex"
keytool -genkeypair -alias tls -keyalg EC -groupname secp256r1 -dname CN=localhost -ext SAN=dns:localhost \
  -storetype PKCS12 -keystore "$WORK/tls.p12" -storepass test-only -keypass test-only -validity 2 >/dev/null 2>&1

# 4. Compilation du vrai code Java + test
OUT=$WORK/classes; SRC=$A/app/src/main/java/ci/anagroci/fieldbuying
javac -nowarn -encoding UTF-8 -cp "$JSON_JAR" -d "$OUT" $(find stubs -name '*.java') \
  "$SRC/AssetServer.java" "$SRC/WebBundleUpdater.java" Format2EndToEndTest.java

# 5. Exécution
mkdir -p "$WORK/canal"
set +e
java -Dstdout.encoding=UTF-8 -cp "$OUT:$JSON_JAR" ci.anagroci.fieldbuying.Format2EndToEndTest \
  "$CLONE" "$CLONE/android/app/src/main/assets" "$WORK/cles-test/web-bundle-private.pem" "$WORK/pub.hex" "$WORK/travail" "$WORK/tls.p12" "$WORK/canal"
code=$?
set -e
if [[ -n "${1:-}" ]]; then
  mkdir -p "$1"
  cp "$WORK/travail/resultats.txt" "$1/format2-e2e-resultats.txt" 2>/dev/null || true
  cp "$WORK/canal/releases.json" "$1/format2-e2e-journal.json" 2>/dev/null || true
  cp "$WORK/canal/version.json" "$1/format2-e2e-version.json" 2>/dev/null || true
fi
exit $code
