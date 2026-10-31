package ci.anagroci.fieldbuying;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Fournisseur privé (non exporté) qui donne à l'application Appareil photo un
 * fichier où écrire la photo de preuve, puis la rend lisible par la page.
 * Évite toute permission CAMERA ou stockage : l'accès est accordé uri par uri,
 * temporairement (FLAG_GRANT_*_URI_PERMISSION), et les fichiers restent dans le
 * cache privé de l'application.
 */
public final class CaptureProvider extends ContentProvider {
    /** Autorité = identifiant de l'application + ".capture" (distincte en version de test). */
    static String authority(android.content.Context c) { return c.getPackageName() + ".capture"; }

    static File dir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "captures");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static Uri newPhotoUri(android.content.Context c) {
        String name = "preuve-" + System.currentTimeMillis() + ".jpg";
        return Uri.parse("content://" + authority(c) + "/" + name);
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || !name.matches("[A-Za-z0-9._-]+")) throw new FileNotFoundException(String.valueOf(uri));
        return new File(dir(getContext()), name);
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        int m = mode != null && mode.contains("w")
                ? ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE
                : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(f, m);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File f = fileFor(uri);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) { return null; }
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }

    /** Supprime les photos temporaires de plus de 30 jours (la page les a copiées depuis longtemps). */
    static void purge(android.content.Context c) {
        File[] files = dir(c).listFiles();
        if (files == null) return;
        long limit = System.currentTimeMillis() - 30L * 24 * 3600 * 1000;
        for (File f : files) if (f.lastModified() < limit) f.delete();
    }
}
