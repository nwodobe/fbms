package ci.anagroci.fieldbuying;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Test JVM du VRAI WebBundleUpdater.java et du VRAI AssetServer.java, contre le
 * VRAI paquet assets/www produit par prepare-web.mjs. Aucun réseau : la source
 * de mise à jour est simulée en mémoire. Clés de test générées à la volée,
 * jamais écrites dans le dépôt.
 *
 * Arguments : <dossier assets> <manifeste signé par Node> <signature Node> <clé publique Node (DER hex)> <dossier de travail>
 */
public final class WebBundleUpdaterTest {
    static int pass = 0, fail = 0;
    static void check(String id, String label, boolean ok, Object observed) {
        System.out.println((ok ? "PASS " : "FAIL ") + id + " " + label + " → " + observed);
        if (ok) pass++; else fail++;
    }

    static final String ROOT = "https://pages.example.test/fbms/";
    static final String MURL = ROOT + "android-updates/stable/web-bundle.json";

    /** Source simulée : URL (sans ?t=) -> contenu ; compte les téléchargements. */
    static final class MemFetcher implements WebBundleUpdater.Fetcher {
        final Map<String, byte[]> files = new HashMap<>();
        int calls = 0, fileCalls = 0;
        @Override public byte[] get(String url, int max) throws IOException {
            calls++;
            String u = url.replaceAll("\\?t=\\d+$", "");
            if (!u.endsWith(".json") && !u.endsWith(".sig")) fileCalls++;
            byte[] b = files.get(u);
            if (b == null) throw new IOException("HTTP 404 " + u);
            if (b.length > max) throw new IOException("réponse trop volumineuse");
            return b;
        }
    }

