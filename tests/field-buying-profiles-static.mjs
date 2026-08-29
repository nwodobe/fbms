/* Gardes statiques des fiches 360° FIELD BUYING — version réconciliée.
   L'implémentation vit dans operations/field-buying.js (moteur unique) ;
   ce test vérifie que les garanties fonctionnelles et de sécurité de la
   mission « fiches 360° et médias » y sont réellement présentes, et que
   l'ancien moteur parallèle field-buying-profiles.js reste inerte. */
import fs from 'node:fs';
const moteur = fs.readFileSync('operations/field-buying.js', 'utf8');
const stub = fs.readFileSync('operations/field-buying-profiles.js', 'utf8');
const html = fs.readFileSync('operations/field-buying.html', 'utf8');
const sql = fs.readFileSync('supabase/20260829_field_buying_sensitive_media.sql', 'utf8');
function has(x, msg) { if (!x) throw new Error(msg); }

/* Moteur unique : field-buying.html ne charge qu'un moteur de rendu. */
has(html.includes('field-buying.js'), 'le moteur principal doit être chargé');
has(!html.includes('field-buying-profiles.js'), 'aucun second moteur ne doit être chargé (réconciliation)');
has(!stub.includes('ANAGROCI_OPS_ROUTE'), 'le fichier profiles ne doit plus toucher au routeur');

/* Fiches 360° et navigation. */
has(moteur.includes("'#rt/") || moteur.includes('"#rt/'), 'routes fiche RT requises');
has(moteur.includes("'#villages/") || moteur.includes('"#villages/'), 'routes fiche Village requises');
has(moteur.includes("'#farmers/") || moteur.includes('"#farmers/'), 'liens fiche Producteur requis');
has(moteur.includes('renderRtFiche') && moteur.includes('renderVillageFiche'), 'rendus fiche RT et Village requis');
has(moteur.includes('Enrôler comme producteur'), 'action RT → Producteur requise');
has(moteur.includes('Voir sa fiche Producteur'), 'passerelle vers le dossier producteur existant requise');

/* Édition sans re-création : mêmes formulaires, update ciblé. */
has(/update\(row\)\.eq\('id', editRow\.id\)/.test(moteur), "l'édition doit mettre à jour l'enregistrement existant");
has(moteur.includes('p_exclude_id'), "l'anti-doublon doit exclure la fiche en cours d'édition");

/* Pièces d'identité et photo RT : bucket privé + URLs signées. */
has(moteur.includes('piece_recto') && moteur.includes('piece_verso'), 'pièce identité recto/verso requise');
has(moteur.includes('photo_profil'), 'photo de profil RT requise');
has(moteur.includes("BUCKET_PRIVE = 'terrain-preuves'"), 'bucket privé existant requis pour les pièces');
has(moteur.includes('createSignedUrl'), 'les pièces doivent être servies par URL signée');
has(!/toDataURL|readAsDataURL/.test(moteur), 'aucune image stockée ou lue en base64');
has(moteur.includes("from('preuves')"), 'registre documents existant (preuves) requis');
has(moteur.includes("from('audit_log')"), 'journalisation via audit_log requise');

/* Capture mobile et galerie village. */
has(moteur.includes("setAttribute('capture', 'environment')"), 'capture appareil photo mobile requise');
has(moteur.includes('galerie'), 'galerie village requise');
has(moteur.includes("loading=\"lazy\"") || moteur.includes("loading=\\\"lazy\\\""), 'miniatures en chargement différé requises');

/* La migration proposée pour durcir la lecture des CNI reste documentée
   (non appliquée au projet live à ce jour — décision BM requise). */
has(sql.includes('false'), 'la migration proposée doit décrire un bucket privé');
has(sql.includes('as restrictive'), 'la migration proposée doit garder sa barrière restrictive');

console.log('FIELD BUYING profiles/media static checks: OK (moteur unique réconcilié)');
