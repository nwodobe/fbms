package ci.anagroci.fieldbuying;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * Bout en bout, format 2, SANS simulation du téléchargement :
 *   vraie chaîne de publication Node (publish-web-update.mjs) sur un clone isolé du dépôt
 *   -> magasin d'objets + manifeste signé servis par un VRAI serveur HTTPS local
 *   -> VRAI WebBundleUpdater.java avec son VRAI HttpsFetcher (préfixe approuvé, sans redirection)
 *   -> VRAI AssetServer.java qui sert ensuite la version active.
 *
 * Arguments : <clone> <assets du clone> <clé privée de test> <clé publique DER hex> <dossier de travail> <keystore TLS> <dossier du canal>
 * Données : uniquement des fichiers du dépôt et des marqueurs de démonstration ; aucune donnée réelle.
 */
public final class Format2EndToEndTest {
    static int pass = 0, fail = 0;
    static final List<String> lines = new ArrayList<>();
    static void check(String id, String label, boolean ok, Object observed) {
        String l = (ok ? "PASS " : "FAIL ") + id + " " + label + " → " + observed;
        System.out.println(l); lines.add(l);
        if (ok) pass++; else fail++;
    }

    static File CLONE, CHANNEL, KEY;
    static volatile boolean serverUp = true;
    static volatile String breakObject = null;       // objet servi tronqué (téléchargement interrompu)
    static final AtomicInteger objectHits = new AtomicInteger();

