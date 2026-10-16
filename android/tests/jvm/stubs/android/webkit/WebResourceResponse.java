package android.webkit;
/** Bouchon de test JVM : conserve les champs pour vérification. */
public class WebResourceResponse {
    public final String mime, encoding, reason; public final int status; public final java.util.Map<String, String> headers; public final java.io.InputStream data;
    public WebResourceResponse(String mime, String enc, int status, String reason, java.util.Map<String, String> h, java.io.InputStream in) {
        this.mime = mime; this.encoding = enc; this.status = status; this.reason = reason; this.headers = h; this.data = in; }
}
