/**
 * Émulateur Supabase du banc d'essai (GoTrue + PostgREST + Storage).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉMULATEUR EST — ET CE QU'IL N'EST PAS
 *
 * Il n'est PAS un substitut de mesure du serveur de production. Les temps de
 * réponse qu'il produit sont ceux d'un processus Node local : les citer comme
 * « performance de Supabase » serait faux. Le rapport 04-LOAD-REPORT.md le
 * dit explicitement à chaque tableau.
 *
 * Il EST le seul moyen de faire tourner les VRAIS parcours applicatifs :
 * l'accès sortant de cet environnement d'exécution n'autorise ni
 * `nwodobe.github.io` ni `*.supabase.co` (constat reproductible :
 * `curl` → CONNECT 403, cf. 01-MAPPING.md §0). Sans backend, aucune page
 * FBMS ne dépasse l'écran de connexion, et rien de métier n'est testable.
 *
 * Ce qu'il permet donc de mesurer POUR DE VRAI :
 *   · le nombre, la nature et la taille des requêtes que CHAQUE page émet
 *     (demande client) — indépendant du serveur ;
 *   · le comportement du client en concurrence (double-clic, retry, conflit,
 *     coupure réseau, rechargement en cours d'écriture) ;
 *   · la performance de rendu du frontend ;
 *   · la conformité des écritures aux contraintes déclarées dans
 *     `supabase/*.sql` (unicité, upsert idempotent, RLS par rôle).
 *
 * Il reproduit fidèlement, parce que les tests en dépendent :
 *   · l'unicité `achats.local_id` et la sémantique `on_conflict` /
 *     `resolution=merge-duplicates|ignore-duplicates` de PostgREST ;
 *   · `updated_at` mis à jour à chaque écriture (contrôle de conflit FBMS) ;
 *   · les politiques RLS de `supabase/rls.sql` et `supabase/achats.sql`
 *     (est_actif / peut_editer_terrain / est_bm) ;
 *   · le code 23505 sur violation d'unicité, 401 sans jeton, 403 hors rôle.
 *
 * Il NE reproduit PAS : le coût réel d'un plan d'exécution PostgreSQL, la
 * latence réseau vers Abidjan, les quotas et le pooler de Supabase, le
 * Realtime. Un paramètre `latenceMs` permet d'injecter une latence fixe pour
 * observer le client sous réseau lent ; c'est un paramètre de scénario, pas
 * une mesure.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'

const JSON_TYPE = 'application/json; charset=utf-8'

/* Rôles réels du projet, repris de shared/auth-gate.js + supabase/rls.sql. */
const ROLES_BM = ['Branch Manager', 'Assistant Branch Manager', 'Head of Field', 'Procurement Officer']
const PEUT_EDITER_TERRAIN = [...ROLES_BM, 'Supervisor', 'Agent Recenseur']
const PEUT_EDITER_CONFIG = [...ROLES_BM, 'Supervisor']

/* Tables et leurs contraintes, reprises de supabase/*.sql. */
const CONTRAINTES = {
  achats: { pk: 'id', uniques: ['local_id'], famille: 'achats' },
  villages: { pk: 'id', uniques: [], famille: 'terrain', horodate: true },
  rt: { pk: 'id', uniques: [], famille: 'terrain', horodate: true },
  producteurs: { pk: 'id', uniques: ['code'], famille: 'terrain', horodate: true },
  hubs_clusters: { pk: 'id', uniques: [], famille: 'terrain', horodate: true },
  profils: { pk: 'user_id', uniques: ['user_id'], famille: 'profils' },
  parametres_calcul: { pk: 'cle', uniques: ['cle'], famille: 'config' },
  parametres_collecte_courte: { pk: 'id_palier', uniques: ['id_palier'], famille: 'config' },
  grilles_tarifaires: { pk: 'id_grille', uniques: [], famille: 'config' },
  lignes_tarifaires: { pk: 'id_ligne', uniques: [], famille: 'config' },
  avances: { pk: 'id', uniques: ['local_id'], famille: 'achats' },
  reconciliations: { pk: 'id', uniques: ['local_id'], famille: 'achats' },
  sacs_mouvements: { pk: 'id', uniques: ['local_id'], famille: 'terrain' },
  audit_log: { pk: 'id', uniques: [], famille: 'audit' },
}

function droitEcriture(famille, role) {
  if (famille === 'terrain' || famille === 'achats' || famille === 'sacs') return PEUT_EDITER_TERRAIN.includes(role)
  if (famille === 'config') return PEUT_EDITER_CONFIG.includes(role)
  if (famille === 'profils') return ROLES_BM.includes(role) && role === 'Branch Manager'
  if (famille === 'audit') return true
  return PEUT_EDITER_TERRAIN.includes(role)
}
function droitSuppression(famille, role) {
  if (famille === 'audit') return false
  return role === 'Branch Manager'
}

