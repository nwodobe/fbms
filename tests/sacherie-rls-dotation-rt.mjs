/* Durcissement RLS du registre historique sacs_mouvements.
   Verification statique de la migration versionnee : la protection de
   DOTATION_RT ne doit dependre ni d'une policy permissive isolee, ni du
   frontend. Le comportement runtime est verifie par la batterie SQL
   documentee dans docs/sacherie_rls_hardening_20260918.md. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync('supabase/20260918_sacherie_rls_hardening.sql', 'utf8');
/* Les interdits portent sur le CODE execute, pas sur les commentaires qui
   expliquent pourquoi telle chose est interdite. */
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/* 1. Migration versionnee, jamais une reecriture d'une migration deployee. */
assert.ok(fs.existsSync('supabase/20260918_sacherie_rls_hardening.sql'), 'migration versionnee requise');
assert.match(sql, /^begin;/m, 'la migration doit etre transactionnelle');
assert.match(sql, /^commit;/m, 'la migration doit committer');
assert.match(sql, /ROLLBACK/, 'strategie de rollback documentee');

/* 2. Le coeur du correctif : des policies RESTRICTIVE, combinees en AND,
      donc insensibles a l'ajout futur d'une policy permissive trop large. */
assert.match(sql, /as\s+restrictive\s+for\s+insert/i, 'policy INSERT restrictive requise');
assert.match(sql, /as\s+restrictive\s+for\s+delete/i, 'policy DELETE restrictive requise');
assert.match(sql, /type is distinct from 'DOTATION_RT'/, "l'INSERT direct de DOTATION_RT doit rester refuse");

/* 3. La porte UPDATE : requalification et modification comptable interdites. */
assert.match(sql, /before update on public\.sacs_mouvements/i, 'trigger BEFORE UPDATE requis');
assert.match(sql, /Requalification en DOTATION_RT interdite/, 'requalification par UPDATE interdite');
for (const col of ['type', 'quantite', 'source', 'destination', 'cluster', 'rt_id', 'request_id', 'approved_qty'])
  assert.match(sql, new RegExp("'" + col + "'"), 'colonne ' + col + ' doit etre figee');

/* 4. Suppression definitivement refusee, et de maniere explicite. */
assert.match(sql, /before delete on public\.sacs_mouvements/i, 'trigger BEFORE DELETE requis');
assert.match(sql, /Suppression interdite/, 'refus explicite de suppression requis');

/* 5. Interdits absolus. */
assert.doesNotMatch(code, /disable\s+row\s+level\s+security/i, 'la RLS ne doit jamais etre desactivee');
assert.doesNotMatch(code, /service_role/i, 'aucun octroi a service_role dans la migration');
assert.doesNotMatch(code, /with check\s*\(\s*true\s*\)/i, 'aucune policy generique authenticated = true');
assert.doesNotMatch(code, /grant\s+all\s+on\s+public\.sacs_mouvements/i, 'aucun octroi large sur la table');

/* 6. Le registre canonique reste unique : aucune table de stock parallele. */
assert.doesNotMatch(code, /create\s+table\s+/i, 'aucune table de stock parallele');

console.log('Sacherie RLS DOTATION_RT static: PASS');
