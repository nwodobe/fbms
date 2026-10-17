package android.net;
/** Bouchon de test JVM reproduisant le sous-ensemble de android.net.Uri utilisé par AssetServer. */
public final class Uri {
    private final java.net.URI u;
    private Uri(java.net.URI u) { this.u = u; }
    public static Uri parse(String s) { try { return new Uri(new java.net.URI(s)); } catch (Exception e) { throw new IllegalArgumentException(s, e); } }
    public String getScheme() { return u.getScheme(); }
    public String getHost() { return u.getHost(); }
    public String getPath() { return u.getRawPath(); }
    public String getQuery() { return u.getQuery(); }
    public String getLastPathSegment() { String p = u.getPath(); return p == null ? null : p.substring(p.lastIndexOf('/') + 1); }
    public static String decode(String s) { try { return java.net.URLDecoder.decode(s.replace("+", "%2B"), "UTF-8"); } catch (Exception e) { return s; } }
    @Override public String toString() { return u.toString(); }
}
