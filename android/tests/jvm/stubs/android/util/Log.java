package android.util;
/** Bouchon de test JVM (n'est jamais embarqué dans l'APK). */
public final class Log { public static int e(String t, String m, Throwable e) { System.err.println(t + ": " + m + " " + e); return 0; } }
