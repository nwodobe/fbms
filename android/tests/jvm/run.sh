#!/usr/bin/env bash
# Tests JVM du vrai code Java de l'APK (AssetServer.java, WebBundleUpdater.java) contre le paquet
# assets/www réel. Prérequis : JDK, Node, org.json Android (Debian : apt install libandroid-json-java ;
# ou JSON_JAR=chemin/json.jar), puis node android/scripts/prepare-web.mjs.
set -euo pipefail
cd "$(dirname "$0")"; A=../..; OUT=$(mktemp -d); WORK=$(mktemp -d)
trap 'rm -rf "$OUT" "$WORK"' EXIT
JSON_JAR=${JSON_JAR:-/usr/share/java/com.android.json.jar}
SRC=$A/app/src/main/java/ci/anagroci/fieldbuying
# La règle de nommage testée doit être identique à celle de NativeBridge.java
diff <(sed -n '/static String sanitize/,/^    }/p' $SRC/NativeBridge.java) \
     <(sed -n '/static String sanitize/,/^    }/p' NativeBridgeNames.java) >/dev/null || { echo "FAIL règle sanitize divergente"; exit 1; }
javac -nowarn -encoding UTF-8 -cp "$JSON_JAR" -d "$OUT" $(find stubs -name '*.java') \
  $SRC/AssetServer.java $SRC/WebBundleUpdater.java NativeBridgeNames.java AssetServerTest.java WebBundleUpdaterTest.java

# Paquet embarqué régénéré sur le commit courant : APK et manifeste Node décrivent le même commit.
( cd $A/.. && node android/scripts/prepare-web.mjs >/dev/null )
java -Dstdout.encoding=UTF-8 -cp "$OUT:$JSON_JAR" ci.anagroci.fieldbuying.AssetServerTest "$A/app/src/main/assets"
# Interopérabilité : manifeste signé par le VRAI script Node, avec une clé jetable hors du dépôt.
node $A/scripts/sign-web-bundle.mjs --generate-keys "$WORK/keys" >/dev/null
REPO=$(cd $A/.. && pwd)
[[ -e "$REPO/android-updates" ]] && { echo "android-updates/ existe déjà : test d'interopérabilité impossible sans l'écraser"; exit 1; }
node $A/scripts/sign-web-bundle.mjs --key "$WORK/keys/web-bundle-private.pem" --min-native 2 >/dev/null  # format 1 historique : APK simulé versionCode 2
mv "$REPO/android-updates/stable/web-bundle.json" "$REPO/android-updates/stable/web-bundle.json.sig" "$WORK/"
rm -rf "$REPO/android-updates"
node -e "const c=require('crypto'),fs=require('fs');process.stdout.write(c.createPublicKey(fs.readFileSync(process.argv[1],'utf8')).export({type:'spki',format:'der'}).toString('hex'))" "$WORK/keys/web-bundle-public.pem" > "$WORK/pub.hex"
java -Dstdout.encoding=UTF-8 -cp "$OUT:$JSON_JAR" ci.anagroci.fieldbuying.WebBundleUpdaterTest "$A/app/src/main/assets" \
  "$WORK/web-bundle.json" "$WORK/web-bundle.json.sig" "$WORK/pub.hex" "$WORK/state"
