// ============================================================================
// ANAGROCI — Fonction Edge : création de comptes réservée au Branch Manager
// ----------------------------------------------------------------------------
// La clé service_role reste ICI (côté serveur), jamais dans le navigateur.
// Flux : le BM connecté appelle cette fonction (avec son jeton). On vérifie
// qu'il est bien Branch Manager, puis on crée le compte Auth + le profil.
//
// DÉPLOIEMENT :
//   supabase functions deploy admin-create-user
//   supabase secrets set SERVICE_ROLE_KEY=<clé service_role du projet>
//   (SUPABASE_URL est fourni automatiquement par la plateforme)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Jeton d'authentification manquant." }, 401);

  // 1) Identifier l'appelant à partir de son jeton.
  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Session invalide." }, 401);

  // 2) Vérifier que l'appelant est un Branch Manager actif.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: prof } = await admin
    .from("profils")
    .select("role, actif")
    .eq("user_id", userData.user.id)
    .single();
  if (!prof || !prof.actif || prof.role !== "Branch Manager") {
    return json({ error: "Action réservée au Branch Manager." }, 403);
  }

  // 3) Valider l'entrée.
  let payload: { nom?: string; email?: string; password?: string; role?: string };
  try { payload = await req.json(); } catch { return json({ error: "Corps de requête invalide." }, 400); }
  const nom = (payload.nom ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();
  const password = payload.password ?? "";
  const role = (payload.role ?? "").trim();
  const ROLES = [
    "Branch Manager", "Assistant Branch Manager", "Head of Field",
    "Procurement Officer", "Supervisor", "Agent Recenseur", "Consultation uniquement",
  ];
  if (!nom || !email || password.length < 8 || !ROLES.includes(role)) {
    return json({ error: "Nom, email, mot de passe (8+ caractères) et rôle valides requis." }, 400);
  }

  // 4) Créer le compte Auth (email confirmé d'office) puis le profil.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nom },
  });
  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? "Échec de création du compte." }, 400);
  }

  const { error: profErr } = await admin.from("profils").insert({
    user_id: created.user.id, nom, email, role, actif: true,
  });
  if (profErr) {
    // Compensation : retirer le compte Auth si le profil échoue, pour rester cohérent.
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Compte créé mais profil refusé : " + profErr.message }, 400);
  }

  return json({ ok: true, user_id: created.user.id, email, role });
});
