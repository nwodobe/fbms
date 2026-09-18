// Creation reservee au BM actif. A deployer apres recette et accord explicite.
// Garder verify_jwt=true. Aucun secret ni jeton n'est journalise.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creerGestionnaire, type Profil, type Role } from './handler.ts';

Deno.serve(creerGestionnaire({
  env: (nom) => Deno.env.get(nom),
  reference: () => crypto.randomUUID(),
  journal: (evenement) => console.error(JSON.stringify(evenement)),
  services: (config, token) => {
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const appelant = createClient(config.url, config.publique, {
      ...options, global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const admin = createClient(config.url, config.privee, options);
    const colonnes = 'user_id,nom,email,role,cluster,actif';
    return {
      identite: async () => { const r = await appelant.auth.getUser(token); return { data: r.data.user, error: r.error }; },
      appelant: async (id) => await appelant.from('profils').select('role,actif').eq('user_id',id).maybeSingle(),
      roles: async () => { const r = await appelant.rpc('fbms_roles_attribuables'); return { data: r.data as Role[] | null, error: r.error }; },
      cluster: async (code) => await appelant.from('aflp_clusters').select('code,active').eq('code',code).maybeSingle(),
      creerAuth: async (s, reference, acteur) => {
        // Politique email_confirm existante conservee : remise d'identifiants hors bande a valider.
        const r = await admin.auth.admin.createUser({ email: s.email, password: s.password, email_confirm: true,
          user_metadata: { nom: s.nom }, app_metadata: { fbms_creation_request: reference, fbms_created_by: acteur } });
        return { data: r.data.user, error: r.error };
      },
      // Ne jamais inserer le profil avec le client admin : RLS + garde + audit du BM.
      insererProfil: async (p) => { const r = await appelant.from('profils').insert(p).select(colonnes).single(); return { data: r.data as Profil | null, error: r.error }; },
      // Ces trois operations ne recoivent que l'UUID retourne par NOTRE createUser.
      verifierProfil: async (id) => { const r = await admin.from('profils').select(colonnes).eq('user_id',id).maybeSingle(); return { data: r.data as Profil | null, error: r.error }; },
      supprimerAuth: async (id) => { const r = await admin.auth.admin.deleteUser(id); return { data: r.data, error: r.error }; },
      verifierAuth: async (id) => { const r = await admin.auth.admin.getUserById(id); return { data: r.data.user, error: r.error }; }
    };
  }
}));
