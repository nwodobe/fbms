// ============================================================================
//  ASSISTANT IA AFLP — FONCTION EDGE D'INTERPRÉTATION LINGUISTIQUE
//  Fichier : docs/edge-functions/aflp-ia-langue/index.ts
//  ----------------------------------------------------------------------------
//  ⚠ CETTE FONCTION N'EST PAS DÉPLOYÉE, et ne peut pas l'être par un agent.
//
//  `supabase/**` — donc `supabase/functions/**` — est interdit à toute
//  modification automatique (CLAUDE.md §3). Ce fichier est une PROPOSITION,
//  déposée dans `docs/`, qui est le seul emplacement auto-modifiable. Pour la
//  mettre en service, un humain la copie dans `supabase/functions/aflp-ia-langue/`
//  puis exécute les commandes de docs/aflp_ia_langue_apprentissage_20260815.md.
//
//  AU 2026-08-15, AUCUN FOURNISSEUR LINGUISTIQUE N'EST CONFIGURÉ sur le projet
//  Supabase de FBMS. Aucun secret n'a été créé, aucune clé n'a été demandée, et
//  aucune n'a été inventée. Tant qu'il en est ainsi, le drapeau
//  `aflp_ia_langue_active` reste à `false` et le client
//  (`shared/aflp-ia-langue.js`) n'émet aucun appel.
//
//  ------------------------------------------------------- CE QU'ELLE FAIT
//  Elle transforme une question en langage naturel en un CONTRAT structuré :
//    { intent, scope, period, filters, confidence,
//      requires_clarification, clarification_question }
//
//  ------------------------------------------------------- CE QU'ELLE NE FAIT PAS
//  · Elle ne reçoit AUCUN chiffre métier. Le client ne lui envoie que la
//    question, le vocabulaire du catalogue et des NOMS de lieux.
//  · Elle n'accède à AUCUNE table de données. Sa seule requête base est la
//    vérification du profil de l'appelant.
//  · Elle ne renvoie JAMAIS de texte de réponse. Un `answer`, une `phrase` ou
//    un `montant` dans sa sortie serait ignoré par le client — mais elle n'en
//    produit pas, et le §5 le vérifie avant de répondre.
//  · Elle n'expose jamais la clé du fournisseur, y compris dans ses messages
//    d'erreur (§7).
// ============================================================================

// deno-lint-ignore-file no-explicit-any

const VERSION = "1.0.0";

