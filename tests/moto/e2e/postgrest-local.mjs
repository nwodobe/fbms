/**
 * AFLP MOTO MANAGER — émulateur LOCAL minimal de l'API Supabase (PostgREST + Storage)
 * branché sur la réplique PostgreSQL locale. Usage : tests uniquement.
 *
 * Chaque requête s'exécute dans une transaction SOUS LE RÔLE `authenticated`
 * avec les claims JWT de l'utilisateur de test : la RLS et les fonctions
 * moto_* de la vraie migration décident, exactement comme en production.
 * Refuse toute base dont l'hôte contient « supabase ».
 *
 * Couvre ce qu'utilise le module : GET table/vue (select=*, eq, neq, is.null,
 * order, limit, objet unique), POST rpc/<fonction>, dépôt, URL signée et lecture signée Storage.
 */
import pg from 'pg';

export function creerEmulateur({ host, port, database }) {
  if (/supabase/i.test(String(host))) throw new Error('REFUS : base Supabase détectée');
  const pool = new pg.Pool({ host, port, database, user: 'postgres', max: 4 });
  const fichiers = new Map();
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  const cacheSignatures = new Map();

  function jwtSub(auth) {
    try { const p = JSON.parse(Buffer.from(String(auth || '').replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString()); return p.sub || null; }
    catch { return null; }
  }
  async function enTantQue(sub, fn) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (sub) {
        await c.query('set local role authenticated');
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
      } else {
        await c.query('set local role anon');
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
      }
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  function reponse(status, corps, entetes = {}) {
    return { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...entetes }, body: corps === undefined ? '' : JSON.stringify(corps) };
  }
  function erreurPg(e) { return reponse(400, { message: e.message, code: e.code || 'P0001', details: e.detail || null, hint: e.hint || null }); }

  async function signature(nom) {
    if (cacheSignatures.has(nom)) return cacheSignatures.get(nom);
    const r = await pool.query(`select p.proretset, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
                                from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace limit 1`, [nom]);
    const s = r.rows[0] || null; cacheSignatures.set(nom, s); return s;
  }

  async function table(nom, params, sub, unique) {
    if (!IDENT.test(nom)) return reponse(400, { message: 'table invalide' });
    const where = [], valeurs = [];
    let ordre = '', limite = '';
    for (const [k, v] of params) {
      if (k === 'select') continue;
      if (k === 'order') {
        ordre = ' order by ' + v.split(',').map(x => { const [col, dir] = x.split('.'); if (!IDENT.test(col)) throw new Error('order invalide'); return `"${col}" ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
        continue;
      }
      if (k === 'limit') { limite = ' limit ' + Math.min(1000, parseInt(v, 10) || 100); continue; }
      if (k === 'offset') continue;
      if (!IDENT.test(k)) throw new Error('filtre invalide');
      const m = /^(eq|neq|is)\.(.*)$/.exec(v);
      if (!m) throw new Error('opérateur non émulé : ' + v);
      if (m[1] === 'is') { where.push(`"${k}" is ${m[2] === 'null' ? 'null' : 'not null'}`); continue; }
      valeurs.push(m[2]);
      where.push(`"${k}"::text ${m[1] === 'eq' ? '=' : '<>'} $${valeurs.length}`);
    }
    const sql = `select coalesce(json_agg(t), '[]'::json) as j from (select * from public."${nom}"${where.length ? ' where ' + where.join(' and ') : ''}${ordre}${limite}) t`;
    const rows = await enTantQue(sub, c => c.query(sql, valeurs).then(r => r.rows[0].j));
    if (unique) return rows.length === 1 ? reponse(200, rows[0]) : reponse(406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' });
    return reponse(200, rows);
  }

  async function rpc(nom, args, sub) {
    if (!IDENT.test(nom)) return reponse(400, { message: 'fonction invalide' });
    const sig = await signature(nom);
    if (!sig) return reponse(404, { message: `Could not find the function public.${nom}`, code: 'PGRST202' });
    const noms = sig.proargnames || [], types = sig.types || [], valeurs = [], parts = [];
    noms.forEach((n, i) => {
      if (!(n in (args || {}))) return;
      const v = args[n];
      valeurs.push(v === null || v === undefined ? null : (types[i] === 'jsonb' || types[i] === 'json') ? JSON.stringify(v) : String(v));
      parts.push(`${n} => $${valeurs.length}::${types[i]}`);
    });
    const appel = `public."${nom}"(${parts.join(', ')})`;
    const sql = sig.proretset ? `select coalesce(json_agg(t), '[]'::json) as j from ${appel} t` : `select to_json(${appel}) as j`;
    const j = await enTantQue(sub, c => c.query(sql, valeurs).then(r => r.rows[0].j));
    return reponse(200, j);
  }

  /* supabase-js envoie un Blob en multipart/form-data : on conserve le contenu du fichier lui-même. */
  function extraireFichier(corps, contentType) {
    const m = /boundary=([^;]+)/.exec(String(contentType || ''));
    if (!m || !corps) return { corps, contentType };
    const b = Buffer.from('--' + m[1]); const debut = corps.indexOf(Buffer.from('filename='));
    if (debut < 0) return { corps, contentType };
    const ent = corps.indexOf(Buffer.from('\r\n\r\n'), debut); const fin = corps.indexOf(b, ent);
    const entete = corps.slice(corps.lastIndexOf(b, debut), ent).toString();
    const t = /Content-Type:\s*([^\r\n]+)/i.exec(entete);
    return { corps: corps.slice(ent + 4, fin - 2), contentType: t ? t[1].trim() : 'application/octet-stream' };
  }
  async function stockage(methode, chemin, corps, contentType, sub) {
    let m = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(chemin);
    if (m && methode === 'POST') {
      const [, bucket, nom] = m; const nomD = decodeURIComponent(nom);
      const ok = await enTantQue(sub, c => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, nomD]).then(r => r.rowCount > 0));
      return ok ? reponse(200, { signedURL: `/object/sign/${bucket}/${nom}?token=test-local` }) : reponse(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
    if (m && methode === 'GET') {  // lecture d'un fichier par URL signée (photos)
      const [, bucket, nom] = m; const f = fichiers.get(bucket + '/' + decodeURIComponent(nom));
      return f ? { status: 200, headers: { 'content-type': f.contentType || 'application/octet-stream', 'access-control-allow-origin': '*' }, body: Buffer.from(f.corps || []) }
               : reponse(404, { message: 'Object not found' });
    }
    m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(chemin);
    if (m && (methode === 'POST' || methode === 'PUT')) {
      const [, bucket, nom] = m; const nomD = decodeURIComponent(nom);
      try {
        await enTantQue(sub, c => c.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)', [bucket, nomD, JSON.stringify({ mimetype: contentType, size: corps ? corps.length : 0 })]));
        fichiers.set(bucket + '/' + nomD, extraireFichier(corps, contentType));
        return reponse(200, { Key: `${bucket}/${nomD}`, Id: nomD });
      } catch (e) {
        if (e.code === '23505') return reponse(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        return reponse(400, { statusCode: '403', error: 'Unauthorized', message: e.message });
      }
    }
    return reponse(404, { message: 'route storage non émulée' });
  }

  async function traiter({ methode, url, entetes, corps }) {
    const u = new URL(url);
    const sub = jwtSub(entetes.authorization || entetes.Authorization);
    try {
      if (methode === 'OPTIONS') return reponse(204, undefined, { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
      if (u.pathname.startsWith('/rest/v1/rpc/')) return await rpc(u.pathname.slice('/rest/v1/rpc/'.length), corps && corps.length ? JSON.parse(corps.toString()) : {}, sub);
      if (u.pathname.startsWith('/rest/v1/') && methode === 'GET') {
        const unique = /vnd\.pgrst\.object/.test(entetes.accept || entetes.Accept || '');
        return await table(u.pathname.slice('/rest/v1/'.length), u.searchParams, sub, unique);
      }
      if (u.pathname.startsWith('/rest/v1/') && methode === 'POST') {
        const nom = u.pathname.slice('/rest/v1/'.length);
        if (!IDENT.test(nom)) return reponse(400, { message: 'table invalide' });
        const lignes = [].concat(JSON.parse(corps.toString() || '[]'));
        await enTantQue(sub, async c => { for (const l of lignes) {
          const existantes = (await c.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [nom])).rows.map(x => x.column_name);
          const cols = Object.keys(l).filter(k => IDENT.test(k) && existantes.includes(k)).map(k => `"${k}"`).join(', ');
          await c.query(`insert into public."${nom}" (${cols}) select ${cols} from json_populate_record(null::public."${nom}", $1)`, [JSON.stringify(l)]);
        } });
        return reponse(201, []);
      }
      if (u.pathname.startsWith('/storage/v1/')) return await stockage(methode, u.pathname, corps, entetes['content-type'], sub);
      if (u.pathname === '/auth/v1/user') return reponse(200, { id: sub, aud: 'authenticated', role: 'authenticated' });
      if (u.pathname.startsWith('/auth/v1/logout')) return reponse(204);
      return reponse(404, { message: 'route non émulée : ' + methode + ' ' + u.pathname });
    } catch (e) { return erreurPg(e); }
  }

  return { traiter, pool, fichiers, fermer: () => pool.end() };
}

/* Session Supabase factice (jeton non signé, lu uniquement par l'émulateur). */
export function session(sub, email) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 36000;
  const token = b({ alg: 'none', typ: 'JWT' }) + '.' + b({ sub, role: 'authenticated', aud: 'authenticated', exp, email }) + '.test';
  return { access_token: token, token_type: 'bearer', expires_in: 36000, expires_at: exp, refresh_token: 'test-local',
           user: { id: sub, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} } };
}
