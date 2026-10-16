package ci.anagroci.fieldbuying;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageInfo;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Pont JavaScript exposé sous window.AnagrociNative.
 * Volontairement minimal : aucune donnée métier, aucun identifiant, aucun accès
 * à Supabase ne transite par ce pont. Il ne fait que ce que le navigateur
 * intégré Android ne sait pas faire seul : confirmer les fichiers embarqués,
 * enregistrer un export dans « Téléchargements » et imprimer.
 */
final class NativeBridge {
    private final MainActivity activity;
    private final AssetServer server;

    NativeBridge(MainActivity activity, AssetServer server) { this.activity = activity; this.server = server; }

    /** Vérifie la présence réelle des fichiers critiques listés au build. */
    @JavascriptInterface
    public String shellStatus() {
        JSONObject out = new JSONObject();
        try {
            JSONObject m = server.manifest();
            JSONArray critical = m.optJSONArray("critical");
            JSONArray missing = new JSONArray();
            if (critical == null || critical.length() == 0) missing.put("_native/bundle-manifest.json");
            else for (int i = 0; i < critical.length(); i++) {
                String f = critical.getString(i);
                if (!server.exists(f)) missing.put(f);
            }
            out.put("bundled", missing.length() == 0);
            out.put("missing", missing);
            out.put("version", appVersion());
            out.put("web_commit", m.optString("git_commit", null));
            out.put("web_built_at", m.optString("generated_at", null));
            out.put("files", m.optInt("file_count", 0));
        } catch (Exception e) {
            try { out.put("bundled", false); out.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return out.toString();
    }

    @JavascriptInterface
    public String appInfo() {
        JSONObject o = new JSONObject();
        try {
            o.put("app", "ANAGROCI FIELD BUYING");
            o.put("version", appVersion());
            o.put("android_sdk", Build.VERSION.SDK_INT);
            o.put("web_commit", server.manifest().optString("git_commit", null));
        } catch (Exception ignored) { }
        return o.toString();
    }

    private String appVersion() {
        try {
            PackageInfo p = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return p.versionName + " (" + p.versionCode + ")";
        } catch (Exception e) { return "?"; }
    }

    /** Enregistre un fichier produit par la page (export Excel, PDF, CSV…) dans Téléchargements/ANAGROCI. */
    @JavascriptInterface
    public String saveFile(String name, String mime, String base64) {
        try {
            final String safe = sanitize(name);
            final byte[] data = Base64.decode(base64, Base64.DEFAULT);
            final String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = activity.getContentResolver();
                ContentValues v = new ContentValues();
                v.put("_display_name", safe);
                v.put("mime_type", type);
                v.put("relative_path", "Download/ANAGROCI");
                v.put("is_pending", 1);
                Uri uri = cr.insert(Uri.parse("content://media/external/downloads"), v);
                if (uri == null) throw new IllegalStateException("Téléchargements indisponible");
                OutputStream os = cr.openOutputStream(uri);
                try { os.write(data); } finally { os.close(); }
                ContentValues done = new ContentValues(); done.put("is_pending", 0);
                cr.update(uri, done, null, null);
                activity.onFileSaved(safe, uri, type);
            } else {
                if (!activity.ensureLegacyStoragePermission()) {
                    toast("Autorisez l'accès au stockage puis relancez l'export.");
                    return "{\"ok\":false,\"reason\":\"permission\"}";
                }
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "ANAGROCI");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Dossier Téléchargements inaccessible");
                File f = new File(dir, safe);
                FileOutputStream fo = new FileOutputStream(f);
                try { fo.write(data); } finally { fo.close(); }
                MediaScannerConnection.scanFile(activity, new String[]{f.getAbsolutePath()}, new String[]{type},
                        new MediaScannerConnection.OnScanCompletedListener() {
                            @Override public void onScanCompleted(String path, Uri uri) { activity.onFileSaved(safe, uri, type); }
                        });
            }
            return "{\"ok\":true}";
        } catch (Exception e) {
            toast("Enregistrement impossible : " + e.getMessage());
            return "{\"ok\":false}";
        }
    }

    @JavascriptInterface
    public void print(final String title) {
        activity.runOnUiThread(new Runnable() { @Override public void run() {
            PrintManager pm = (PrintManager) activity.getSystemService(android.content.Context.PRINT_SERVICE);
            String job = (title == null || title.isEmpty()) ? "ANAGROCI" : title;
            pm.print(job, activity.webView().createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
        }});
    }

    private void toast(final String msg) {
        activity.runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(activity, msg, Toast.LENGTH_LONG).show(); } });
    }

    static String sanitize(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (n.isEmpty()) n = "export-anagroci";
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n;
    }
}