// --- Secrets serveur. Aucun défaut, aucune valeur en dur. -------------------
// À poser avec : supabase secrets set AFLP_IA_LANGUE_CLE=… (voir la doc)
const CLE_FOURNISSEUR = Deno.env.get("AFLP_IA_LANGUE_CLE") ?? "";
const MODELE = Deno.env.get("AFLP_IA_LANGUE_MODELE") ?? "";
const URL_FOURNISSEUR = Deno.env.get("AFLP_IA_LANGUE_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const TIMEOUT_MS = Number(Deno.env.get("AFLP_IA_LANGUE_TIMEOUT_MS") ?? "8000");
const MAX_QUESTION = 500;

// --- Limitation de débit en mémoire d'instance ------------------------------
// Volontairement simple, et volontairement documentée comme telle : une
// instance Edge peut être recyclée, ce compteur n'est donc pas un quota
// comptable. Il borne les rafales ; le vrai plafond de coût est celui du
// fournisseur. Ne pas le présenter comme une garantie.
const FENETRE_MS = 60_000;
const MAX_PAR_FENETRE = 20;
const compteurs = new Map<string, { debut: number; n: number }>();

function debitDepasse(cle: string): boolean {
  const maintenant = Date.now();
  const c = compteurs.get(cle);
  if (!c || maintenant - c.debut > FENETRE_MS) {
    compteurs.set(cle, { debut: maintenant, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > MAX_PAR_FENETRE;
}

// --- Réponse JSON -----------------------------------------------------------
const ENTETES = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: ENTETES });
}

// ============================================================================
//  1. Validation de la charge reçue du navigateur
//     On refuse tout ce qui ressemble à une donnée métier : si un jour un
//     appelant ajoutait un `montant` ou un `etat` à la charge, cette fonction
//     doit le rejeter, pas le transmettre au fournisseur.
// ============================================================================
const CLES_ATTENDUES = ["question", "catalogue", "lieux"];

function validerEntree(corps: any): string | null {
  if (!corps || typeof corps !== "object") return "corps absent";
  for (const k of Object.keys(corps)) {
    if (!CLES_ATTENDUES.includes(k)) return `clé interdite dans la charge : ${k}`;
  }
  if (typeof corps.question !== "string" || !corps.question.trim()) return "question absente";
  if (corps.question.length > MAX_QUESTION) return "question trop longue";
  if (!corps.catalogue || !Array.isArray(corps.catalogue.intentions)) return "catalogue absent";
  if (!corps.catalogue.intentions.length) return "catalogue vide";
  return null;
}

// ============================================================================
//  2. Vérification de l'appelant
//     La fonction n'accepte que des utilisateurs FBMS actifs. Le contrôle passe
//     par la table `profils` et la RLS, jamais par `user_metadata` : ce dernier
//     est modifiable par l'utilisateur lui-même.
// ============================================================================
async function profilActif(jwt: string): Promise<{ ok: boolean; role?: string; motif?: string }> {
  if (!jwt) return { ok: false, motif: "jeton absent" };
  if (!SUPABASE_URL || !SUPABASE_ANON) return { ok: false, motif: "environnement incomplet" };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profils?select=role,actif&limit=1`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return { ok: false, motif: "profil illisible" };
  const lignes = await r.json();
  // La RLS de `profils` ne laisse voir à un utilisateur que sa propre ligne :
  // le premier enregistrement retourné EST le sien.
  if (!Array.isArray(lignes) || !lignes.length) return { ok: false, motif: "profil introuvable" };
  if (lignes[0].actif !== true) return { ok: false, motif: "compte désactivé" };
  return { ok: true, role: lignes[0].role };
}

// ============================================================================
//  3. Consigne envoyée au fournisseur
//     Elle décrit une tâche de CLASSIFICATION, pas de rédaction. Aucun chiffre
//     n'y figure, et il est demandé explicitement de n'en produire aucun.
// ============================================================================
function consigne(catalogue: any, lieux: any): string {
  const intentions = catalogue.intentions
    .map((i: any) =>
      `- ${i.code} : ${i.nom}. ${i.description} ` +
      `Portées : ${(i.portees || []).join("|")}. Périodes : ${(i.periodes || []).join("|")}. ` +
      `Exemples : ${(i.exemples || []).join(" / ")}`)
    .join("\n");

  return [
    "Tu classes une question professionnelle en français ivoirien dans un catalogue fermé.",
    "Tu ne réponds JAMAIS à la question. Tu ne produis JAMAIS de chiffre, de montant,",
    "de volume ni de date de donnée. Tu ne rédiges aucune phrase destinée à l'utilisateur",
    "hormis, éventuellement, une question de clarification.",
    "",
    "Réponds UNIQUEMENT par un objet JSON de cette forme exacte, sans texte autour :",
    '{"intent":"<code|null>","scope":{"type":"global|zone|cluster|village|rt","id":"<identifiant|null>",',
    '"label":"<libellé|null>"},"period":"day|week|campaign","filters":{},',
    '"confidence":<0..1>,"requires_clarification":<bool>,"clarification_question":"<texte|null>"}',
    "",
    "Contraintes absolues :",
    "- `intent` est l'un des codes ci-dessous, ou null si aucun ne convient. N'invente aucun code.",
    "- `scope.label` est l'un des lieux listés ci-dessous, à l'orthographe exacte. N'invente aucun lieu.",
    "- `period` et `filters` doivent être autorisés pour l'intention retenue.",
    "- Si la question est ambiguë, mets `requires_clarification` à true et propose une question courte.",
    "- Si tu hésites, baisse `confidence`. Une confiance élevée sur une erreur coûte plus cher qu'un doute.",
    "",
    "Catalogue des intentions :",
    intentions,
    "",
    `Zones : ${(lieux.zones || []).join(", ") || "aucune"}`,
    `Clusters : ${(lieux.clusters || []).join(", ") || "aucun"}`,
    `Villages : ${(lieux.villages || []).slice(0, 80).join(", ") || "aucun"}`,
    `Équipes RT : ${(lieux.equipes || []).slice(0, 80).join(", ") || "aucune"}`,
  ].join("\n");
}

// ============================================================================
//  4. Appel du fournisseur, avec délai maximal
// ============================================================================
async function interroger(question: string, catalogue: any, lieux: any) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL_FOURNISSEUR, {
      method: "POST",
      signal: controleur.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLE_FOURNISSEUR,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 400,
        temperature: 0,          // classification : aucun aléa souhaitable
        system: consigne(catalogue, lieux),
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!r.ok) return { erreur: `fournisseur: statut ${r.status}` };
    const data = await r.json();
    const texte = (data?.content?.[0]?.text ?? "").trim();
    const usage = {
      total_tokens: (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0),
      input_tokens: data?.usage?.input_tokens ?? 0,
      output_tokens: data?.usage?.output_tokens ?? 0,
    };
    return { texte, usage };
  } catch (e) {
    return { erreur: (e as Error).name === "AbortError" ? "délai dépassé" : "appel impossible" };
  } finally {
    clearTimeout(minuteur);
  }
}

// ============================================================================
//  5. Validation stricte de la sortie du modèle
//     Le client revalide de son côté, et le moteur une troisième fois. Cette
//     redondance est délibérée : les trois contrôles ne partagent aucun code,
//     donc aucun défaut commun.
// ============================================================================
const CLES_CONTRAT = ["intent", "scope", "period", "filters", "confidence",
  "requires_clarification", "clarification_question"];
const CLES_PORTEE = ["type", "id", "label"];

function validerContrat(c: any, catalogue: any, lieux: any): string | null {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "contrat non structuré";
  for (const k of Object.keys(c)) {
    if (!CLES_CONTRAT.includes(k)) return `clé inconnue : ${k}`;
  }
  const codes = catalogue.intentions.map((i: any) => i.code);
  if (c.intent !== null && !codes.includes(c.intent)) return `intention inventée : ${c.intent}`;
  const intention = catalogue.intentions.find((i: any) => i.code === c.intent);

  if (!c.scope || typeof c.scope !== "object") return "portée absente";
  for (const k of Object.keys(c.scope)) {
    if (!CLES_PORTEE.includes(k)) return `clé de portée inconnue : ${k}`;
  }
  if (!catalogue.portees.includes(c.scope.type)) return `portée inconnue : ${c.scope.type}`;
  if (intention && !intention.portees.includes(c.scope.type)) {
    return `portée ${c.scope.type} non autorisée pour ${c.intent}`;
  }
  if (c.scope.type !== "global") {
    const connus = [
      ...(lieux.zones ?? []), ...(lieux.clusters ?? []),
      ...(lieux.villages ?? []), ...(lieux.equipes ?? []),
    ].map(String);
    if (!connus.includes(String(c.scope.label))) return `lieu inventé : ${c.scope.label}`;
  }
  if (!catalogue.periodes.includes(c.period)) return `période inconnue : ${c.period}`;
  if (intention && !intention.periodes.includes(c.period)) {
    return `période ${c.period} non autorisée pour ${c.intent}`;
  }
  if (c.filters === null || typeof c.filters !== "object" || Array.isArray(c.filters)) {
    return "filtres non structurés";
  }
  for (const k of Object.keys(c.filters)) {
    if (!catalogue.filtres.includes(k)) return `filtre inconnu : ${k}`;
    if (intention && !intention.filtres.includes(k)) return `filtre ${k} non autorisé`;
  }
  if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
    return "confiance hors [0,1]";
  }
  if (typeof c.requires_clarification !== "boolean") return "requires_clarification non booléen";
  if (c.clarification_question !== null && typeof c.clarification_question !== "string") {
    return "clarification_question non textuelle";
  }
  // Dernier filet : une clarification qui contiendrait un chiffre serait une
  // réponse déguisée. On la refuse.
  if (typeof c.clarification_question === "string" && /\d{3,}/.test(c.clarification_question)) {
    return "la question de clarification contient un chiffre";
  }
  return null;
}

function extraireJson(texte: string): any {
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return null;
  try { return JSON.parse(texte.slice(debut, fin + 1)); } catch { return null; }
}

// ============================================================================
//  6. Point d'entrée
// ============================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES });
  if (req.method !== "POST") return json({ erreur: "méthode non autorisée" }, 405);

  // Interrupteur d'arrêt serveur : il l'emporte sur toute configuration client.
  if (Deno.env.get("AFLP_IA_LANGUE_KILL") === "true") {
    return json({ erreur: "couche linguistique coupée", contrat: null }, 503);
  }
  // Fournisseur non configuré : on le dit clairement, sans jamais révéler
  // quelle variable manque au-delà de son nom — et surtout aucune valeur.
  if (!CLE_FOURNISSEUR || !MODELE || !URL_FOURNISSEUR) {
    return json({
      erreur: "fournisseur linguistique non configuré",
      detail: "secrets AFLP_IA_LANGUE_CLE / _MODELE / _URL absents",
      contrat: null,
      version: VERSION,
    }, 503);
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const profil = await profilActif(jwt);
  if (!profil.ok) return json({ erreur: `accès refusé : ${profil.motif}`, contrat: null }, 401);

  if (debitDepasse(jwt.slice(-24))) {
    return json({ erreur: "trop d'appels, réessayez dans une minute", contrat: null }, 429);
  }

  let corps: any;
  try { corps = await req.json(); } catch { return json({ erreur: "JSON illisible" }, 400); }

  const pbEntree = validerEntree(corps);
  if (pbEntree) return json({ erreur: `charge refusée : ${pbEntree}`, contrat: null }, 400);

  const r = await interroger(corps.question, corps.catalogue, corps.lieux ?? {});
  if ("erreur" in r) return json({ erreur: r.erreur, contrat: null }, 502);

  const brut = extraireJson(r.texte ?? "");
  if (!brut) return json({ erreur: "sortie du modèle non exploitable", contrat: null }, 502);

  const pb = validerContrat(brut, corps.catalogue, corps.lieux ?? {});
  if (pb) return json({ erreur: `contrat refusé : ${pb}`, contrat: null }, 422);

  return json({ contrat: brut, usage: r.usage, version: VERSION });
});

// ============================================================================
//  7. Ce que cette fonction ne fera jamais, et pourquoi c'est écrit ici
//  · Aucun message d'erreur ne contient la clé du fournisseur ni un fragment
//    de celle-ci : les erreurs sont réécrites (§4 et §6) plutôt que
//    retransmises telles quelles.
//  · Aucun accès aux tables `achats`, `avances`, `reconciliations`,
//    `sacs_mouvements` : la seule requête base est la lecture du profil de
//    l'appelant.
//  · Aucun `service_role` : la fonction n'utilise que la clé anonyme et le
//    jeton de l'utilisateur, donc la RLS s'applique intégralement.
//  · Aucune écriture, nulle part.
// ============================================================================
