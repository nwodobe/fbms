package ci.anagroci.fieldbuying;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * Mises à jour du paquet Web de l'APK, SIGNÉES et VÉRIFIÉES (option C hybride).
 *
 * Principe :
 *  - l'APK embarque une version complète de l'application (assets/www) : elle
 *    démarre toujours, même sans réseau, même si une mise à jour est refusée ;
 *  - une version plus récente peut être téléchargée depuis UNE source approuvée,
 *    fixée au build (HTTPS, hôte unique) : un manifeste qui liste chaque fichier
 *    avec son empreinte SHA-256, signé ECDSA P-256 par la clé de publication
 *    ANAGROCI. La clé publique est dans l'APK ; la clé privée n'y est jamais ;
 *  - aucun fichier n'est utilisé sans signature valide ET empreinte exacte.
 *    Tout écart = mise à jour refusée, la version en place continue ;
 *  - la nouvelle version n'est activée qu'au démarrage suivant (jamais en cours
 *    de saisie), et seulement si la file d'opérations locales le permet ;
 *  - si elle ne confirme pas son démarrage, retour automatique à la précédente.
 *
 * Ce qui n'est JAMAIS mis à jour par ce canal : le code Java, le pont natif
 * (_native/), les bibliothèques figées (_vendor/), les permissions. Ceux-là
 * exigent un nouvel APK, signé avec la même clé.
 *
 * Format 2 (unification Web / APK, 25/10/2026) :
 *  - les fichiers sont téléchargés depuis un magasin IMMUABLE adressé par leur
 *    empreinte (<canal>/objects/aa/<sha256>) et non plus depuis le site en
 *    direct : une publication Web ultérieure ne peut plus invalider une mise à
 *    jour déjà signée, ni mélanger deux versions pendant un téléchargement ;
 *  - la source est un préfixe HTTPS exact (hôte ET chemin) fixé au build ;
 *  - le manifeste porte l'identité commune de la version (web_version, commit,
 *    date, compatibilité native et Supabase, politique, canal) ;
 *  - une version publiée peut être révoquée (revoked_sequences) : un téléphone
 *    qui l'utilise revient à la précédente au démarrage suivant ;
 *  - une version qui exige un nouvel APK est signalée comme telle, jamais
 *    appliquée : le code Java et les composants natifs ne sont pas remplaçables.
 *
 * Aucune dépendance Android dans cette classe : elle est testée telle quelle
 * sur la JVM (android/tests/jvm/WebBundleUpdaterTest.java).
 */
final class WebBundleUpdater {

    /** Téléchargement HTTPS borné. Remplaçable en test. */
    interface Fetcher { byte[] get(String url, int maxBytes) throws IOException; }

    static final int FORMAT = 2;
    static final int FORMAT_MIN = 1;
    static final int MAX_MANIFEST = 2 * 1024 * 1024;
    static final int MAX_FILE = 12 * 1024 * 1024;
    static final long MAX_TOTAL = 60L * 1024 * 1024;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    /* Chemins acceptés : ceux de l'application Web, jamais le pont natif ni les bibliothèques figées. */
    private static final Pattern SAFE_PATH = Pattern.compile("^(?!_native/)(?!_vendor/)[A-Za-z0-9][A-Za-z0-9._\\-/]*$");

    private final File base;
    private final JSONObject embedded;
    private final JSONObject config;
    private final int nativeVersionCode;
    private final String appId;
    private final Fetcher fetcher;
    private final Map<String, String> embeddedSha = new HashMap<>();

    private JSONObject state;
    /** Fichiers servis depuis la mise à jour active : chemin -> fichier vérifié. */
    private Map<String, File> overlay = new HashMap<>();
    private JSONObject activeManifest;
    private volatile boolean checking;

    WebBundleUpdater(File base, JSONObject embedded, JSONObject config, int nativeVersionCode, String appId, Fetcher fetcher) {
        this.base = base;
        this.embedded = embedded == null ? new JSONObject() : embedded;
        this.config = config == null ? new JSONObject() : config;
        this.nativeVersionCode = nativeVersionCode;
        this.appId = appId;
        this.fetcher = fetcher == null ? new HttpsFetcher(updateRoot(this.config)) : fetcher;
        JSONObject files = this.embedded.optJSONObject("files");
        if (files != null) {
            Iterator<String> it = files.keys();
            while (it.hasNext()) { String k = it.next(); embeddedSha.put(k, files.optString(k)); }
        }
        base.mkdirs();
        state = readState();
    }