    static String run(String... cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(CLONE).redirectErrorStream(true);
        Process p = pb.start();
        byte[] out = readAll(p.getInputStream());
        int code = p.waitFor();
        return code + "\n" + new String(out, "UTF-8");
    }
    static int code(String r) { return Integer.parseInt(r.substring(0, r.indexOf('\n'))); }
    static String publish(String... extra) throws Exception {
        List<String> c = new ArrayList<>();
        c.add("node"); c.add("android/scripts/publish-web-update.mjs"); c.add("--channel"); c.add("test");
        c.add("--key"); c.add(KEY.getAbsolutePath()); c.add("--out"); c.add(CHANNEL.getAbsolutePath());
        c.add("--gates"); c.add("node -e 0");
        for (String e : extra) c.add(e);
        return run(c.toArray(new String[0]));
    }
    static JSONObject publishJson(String... extra) throws Exception {
        String r = publish(extra);
        if (code(r) != 0) throw new IllegalStateException("publication en échec : " + r);
        String s = r.substring(r.indexOf('{'));
        return new JSONObject(s.substring(0, s.lastIndexOf('}') + 1));
    }
    static void commitChange(String rel, String append, String msg) throws Exception {
        File f = new File(CLONE, rel);
        Files.write(f.toPath(), (new String(Files.readAllBytes(f.toPath()), "UTF-8") + append).getBytes("UTF-8"));
        run("git", "-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-am", msg);
        Thread.sleep(1100); // numéros de version = secondes du commit
    }
    static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[65536]; int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n); in.close(); return o.toByteArray();
    }
    static String body(WebResourceResponse r) throws Exception { return new String(readAll(r.data), "UTF-8"); }

    /** Empreinte globale d'un dossier (données locales simulées de l'application). */
    static String treeHash(File d) throws Exception {
        List<String> parts = new ArrayList<>();
        walk(d, d, parts);
        java.util.Collections.sort(parts);
        return WebBundleUpdater.sha256(String.join("\n", parts).getBytes("UTF-8"));
    }
    static void walk(File root, File f, List<String> out) throws Exception {
        File[] c = f.listFiles(); if (c == null) return;
        for (File x : c) { if (x.isDirectory()) walk(root, x, out); else out.add(root.toPath().relativize(x.toPath()) + ":" + WebBundleUpdater.sha256(x)); }
    }

    public static void main(String[] a) throws Exception {
        CLONE = new File(a[0]); File assets = new File(a[1]); KEY = new File(a[2]);
        String pubHex = new String(Files.readAllBytes(new File(a[3]).toPath()), "UTF-8").trim();
        File work = new File(a[4]); WebBundleUpdater.deleteTree(work); work.mkdirs();
        File ks = new File(a[5]); CHANNEL = new File(a[6]);

        /* Serveur HTTPS local (certificat de test) qui ne sert QUE le dossier du canal. */
        char[] pw = "test-only".toCharArray();
        KeyStore k = KeyStore.getInstance("PKCS12"); k.load(new FileInputStream(ks), pw);
        KeyManagerFactory kmf = KeyManagerFactory.getInstance("SunX509"); kmf.init(k, pw);
        TrustManagerFactory tmf = TrustManagerFactory.getInstance("SunX509"); tmf.init(k);
        SSLContext ssl = SSLContext.getInstance("TLS"); ssl.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
        HttpsURLConnection.setDefaultSSLSocketFactory(ssl.getSocketFactory());
        HttpsServer srv = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        srv.setHttpsConfigurator(new HttpsConfigurator(ssl));
        final String base = "/fbms/android-updates/test/";
        srv.createContext("/", ex -> {
            String p = ex.getRequestURI().getPath();
            byte[] out = null; int status = 404;
            if (!serverUp) status = 503;
            else if (p.startsWith(base) && !p.contains("..")) {
                File f = new File(CHANNEL, p.substring(base.length()));
                if (f.isFile()) { try { out = Files.readAllBytes(f.toPath()); status = 200; } catch (Exception e) { status = 500; } }
                if (p.contains("/objects/")) objectHits.incrementAndGet();
                if (out != null && breakObject != null && p.endsWith(breakObject)) {
                    ex.sendResponseHeaders(200, out.length);           // annonce la taille complète…
                    OutputStream os = ex.getResponseBody(); os.write(out, 0, out.length / 2); os.flush();
                    ex.close(); return;                                 // …puis coupe : téléchargement interrompu
                }
            }
            if (out == null) out = new byte[0];
            ex.sendResponseHeaders(status, out.length == 0 ? -1 : out.length);
            if (out.length > 0) { OutputStream os = ex.getResponseBody(); os.write(out); os.close(); } else ex.close();
        });
        srv.start();
        String ROOT = "https://localhost:" + srv.getAddress().getPort() + base;
        JSONObject cfg = new JSONObject().put("enabled", true).put("channel", "test").put("app_id", "ci.anagroci.fieldbuying")
                .put("update_root_url", ROOT).put("manifest_url", ROOT + "web-bundle.json").put("public_key_der_hex", pubHex);

        File www = new File(assets, "www");
        JSONObject emb = new JSONObject(new String(Files.readAllBytes(new File(www, "_native/bundle-manifest.json").toPath()), "UTF-8"));
        File appData = new File(work, "app_data");               // stockage local simulé (IndexedDB, localStorage)
        new File(appData, "app_webview/Default/IndexedDB/https_appassets.androidplatform.net_0.indexeddb.leveldb").mkdirs();
        Files.write(new File(appData, "app_webview/Default/IndexedDB/https_appassets.androidplatform.net_0.indexeddb.leveldb/000003.log").toPath(),
                "operations en attente : 3 (donnees synthetiques)".getBytes("UTF-8"));
        new File(appData, "app_webview/Default/Local Storage").mkdirs();
        Files.write(new File(appData, "app_webview/Default/Local Storage/leveldb.log").toPath(), "session synthetique".getBytes("UTF-8"));
        String dataBefore = treeHash(appData);
        File upd = new File(work, "files/web-updates");
        final int NATIVE = 3;
        WebBundleUpdater u = new WebBundleUpdater(upd, emb, cfg, NATIVE, "ci.anagroci.fieldbuying", null);
        u.startup();
        String FB = "operations/field-buying.js";

        // E2E-01 : APK et canal au même commit -> à jour, aucun téléchargement
        JSONObject p0 = publishJson();
        JSONObject s = u.check();
        check("E2E-01", "Canal publié depuis le même commit que l'APK : « à jour », 0 objet téléchargé",
                "à jour".equals(s.optString("last_result")) && objectHits.get() == 0, s.optString("last_result") + " · seq " + p0.optLong("sequence"));
        check("E2E-02", "Identité commune : web_version identique dans l'APK et dans la publication",
                emb.optString("web_version").equals(p0.optString("web_version")), emb.optString("web_version"));

        // E2E-03 : une correction Web validée devient disponible
        commitChange(FB, "\n/* DEMO-UNIFICATION v1 : modification fictive et réversible */\n", "démo v1");
        JSONObject p1 = publishJson("--notes", "démonstration v1");
        objectHits.set(0);
        s = u.check();
        check("E2E-03", "Correction publiée : détectée, téléchargée depuis le magasin d'objets, vérifiée, mise en attente",
                s.optLong("pending_sequence") == p1.optLong("sequence") && objectHits.get() == 1 && "prete".equals(s.optString("phase")),
                "phase " + s.optString("phase") + " · " + objectHits.get() + " objet(s)");
        check("E2E-04", "Rien n'est remplacé pendant la session en cours", u.resolve(FB) == null && "intégrée à l'APK".equals(s.optString("active")), s.optString("active"));

        // E2E-05 : hors ligne -> la version locale continue, l'échec est clair
        serverUp = false;
        commitChange(FB, "\n/* DEMO-UNIFICATION v2 */\n", "démo v2");
        JSONObject p2 = publishJson();
        s = u.check();
        check("E2E-05", "Source injoignable (hors ligne) : version locale conservée, statut d'erreur clair",
                s.optString("last_result").startsWith("échec") && s.optLong("pending_sequence") == p1.optLong("sequence"), s.optString("last_result"));

        // E2E-06 : redémarrage -> activation de la version téléchargée, puis confirmation
        s = u.startup();
        AssetServer as = new AssetServer(new AssetManager(assets)); as.setUpdater(u);
        String served = body(as.handle(Uri.parse(AssetServer.ORIGIN + "/" + FB)));
        u.confirmBoot();
        s = u.status();
        check("E2E-06", "Redémarrage : version v1 activée, servie par AssetServer, démarrage confirmé, date de réussite notée",
                s.optLong("active_sequence") == p1.optLong("sequence") && served.contains("DEMO-UNIFICATION v1") && !s.optString("last_success_at").isEmpty(),
                "active " + s.optLong("active_sequence") + " · réussite " + s.optString("last_success_at"));

        // E2E-07 : reconnexion -> récupère v2
        serverUp = true;
        s = u.check();
        check("E2E-07", "Reconnexion : la version v2 est récupérée", s.optLong("pending_sequence") == p2.optLong("sequence"), s.optString("last_result"));

        // E2E-08 : téléchargement interrompu puis reprise
        commitChange(FB, "\n/* DEMO-UNIFICATION v3 */\n", "démo v3");
        JSONObject p3 = publishJson();
        String sha3 = new JSONObject(new String(Files.readAllBytes(new File(CHANNEL, "web-bundle.json").toPath()), "UTF-8"))
                .getJSONObject("files").getJSONObject(FB).getString("sha256");
        breakObject = sha3;
        s = u.check();
        boolean interrupted = !s.optString("last_result").startsWith("version") && s.optLong("pending_sequence") == p2.optLong("sequence")
                && !new File(upd, "staging").exists();
        breakObject = null;
        JSONObject s2 = u.check();
        check("E2E-08", "Téléchargement interrompu : aucune version partielle, téléchargement repris ensuite",
                interrupted && s2.optLong("pending_sequence") == p3.optLong("sequence"), s.optString("last_result") + " → " + s2.optString("last_result"));

        // E2E-09 : objet altéré sur le serveur -> refus
        commitChange(FB, "\n/* DEMO-UNIFICATION v4 */\n", "démo v4");
        JSONObject p4 = publishJson();
        String sha4 = new JSONObject(new String(Files.readAllBytes(new File(CHANNEL, "web-bundle.json").toPath()), "UTF-8"))
                .getJSONObject("files").getJSONObject(FB).getString("sha256");
        File obj4 = new File(CHANNEL, "objects/" + sha4.substring(0, 2) + "/" + sha4);
        byte[] good = Files.readAllBytes(obj4.toPath());
        Files.write(obj4.toPath(), (new String(good, "UTF-8") + "alert('injection')").getBytes("UTF-8"));
        s = u.check();
        check("E2E-09", "Objet modifié après signature : mise à jour refusée, version en place conservée",
                s.optString("last_result").startsWith("refusée") && s.optLong("pending_sequence") == p3.optLong("sequence"), s.optString("last_result"));
        String verifyOut = run("node", "android/scripts/publish-web-update.mjs", "--channel", "test", "--out", CHANNEL.getAbsolutePath(), "--verify", "--pub", new File(KEY.getParentFile(), "web-bundle-public.pem").getAbsolutePath());
        check("E2E-10", "Contrôle de la publication (--verify) : objet altéré détecté", code(verifyOut) != 0 && verifyOut.contains(FB), "code " + code(verifyOut));
        Files.write(obj4.toPath(), good);
        s = u.check();
        check("E2E-11", "Objet restauré : la même version est acceptée", s.optLong("pending_sequence") == p4.optLong("sequence"), s.optString("last_result"));

        // E2E-12 / 13 : v4 activée puis jugée défectueuse -> révocation + retour arrière publiés ensemble
        u.startup(); u.confirmBoot();
        boolean v4Active = u.status().optLong("active_sequence") == p4.optLong("sequence");
        String refused = publish("--revoke", String.valueOf(p4.optLong("sequence")));
        JSONObject rb = publishJson("--revoke", String.valueOf(p4.optLong("sequence")), "--rollback-to", String.valueOf(p3.optLong("sequence")));
        s = u.check();
        boolean flagged = s.optBoolean("revoke_pending");
        s = u.startup(); u.confirmBoot(); s = u.status();
        served = body(as.handle(Uri.parse(AssetServer.ORIGIN + "/" + FB)));
        check("E2E-12", "Révoquer la version courante sans rien publier à sa place : refusé par la chaîne",
                code(refused) != 0 && refused.contains("--rollback-to"), "code " + code(refused));
        check("E2E-13", "Version active révoquée + retour arrière : signalée, puis au démarrage suivant v4 refusée et contenu v3 actif sous un nouveau numéro",
                v4Active && flagged && s.optLong("active_sequence") == rb.optLong("sequence") && s.getJSONObject("rejected").has(String.valueOf(p4.optLong("sequence")))
                        && served.contains("DEMO-UNIFICATION v3") && !served.contains("DEMO-UNIFICATION v4") && rb.optLong("rollback_of") == p3.optLong("sequence"),
                "révocation=" + flagged + " · active " + s.optLong("active_sequence") + " (retour de " + rb.optLong("rollback_of") + ")");

        // E2E-14 : version qui exige un nouvel APK
        commitChange(FB, "\n/* DEMO-UNIFICATION v5 : exige un APK plus récent */\n", "démo v5");
        JSONObject p5 = publishJson("--min-native", "99");
        objectHits.set(0);
        s = u.check();
        check("E2E-14", "Version exigeant un nouvel APK : signalée « nouvel APK requis », rien téléchargé ni activé",
                "nouvel_apk".equals(s.optString("phase")) && objectHits.get() == 0 && s.optLong("active_sequence") == rb.optLong("sequence")
                        && s.getJSONObject("latest").has("native"), s.optString("phase") + " · " + s.optString("last_result"));

        // E2E-15 : mise à jour de sécurité
        JSONObject p6 = publishJson("--policy", "security", "--force");
        s = u.check();
        check("E2E-15", "Mise à jour de sécurité : politique transmise à l'écran, version mise en attente",
                "security".equals(s.getJSONObject("latest").optString("update_policy")) && s.optLong("pending_sequence") == p6.optLong("sequence"),
                s.getJSONObject("latest").optString("update_policy"));

        // E2E-16 : format de file locale modifié + opérations en attente -> activation différée
        commitChange("shared/farmer-registry-sync.js", "\n", "prépare format");
        File frs = new File(CLONE, "shared/farmer-registry-sync.js");
        Files.write(frs.toPath(), new String(Files.readAllBytes(frs.toPath()), "UTF-8").replace("var DB_VERSION = 1;", "var DB_VERSION = 2;").getBytes("UTF-8"));
        run("git", "-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-am", "format de file 2");
        Thread.sleep(1100);
        JSONObject p7 = publishJson();
        u.reportQueue(4);
        s = u.check(); s = u.startup();
        boolean deferred = "differee".equals(s.optString("phase")) && s.optLong("active_sequence") == rb.optLong("sequence");
        u.reportQueue(0);
        s = u.startup();
        check("E2E-16", "Format des files changé avec 4 opérations en attente : activation différée ; file vidée : activation",
                deferred && s.optLong("active_sequence") == p7.optLong("sequence"), "différée=" + deferred + " · active " + s.optLong("active_sequence"));

        // E2E-17 : démarrage non confirmé -> retour automatique
        commitChange(FB, "\n/* DEMO-UNIFICATION v8 : ne confirme pas son démarrage */\n", "démo v8");
        u.confirmBoot();
        JSONObject p8 = publishJson();
        u.check(); u.startup();
        u.bootFailed();
        s = u.status();
        check("E2E-17", "Version défectueuse (démarrage non confirmé) : retour automatique, version refusée définitivement",
                s.optLong("active_sequence") == p7.optLong("sequence") && s.getJSONObject("rejected").has(String.valueOf(p8.optLong("sequence"))), "active " + s.optLong("active_sequence"));

        // E2E-18 : rejeu d'un ancien manifeste signé
        File cur = new File(CHANNEL, "web-bundle.json"), curSig = new File(CHANNEL, "web-bundle.json.sig");
        byte[] keepM = Files.readAllBytes(cur.toPath()), keepS = Files.readAllBytes(curSig.toPath());
        Files.copy(new File(CHANNEL, "manifests/" + p1.optLong("sequence") + ".json").toPath(), cur.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        Files.copy(new File(CHANNEL, "manifests/" + p1.optLong("sequence") + ".json.sig").toPath(), curSig.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        s = u.check();
        check("E2E-18", "Rejeu d'un ancien manifeste authentique : ignoré (anti-rejeu)", "à jour".equals(s.optString("last_result")) && s.optLong("active_sequence") == p7.optLong("sequence"), s.optString("last_result"));
        Files.write(cur.toPath(), keepM); Files.write(curSig.toPath(), keepS);

        // E2E-19 : chaîne de publication — contrôle critique en échec = rien n'est publié
        commitChange(FB, "\n/* DEMO-UNIFICATION v9 */\n", "démo v9");
        byte[] before = Files.readAllBytes(cur.toPath());
        List<String> c = new ArrayList<>(java.util.Arrays.asList("node", "android/scripts/publish-web-update.mjs", "--channel", "test", "--key", KEY.getAbsolutePath(),
                "--out", CHANNEL.getAbsolutePath(), "--gates", "node -e process.exit(1)"));
        String gate = run(c.toArray(new String[0]));
        check("E2E-19", "Contrôle critique en échec : publication bloquée (code 2), manifeste inchangé",
                code(gate) == 2 && java.util.Arrays.equals(before, Files.readAllBytes(cur.toPath())), "code " + code(gate));

        // E2E-20 : arbre non commité refusé ; clé dans le dépôt refusée
        Files.write(new File(CLONE, FB).toPath(), (new String(Files.readAllBytes(new File(CLONE, FB).toPath()), "UTF-8") + "//x").getBytes("UTF-8"));
        String dirty = publish();
        run("git", "checkout", "--", FB);
        File inRepoKey = new File(CLONE, "cle-dans-le-depot.pem");
        Files.copy(KEY.toPath(), inRepoKey.toPath());
        String inRepo = run("node", "android/scripts/publish-web-update.mjs", "--channel", "test", "--key", inRepoKey.getAbsolutePath(), "--out", CHANNEL.getAbsolutePath(), "--gates", "node -e 0");
        inRepoKey.delete();
        check("E2E-20", "Refus : fichiers Web non commités ; clé privée placée dans le dépôt",
                code(dirty) != 0 && dirty.contains("non commités") && code(inRepo) != 0 && inRepo.contains("DANS le dépôt"), "codes " + code(dirty) + "/" + code(inRepo));

        // E2E-21 : journal de publication complet et cohérent
        JSONObject journal = new JSONObject(new String(Files.readAllBytes(new File(CHANNEL, "releases.json").toPath()), "UTF-8"));
        int n = journal.getJSONArray("releases").length();
        boolean revokedLogged = false;
        for (int i = 0; i < n; i++) { JSONObject r = journal.getJSONArray("releases").getJSONObject(i);
            if (r.optLong("sequence") == p4.optLong("sequence") && "revoked".equals(r.optString("status"))) revokedLogged = true; }
        check("E2E-21", "Journal de publication : chaque version, son statut (révoquée, remplacée…) et ses étapes", n >= 9 && revokedLogged, n + " publications");

        // E2E-22 : données locales de l'application intactes après tous les cycles
        String dataAfter = treeHash(appData);
        check("E2E-22", "Données locales (IndexedDB, localStorage simulés) strictement identiques avant / après 9 publications, 1 révocation, 1 retour arrière",
                dataBefore.equals(dataAfter), dataAfter.substring(0, 16));

        srv.stop(0);
        System.out.println("RESULTAT " + pass + " PASS / " + fail + " FAIL");
        Files.write(new File(work, "resultats.txt").toPath(), (String.join("\n", lines) + "\nRESULTAT " + pass + " PASS / " + fail + " FAIL\n").getBytes("UTF-8"));
        if (fail > 0) System.exit(1);
    }
}
