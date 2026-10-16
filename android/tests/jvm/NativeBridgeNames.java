package ci.anagroci.fieldbuying;
/** Accès de test à la règle d'assainissement de NativeBridge (copie exacte vérifiée par run.sh). */
final class NativeBridgeNames {
    static String sanitize(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (n.isEmpty()) n = "export-anagroci";
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n;
    }
}
