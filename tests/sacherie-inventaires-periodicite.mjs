/* Inventaires periodiques : le systeme doit repondre « quels emplacements
   doivent etre inventories aujourd'hui ? » a partir de la DATE du dernier
   comptage, et non de l'existence d'un comptage. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync('supabase/20260918_sacherie_inventory_periodicity.sql', 'utf8');
const js = fs.readFileSync('operations/field-buying.js', 'utf8');
const css = fs.readFileSync('operations/operations-v2.css', 'utf8');

/* 1. Parametre central, configurable, dans la table de settings EXISTANTE. */
assert.match(sql, /alter table public\.rcn_jute_settings/i, 'la table de settings existante doit etre reutilisee');
assert.match(sql, /inventory_frequency_days/, 'parametre de frequence requis');
assert.match(sql, /default 7/, 'valeur initiale de 7 jours');
assert.match(sql, /between 1 and 90/, 'la frequence doit rester bornee');

/* 2. Les seuils derivent de la frequence : ils ne sont pas codes ailleurs. */
assert.match(sql, /b\.freq \* 2/, 'le seuil EN_RETARD doit deriver de la frequence');
for (const st of ['JAMAIS_INVENTORIE', 'A_JOUR', 'A_FAIRE', 'EN_RETARD'])
  assert.match(sql, new RegExp("'" + st + "'"), 'statut ' + st + ' requis');

/* 3. Modele prepare pour une frequence par type d'emplacement, mais VIDE :
      aucune valeur metier differenciee n'est inventee. */
assert.match(sql, /rcn_jute_inventory_frequencies/, 'table d override par scope requise');
assert.doesNotMatch(sql, /insert into public\.rcn_jute_inventory_frequencies/i,
  'aucune frequence metier differenciee ne doit etre inventee au deploiement');

/* 4. Calcul SERVEUR, perimetre SERVEUR, droit explicite. */
assert.match(sql, /security definer/i, 'calcul serveur requis');
assert.match(sql, /private\.sacherie_ct_perimetre\(\)/, 'perimetre serveur requis');
assert.match(sql, /grant execute on function public\.sacherie_ct_inventaires_dus/i,
  'droit d execution explicite requis (lecon du defaut sacherie_ct_location)');

/* 5. Reutilisation de la vue existante : aucun second moteur d inventaire. */
assert.match(sql, /sacherie_ct_latest_inventory/, 'la vue existante doit etre reutilisee');
assert.doesNotMatch(sql, /create\s+table\s+public\.rcn_jute_inventories/i, 'aucun registre d inventaire parallele');

/* 6. Front : l approximation historique doit avoir disparu. */
assert.doesNotMatch(js, /filter\(function \(l\) \{ return l\.actif; \}\)\.length - \(b\.inventaires \|\| \[\]\)\.length/,
  'le KPI ne doit plus etre locations - lignes d inventaire');
assert.match(js, /sacherie_ct_inventaires_dus/, 'le front doit consommer la RPC serveur');
assert.match(js, /bagInventaireTable/, 'tableau de periodicite requis');
for (const col of ['Dernier inventaire', 'Jours écoulés', 'Fréquence', 'Prochaine échéance', 'Écart dernier inventaire'])
  assert.ok(js.includes(col), 'colonne « ' + col + ' » requise dans le tableau');
assert.match(js, /mesureInv \? String\(duus\.length\) : '—'/,
  'une source en panne doit afficher — et non 0');

/* 7. La regle HOLD reste intacte : jamais d alignement silencieux. */
assert.match(js, /Aucun ajustement silencieux/, 'la regle HOLD doit rester affichee');
assert.doesNotMatch(sql, /update public\.rcn_jute_movements/i, 'un inventaire ne doit jamais aligner le stock');

/* 8. Style livre avec la fonctionnalite. */
assert.match(css, /\.ops-hist-pied/, 'styles du journal requis');

console.log('Sacherie inventaires periodicite static: PASS');