    // ---------------------------------------------------------------- état

    private File stateFile() { return new File(base, "state.json"); }

    private JSONObject readState() {
        try { return new JSONObject(new String(readAll(stateFile(), 1 << 20), UTF8)); }
        catch (Exception e) { return new JSONObject(); }
    }

    private void saveState() {
        try {
            File tmp = new File(base, "state.json.tmp");
            writeFile(tmp, state.toString(1).getBytes(UTF8));
            if (!tmp.renameTo(stateFile())) throw new IOException("renommage impossible");
        } catch (Exception ignored) { }
    }

    private void log(String event, String detail) {
        try {
            JSONArray h = state.optJSONArray("history");
            if (h == null) { h = new JSONArray(); state.put("history", h); }
            h.put(new JSONObject().put("at", now()).put("event", event).put("detail", detail == null ? "" : detail));
            while (h.length() > 30) h.remove(0);
        } catch (Exception ignored) { }
    }

    /**
     * Préfixe HTTPS approuvé : toutes les requêtes doivent commencer par lui
     * (même hôte ET même chemin). Format 2 : update_root_url (dossier du canal).
     * Format 1 : web_root_url (racine du site).
     */
    static String updateRoot(JSONObject cfg) {
        String r = cfg.optString("update_root_url", "");
        if (r.isEmpty()) r = cfg.optString("web_root_url", "");
        if (!r.isEmpty() && !r.endsWith("/")) r += "/";
        return r;
    }

    boolean enabled() {
        String root = updateRoot(config);
        String mu = config.optString("manifest_url", "");
        return config.optBoolean("enabled", false) && !config.optString("public_key_der_hex", "").isEmpty()
                && root.startsWith("https://") && mu.startsWith("https://")
                && hostOf(mu).equals(hostOf(root)) && mu.startsWith(root);
    }

    long embeddedSequence() { return embedded.optLong("sequence", 0); }

    long activeSequence() { return activeManifest == null ? embeddedSequence() : activeManifest.optLong("sequence", 0); }

    String activeQueueSchema() {
        return activeManifest != null ? activeManifest.optString("queue_schema", "") : embedded.optString("queue_schema", "");
    }

    // ------------------------------------------------------------ démarrage

    /**
     * Appelé au démarrage de l'application, AVANT le chargement de la page.
     * 1. retour arrière si la version activée au démarrage précédent n'a pas confirmé ;
     * 2. activation d'une version téléchargée, si la file locale le permet ;
     * 3. revérification complète (signature + empreintes) de la version active.
     */
    synchronized JSONObject startup() {
        if (state.optBoolean("revoke_active", false)) {
            state.remove("revoke_active");
            long bad = state.optLong("active_seq", 0);
            if (bad > 0) {
                reject(bad, "version révoquée par la publication : retour à la version précédente");
                state.remove("awaiting_confirm");
                restorePrevious();
            }
        }
        if (state.optBoolean("awaiting_confirm", false)) {
            long bad = state.optLong("active_seq", 0);
            reject(bad, "démarrage non confirmé : retour à la version précédente");
            state.remove("awaiting_confirm");
            restorePrevious();
        }
        long pending = state.optLong("pending_seq", 0);
        if (pending > 0) {
            String why = activationBlocker(pending);
            if (why == null) {
                long prev = state.optLong("active_seq", 0);
                if (prev > 0) put(state, "previous_seq", prev);
                put(state, "active_seq", pending);
                state.remove("pending_seq");
                state.remove("deferred_reason");
                put(state, "awaiting_confirm", true);
                put(state, "activated_at", now());
                log("activation", "version " + pending);
            } else if (why.startsWith("REFUS:")) {
                reject(pending, why.substring(6));
                state.remove("pending_seq");
            } else {
                put(state, "deferred_reason", why);
            }
        }
        loadActive();
        cleanup();
        saveState();
        return status();
    }

