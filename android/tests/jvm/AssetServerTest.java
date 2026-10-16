package ci.anagroci.fieldbuying;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;

/**
 * Test JVM du VRAI code AssetServer.java (le même fichier que l'APK), exécuté
 * contre le VRAI paquet assets/www produit par prepare-web.mjs.
 * Lancement : android/tests/jvm/run.sh
 */
public final class AssetServerTest {
    static int pass = 0, fail = 0;
    static void check(String id, String label, boolean ok) {
        System.out.println((ok ? "PASS " : "FAIL ") + id + " " + label);
        if (ok) pass++; else fail++;
    }
    static String body(WebResourceResponse r) throws Exception {
        InputStream in = r.data; ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n); in.close(); return o.toString("UTF-8");
    }
    public static void main(String[] a) throws Exception {
        AssetServer s = new AssetServer(new AssetManager(new File(a[0])));
        String O = AssetServer.ORIGIN;

        WebResourceResponse fb = s.handle(Uri.parse(O + "/operations/field-buying.html"));
        String html = body(fb);
        check("JVM-01", "Page FIELD BUYING servie localement (200, text/html)", fb.status == 200 && "text/html".equals(fb.mime));
        check("JVM-02", "Pont natif injecté en premier dans <head>", html.indexOf("<head><script src=\"/_native/bridge.js\"></script>") > 0
              && html.indexOf("/_native/bridge.js") < html.indexOf("supabase"));
        check("JVM-03", "Code métier inchangé hormis l'injection", html.replace("<script src=\"/_native/bridge.js\"></script>", "")
              .equals(new String(java.nio.file.Files.readAllBytes(new File(a[0], "www/operations/field-buying.html").toPath()), "UTF-8")));

        WebResourceResponse sb = s.handle(Uri.parse("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"));
        check("JVM-04", "supabase-js servi depuis la copie locale (aucun réseau)", sb != null && sb.status == 200 && body(sb).startsWith("var supabase="));
        WebResourceResponse lc = s.handle(Uri.parse("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css"));
        WebResourceResponse li = s.handle(Uri.parse("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png"));
        check("JVM-05", "Leaflet CSS + images servis localement", lc != null && "text/css".equals(lc.mime) && li != null && "image/png".equals(li.mime));
        WebResourceResponse ft = s.handle(Uri.parse("https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"));
        check("JVM-06", "Polices Google servies localement", ft != null && body(ft).contains("@font-face{font-family:'Archivo'"));
        WebResourceResponse wf = s.handle(Uri.parse(O + "/_vendor/fonts/archivo-latin-700-normal.woff2"));
        check("JVM-07", "Fichier de police woff2 présent", wf != null && wf.status == 200 && "font/woff2".equals(wf.mime));
        check("JVM-08", "Supabase (API) laissé au réseau", s.handle(Uri.parse("https://jmbdgpdthzpszfnddwzi.supabase.co/rest/v1/profils")) == null);
        check("JVM-09", "Tuiles de carte laissées au réseau", s.handle(Uri.parse("https://tile.openstreetmap.org/1/1/1.png")) == null);
        check("JVM-10", "Fichier absent : 404 explicite", s.handle(Uri.parse(O + "/operations/inexistant.js")).status == 404);
        check("JVM-11", "Traversée de chemin refusée", s.handle(Uri.parse(O + "/../../AndroidManifest.xml")).status >= 403);
        check("JVM-12", "Requête ?v= de cache ignorée pour le fichier", s.handle(Uri.parse(O + "/shared/offline-field.js?v=20261016-android-1")).status == 200);
        check("JVM-13", "Service Worker non embarqué", s.handle(Uri.parse(O + "/sw.js")).status == 404);
        check("JVM-14", "Origine étrangère jamais servie comme locale", !s.isLocal(Uri.parse("https://appassets.androidplatform.net.evil.example/x"))
              && !s.isLocal(Uri.parse("http://appassets.androidplatform.net/x")));
        check("JVM-15", "Nom d'export assaini", NativeBridgeNames.sanitize("../../a:b?.xlsx").equals(".._.._a_b_.xlsx"));
        System.out.println("RESULTAT " + pass + " PASS / " + fail + " FAIL");
        if (fail > 0) System.exit(1);
    }
}
