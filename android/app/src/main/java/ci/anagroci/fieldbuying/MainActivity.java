package ci.anagroci.fieldbuying;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * ANAGROCI FIELD BUYING — AFLP 2027 | Field Operations.
 *
 * Une seule activité, un seul WebView. Les fichiers de l'application Web sont
 * embarqués (AssetServer) ; l'authentification, les rôles et les données
 * restent ceux de Supabase, exactement comme sur la version Web.
 */
public class MainActivity extends Activity {
    static final String START = AssetServer.ORIGIN + "/operations/field-buying.html";

    private static final int REQ_FILE = 41;
    private static final int REQ_LOCATION = 42;
    private static final int REQ_STORAGE = 43;

    private WebView web;
    private AssetServer server;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingPhoto;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    WebView webView() { return web; }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#053B23"));
        w.setNavigationBarColor(Color.parseColor("#053B23"));
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        server = new AssetServer(getAssets());
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#053B23"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage : session Supabase, profil en cache
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);           // aucun accès file:// : tout passe par l'origine locale
        s.setAllowContentAccess(true);         // nécessaire pour lire la photo prise (content://)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);    // window.open → même vue, puis routage ci-dessous
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " ANAGROCI-FieldBuying/" + versionName());
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new NativeBridge(this, server), "AnagrociNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String url, String ua, String cd, String mime, long len) { openExternal(Uri.parse(url)); }
        });

        CaptureProvider.purge(this);
        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(START);
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onDestroy() { if (web != null) { web.destroy(); } super.onDestroy(); }

    /** Retour Android : historique de l'application d'abord, puis mise en arrière-plan (jamais de fermeture brutale). */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);
    }

    final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            return server.handle(req.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri u = Uri.parse(url);
            if (server.isLocal(u)) return false;      // navigation interne à l'application
            openExternal(u);                          // tout le reste : navigateur, téléphone, WhatsApp…
            return true;
        }
    }

    final class Chrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!(AssetServer.ORIGIN + "/").equals(origin) && !AssetServer.ORIGIN.equals(origin)) { callback.invoke(origin, false, false); return; }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            geoOrigin = origin; geoCallback = callback;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            String[] accept = params.getAcceptTypes();
            boolean image = false;
            StringBuilder types = new StringBuilder();
            if (accept != null) for (String a : accept) {
                if (a == null || a.trim().isEmpty()) continue;
                if (a.startsWith("image")) image = true;
                types.append(a).append(',');
            }
            boolean onlyImages = image && types.toString().replace("image/*,", "").replace("image/jpeg,", "").replace("image/png,", "").isEmpty();

            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(onlyImages ? "image/*" : "*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

            List<Intent> extra = new ArrayList<>();
            pendingPhoto = null;
            if (image) {
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                if (cam.resolveActivity(getPackageManager()) != null) {
                    pendingPhoto = CaptureProvider.newPhotoUri(MainActivity.this);
                    cam.putExtra(MediaStore.EXTRA_OUTPUT, pendingPhoto);
                    cam.setClipData(ClipData.newRawUri("photo", pendingPhoto));
                    cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    extra.add(cam);
                }
            }
            try {
                if (params.isCaptureEnabled() && !extra.isEmpty()) {
                    startActivityForResult(extra.get(0), REQ_FILE);    // capture="environment" : appareil photo direct
                } else {
                    Intent chooser = Intent.createChooser(pick, image ? "Ajouter une photo" : "Choisir un fichier");
                    if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
                    startActivityForResult(chooser, REQ_FILE);
                }
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                Toast.makeText(MainActivity.this, "Aucune application disponible pour choisir un fichier.", Toast.LENGTH_LONG).show();
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILE) { super.onActivityResult(req, res, data); return; }
        ValueCallback<Uri[]> cb = fileCallback; fileCallback = null;
        if (cb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0 && data.getData() == null
                    && (pendingPhoto == null || !pendingPhoto.equals(data.getClipData().getItemAt(0).getUri()))) {
                ClipData cd = data.getClipData();
                out = new Uri[cd.getItemCount()];
                for (int i = 0; i < cd.getItemCount(); i++) out[i] = cd.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            } else if (pendingPhoto != null && photoWritten(pendingPhoto)) {
                out = new Uri[]{pendingPhoto};      // l'appareil photo a écrit dans notre fichier
            }
        }
        pendingPhoto = null;
        cb.onReceiveValue(out);
    }

    private boolean photoWritten(Uri u) {
        java.io.File f = new java.io.File(CaptureProvider.dir(this), u.getLastPathSegment());
        return f.exists() && f.length() > 0;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        if (req == REQ_LOCATION && geoCallback != null) {
            boolean ok = false;
            for (int r : results) ok |= r == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, false);
            if (!ok) Toast.makeText(this, "Position GPS refusée : la parcelle peut être enregistrée sans GPS.", Toast.LENGTH_LONG).show();
            geoCallback = null; geoOrigin = null;
        }
    }

    /** Android 7 à 9 uniquement : écrire dans Téléchargements demande une autorisation. */
    boolean ensureLegacyStoragePermission() {
        if (Build.VERSION.SDK_INT >= 29) return true;
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) return true;
        runOnUiThread(new Runnable() { @Override public void run() {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        }});
        return false;
    }

    void onFileSaved(final String name, final Uri uri, final String mime) {
        runOnUiThread(new Runnable() { @Override public void run() {
            new AlertDialog.Builder(MainActivity.this)
                .setTitle("Fichier enregistré")
                .setMessage(name + "\n\nDossier : Téléchargements / ANAGROCI")
                .setPositiveButton("Ouvrir", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        if (uri == null) return;
                        Intent v = new Intent(Intent.ACTION_VIEW);
                        v.setDataAndType(uri, mime);
                        v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(v); } catch (ActivityNotFoundException e) {
                            Toast.makeText(MainActivity.this, "Aucune application pour ouvrir ce fichier.", Toast.LENGTH_LONG).show();
                        }
                    }
                })
                .setNegativeButton("Fermer", null)
                .show();
        }});
    }

    void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Aucune application pour ouvrir ce lien.", Toast.LENGTH_LONG).show();
        }
    }
}