    /** null = activable ; "REFUS:…" = définitivement refusée ; autre = différée. */
    private String activationBlocker(long seq) {
        JSONObject m;
        try { m = verifyBundle(seq); } catch (Exception e) { return "REFUS:" + e.getMessage(); }
        String q = m.optString("queue_schema", "");
        if (!q.equals(activeQueueSchema())) {
            int open = state.optInt("queue_open", -1);
            if (open != 0) return "format de la file locale modifié : activation après synchronisation complète ("
                    + (open < 0 ? "état de la file inconnu" : open + " opération(s) non synchronisée(s)") + ")";
        }
        return null;
    }

    private void restorePrevious() {
        long prev = state.optLong("previous_seq", 0);
        state.remove("previous_seq");
        if (prev > 0 && !isRejected(prev)) { put(state, "active_seq", prev); log("retour", "version " + prev); }
        else { state.remove("active_seq"); log("retour", "version intégrée à l'APK"); }
    }

    private void loadActive() {
        overlay = new HashMap<>();
        activeManifest = null;
        long seq = state.optLong("active_seq", 0);
        if (seq <= 0) return;
        try {
            if (seq <= embeddedSequence()) throw new IOException("l'APK installé contient une version plus récente ou identique");
            JSONObject m = verifyBundle(seq);
            Map<String, File> map = new HashMap<>();
            JSONObject files = m.getJSONObject("files");
            Iterator<String> it = files.keys();
            while (it.hasNext()) {
                String rel = it.next();
                File f = new File(dir(seq), "files/" + rel);
                if (f.isFile()) map.put(rel, f);
            }
            overlay = map;
            activeManifest = m;
        } catch (Exception e) {
            boolean apkNewer = seq <= embeddedSequence();
            if (!apkNewer) reject(seq, "version active invalide : " + e.getMessage());
            else log("abandon", "version " + seq + " : " + e.getMessage());
            state.remove("active_seq");
            state.remove("awaiting_confirm");
            long prev = state.optLong("previous_seq", 0);
            state.remove("previous_seq");
            if (prev > 0 && prev != seq && !isRejected(prev)) { put(state, "active_seq", prev); loadActive(); }
        }
    }

    /** Appelé par la page quand l'application a démarré correctement avec la version active. */
    synchronized void confirmBoot() {
        if (state.optBoolean("awaiting_confirm", false)) {
            state.remove("awaiting_confirm");
            put(state, "last_success_at", now());
            put(state, "last_success_seq", state.optLong("active_seq", 0));
            log("confirmation", "version " + state.optLong("active_seq", 0) + " démarrée");
            saveState();
        }
    }

    synchronized boolean awaitingConfirm() { return state.optBoolean("awaiting_confirm", false); }

    /** Le démarrage n'a pas été confirmé à temps : retour immédiat (utilisé par le chien de garde). */
    synchronized void bootFailed() {
        if (!state.optBoolean("awaiting_confirm", false)) return;
        reject(state.optLong("active_seq", 0), "démarrage non confirmé dans le délai : retour à la version précédente");
        state.remove("awaiting_confirm");
        restorePrevious();
        loadActive();
        saveState();
    }

    /** Nombre d'opérations locales non synchronisées (tous utilisateurs du téléphone), transmis par la page. */
    synchronized void reportQueue(int open) {
        put(state, "queue_open", open);
        put(state, "queue_reported_at", now());
        saveState();
    }

    /** Fichier de la mise à jour active pour ce chemin, ou null (=> fichier intégré à l'APK). */
    synchronized File resolve(String rel) { return overlay.get(rel); }

    // -------------------------------------------------------- vérification

    private File dir(long seq) { return new File(base, "bundles/" + seq); }

    /** Revérifie entièrement un paquet présent sur le téléphone. Exception = inutilisable. */
    JSONObject verifyBundle(long seq) throws Exception {
        File d = dir(seq);
        byte[] raw = readAll(new File(d, "web-bundle.json"), MAX_MANIFEST);
        byte[] sig = readAll(new File(d, "web-bundle.json.sig"), 4096);
        JSONObject m = checkManifest(raw, sig);
        if (m.optLong("sequence", 0) != seq) throw new IOException("numéro de version incohérent");
        JSONObject files = m.getJSONObject("files");
        Iterator<String> it = files.keys();
        while (it.hasNext()) {
            String rel = it.next();
            String want = files.getJSONObject(rel).getString("sha256");
            File f = new File(d, "files/" + rel);
            if (f.isFile()) {
                if (!want.equals(sha256(f))) throw new IOException("empreinte invalide : " + rel);
            } else if (!want.equals(embeddedSha.get(rel))) {
                throw new IOException("fichier manquant : " + rel);
            }
        }
        return m;
    }