/** Découpe `col=op.valeur` en filtre PostgREST. */
function litFiltres(params) {
  const filtres = []
  for (const [cle, valeur] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey'].includes(cle)) continue
    const m = /^(eq|neq|gt|gte|lt|lte|is|in|like|ilike|not)\.(.*)$/s.exec(valeur)
    if (!m) continue
    filtres.push({ col: cle, op: m[1], val: m[2] })
  }
  return filtres
}

function coerce(v) {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null') return null
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return v
}

function passe(ligne, f) {
  const brut = ligne[f.col]
  switch (f.op) {
    case 'eq': return String(brut) === String(coerce(f.val)) || brut === coerce(f.val)
    case 'neq': return !(String(brut) === String(coerce(f.val)))
    case 'gt': return brut > coerce(f.val)
    case 'gte': return brut >= coerce(f.val)
    case 'lt': return brut < coerce(f.val)
    case 'lte': return brut <= coerce(f.val)
    case 'is': return f.val === 'null' ? brut == null : brut === coerce(f.val)
    case 'in': {
      const liste = f.val.replace(/^\(|\)$/g, '').split(',').map((s) => coerce(s.replace(/^"|"$/g, '')))
      return liste.some((x) => String(x) === String(brut))
    }
    case 'like': case 'ilike': {
      const rx = new RegExp('^' + f.val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', f.op === 'ilike' ? 'i' : '')
      return rx.test(String(brut ?? ''))
    }
    default: return true
  }
}

export function demarrerFauxSupabase({ port = 0, latenceMs = 0, plafondConcurrence = 0 } = {}) {
  /** Données. Uniquement des jeux de test explicitement préfixés TEST_LOAD_. */
  const tables = new Map()
  const utilisateurs = new Map()      // email -> {id, email, motDePasse, role, nom, actif}
  const jetons = new Map()            // access_token -> userId
  const objets = new Map()            // storage
  const journal = []                  // instrumentation
  const compteurs = { requetes: 0, erreurs: 0, conflitsUnicite: 0, ecrituresPerdues: 0 }
  let enCours = 0
  let maxEnCours = 0

  function table(nom) {
    if (!tables.has(nom)) tables.set(nom, [])
    return tables.get(nom)
  }

  function creerUtilisateur({ email, motDePasse, role, nom, actif = true }) {
    const id = createHash('sha1').update(email).digest('hex').slice(0, 8).replace(/(.{8})/, '$1-0000-4000-8000-000000000000')
    const u = { id, email, motDePasse, role, nom, actif }
    utilisateurs.set(email, u)
    const p = table('profils')
    const i = p.findIndex((x) => x.user_id === id)
    const ligne = { user_id: id, nom, email, role, actif, created_at: new Date().toISOString() }
    if (i >= 0) p[i] = ligne; else p.push(ligne)
    return u
  }

  function profilDe(userId) { return table('profils').find((p) => p.user_id === userId) || null }

  function contexte(req) {
    const auth = req.headers['authorization'] || ''
    const apikey = req.headers['apikey'] || ''
    const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!apikey) return { anon: true, raison: 'apikey manquante' }
    if (!jeton || jeton === apikey) return { anon: true }        // clé publiable seule = visiteur anonyme
    const uid = jetons.get(jeton)
    if (!uid) return { anon: true, expire: true }
    const prof = profilDe(uid)
    if (!prof || !prof.actif) return { anon: true, inactif: true }
    return { anon: false, userId: uid, role: prof.role, profil: prof }
  }

  function repondre(res, statut, corps, entetes = {}) {
    const texte = corps === undefined ? '' : JSON.stringify(corps)
    res.writeHead(statut, { 'Content-Type': JSON_TYPE, 'Access-Control-Allow-Origin': '*', ...entetes })
    res.end(texte)
    return texte.length
  }

  const serveur = createServer(async (req, res) => {
    const debut = process.hrtime.bigint()
    compteurs.requetes++
    enCours++
    if (enCours > maxEnCours) maxEnCours = enCours
    const url = new URL(req.url, 'http://x')
    let corpsBrut = ''
    for await (const c of req) corpsBrut += c
    const vu = req.headers['x-vu'] || ''

    const finir = (statut, octets, etiquette) => {
      enCours--
      journal.push({
        t: Date.now(),
        methode: req.method,
        chemin: url.pathname,
        table: etiquette || '',
        statut,
        octets,
        ms: Number(process.hrtime.bigint() - debut) / 1e6,
        vu,
      })
      if (statut >= 400) compteurs.erreurs++
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      })
      res.end()
      return finir(204, 0, '')
    }

    if (latenceMs > 0) await new Promise((r) => setTimeout(r, latenceMs))
    if (plafondConcurrence > 0 && enCours > plafondConcurrence) {
      // Émule un pooler saturé : refus explicite plutôt que file infinie.
      const n = repondre(res, 503, { message: 'trop de connexions simultanées (émulation pooler)' })
      return finir(503, n, 'pooler')
    }

    /* ---------------------------- GoTrue ---------------------------- */
    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      const body = corpsBrut ? JSON.parse(corpsBrut) : {}
      if (grant === 'password') {
        const u = utilisateurs.get(String(body.email || '').toLowerCase())
        if (!u || u.motDePasse !== body.password) {
          const n = repondre(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
          return finir(400, n, 'auth')
        }
        const at = randomUUID()
        jetons.set(at, u.id)
        const n = repondre(res, 200, {
          access_token: at, token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'r-' + at,
          user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
        })
        return finir(200, n, 'auth')
      }
      if (grant === 'refresh_token') {
        const ancien = String(body.refresh_token || '').replace(/^r-/, '')
        const uid = jetons.get(ancien)
        if (!uid) { const n = repondre(res, 400, { error: 'invalid_grant' }); return finir(400, n, 'auth') }
        const at = randomUUID()
        jetons.set(at, uid)
        const u = [...utilisateurs.values()].find((x) => x.id === uid)
        const n = repondre(res, 200, {
          access_token: at, token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'r-' + at,
          user: { id: uid, email: u?.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
        })
        return finir(200, n, 'auth')
      }
      const n = repondre(res, 400, { error: 'unsupported_grant_type' })
      return finir(400, n, 'auth')
    }
    if (url.pathname === '/auth/v1/user') {
      const ctx = contexte(req)
      if (ctx.anon) { const n = repondre(res, 401, { message: 'invalid claim' }); return finir(401, n, 'auth') }
      const u = [...utilisateurs.values()].find((x) => x.id === ctx.userId)
      const n = repondre(res, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} })
      return finir(200, n, 'auth')
    }
    if (url.pathname === '/auth/v1/logout') {
      const auth = req.headers['authorization'] || ''
      jetons.delete(auth.slice(7))
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end()
      return finir(204, 0, 'auth')
    }

    /* ---------------------------- Storage --------------------------- */
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const chemin = url.pathname.replace('/storage/v1/object/', '')
      if (req.method === 'POST' || req.method === 'PUT') {
        objets.set(chemin, corpsBrut.length)
        const n = repondre(res, 200, { Key: chemin })
        return finir(200, n, 'storage')
      }
      const n = repondre(res, 200, {})
      return finir(200, n, 'storage')
    }

    /* --------------------------- PostgREST -------------------------- */
    if (url.pathname.startsWith('/rest/v1/')) {
      const nom = url.pathname.slice('/rest/v1/'.length)
      const meta = CONTRAINTES[nom] || { pk: 'id', uniques: [], famille: 'terrain' }
      const ctx = contexte(req)
      const prefer = String(req.headers['prefer'] || '')
      const accept = String(req.headers['accept'] || '')
      const objetUnique = accept.includes('vnd.pgrst.object')
      const rendre = prefer.includes('return=representation')

      /* RLS : aucune donnée sans profil actif — c'est le comportement réel de
         supabase/rls.sql, et c'est ce que teste 07-SECURITY-ACCESS.md. */
      if (ctx.anon) {
        if (req.method === 'GET') {
          // PostgREST renvoie 200 + liste vide quand la politique ne laisse
          // passer aucune ligne : pas une erreur, un ensemble vide.
          const n = repondre(res, 200, objetUnique ? null : [])
          return finir(200, n, nom)
        }
        const n = repondre(res, 401, { code: '42501', message: 'new row violates row-level security policy' })
        return finir(401, n, nom)
      }

      const lignes = table(nom)
      const filtres = litFiltres(url.searchParams)

      if (req.method === 'GET') {
        let out = lignes.filter((l) => filtres.every((f) => passe(l, f)))
        if (nom === 'profils' && ctx.role !== 'Branch Manager') out = out.filter((l) => l.user_id === ctx.userId)
        const ordre = url.searchParams.get('order')
        if (ordre) {
          const [col, sens] = ordre.split('.')
          out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (sens === 'desc' ? -1 : 1))
        }
        const limite = url.searchParams.get('limit')
        if (limite) out = out.slice(0, Number(limite))
        if (objetUnique) {
          if (out.length === 1) { const n = repondre(res, 200, out[0]); return finir(200, n, nom) }
          if (out.length === 0) { const n = repondre(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }); return finir(406, n, nom) }
          const n = repondre(res, 406, { code: 'PGRST116', message: 'multiple rows returned' }); return finir(406, n, nom)
        }
        const n = repondre(res, 200, out)
        return finir(200, n, nom)
      }

      if (req.method === 'POST') {
        if (!droitEcriture(meta.famille, ctx.role)) {
          const n = repondre(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "' + nom + '"' })
          return finir(403, n, nom)
        }
        const entrees = corpsBrut ? JSON.parse(corpsBrut) : []
        const lot = Array.isArray(entrees) ? entrees : [entrees]
        const conflitCol = url.searchParams.get('on_conflict')
        const fusion = prefer.includes('resolution=merge-duplicates')
        const ignore = prefer.includes('resolution=ignore-duplicates')
        const resultat = []
        for (const brut of lot) {
          const ligne = { ...brut }
          const cles = conflitCol ? conflitCol.split(',') : [meta.pk]
          const existante = lignes.find((l) => cles.every((c) => l[c] !== undefined && ligne[c] !== undefined && String(l[c]) === String(ligne[c])))
          if (existante) {
            if (ignore) { resultat.push(existante); continue }
            if (fusion || conflitCol) {
              Object.assign(existante, ligne)
              if (meta.horodate) existante.updated_at = new Date().toISOString()
              resultat.push(existante); continue
            }
            compteurs.conflitsUnicite++
            const n = repondre(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint', details: 'Key (' + cles.join(',') + ') already exists.' })
            return finir(409, n, nom)
          }
          // Unicité déclarée hors clé de conflit (ex. achats.local_id).
          for (const u of meta.uniques) {
            if (ligne[u] === undefined || ligne[u] === null) continue
            if (lignes.some((l) => String(l[u]) === String(ligne[u]))) {
              compteurs.conflitsUnicite++
              const n = repondre(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "' + nom + '_' + u + '_key"' })
              return finir(409, n, nom)
            }
          }
          if (ligne[meta.pk] === undefined) ligne[meta.pk] = randomUUID()
          ligne.created_at = ligne.created_at || new Date().toISOString()
          if (meta.horodate) ligne.updated_at = new Date().toISOString()
          if (nom === 'villages' || nom === 'rt' || nom === 'producteurs') ligne.updated_by = ctx.profil.email
          lignes.push(ligne)
          resultat.push(ligne)
        }
        const n = repondre(res, rendre ? 200 : 201, rendre ? (objetUnique ? resultat[0] : resultat) : undefined)
        return finir(rendre ? 200 : 201, n, nom)
      }

      if (req.method === 'PATCH') {
        if (!droitEcriture(meta.famille, ctx.role)) {
          const n = repondre(res, 403, { code: '42501', message: 'row-level security policy' })
          return finir(403, n, nom)
        }
        const patch = corpsBrut ? JSON.parse(corpsBrut) : {}
        const cibles = lignes.filter((l) => filtres.every((f) => passe(l, f)))
        for (const l of cibles) {
          Object.assign(l, patch)
          if (meta.horodate) l.updated_at = new Date().toISOString()
          if (nom === 'villages' || nom === 'rt' || nom === 'producteurs') l.updated_by = ctx.profil.email
        }
        const n = repondre(res, 200, rendre ? (objetUnique ? cibles[0] ?? null : cibles) : undefined)
        return finir(200, n, nom)
      }

      if (req.method === 'DELETE') {
        if (!droitSuppression(meta.famille, ctx.role)) {
          const n = repondre(res, 403, { code: '42501', message: 'row-level security policy for table "' + nom + '"' })
          return finir(403, n, nom)
        }
        const restants = lignes.filter((l) => !filtres.every((f) => passe(l, f)))
        const supprimes = lignes.length - restants.length
        tables.set(nom, restants)
        const n = repondre(res, 200, rendre ? [] : undefined)
        return finir(200, n, nom + ':-' + supprimes)
      }
    }

    const n = repondre(res, 404, { message: 'route inconnue: ' + url.pathname })
    return finir(404, n, '')
  })

  return new Promise((resolve) => {
    serveur.listen(port, '127.0.0.1', () => {
      resolve({
        port: serveur.address().port,
        base: `http://127.0.0.1:${serveur.address().port}`,
        tables, journal, compteurs, utilisateurs,
        creerUtilisateur,
        maxConcurrence: () => maxEnCours,
        raz: () => { journal.length = 0; compteurs.requetes = 0; compteurs.erreurs = 0; maxEnCours = 0 },
        fermer: () => new Promise((r) => serveur.close(r)),
      })
    })
  })
}
