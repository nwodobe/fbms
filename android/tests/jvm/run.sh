#!/usr/bin/env bash
# Test JVM d'AssetServer.java contre le paquet assets/www réel. Prérequis : JDK, org.json Android
# (Debian : apt install libandroid-json-java ; ou JSON_JAR=chemin/json.jar), puis prepare-web.mjs.
set -euo pipefail
cd "$(dirname "$0")"; A=../..; OUT=$(mktemp -d)
JSON_JAR=${JSON_JAR:-/usr/share/java/com.android.json.jar}
# La règle de nommage testée doit être identique à celle de NativeBridge.java
diff <(sed -n '/static String sanitize/,/^    }/p' $A/app/src/main/java/ci/anagroci/fieldbuying/NativeBridge.java) \
     <(sed -n '/static String sanitize/,/^    }/p' NativeBridgeNames.java) >/dev/null || { echo "FAIL règle sanitize divergente"; exit 1; }
javac -nowarn -encoding UTF-8 -cp "$JSON_JAR" -d "$OUT" $(find stubs -name '*.java') \
  $A/app/src/main/java/ci/anagroci/fieldbuying/AssetServer.java NativeBridgeNames.java AssetServerTest.java
java -Dstdout.encoding=UTF-8 -cp "$OUT:$JSON_JAR" ci.anagroci.fieldbuying.AssetServerTest "$A/app/src/main/assets"