    /** Signature, format, application, compatibilité APK. Ne télécharge rien. */
    JSONObject checkManifest(byte[] raw, byte[] sigHex) throws Exception {
        if (!verifySignature(raw, hexToBytes(new String(sigHex, UTF8).trim()), config.optString("public_key_der_hex", "")))
            throw new SecurityException("signature invalide");
        JSONObject m = new JSONObject(new String(raw, UTF8));
        int fmt = m.optInt("format", 0);
        if (fmt < FORMAT_MIN || fmt > FORMAT) throw new IOException("format de paquet non pris en charge");
        if (!appId.equals(m.optString("app_id"))) throw new IOException("paquet destiné à une autre application");
        String ch = config.optString("channel", "stable");
        if (!ch.equals(m.optString("channel"))) throw new IOException("canal " + m.optString("channel") + " au lieu de " + ch);
        if (m.optInt("min_native_version_code", Integer.MAX_VALUE) > nativeVersionCode)
            throw new IncompatibleException("nouvel APK requis (versionCode ≥ " + m.optInt("min_native_version_code") + ")", m);
        JSONArray need = m.optJSONArray("required_vendor");
        JSONObject vm = embedded.optJSONObject("vendor_map");
        if (need != null) for (int i = 0; i < need.length(); i++) {
            if (vm == null || !vm.has(need.getString(i))) throw new IncompatibleException("nouvel APK requis (bibliothèque " + need.getString(i) + ")", m);
        }
        JSONObject files = m.getJSONObject("files");
        long total = 0;
        Iterator<String> it = files.keys();
        while (it.hasNext()) {
            String rel = it.next();
            if (!SAFE_PATH.matcher(rel).matches() || rel.contains("..") || rel.contains("//")) throw new SecurityException("chemin refusé : " + rel);
            JSONObject f = files.getJSONObject(rel);
            if (!f.optString("sha256").matches("^[0-9a-f]{64}$")) throw new IOException("empreinte mal formée : " + rel);
            long size = f.optLong("size", -1);
            if (size < 0 || size > MAX_FILE) throw new IOException("taille refusée : " + rel);
            total += size;
        }
        if (total > MAX_TOTAL) throw new IOException("paquet trop volumineux");
        if (!files.has("operations/field-buying.html")) throw new IOException("page principale absente du paquet");
        return m;
    }

    static final class IncompatibleException extends IOException {
        final JSONObject manifest;
        IncompatibleException(String m) { this(m, null); }
        IncompatibleException(String m, JSONObject manifest) { super(m); this.manifest = manifest; }
    }

