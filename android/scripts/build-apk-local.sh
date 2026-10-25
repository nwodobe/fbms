#!/usr/bin/env bash
# =============================================================================
# Compilation de l'APK ANAGROCI FIELD BUYING SANS Gradle ni Android Studio,
# avec les seuls outils du SDK Android (aapt2, javac, dx/d8, zipalign, apksigner).
#
# Utile sur une machine Linux sans accès à Google Maven (ex. Debian/Ubuntu :
#   sudo apt install android-sdk-build-tools android-sdk-platform-23 apksigner zipalign
# ). L'application n'a AUCUNE dépendance externe : seule la plateforme Android
# est nécessaire. Le projet Gradle (android/app/build.gradle) produit le même APK
# depuis Android Studio.
#
# Usage (depuis la racine du dépôt) :
#   android/scripts/build-apk-local.sh                 # APK non signé + APK debug
#   KEYSTORE=/chemin/anagroci-release.jks KEY_ALIAS=anagroci \
#     android/scripts/build-apk-local.sh --release     # + APK release signé
#   (mot de passe demandé de façon interactive, ou variable KS_PASS / KEY_PASS)
#
# Variables : ANDROID_JAR, BUILD_TOOLS (détectés automatiquement si absents).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$(pwd); A="$REPO/android"; APP="$A/app/src/main"
OUT="$A/build/local"; TMP="$OUT/tmp"
RELEASE=0; [[ "${1:-}" == "--release" ]] && RELEASE=1
# Variante de test : suffixe d'identifiant et nom affiché (défaut : .debug / « ANAGROCI FB TEST »).
# Un suffixe distinct (ex. DEBUG_SUFFIX=.majtest) installe l'APK de test À CÔTÉ de toute version déjà
# présente sur un téléphone, sans jamais toucher à ses données ni à sa file hors ligne.
DEBUG_SUFFIX=${DEBUG_SUFFIX:-.debug}; DEBUG_LABEL=${DEBUG_LABEL:-ANAGROCI FB TEST}
[[ "$DEBUG_SUFFIX" =~ ^\.[a-z][a-z0-9]{1,20}$ ]] || { echo "DEBUG_SUFFIX invalide : $DEBUG_SUFFIX"; exit 1; }

prop() { grep -E "^$1=" "$A/version.properties" | cut -d= -f2- | tr -d '\r'; }
APP_ID=$(prop applicationId); VCODE=$(prop versionCode); VNAME=$(prop versionName)
MIN=$(prop minSdk); TARGET=$(prop targetSdk)

