/** Creation de compte : logique testable sans Deno, Auth distant ni ecriture en production. */
export type Erreur = { code?: string; status?: number; message?: string };
export type Resultat<T> = { data: T | null; error?: Erreur | null };
export type Profil = { user_id: string; nom: string; email: string; role: string; cluster: string | null; actif: boolean };
export type Role = { valeur: string; attribuable: boolean; cluster_requis: boolean };
export type Saisie = { nom: string; email: string; password: string; role: string; cluster: string | null };
export interface Services {
  identite(): Promise<Resultat<{ id: string }>>;
  appelant(id: string): Promise<Resultat<{ role: string; actif: boolean }>>;
  roles(): Promise<Resultat<Role[]>>;
  cluster(code: string): Promise<Resultat<{ code: string; active: boolean | null }>>;
  creerAuth(saisie: Saisie, reference: string, acteur: string): Promise<Resultat<{ id: string }>>;
  insererProfil(profil: Profil): Promise<Resultat<Profil>>;
  // Lecture privilegiee limitee a l'identifiant cree PAR CETTE tentative.
  verifierProfil(id: string): Promise<Resultat<Profil>>;
  supprimerAuth(id: string): Promise<Resultat<unknown>>;
  verifierAuth(id: string): Promise<Resultat<{ id: string }>>;
}
export type Configuration = { url: string; publique: string; privee: string };
export interface Dependances {
  env(nom: string): string | undefined;
  services(config: Configuration, token: string): Services;
  reference(): string;
  journal(evenement: { reference: string; etape: string; code: string; compte?: string }): void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages: Record<string, string> = {
  CONFIGURATION_INCOMPLETE: 'Le service de cr\u00e9ation des comptes est mal configur\u00e9.',
  ORIGINE_REFUSEE: 'Origine de la demande non autoris\u00e9e.',
  METHODE_REFUSEE: 'M\u00e9thode non autoris\u00e9e.',
  SESSION_INVALIDE: 'Votre session a expir\u00e9 ou est invalide. Reconnectez-vous.',
  ACCES_REFUSE: 'Vous n\u2019\u00eates pas autoris\u00e9 \u00e0 cr\u00e9er cet acc\u00e8s.',
  DONNEES_INVALIDES: 'V\u00e9rifiez le nom, l\u2019email, le r\u00f4le et le mot de passe (8 caract\u00e8res minimum).',
  CORPS_TROP_VOLUMINEUX: 'La demande est trop volumineuse.',
  REFERENTIEL_INDISPONIBLE: 'Le r\u00e9f\u00e9rentiel des r\u00f4les est momentan\u00e9ment indisponible.',
  ROLE_NON_ATTRIBUABLE: 'Ce r\u00f4le ne peut pas \u00eatre attribu\u00e9 depuis votre compte.',
  CLUSTER_REQUIS: 'S\u00e9lectionnez un cluster pour ce poste.',
  CLUSTER_INVALIDE: 'Le cluster choisi est inconnu ou inactif.',
  EMAIL_EXISTANT: 'Un compte existe d\u00e9j\u00e0 avec cette adresse email. Aucun compte existant n\u2019a \u00e9t\u00e9 modifi\u00e9.',
  MOT_DE_PASSE_REFUSE: 'Le mot de passe ne respecte pas les exigences du serveur.',
  AUTH_REFUSE: 'Le service d\u2019authentification a refus\u00e9 la cr\u00e9ation.',
  PROFIL_REFUSE_COMPENSE: 'Le profil a \u00e9t\u00e9 refus\u00e9. Le compte de connexion cr\u00e9\u00e9 par cette tentative a \u00e9t\u00e9 supprim\u00e9.',
  COHERENCE_A_VERIFIER: 'Cr\u00e9ation incompl\u00e8te : une v\u00e9rification administrateur est n\u00e9cessaire. Ne recr\u00e9ez pas ce compte.',
  CREATION_INCERTAINE: 'Le r\u00e9sultat de la cr\u00e9ation n\u2019a pas pu \u00eatre confirm\u00e9. V\u00e9rifiez le compte avant une nouvelle tentative.',
  SERVICE_INDISPONIBLE: 'Le service de cr\u00e9ation est momentan\u00e9ment indisponible.'
};
function cleJSON(valeur: string | undefined): string {
  if (!valeur) return '';
  try { const x = JSON.parse(valeur); return typeof x?.default === 'string' ? x.default : ''; } catch { return ''; }
}
async function lireSaisie(req: Request): Promise<Saisie> {
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('DONNEES_INVALIDES');
  const lecteur = req.body?.getReader();
  if (!lecteur) throw new Error('DONNEES_INVALIDES');
  const morceaux: Uint8Array[] = []; let taille = 0;
  try {
    while (true) {
      const { value, done } = await lecteur.read(); if (done) break;
      taille += value.byteLength;
      if (taille > 16384) { await lecteur.cancel(); throw new Error('CORPS_TROP_VOLUMINEUX'); }
      morceaux.push(value);
    }
  } finally { lecteur.releaseLock(); }
  const bytes = new Uint8Array(taille); let offset = 0;
  for (const morceau of morceaux) { bytes.set(morceau, offset); offset += morceau.byteLength; }
  let x: unknown; try { x = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('DONNEES_INVALIDES'); }
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('DONNEES_INVALIDES');
  const v = x as Record<string, unknown>;
  if (['nom','email','password','role'].some(k => typeof v[k] !== 'string') ||
      (v.cluster !== undefined && v.cluster !== null && typeof v.cluster !== 'string')) throw new Error('DONNEES_INVALIDES');
  // Liste blanche : jamais authority_level, actif, user_id ou permissions venant du client.
  const s: Saisie = { nom: (v.nom as string).trim(), email: (v.email as string).trim().toLowerCase(),
    password: v.password as string, role: (v.role as string).trim(), cluster: ((v.cluster || '') as string).trim() || null };
  if (!s.nom || s.nom.length > 200 || s.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) ||
      s.password.length < 8 || s.password.length > 1024 || !s.role || s.role.length > 100 || (s.cluster?.length || 0) > 100) throw new Error('DONNEES_INVALIDES');
  return s;
}
function identique(a: Profil | null, b: Profil): boolean {
  return !!a && a.user_id === b.user_id && a.nom === b.nom && a.email === b.email && a.role === b.role &&
    (a.cluster || null) === b.cluster && a.actif === true;
}
export function creerGestionnaire(deps: Dependances) {
  return async (req: Request): Promise<Response> => {
    const reference = deps.reference();
    const origine = req.headers.get('Origin');
    const origines = (deps.env('ADMIN_ALLOWED_ORIGINS') || 'https://nwodobe.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const autorisee = !origine || origines.includes(origine);
    const headers: Record<string,string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': reference };
    if (origine && autorisee) headers['Access-Control-Allow-Origin'] = origine;
    if (autorisee) {
      headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Expose-Headers'] = 'X-Request-Id';
    }
    const erreur = (code: string, status: number) => new Response(JSON.stringify({ ok: false, code, error: messages[code], request_id: reference }), { status, headers });
    const noter = (code: string, etape: string, compte?: string) => deps.journal({ reference, etape, code, ...(compte ? { compte } : {}) });
    if (!autorisee) return erreur('ORIGINE_REFUSEE', 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return erreur('METHODE_REFUSEE', 405);
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
    if (!token || token === 'null' || token === 'undefined') return erreur('SESSION_INVALIDE', 401);
    const config = {
      url: deps.env('SUPABASE_URL') || '',
      publique: deps.env('SUPABASE_ANON_KEY') || cleJSON(deps.env('SUPABASE_PUBLISHABLE_KEYS')),
      privee: deps.env('SUPABASE_SERVICE_ROLE_KEY') || deps.env('SERVICE_ROLE_KEY') || cleJSON(deps.env('SUPABASE_SECRET_KEYS'))
    };
    if (!config.url || !config.publique || !config.privee) { noter('CONFIGURATION_INCOMPLETE','configuration'); return erreur('CONFIGURATION_INCOMPLETE',503); }
    let services: Services; let etape = 'lecture';
    try {
      services = deps.services(config, token);
      const identite = await services.identite();
      if (identite.error || !identite.data?.id) return erreur('SESSION_INVALIDE',401);
      const acteur = await services.appelant(identite.data.id);
      if (acteur.error) return erreur('SERVICE_INDISPONIBLE',503);
      if (!acteur.data || acteur.data.actif !== true || acteur.data.role !== 'Branch Manager') return erreur('ACCES_REFUSE',403);
      let saisie: Saisie;
      try { saisie = await lireSaisie(req); } catch (e) { const code = e instanceof Error && e.message === 'CORPS_TROP_VOLUMINEUX' ? e.message : 'DONNEES_INVALIDES'; return erreur(code, code === 'CORPS_TROP_VOLUMINEUX' ? 413 : 400); }
      const roles = await services.roles();
      if (roles.error || !Array.isArray(roles.data)) return erreur('REFERENTIEL_INDISPONIBLE',503);
      const role = roles.data.find(r => r.valeur === saisie.role);
      if (!role || role.attribuable !== true) return erreur('ROLE_NON_ATTRIBUABLE',403);
      if (role.cluster_requis && !saisie.cluster) return erreur('CLUSTER_REQUIS',400);
      if (saisie.cluster) {
        const cluster = await services.cluster(saisie.cluster);
        if (cluster.error) return erreur('SERVICE_INDISPONIBLE',503);
        if (!cluster.data || cluster.data.active === false) return erreur('CLUSTER_INVALIDE',400);
      }
      etape = 'creation_auth';
      const creation = await services.creerAuth(saisie, reference, identite.data.id);
      if (creation.error || !creation.data?.id) {
        const c = creation.error?.code;
        if (c === 'email_exists' || c === 'user_already_exists') return erreur('EMAIL_EXISTANT',409);
        if (c === 'weak_password') return erreur('MOT_DE_PASSE_REFUSE',400);
        if ((creation.error?.status || 0) >= 500 || !creation.error?.status) { noter('CREATION_INCERTAINE',etape); return erreur('CREATION_INCERTAINE',503); }
        return erreur('AUTH_REFUSE',400);
      }
      const id = creation.data.id;
      if (!UUID.test(id)) { noter('COHERENCE_A_VERIFIER',etape); return erreur('COHERENCE_A_VERIFIER',500); }
      const profil: Profil = { user_id: id, nom: saisie.nom, email: saisie.email, role: saisie.role, cluster: saisie.cluster, actif: true };
      const succes = () => new Response(JSON.stringify({ ok: true, user_id: id, email: profil.email, role: profil.role,
        cluster: profil.cluster, profile_verified: true, request_id: reference }), { status: 201, headers });
      // Un timeout ne prouve pas qu'un INSERT a echoue : relire avant compensation.
      try {
        const insertion = await services.insererProfil(profil);
        if (!insertion.error && identique(insertion.data,profil)) return succes();
      } catch { /* Relecture ciblee ci-dessous, sans seconde insertion. */ }
      etape = 'verification_profil';
      try {
        const lecture = await services.verifierProfil(id);
        if (lecture.error) throw new Error('lecture_indisponible');
        if (identique(lecture.data,profil)) return succes();
        // Un trigger concurrent a pu creer un autre profil : ne pas le supprimer aveuglement.
        if (lecture.data) { noter('COHERENCE_A_VERIFIER',etape,id); return erreur('COHERENCE_A_VERIFIER',500); }
        etape = 'compensation';
        await services.supprimerAuth(id);
        const verification = await services.verifierAuth(id);
        const absent = !verification.data && (verification.error?.status === 404 || verification.error?.code === 'user_not_found');
        if (!absent) throw new Error('suppression_non_confirmee');
        noter('PROFIL_REFUSE_COMPENSE',etape,id);
        return erreur('PROFIL_REFUSE_COMPENSE',422);
      } catch { noter('COHERENCE_A_VERIFIER',etape,id); return erreur('COHERENCE_A_VERIFIER',500); }
    } catch {
      const code = etape === 'creation_auth' ? 'CREATION_INCERTAINE' : 'SERVICE_INDISPONIBLE';
      noter(code,etape); return erreur(code,503);
    }
  };
}