    static KeyPair keys() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        return g.generateKeyPair();
    }
    static String sign(KeyPair k, byte[] data) throws Exception {
        Signature s = Signature.getInstance("SHA256withECDSA"); s.initSign(k.getPrivate()); s.update(data);
        return WebBundleUpdater.hex(s.sign());
    }
    static JSONObject config(KeyPair k) throws Exception {
        return new JSONObject().put("enabled", true).put("channel", "stable").put("app_id", "ci.anagroci.fieldbuying")
                .put("web_root_url", ROOT).put("manifest_url", MURL)
                .put("public_key_der_hex", WebBundleUpdater.hex(k.getPublic().getEncoded()));
    }
    static String body(WebResourceResponse r) throws Exception {
        InputStream in = r.data; ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n); in.close(); return o.toString("UTF-8");
    }
    static byte[] read(File f) throws IOException { return WebBundleUpdater.readAll(f, 64 << 20); }

    static File WWW;
    static JSONObject EMB;

    /** Manifeste de mise à jour : copie des empreintes intégrées, avec les fichiers modifiés fournis. */
    static JSONObject manifest(long seq, Map<String, byte[]> changed) throws Exception {
        JSONObject files = new JSONObject();
        JSONObject ef = EMB.getJSONObject("files");
        Iterator<String> it = ef.keys();
        while (it.hasNext()) {
            String k = it.next();
            files.put(k, new JSONObject().put("sha256", ef.getString(k)).put("size", new File(WWW, k).length()));
        }
        for (Map.Entry<String, byte[]> e : changed.entrySet())
            files.put(e.getKey(), new JSONObject().put("sha256", WebBundleUpdater.sha256(e.getValue())).put("size", e.getValue().length));
        return new JSONObject().put("format", 1).put("app_id", "ci.anagroci.fieldbuying").put("channel", "stable")
                .put("sequence", seq).put("git_commit", "test" + seq).put("bundle_label", "t" + seq)
                .put("min_native_version_code", 2).put("queue_schema", EMB.getString("queue_schema"))
                .put("required_vendor", new JSONArray().put("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"))
                .put("files", files);
    }
    static void publish(MemFetcher f, KeyPair k, JSONObject m, Map<String, byte[]> changed) throws Exception {
        byte[] raw = m.toString(1).getBytes("UTF-8");
        f.files.put(MURL, raw);
        f.files.put(MURL + ".sig", sign(k, raw).getBytes("UTF-8"));
        for (Map.Entry<String, byte[]> e : changed.entrySet()) f.files.put(ROOT + WebBundleUpdater.encodePath(e.getKey()), e.getValue());
    }
    static WebBundleUpdater upd(File dir, JSONObject cfg, MemFetcher f) { return new WebBundleUpdater(dir, EMB, cfg, 2, "ci.anagroci.fieldbuying", f); }
    static WebBundleUpdater upd(File dir, JSONObject cfg, MemFetcher f, JSONObject emb, int code) { return new WebBundleUpdater(dir, emb, cfg, code, "ci.anagroci.fieldbuying", f); }
    static Map<String, byte[]> one(String k, String v) throws Exception { Map<String, byte[]> m = new HashMap<>(); m.put(k, v.getBytes("UTF-8")); return m; }

    public static void main(String[] a) throws Exception {
        File assets = new File(a[0]);
        WWW = new File(assets, "www");
        EMB = new JSONObject(new String(read(new File(WWW, "_native/bundle-manifest.json")), "UTF-8"));
        File work = new File(a[4]);
        WebBundleUpdater.deleteTree(work);
        long E = EMB.getLong("sequence");
        String FBJS = "operations/field-buying.js";
        String original = new String(read(new File(WWW, FBJS)), "UTF-8");
        KeyPair K = keys();
        JSONObject CFG = config(K);

        // ---------------------------------------------------------------- U01
        MemFetcher f0 = new MemFetcher();
        WebBundleUpdater u0 = upd(new File(work, "u0"), new JSONObject().put("enabled", false).put("reason", "aucune URL"), f0);
        JSONObject s0 = u0.check();
        check("UPD-01", "Mécanisme désactivé sans source/clé : aucune requête réseau", f0.calls == 0 && s0.getString("last_result").startsWith("désactivée"), s0.getString("last_result"));

        // ---------------------------------------------------------------- U02 / U03 : interopérabilité Node -> Java
        byte[] nodeRaw = read(new File(a[1]));
        byte[] nodeSig = read(new File(a[2]));
        JSONObject ncfg = new JSONObject(CFG.toString()).put("public_key_der_hex", new String(read(new File(a[3])), "UTF-8").trim());
        boolean interop;
        try { upd(new File(work, "u2"), ncfg, new MemFetcher()).checkManifest(nodeRaw, nodeSig); interop = true; } catch (Exception e) { interop = false; System.out.println("  " + e); }
        check("UPD-02", "Manifeste signé par sign-web-bundle.mjs (Node) vérifié par l'APK (Java)", interop, interop ? "signature ECDSA P-256 valide" : "refus");
        byte[] tampered = new String(nodeRaw, "UTF-8").replaceFirst("\"min_native_version_code\": \\d+", "\"min_native_version_code\": 1").getBytes("UTF-8");
        boolean tamperRefused;
        try { upd(new File(work, "u2b"), ncfg, new MemFetcher()).checkManifest(tampered, nodeSig); tamperRefused = false; } catch (SecurityException e) { tamperRefused = true; }
        check("UPD-03", "Manifeste Node modifié d'un seul champ après signature : refusé", tamperRefused && !java.util.Arrays.equals(tampered, nodeRaw), "SecurityException");
        MemFetcher fn = new MemFetcher();
        fn.files.put(MURL, nodeRaw); fn.files.put(MURL + ".sig", nodeSig);
        JSONObject sn = upd(new File(work, "u3"), ncfg, fn).check();
        check("UPD-04", "Même commit que l'APK : « à jour », aucun fichier téléchargé", "à jour".equals(sn.getString("last_result")) && fn.fileCalls == 0, sn.getString("last_result"));

        // ---------------------------------------------------------------- U05..U10 : cycle nominal
        File d1 = new File(work, "u5");
        MemFetcher f1 = new MemFetcher();
        Map<String, byte[]> ch1 = one(FBJS, original + "\n/* version de test v1 */\n");
        publish(f1, K, manifest(E + 100, ch1), ch1);
        WebBundleUpdater u1 = upd(d1, CFG, f1);
        u1.startup();
        JSONObject s1 = u1.check();
        check("UPD-05", "Nouvelle version signée : seul le fichier modifié est téléchargé", f1.fileCalls == 1 && s1.getLong("pending_sequence") == E + 100, f1.fileCalls + " fichier(s), en attente " + s1.getLong("pending_sequence"));
        check("UPD-06", "Rien n'est remplacé pendant la session en cours", u1.resolve(FBJS) == null && "intégrée à l'APK".equals(s1.getString("active")), s1.getString("active"));
        u1.reportQueue(0);
        JSONObject s1b = u1.startup();
        File over = u1.resolve(FBJS);
        check("UPD-07", "Au démarrage suivant : version activée, fichier vérifié servi", over != null && new String(read(over), "UTF-8").endsWith("v1 */\n")
                && s1b.getLong("active_sequence") == E + 100 && s1b.getBoolean("awaiting_confirm"), s1b.getString("active") + " " + s1b.getLong("active_sequence"));

        AssetServer srv = new AssetServer(new AssetManager(assets));
        srv.setUpdater(u1);
        String served = body(srv.handle(Uri.parse(AssetServer.ORIGIN + "/" + FBJS + "?v=20261016-android-uh-1")));
        String bridge = body(srv.handle(Uri.parse(AssetServer.ORIGIN + "/_native/bridge.js")));
        String html = body(srv.handle(Uri.parse(AssetServer.ORIGIN + "/operations/field-buying.html")));
        check("UPD-08", "AssetServer sert la version mise à jour, pont natif et page HTML intacts", served.endsWith("v1 */\n")
                && bridge.equals(new String(read(new File(WWW, "_native/bridge.js")), "UTF-8")) && html.startsWith("<!doctype html><html lang=\"fr\"><head><script src=\"/_native/bridge.js\">"), "field-buying.js = v1");
        check("UPD-09", "Fichier non modifié : servi depuis l'APK", body(srv.handle(Uri.parse(AssetServer.ORIGIN + "/shared/offline-field.js"))).equals(new String(read(new File(WWW, "shared/offline-field.js")), "UTF-8")), "offline-field.js intégré");
        u1.confirmBoot();
        WebBundleUpdater u1r = upd(d1, CFG, f1);
        JSONObject s1r = u1r.startup();
        check("UPD-10", "Démarrage confirmé puis redémarrage : version conservée et revérifiée", !s1r.getBoolean("awaiting_confirm") && s1r.getLong("active_sequence") == E + 100 && u1r.resolve(FBJS) != null, "active " + s1r.getLong("active_sequence"));
        check("UPD-11", "File locale déclarée transmise et conservée", s1r.getInt("queue_open") == 0, "queue_open=" + s1r.getInt("queue_open"));

        // ---------------------------------------------------------------- U12 : altération sur le téléphone
        WebBundleUpdater.writeFile(u1r.resolve(FBJS), "alert('altéré')".getBytes("UTF-8"));
        WebBundleUpdater u1t = upd(d1, CFG, f1);
        JSONObject s1t = u1t.startup();
        check("UPD-12", "Fichier altéré sur le téléphone : version écartée, retour à l'APK", u1t.resolve(FBJS) == null && "intégrée à l'APK".equals(s1t.getString("active"))
                && s1t.getJSONObject("rejected").has(String.valueOf(E + 100)), s1t.getJSONObject("rejected").optString(String.valueOf(E + 100)));

        // ---------------------------------------------------------------- U13..U22 : refus
        Object[][] refusals = {
            {"UPD-13", "Manifeste modifié après signature", "tamper"},
            {"UPD-14", "Signé par une autre clé", "otherkey"},
            {"UPD-15", "Fichier publié différent de son empreinte signée", "badfile"},
            {"UPD-16", "Chemin « ../ » dans le manifeste", "traversal"},
            {"UPD-17", "Tentative de remplacer le pont natif _native/bridge.js", "native"},
            {"UPD-18", "Paquet destiné à une autre application", "appid"},
            {"UPD-19", "Canal différent (beta au lieu de stable)", "channel"},
            {"UPD-20", "APK trop ancien (min_native_version_code > versionCode)", "minnative"},
            {"UPD-21", "Bibliothèque absente de l'APK (required_vendor)", "vendor"},
            {"UPD-22", "Page principale absente du paquet", "nomain"},
            {"UPD-23", "Fichier plus grand que la limite", "huge"},
            {"UPD-24", "Signature absente / vide", "nosig"},
        };
        int n = 0;
        for (Object[] r : refusals) {
            String kind = (String) r[2];
            File d = new File(work, "r" + (n++));
            MemFetcher f = new MemFetcher();
            Map<String, byte[]> ch = one(FBJS, original + "\n/* " + kind + " */\n");
            JSONObject m = manifest(E + 200, ch);
            KeyPair signer = K;
            if (kind.equals("otherkey")) signer = keys();
            if (kind.equals("traversal")) m.getJSONObject("files").put("../../evil.js", new JSONObject().put("sha256", WebBundleUpdater.sha256(new byte[1])).put("size", 1));
            if (kind.equals("native")) { byte[] ev = "window.evil=1".getBytes("UTF-8"); m.getJSONObject("files").put("_native/bridge.js", new JSONObject().put("sha256", WebBundleUpdater.sha256(ev)).put("size", ev.length)); f.files.put(ROOT + "_native/bridge.js", ev); }
            if (kind.equals("appid")) m.put("app_id", "com.autre.application");
            if (kind.equals("channel")) m.put("channel", "beta");
            if (kind.equals("minnative")) m.put("min_native_version_code", 3);
            if (kind.equals("vendor")) m.getJSONArray("required_vendor").put("https://cdn.jsdelivr.net/npm/bibliotheque-inconnue@9/x.js");
            if (kind.equals("nomain")) m.getJSONObject("files").remove("operations/field-buying.html");
            if (kind.equals("huge")) m.getJSONObject("files").put("assets/enorme.bin", new JSONObject().put("sha256", WebBundleUpdater.sha256(new byte[1])).put("size", WebBundleUpdater.MAX_FILE + 1));
            publish(f, signer, m, ch);
            if (kind.equals("tamper")) f.files.put(MURL, new String(f.files.get(MURL), "UTF-8").replace("\"min_native_version_code\": 2", "\"min_native_version_code\": 1").getBytes("UTF-8"));
            if (kind.equals("badfile")) f.files.put(ROOT + FBJS, "window.pirate=1".getBytes("UTF-8"));
            if (kind.equals("nosig")) f.files.put(MURL + ".sig", new byte[0]);
            WebBundleUpdater u = upd(d, CFG, f);
            u.startup();
            JSONObject s = u.check();
            u.reportQueue(0);
            JSONObject s2 = u.startup();
            boolean ok = s.getLong("pending_sequence") == 0 && s2.getLong("active_sequence") == E && u.resolve(FBJS) == null
                    && !new File(d, "bundles/" + (E + 200)).exists();
            check((String) r[0], r[1] + " : refusé, version en place conservée", ok, s.getString("last_result"));
        }

        // ---------------------------------------------------------------- U25 : retour arrière (version antérieure)
        File d3 = new File(work, "u25");
        MemFetcher f3 = new MemFetcher();
        Map<String, byte[]> chA = one(FBJS, original + "\n/* A */\n");
        publish(f3, K, manifest(E + 300, chA), chA);
        WebBundleUpdater u3 = upd(d3, CFG, f3);
        u3.startup(); u3.check(); u3.reportQueue(0); u3.startup(); u3.confirmBoot();
        Map<String, byte[]> chOld = one(FBJS, original + "\n/* ancienne */\n");
        publish(f3, K, manifest(E + 250, chOld), chOld);
        JSONObject s3 = u3.check();
        check("UPD-25", "Version signée plus ANCIENNE que l'active (rejeu) : ignorée", "à jour".equals(s3.getString("last_result")) && s3.getLong("pending_sequence") == 0, s3.getString("last_result"));

        // ---------------------------------------------------------------- U26..U28 : démarrage non confirmé
        Map<String, byte[]> chB = one(FBJS, original + "\n/* B cassée */\n");
        publish(f3, K, manifest(E + 400, chB), chB);
        u3.check();
        JSONObject sB = u3.startup();
        check("UPD-26", "Version B activée en attente de confirmation (A gardée en secours)", sB.getLong("active_sequence") == E + 400 && sB.getBoolean("awaiting_confirm") && new File(d3, "bundles/" + (E + 300)).isDirectory(), "active " + sB.getLong("active_sequence"));
        WebBundleUpdater u3r = upd(d3, CFG, f3);
        JSONObject sR = u3r.startup();
        check("UPD-27", "B n'a jamais confirmé : redémarrage → retour automatique à A", sR.getLong("active_sequence") == E + 300 && new String(read(u3r.resolve(FBJS)), "UTF-8").endsWith("/* A */\n")
                && sR.getJSONObject("rejected").has(String.valueOf(E + 400)), "active " + sR.getLong("active_sequence"));
        JSONObject sR2 = u3r.check();
        check("UPD-28", "B refusée n'est plus jamais retéléchargée", sR2.getString("last_result").contains("déjà refusée"), sR2.getString("last_result"));

        Map<String, byte[]> chC = one(FBJS, original + "\n/* C */\n");
        publish(f3, K, manifest(E + 500, chC), chC);
        u3r.check(); u3r.startup();
        u3r.bootFailed();
        check("UPD-29", "Chien de garde (60 s sans confirmation) : retour immédiat sans redémarrer", u3r.status().getLong("active_sequence") == E + 300 && !u3r.awaitingConfirm(), "active " + u3r.status().getLong("active_sequence"));

        // ---------------------------------------------------------------- U30..U33 : file locale
        Object[][] q = { {"UPD-30", 3, false}, {"UPD-31", -1, false}, {"UPD-32", 0, true} };
        for (Object[] c : q) {
            File d = new File(work, "q" + c[0]);
            MemFetcher f = new MemFetcher();
            Map<String, byte[]> ch = one(FBJS, original + "\n/* schéma 2 */\n");
            JSONObject m = manifest(E + 600, ch).put("queue_schema", "anagroci_ops_offline@2");
            publish(f, K, m, ch);
            WebBundleUpdater u = upd(d, CFG, f);
            u.startup(); u.check();
            int open = (Integer) c[1];
            if (open >= 0) u.reportQueue(open);
            JSONObject s = u.startup();
            boolean activated = s.getLong("active_sequence") == E + 600;
            String label = open > 0 ? "Format de file modifié + " + open + " opérations non synchronisées : activation DIFFÉRÉE"
                    : open < 0 ? "Format de file modifié + état de la file inconnu : activation DIFFÉRÉE"
                    : "Format de file modifié + file vide : activation";
            check((String) c[0], label, activated == (Boolean) c[2] && (activated || (s.getLong("pending_sequence") == E + 600 && s.getString("deferred_reason").length() > 0)),
                    activated ? "activée" : s.getString("deferred_reason"));
        }
        File dq = new File(work, "q33");
        MemFetcher fq = new MemFetcher();
        Map<String, byte[]> chq = one(FBJS, original + "\n/* même schéma */\n");
        publish(fq, K, manifest(E + 700, chq), chq);
        WebBundleUpdater uq = upd(dq, CFG, fq);
        uq.startup(); uq.check(); uq.reportQueue(12);
        JSONObject sq = uq.startup();
        check("UPD-33", "Format de file inchangé : activée même avec 12 opérations en attente (file conservée telle quelle)", sq.getLong("active_sequence") == E + 700, "active " + sq.getLong("active_sequence"));

        // ---------------------------------------------------------------- U34 : nouvel APK plus récent que la mise à jour
        uq.confirmBoot();
        JSONObject newer = new JSONObject(EMB.toString()).put("sequence", E + 10000);
        WebBundleUpdater ua = upd(dq, CFG, fq, newer, 3);
        JSONObject sa = ua.startup();
        check("UPD-34", "Nouvel APK plus récent installé par-dessus : la mise à jour Web antérieure est abandonnée", ua.resolve(FBJS) == null && "intégrée à l'APK".equals(sa.getString("active")), sa.getString("active"));

        // ---------------------------------------------------------------- U35..U38 : robustesse
        File dc = new File(work, "corrupt"); dc.mkdirs();
        WebBundleUpdater.writeFile(new File(dc, "state.json"), "{pas du json".getBytes("UTF-8"));
        boolean noCrash;
        try { JSONObject sc = upd(dc, CFG, new MemFetcher()).startup(); noCrash = "intégrée à l'APK".equals(sc.getString("active")); } catch (Exception e) { noCrash = false; }
        check("UPD-35", "État local illisible : démarrage sur la version de l'APK, sans plantage", noCrash, noCrash ? "version intégrée" : "plantage");
        JSONObject badHost = new JSONObject(CFG.toString()).put("manifest_url", "https://autre-hote.example/x.json");
        check("UPD-36", "Manifeste et fichiers sur deux hôtes différents : mécanisme désactivé", !upd(new File(work, "h"), badHost, new MemFetcher()).enabled(), "désactivé");
        WebBundleUpdater.HttpsFetcher hf = new WebBundleUpdater.HttpsFetcher(ROOT);
        boolean httpRefused = false, hostRefused = false, pathRefused = false, dotRefused = false;
        try { hf.get("http://pages.example.test/fbms/x", 10); } catch (SecurityException e) { httpRefused = true; }
        try { hf.get("https://evil.example/fbms/x", 10); } catch (SecurityException e) { hostRefused = true; }
        try { hf.get("https://pages.example.test/autre-depot/x", 10); } catch (SecurityException e) { pathRefused = true; }
        try { hf.get("https://pages.example.test/fbms/../autre/x", 10); } catch (SecurityException e) { dotRefused = true; }
        check("UPD-37", "Téléchargeur : HTTP en clair, autre hôte, autre chemin et « .. » refusés (avant toute connexion)", httpRefused && hostRefused && pathRefused && dotRefused,
                "http=" + httpRefused + " hôte=" + hostRefused + " chemin=" + pathRefused + " point-point=" + dotRefused);
        WebBundleUpdater.Fetcher down = (url, max) -> { throw new IOException("HTTP 503 sur /fbms/"); };
        WebBundleUpdater uo = new WebBundleUpdater(new File(work, "offline"), EMB, CFG, 2, "ci.anagroci.fieldbuying", down);
        JSONObject so = uo.check();
        check("UPD-38", "Source injoignable (hors ligne / 503) : échec signalé, version en place conservée", so.getString("last_result").startsWith("échec") && so.getLong("active_sequence") == E, so.getString("last_result"));
        MemFetcher f404 = new MemFetcher();
        JSONObject s404 = upd(new File(work, "c404"), CFG, f404).check();
        check("UPD-39", "Canal pas encore publié (404) : « à jour », pas d'erreur affichée à l'agent", s404.getString("last_result").startsWith("à jour") && "a_jour".equals(s404.getString("phase")), s404.getString("phase") + " · " + s404.getString("last_result"));

        System.out.println("RESULTAT " + pass + " PASS / " + fail + " FAIL");
        if (fail > 0) System.exit(1);
    }
}