BUILD_TOOLS=${BUILD_TOOLS:-$(ls -d "${ANDROID_HOME:-/usr/lib/android-sdk}"/build-tools/* 2>/dev/null | sort -V | tail -1)}
ANDROID_JAR=${ANDROID_JAR:-$(ls "${ANDROID_HOME:-/usr/lib/android-sdk}"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)}
[[ -x "$BUILD_TOOLS/aapt2" ]] || { echo "aapt2 introuvable (BUILD_TOOLS=$BUILD_TOOLS)"; exit 1; }
[[ -f "$ANDROID_JAR" ]] || { echo "android.jar introuvable"; exit 1; }
AAPT2="$BUILD_TOOLS/aapt2"; ZIPALIGN=$(command -v zipalign || echo "$BUILD_TOOLS/zipalign")
APKSIGNER=$(command -v apksigner || echo "$BUILD_TOOLS/apksigner")
# Dexeur : d8 (SDK récent), sinon dx du SDK, sinon dalvik-exchange (paquet Debian/Ubuntu « dalvik-exchange »)
if [[ -x "$BUILD_TOOLS/d8" ]]; then DEXER=d8; DX=""
elif [[ -x "$BUILD_TOOLS/dx" ]]; then DEXER=dx; DX="$BUILD_TOOLS/dx"
elif command -v dalvik-exchange >/dev/null; then DEXER=dx; DX=$(command -v dalvik-exchange)
else echo "Aucun dexeur (d8, dx ou dalvik-exchange)"; exit 1; fi

echo "== ANAGROCI FIELD BUYING $VNAME ($VCODE) · $APP_ID · minSdk $MIN · targetSdk $TARGET"
echo "== outils : $(basename "$BUILD_TOOLS") · $(basename "$(dirname "$ANDROID_JAR")") · dex=$DEXER"

rm -rf "$OUT"; mkdir -p "$TMP/res" "$TMP/gen" "$TMP/classes"

# 1. Paquet Web (mêmes fichiers que GitHub Pages + bibliothèques figées)
node "$A/scripts/prepare-web.mjs" > "$OUT/prepare-web.json"
cat "$OUT/prepare-web.json"

trap 'rm -rf "$TMP"' EXIT
# 2. Manifeste de build : identité injectée depuis version.properties
python3 - "$APP/AndroidManifest.xml" "$TMP" "$APP_ID" "$VCODE" "$VNAME" "$MIN" "$TARGET" "$DEBUG_SUFFIX" "$DEBUG_LABEL" <<'PY'
import sys
src,tmp,pkg,vc,vn,mn,tg,suf,lab=sys.argv[1:]
base=open(src,encoding='utf-8').read()
def build(app_id,label,debug):
    s=base.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
     f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{app_id}" android:versionCode="{vc}" android:versionName="{vn}">\n    <uses-sdk android:minSdkVersion="{mn}" android:targetSdkVersion="{tg}" />',1)
    s=s.replace('${applicationId}',app_id).replace('${appLabel}',label)
    if debug: s=s.replace('<application','<application android:debuggable="true"',1)
    assert '${' not in s, 'variable de manifeste non remplacée'
    return s
open(tmp+'/AndroidManifest.xml','w',encoding='utf-8').write(build(pkg,'@string/app_name',False))
open(tmp+'/AndroidManifest.debug.xml','w',encoding='utf-8').write(build(pkg+suf,lab,True))
PY

# 3. Ressources
"$AAPT2" compile --dir "$APP/res" -o "$TMP/res.zip"
link() { # $1 manifeste, $2 sortie, $3 dossier R.java (facultatif)
  "$AAPT2" link -I "$ANDROID_JAR" --manifest "$1" -A "$APP/assets" \
    --min-sdk-version "$MIN" --target-sdk-version "$TARGET" --version-code "$VCODE" --version-name "$VNAME" \
    ${3:+--java "$3"} -o "$2" "$TMP/res.zip" -0 woff2 -0 png
}
link "$TMP/AndroidManifest.xml" "$TMP/base.apk" "$TMP/gen"
# R.java est généré pour le package de base ; la variante debug change seulement l'identifiant
link "$TMP/AndroidManifest.debug.xml" "$TMP/base-debug.apk"

# 4. Java -> bytecode Java 8 -> dex
find "$APP/java" "$TMP/gen" -name '*.java' > "$TMP/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$TMP/classes" @"$TMP/sources.txt"
if [[ $DEXER == d8 ]]; then
  "$BUILD_TOOLS/d8" --release --min-api "$MIN" --lib "$ANDROID_JAR" --output "$TMP" $(find "$TMP/classes" -name '*.class')
else
  "$DX" --dex --min-sdk-version="$MIN" --output="$TMP/classes.dex" "$TMP/classes"
fi
cp "$TMP/base.apk" "$TMP/unaligned.apk"; cp "$TMP/base-debug.apk" "$TMP/unaligned-debug.apk"
(cd "$TMP" && zip -q -j unaligned.apk classes.dex && zip -q -j unaligned-debug.apk classes.dex)

# 5. Alignement
UNSIGNED="$OUT/ANAGROCI_FIELD_BUYING_AFLP_2027_v${VNAME}_unsigned.apk"
"$ZIPALIGN" -p -f 4 "$TMP/unaligned.apk" "$UNSIGNED"
"$ZIPALIGN" -c -p 4 "$UNSIGNED"
"$ZIPALIGN" -p -f 4 "$TMP/unaligned-debug.apk" "$TMP/aligned-debug.apk"

# 6. APK debug (android:debuggable, inspectable via chrome://inspect) : clé de debug
#    locale, générée si absente, JAMAIS commitée. Ne pas distribuer à l'équipe.
DEBUG_KS=${DEBUG_KEYSTORE:-$HOME/.android/anagroci-debug.keystore}
if [[ ! -f "$DEBUG_KS" ]]; then
  mkdir -p "$(dirname "$DEBUG_KS")"
  keytool -genkeypair -keystore "$DEBUG_KS" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
DEBUG_APK="$OUT/ANAGROCI_FIELD_BUYING_AFLP_2027_v${VNAME}_${DEBUG_SUFFIX#.}.apk"
"$APKSIGNER" sign --ks "$DEBUG_KS" --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey \
  --v4-signing-enabled false --min-sdk-version "$MIN" --out "$DEBUG_APK" "$TMP/aligned-debug.apk"
"$APKSIGNER" verify --min-sdk-version "$MIN" "$DEBUG_APK"
echo "APK debug   : $DEBUG_APK"

# 7. APK release signé (clé de l'organisation, fournie par l'opérateur)
if [[ $RELEASE == 1 ]]; then
  : "${KEYSTORE:?KEYSTORE requis pour --release}" "${KEY_ALIAS:?KEY_ALIAS requis}"
  REL="$OUT/ANAGROCI_FIELD_BUYING_AFLP_2027_v${VNAME}.apk"
  ARGS=(--ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" --min-sdk-version "$MIN" --out "$REL")
  [[ -n "${KS_PASS:-}" ]] && ARGS+=(--ks-pass env:KS_PASS)
  if [[ -n "${KEY_PASS:-}" ]]; then ARGS+=(--key-pass env:KEY_PASS); elif [[ -n "${KS_PASS:-}" ]]; then ARGS+=(--key-pass env:KS_PASS); fi
  ARGS+=(--v4-signing-enabled false)
  "$APKSIGNER" sign "${ARGS[@]}" "$UNSIGNED"
  "$APKSIGNER" verify --min-sdk-version "$MIN" --print-certs "$REL" | grep -E "Signer #1 certificate (DN|SHA-256)"
  echo "APK release : $REL"
fi
rm -rf "$TMP"
( cd "$OUT" && sha256sum *.apk > SHA256SUMS.txt && cat SHA256SUMS.txt )
