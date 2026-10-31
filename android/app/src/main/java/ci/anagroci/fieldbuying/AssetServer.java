package ci.anagroci.fieldbuying;

import android.content.res.AssetManager;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sert l'application Web ANAGROCI depuis les fichiers embarqués dans l'APK
 * (assets/www) sous une origine HTTPS locale, sans aucun serveur.
 *
 * - Origine locale : https://appassets.androidplatform.net/ (domaine réservé
 *   par Android à cet usage, jamais résolu sur Internet).
 * - Les bibliothèques chargées depuis des CDN (supabase-js, Leaflet, ExcelJS,
 *   XLSX, Chart.js, polices) sont servies depuis des copies locales figées :
 *   l'application démarre et fonctionne sans réseau.
 * - Toute autre requête (Supabase, tuiles de carte, etc.) part sur le réseau,
 *   inchangée : la base centrale reste l'unique source de vérité.
 */
final class AssetServer {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    private static final String TAG = "AnagrociAssets";
    private static final String ROOT = "www";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final Pattern HEAD = Pattern.compile("<head[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final String BRIDGE_TAG = "<script src=\"/_native/bridge.js\"></script>";

    private final AssetManager assets;
    /** URL CDN (sans requête) -> chemin local sous assets/www. */
    private final Map<String, String> vendor = new HashMap<>();
    private JSONObject manifest = new JSONObject();
    /** Mise à jour Web signée et vérifiée (facultative). null = fichiers de l'APK uniquement. */
    private volatile WebBundleUpdater updater;

    AssetServer(AssetManager assets) {
        this.assets = assets;
        try {
            manifest = new JSONObject(readText(ROOT + "/_native/bundle-manifest.json"));
            JSONObject map = manifest.optJSONObject("vendor_map");
            if (map != null) {
                Iterator<String> it = map.keys();
                while (it.hasNext()) { String k = it.next(); vendor.put(k, map.getString(k)); }
            }
        } catch (Exception e) {
            Log.e(TAG, "Manifeste du paquet Web illisible", e);
        }
    }

    JSONObject manifest() { return manifest; }

    void setUpdater(WebBundleUpdater u) { this.updater = u; }

    boolean isLocal(Uri u) { return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost()); }

    /** @return une réponse locale, ou null pour laisser la requête partir sur le réseau. */
    WebResourceResponse handle(Uri u) {
        if (u == null) return null;
        if (isLocal(u)) return local(u.getPath());
        String key = vendorKey(u);
        String path = key == null ? null : vendor.get(key);
        if (path != null) return serve(path, false);
        return null;
    }

    /** Clé de correspondance CDN : hôte + chemin, et la requête pour Google Fonts. */
    static String vendorKey(Uri u) {
        String host = u.getHost();
        if (host == null) return null;
        /* Toutes les pages n'utilisent que Archivo, IBM Plex Sans et IBM Plex Mono :
           une feuille locale unique couvre chaque variante demandée. */
        if ("fonts.googleapis.com".equals(host)) return "https://fonts.googleapis.com/css";
        if ("cdn.jsdelivr.net".equals(host) || "unpkg.com".equals(host) || "cdnjs.cloudflare.com".equals(host)) {
            return "https://" + host + u.getPath();
        }
        return null;
    }

    private WebResourceResponse local(String path) {
        if (path == null || path.isEmpty() || path.endsWith("/")) path = (path == null ? "/" : path) + "index.html";
        path = Uri.decode(path);
        if (path.contains("..")) return status(403, "Interdit");
        return serve(path.substring(1), true);
    }

    private WebResourceResponse serve(String rel, boolean injectBridge) {
        String asset = ROOT + "/" + rel;
        String mime = mime(rel);
        /* Un fichier d'une mise à jour signée n'est servi que pour l'application Web
           elle-même : jamais pour le pont natif ni pour les bibliothèques figées. */
        WebBundleUpdater u = updater;
        java.io.File over = (u == null || !injectBridge) ? null : u.resolve(rel);
        try {
            if (over != null) {
                if (mime.equals("text/html")) {
                    String html = new String(WebBundleUpdater.readAll(over, WebBundleUpdater.MAX_FILE), UTF8);
                    Matcher m = HEAD.matcher(html);
                    html = m.find() ? html.substring(0, m.end()) + BRIDGE_TAG + html.substring(m.end()) : BRIDGE_TAG + html;
                    return ok(mime, new ByteArrayInputStream(html.getBytes(UTF8)));
                }
                return ok(mime, new java.io.FileInputStream(over));
            }
            if (injectBridge && mime.equals("text/html")) {
                String html = readText(asset);
                Matcher m = HEAD.matcher(html);
                html = m.find() ? html.substring(0, m.end()) + BRIDGE_TAG + html.substring(m.end()) : BRIDGE_TAG + html;
                return ok(mime, new ByteArrayInputStream(html.getBytes(UTF8)));
            }
            return ok(mime, assets.open(asset, AssetManager.ACCESS_STREAMING));
        } catch (IOException e) {
            return status(404, "Fichier absent de l'application : " + rel);
        }
    }

    boolean exists(String rel) {
        WebBundleUpdater u = updater;
        if (u != null && u.resolve(rel) != null) return true;
        try { InputStream in = assets.open(ROOT + "/" + rel); in.close(); return true; }
        catch (IOException e) { return false; }
    }

    private static WebResourceResponse ok(String mime, InputStream in) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        h.put("X-Content-Type-Options", "nosniff");
        String enc = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("svg+xml") ? "utf-8" : null;
        return new WebResourceResponse(mime, enc, 200, "OK", h, in);
    }

    private static WebResourceResponse status(int code, String msg) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", code, code == 404 ? "Not Found" : "Forbidden", h,
                new ByteArrayInputStream(msg.getBytes(UTF8)));
    }

    String readText(String asset) throws IOException {
        InputStream in = assets.open(asset);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), UTF8);
        } finally { in.close(); }
    }

    static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int q = p.indexOf('?'); if (q >= 0) p = p.substring(0, q);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css") || p.contains("fonts.googleapis")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".map")) return "application/json";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }
}
