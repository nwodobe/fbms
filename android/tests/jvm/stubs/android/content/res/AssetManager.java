package android.content.res;
/** Bouchon de test JVM : lit le vrai dossier assets/ du projet. */
public final class AssetManager {
    public static final int ACCESS_STREAMING = 2;
    private final java.io.File root;
    public AssetManager(java.io.File root) { this.root = root; }
    public java.io.InputStream open(String name) throws java.io.IOException { return open(name, ACCESS_STREAMING); }
    public java.io.InputStream open(String name, int mode) throws java.io.IOException {
        java.io.File f = new java.io.File(root, name);
        if (!f.isFile()) throw new java.io.FileNotFoundException(name);
        return new java.io.FileInputStream(f);
    }
}