    static boolean verifySignature(byte[] data, byte[] sigDer, String publicKeyDerHex) {
        try {
            PublicKey pk = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(hexToBytes(publicKeyDerHex)));
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initVerify(pk);
            s.update(data);
            return s.verify(sigDer);
        } catch (Exception e) { return false; }
    }

    // --------------------------------------------------------- vérification en ligne

    /**
     * Vérifie la source approuvée et télécharge la nouvelle version si elle existe.
     * Ne modifie JAMAIS la version en cours d'utilisation : au mieux, une version
     * vérifiée est mise « en attente » pour le prochain démarrage.
     */
    JSONObject check() {
        synchronized (this) {
            if (checking) return status();
            checking = true;
            put(state, "last_check_at", now());
        }
        String result;
        try {
            result = doCheck();
        } catch (IncompatibleException e) {
            result = "incompatible : " + e.getMessage();
            synchronized (this) { noteLatest(e.manifest, true, e.getMessage()); }
        } catch (SecurityException e) {
            result = "refusée : " + e.getMessage();
            synchronized (this) { log("refus", e.getMessage()); }
        } catch (Exception e) {
            result = "échec : " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
        synchronized (this) {
            checking = false;
            deleteTree(new File(base, "staging"));          // jamais de version partielle laissée sur le téléphone
            state.remove("downloading_seq");
            put(state, "last_result", result);
            saveState();
            return status();
        }
    }

    private String doCheck() throws Exception {
        if (!enabled()) return "désactivée : " + config.optString("reason", "aucune source approuvée dans cet APK");
        String mu = config.optString("manifest_url");
        byte[] raw = fetcher.get(mu + "?t=" + System.currentTimeMillis(), MAX_MANIFEST);
        byte[] sig = fetcher.get(mu + ".sig?t=" + System.currentTimeMillis(), 4096);
        JSONObject m = checkManifest(raw, sig);
        long seq = m.optLong("sequence", 0);
        long known;
        synchronized (this) {
            noteLatest(m, false, null);
            applyRevocations(m);
            known = Math.max(activeSequence(), Math.max(embeddedSequence(), state.optLong("pending_seq", 0)));
            if (isRejected(seq)) return "version " + seq + " déjà refusée sur ce téléphone";
        }
        if (seq <= known) return state.optBoolean("revoke_active", false)
                ? "version active révoquée : retour à la précédente au prochain démarrage" : "à jour";
        synchronized (this) { put(state, "downloading_seq", seq); saveState(); }

        File stage = new File(base, "staging");
        deleteTree(stage);
        new File(stage, "files").mkdirs();
        JSONObject files = m.getJSONObject("files");
        String root = updateRoot(config);
        boolean objects = m.optInt("format", 1) >= 2;
        String objBase = root + m.optString("objects_path", "objects/");
        if (objects && (!objBase.startsWith(root) || objBase.contains(".."))) throw new SecurityException("magasin d'objets hors de la source approuvée");
        int downloaded = 0;
        Iterator<String> it = files.keys();
        while (it.hasNext()) {
            String rel = it.next();
            JSONObject f = files.getJSONObject(rel);
            String want = f.getString("sha256");
            if (want.equals(embeddedSha.get(rel))) continue;           // identique à l'APK
            File out = new File(stage, "files/" + rel);
            File reuse;
            synchronized (this) { reuse = overlay.get(rel); }
            byte[] data = null;
            if (reuse != null && want.equals(sha256(reuse))) data = readAll(reuse, MAX_FILE);
            if (data == null) {
                String url = objects ? objBase + want.substring(0, 2) + "/" + want : root + encodePath(rel);
                try { data = fetcher.get(url, (int) Math.min(MAX_FILE, f.getLong("size") + 1)); }
                catch (IOException e) {
                    /* Plus gros que la taille signée : ce n'est pas le fichier publié. */
                    if (String.valueOf(e.getMessage()).contains("trop volumineuse")) throw new SecurityException("fichier non conforme au manifeste signé : " + rel + " (taille)");
                    throw e;
                }
                downloaded++;
            }
            if (data.length != f.getLong("size") || !want.equals(sha256(data)))
                throw new SecurityException("fichier non conforme au manifeste signé : " + rel + " (publication en cours ? réessayer plus tard)");
            out.getParentFile().mkdirs();
            writeFile(out, data);
        }
        writeFile(new File(stage, "web-bundle.json"), raw);
        writeFile(new File(stage, "web-bundle.json.sig"), sig);
        synchronized (this) {
            File target = dir(seq);
            deleteTree(target);
            target.getParentFile().mkdirs();
            if (!stage.renameTo(target)) throw new IOException("installation locale impossible");
            verifyBundle(seq);
            long old = state.optLong("pending_seq", 0);
            put(state, "pending_seq", seq);
            state.remove("downloading_seq");
            put(state, "downloaded_at", now());
            log("téléchargement", "version " + seq + " (" + downloaded + " fichier(s))");
            if (old > 0 && old != seq) deleteTree(dir(old));
        }
        return "version " + seq + " vérifiée : appliquée au prochain démarrage";
    }

    // ---------------------------------------------------------------- statut

    synchronized JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", enabled());
            o.put("source", enabled() ? updateRoot(config) : JSONObject.NULL);
            o.put("channel", config.optString("channel", "stable"));
            o.put("embedded_sequence", embeddedSequence());
            o.put("embedded_commit", embedded.optString("git_commit", ""));
            o.put("active", activeManifest == null ? "intégrée à l'APK" : "mise à jour signée");
            o.put("active_sequence", activeSequence());
            o.put("active_commit", activeManifest == null ? embedded.optString("git_commit", "") : activeManifest.optString("git_commit", ""));
            o.put("active_label", activeManifest == null ? embedded.optString("bundle_label", "") : activeManifest.optString("bundle_label", ""));
            o.put("overlay_files", overlay.size());
            o.put("pending_sequence", state.optLong("pending_seq", 0));
            o.put("deferred_reason", state.optString("deferred_reason", ""));
            o.put("awaiting_confirm", state.optBoolean("awaiting_confirm", false));
            o.put("queue_open", state.optInt("queue_open", -1));
            o.put("last_check_at", state.optString("last_check_at", ""));
            o.put("last_result", state.optString("last_result", ""));
            o.put("checking", checking);
            o.put("rejected", state.optJSONObject("rejected") == null ? new JSONObject() : state.optJSONObject("rejected"));
            o.put("history", state.optJSONArray("history") == null ? new JSONArray() : state.optJSONArray("history"));
            o.put("active_web_version", activeManifest == null ? embedded.optString("web_version", embedded.optString("bundle_label", "")) : activeManifest.optString("web_version", activeManifest.optString("bundle_label", "")));
            o.put("latest", state.optJSONObject("latest") == null ? new JSONObject() : state.optJSONObject("latest"));
            o.put("downloading_sequence", state.optLong("downloading_seq", 0));
            o.put("last_success_at", state.optString("last_success_at", ""));
            o.put("activated_at", state.optString("activated_at", ""));
            o.put("revoke_pending", state.optBoolean("revoke_active", false));
            o.put("phase", phase());
        } catch (Exception ignored) { }
        return o;
    }

    /**
     * Statut simple pour l'écran « Version et mises à jour » :
     * a_jour · disponible · telechargement · prete · differee · nouvel_apk · erreur · desactivee.
     */
    private String phase() {
        if (!enabled()) return "desactivee";
        if (checking && state.optLong("downloading_seq", 0) > 0) return "telechargement";
        JSONObject l = state.optJSONObject("latest");
        if (l != null && l.optBoolean("native_required", false) && l.optLong("sequence", 0) > activeSequence()) return "nouvel_apk";
        if (state.optLong("pending_seq", 0) > 0) return state.optString("deferred_reason", "").isEmpty() ? "prete" : "differee";
        String r = state.optString("last_result", "");
        if (r.startsWith("échec") || r.startsWith("refusée") || r.startsWith("incompatible")) return "erreur";
        if (l != null && l.optLong("sequence", 0) > activeSequence() && !isRejected(l.optLong("sequence", 0))) return "disponible";
        return "a_jour";
    }

    /** Mémorise la dernière version annoncée par la source (manifeste signé, déjà vérifié). */
    private void noteLatest(JSONObject m, boolean nativeRequired, String why) {
        if (m == null) return;
        try {
            JSONObject l = new JSONObject();
            l.put("sequence", m.optLong("sequence", 0));
            l.put("web_version", m.optString("web_version", m.optString("bundle_label", "")));
            l.put("git_commit", m.optString("git_commit", ""));
            l.put("published_at", m.optString("published_at", m.optString("created_at", "")));
            l.put("update_policy", m.optString("update_policy", "recommended"));
            l.put("min_native_version_code", m.optInt("min_native_version_code", 0));
            l.put("native_required", nativeRequired);
            if (why != null) l.put("reason", why);
            JSONObject nat = m.optJSONObject("native");
            if (nat != null) l.put("native", nat);
            if (m.has("supabase_compat")) l.put("supabase_compat", m.optString("supabase_compat"));
            l.put("seen_at", now());
            state.put("latest", l);
        } catch (Exception ignored) { }
    }

    /**
     * Révocations publiées (manifeste signé) : une version révoquée n'est jamais
     * activée ; si elle est active, retour à la précédente au démarrage suivant
     * (jamais en cours de saisie).
     */
    private void applyRevocations(JSONObject m) {
        JSONArray rv = m.optJSONArray("revoked_sequences");
        if (rv == null) return;
        for (int i = 0; i < rv.length(); i++) {
            long s = rv.optLong(i, 0);
            if (s <= 0) continue;
            if (s == state.optLong("pending_seq", 0)) { reject(s, "version révoquée par la publication"); state.remove("pending_seq"); state.remove("deferred_reason"); }
            else if (s == state.optLong("active_seq", 0)) { put(state, "revoke_active", true); log("révocation", "version " + s + " : retour au prochain démarrage"); }
            else if (s == state.optLong("previous_seq", 0)) { reject(s, "version révoquée par la publication"); state.remove("previous_seq"); }
            else if (!isRejected(s) && s > embeddedSequence()) reject(s, "version révoquée par la publication");
        }
    }

    // ------------------------------------------------------------ outils

    private static void put(JSONObject o, String k, Object v) { try { o.put(k, v); } catch (Exception ignored) { } }

    private boolean isRejected(long seq) { JSONObject r = state.optJSONObject("rejected"); return r != null && r.has(String.valueOf(seq)); }

    private void reject(long seq, String why) {
        if (seq <= 0) return;
        try {
            JSONObject r = state.optJSONObject("rejected");
            if (r == null) { r = new JSONObject(); state.put("rejected", r); }
            r.put(String.valueOf(seq), why);
        } catch (Exception ignored) { }
        log("refus", "version " + seq + " : " + why);
        deleteTree(dir(seq));
    }

    private void cleanup() {
        File[] ds = new File(base, "bundles").listFiles();
        if (ds == null) return;
        for (File d : ds) {
            long s;
            try { s = Long.parseLong(d.getName()); } catch (NumberFormatException e) { deleteTree(d); continue; }
            if (s != state.optLong("active_seq", 0) && s != state.optLong("previous_seq", 0) && s != state.optLong("pending_seq", 0)) deleteTree(d);
        }
        deleteTree(new File(base, "staging"));
    }

    static String encodePath(String rel) throws IOException {
        StringBuilder b = new StringBuilder();
        for (String seg : rel.split("/")) {
            if (b.length() > 0) b.append('/');
            b.append(URLEncoder.encode(seg, "UTF-8").replace("+", "%20"));
        }
        return b.toString();
    }

    static String hostOf(String url) {
        try { return new URL(url).getHost(); } catch (Exception e) { return ""; }
    }

    static String now() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    static String sha256(byte[] d) {
        try { return hex(MessageDigest.getInstance("SHA-256").digest(d)); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            InputStream in = new FileInputStream(f);
            try { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) > 0) md.update(b, 0, n); } finally { in.close(); }
            return hex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x & 0xff));
        return s.toString();
    }

    static byte[] hexToBytes(String h) {
        if (h == null || (h.length() & 1) == 1 || !h.matches("^[0-9a-fA-F]*$")) return new byte[0];
        byte[] o = new byte[h.length() / 2];
        for (int i = 0; i < o.length; i++) o[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return o;
    }

    static byte[] readAll(File f, int max) throws IOException {
        if (!f.isFile()) throw new IOException("absent : " + f.getName());
        if (f.length() > max) throw new IOException("trop volumineux : " + f.getName());
        return readStream(new FileInputStream(f), max);
    }

    static byte[] readStream(InputStream in, int max) throws IOException {
        try {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[65536]; int n; long t = 0;
            while ((n = in.read(b)) > 0) { t += n; if (t > max) throw new IOException("réponse trop volumineuse"); o.write(b, 0, n); }
            return o.toByteArray();
        } finally { in.close(); }
    }

    static void writeFile(File f, byte[] d) throws IOException {
        FileOutputStream o = new FileOutputStream(f);
        try { o.write(d); o.getFD().sync(); } finally { o.close(); }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] c = f.listFiles();
        if (c != null) for (File x : c) deleteTree(x);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** HTTPS uniquement, sous le préfixe approuvé uniquement (hôte + chemin), sans redirection. */
    static final class HttpsFetcher implements Fetcher {
        private final String prefix;
        private final String host;
        HttpsFetcher(String prefix) { this.prefix = prefix == null ? "" : prefix; this.host = hostOf(this.prefix); }
        @Override public byte[] get(String url, int maxBytes) throws IOException {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) || !host.equals(u.getHost()) || prefix.isEmpty() || !url.startsWith(prefix) || u.getPath().contains(".."))
                throw new SecurityException("source non approuvée : " + u.getHost() + u.getPath());
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            if (!(c instanceof HttpsURLConnection)) throw new SecurityException("connexion non chiffrée");
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setUseCaches(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            try {
                int code = c.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code + " sur " + u.getPath());
                long len = c.getContentLength();
                if (len > maxBytes) throw new IOException("réponse trop volumineuse");
                return readStream(c.getInputStream(), maxBytes);
            } finally { c.disconnect(); }
        }
    }
}
