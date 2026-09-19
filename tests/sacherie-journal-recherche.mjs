/* Journal du registre canonique : recherche et pagination SERVEUR.
   Interdit : charger tout le registre dans le navigateur puis filtrer en
   JavaScript. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync('supabase/20260918_sacherie_movement_search.sql', 'utf8');
const js = fs.readFileSync('operations/sacherie-operational-p1.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/* 1. RPC serveur avec tous les criteres demandes. */
assert.match(sql, /create or replace function public\.sacherie_search_movements/i, 'RPC de recherche requise');
for (const p of ['p_query', 'p_from_date', 'p_to_date', 'p_movement_type', 'p_from_location',
                 'p_to_location', 'p_cluster', 'p_rt_id', 'p_state', 'p_limit',
                 'p_cursor_date', 'p_cursor_id'])
  assert.match(sql, new RegExp('\\b' + p + '\\b'), 'parametre ' + p + ' requis');

/* 2. Pagination par curseur stable, pas d OFFSET profond. */
assert.match(sql, /order by m\.movement_at desc, m\.id desc/i, 'tri stable requis');
assert.match(sql, /\(m\.movement_at,\s*m\.id\)\s*<\s*\(p_cursor_date/, 'curseur strict requis');
assert.doesNotMatch(code, /\boffset\b/i, 'aucun OFFSET profond');

/* 3. Limite bornee cote serveur. */
assert.match(sql, /least\(greatest\(coalesce\(p_limit,\s*50\),\s*1\),\s*100\)/, 'p_limit doit etre borne a 100');

/* 4. SECURITY DEFINER avec controle interne du perimetre. */
assert.match(sql, /security definer/i, 'RPC serveur requise');
assert.match(sql, /private\.sacherie_ct_perimetre\(\)/, 'controle de perimetre interne requis');
assert.match(sql, /grant execute on function public\.sacherie_search_movements/i, 'droit explicite requis');
assert.match(sql, /ledger = 'INTERNE'/, 'le journal Sacherie ne doit pas exposer le grand livre fournisseur');

/* 5. Indexes : deux, justifies, pas quinze. */
const idx = (sql.match(/create index if not exists/gi) || []).length;
assert.equal(idx, 2, 'exactement deux indexes, chacun justifie');
assert.match(sql, /idx_rcn_jute_mv_journal/, 'index de pagination requis');
assert.match(sql, /gin_trgm_ops/, 'index de recherche texte requis');

/* 6. Front : plus de filtrage JavaScript sur un lot charge en bloc. */
assert.doesNotMatch(js, /limit\(300\)/, 'le journal ne doit plus charger 300 lignes');
assert.match(js, /sacherie_search_movements/, 'le front doit appeler la RPC');
assert.match(js, /p_cursor_date/, 'pagination par curseur cote front');
assert.match(js, /Journal momentanément indisponible/, 'panne journal : ne jamais faire croire a zero mouvement');
for (const f of ['histDu', 'histAu', 'histType', 'histEtat', 'histDe', 'histVers', 'histCluster', 'histRt'])
  assert.match(js, new RegExp(f), 'filtre ' + f + ' requis');
assert.match(js, /25 \/ page|50 \/ page|100 \/ page/, 'taille de page reglable requise');

/* 7. Cache-busting : sans lui, le navigateur sert l ancien journal. */
assert.match(html, /sacherie-operational-p1\.js\?v=20260918-sacherie-2/, 'cache-busting requis');
assert.match(html, /field-buying\.js\?v=20260919-farmer-edit-1/, 'cache-busting requis');

console.log('Sacherie journal recherche static: PASS');
