# Rôle Assistant Unit Head (AFLP 2027) — rapport d'audit et de préparation

Date : 03/11/2026 · Branche : `feat/aflp-assistant-unit-head-acces` · Projet Supabase : `jmbdgpdthzpszfnddwzi`
Statut : **appliqué en production le 03/11/2026** sur autorisation du Branch Manager (contrôles post-déploiement : contrainte, 12 politiques, 7 déclencheurs ; non-régression Unit Head et Branch Manager vérifiée ; assistant fictif testé dans une transaction annulée).

## 1. Diagnostic de l'existant (production relevée en lecture seule le 03/11/2026)

| # | Constat du mandat | État vérifié | Effet réel |
|---|---|---|---|
| 1 | Rôle absent de `profils_role_check` | **Confirmé** | Création de compte impossible (23514), constatée sur le banc (phase AVANT A-01) |
| 2 | Aucun compte AUH | **Confirmé** (0) | — |
| 3 | `admin-create-user` déployée | **Confirmé** (v1, `verify_jwt=true`) | Rôle et cluster obligatoire lus dans `fbms_roles_attribuables()` : aucune modification de la fonction Edge n'est nécessaire |
| 4 | Lectures `villages`, `rt`, `producteurs` trop permissives | **Confirmé pour `villages` et `rt`** (`est_actif()` / `fbms_role() is not null`, aucune politique restrictive). `producteurs` est déjà cloisonné (`farmer_registry_scope_guard`, RESTRICTIVE ALL). **Aussi ouverts à tout compte actif : `achats`, `avances`, `aflp_incidents`, `sacs_mouvements`, `reconciliations`, `depenses_mission`** | Un assistant aurait vu tous les clusters |
| 5 | `peut_editer_terrain()` n'inclut pas l'AUH | **Confirmé, mais sans effet bloquant** : la couche permissive est déjà satisfaite par `villages_write` / `rt_write` / `prod_write` (politiques « liste noire » `<> 'Consultation uniquement'`), et `peut_modifier_rt_producteur()` inclut déjà l'AUH. Ajouter l'AUH à `peut_editer_terrain()` ouvrirait aussi `hubs_clusters` (paramétrage) : **non modifié** | — |
| 6 | AFLP FLEET ne reconnaît pas le rôle | **Confirmé** (`moto_classe_de` → null) | Aucun accès moto. Conservé tel quel (aucune permission non mandatée) |
| + | `offline_sync_batch`, `aflp_declare_incident` sont SECURITY DEFINER | Contournent RLS ; l'achat hors ligne accepte le `statut_validation` envoyé par le terminal | Les gardes AUH sont donc des **déclencheurs** |
| + | Statut village « Approuvé BM » : aucun contrôle serveur hors Agent Recenseur | Tout rôle d'écriture peut l'apposer (Unit Head compris) | Contrôlé pour l'AUH ; inchangé pour les autres (risque résiduel R1) |
| + | `avances` INSERT ouvert à tout compte actif, statut par défaut « Active » | Une insertion = un engagement financier | Interdit à l'AUH ; inchangé pour les autres (R2) |

## 2. Trois approches comparées

| Critère | 1. Rôle autonome (retenue) | 2. Extension du Unit Head | 3. Permissions granulaires |
|---|---|---|---|
| Maintenance | Simple : une valeur, des gardes ciblées | Simple au départ, puis soustractive | Lourde (table + ~40 politiques réécrites) |
| Privilèges excessifs | Faible : tout ce qui n'est pas listé est refusé, sauf les politiques « liste noire » existantes, neutralisées par des RESTRICTIVES | **Élevé** : hérite d'avances, validations, Sacherie en écriture, classe FLEET `UNITE` | Faible |
| Compatibilité FBMS | Déjà anticipé (`aflp-access.js`, Farmer Registry, Sacherie front) | `fonction_operationnelle` ne confère plus de droit (`ops_has_role`) | Rupture avec l'existant |
| Sécurité serveur | Déclencheurs + RESTRICTIVES : tous chemins | Exceptions à poser partout | Bonne si complète |
| Effets sur l'existant | **Nuls** (prouvé : banc UH rejoué, 0 écart) | Effets de bord sur les 5 UH en poste | Risque élevé à 2 mois de campagne |
| Déploiement | Une migration réversible | Idem | Long, risqué |

Décision : **approche 1**. L'approche 3 n'apporte aucun bénéfice démontré pour un seul rôle.

## 3. Matrice définitive (serveur = source de vérité)

| Domaine | Autorisé (son cluster uniquement) | Refusé |
|---|---|---|
| Villages | lire, créer, modifier ; **validation terrain** Brouillon / À corriger → Soumis | autres clusters (lecture comprise), À corriger / Validé* / Approuvé BM / Rejeté, modifier le statut d'une fiche validée, supprimer |
| Producteurs, parcelles | lire, créer, corriger, GPS ; **Identifié ↔ Enrôlé** ; parcelles et superficies | Actif / Inactif, autres clusters, supprimer, forcer un doublon fort |
| RT | lire, créer, modifier ; **Pressenti → Confirmé** si un autre que lui l'a enregistré (quatre yeux) | Actif / Écarté, confirmer son propre RT, créer un RT déjà confirmé, autres clusters, supprimer |
| Achats RCN | saisir (direct ou hors ligne) ; statut forcé « À valider », validateur vidé | valider, modifier, autres clusters, village d'un autre cluster |
| Avances, dépenses, paiements | lire celles de son cluster | engager, modifier, supprimer une avance ; saisir/approuver une dépense |
| Anomalies | déclarer (rattachée d'office à son cluster), lire | autres clusters |
| Sacs, stock, réconciliations | lire ; demander des sacs ; historique sacs et réconciliation de son cluster | mouvement physique d'emplacement Sacherie |
| Comptes | — | créer, modifier, lire les autres profils ; changer son rôle ou son cluster |
| AFLP FLEET | — | aucune classe (aucune affectation ni transfert) |
| Missions (`missions`) | — | table de planification à budget (`budget_alloue_xof`) : non ouverte (R5) |

États et transitions : **aucun nouvel état créé**. Validation hiérarchique = états existants réservés au Unit Head et au-dessus ; validation financière = rôles habilités existants.

## 4. Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/20261103120000_aflp_assistant_unit_head_acces.sql` | Migration (transaction unique, idempotente) |
| `supabase/20261103120100_aflp_assistant_unit_head_acces_rollback.sql` | Retour arrière |
| `shared/admin.html` | Zone + cluster cohérents, statut, lien d'activation, détail des droits, changement d'affectation confirmé |
| `shared/aflp-access.js` (1.1.0) | Matrice alignée sur le serveur, `statutsAutorises()` |
| `fbms/index.html` | Statuts RT proposés limités pour l'AUH |
| `tests/sql/assistant-unit-head/` | Banc isolé fidèle à la production + 117 scénarios |
| `tests/admin-assistant-unit-head-browser.py`, `tests/aflp-access-assistant-unit-head.cjs` | Recette interface et matrice |

## 5. Preuves

- **Fidélité du banc** : 40 fonctions de production recopiées, empreintes md5 identiques à la production (`empreintes_production_20261103.txt`, contrôle bloquant du script).
- **Banc SQL** : `bash tests/sql/assistant-unit-head/lancer-banc.sh` → APRES 117/117, REJEU 116/116, ROLLBACK 8/8, `BANC OK` (`resultats-derniere-execution.txt`). PostgreSQL 16 local ; la production est en 17.6 (syntaxe standard, risque R7).
- **Non-régression Unit Head** : le banc UH du 16/10 (59 scénarios) est rejoué avant, après et après retour arrière : **0 scénario ne change de résultat**. Le seul échec, constant, est R01 (un UH crée un RT hors cluster), lacune préexistante.
- **Concurrence** : BM approuve pendant que l'AUH renvoie en Brouillon → l'AUH attend le verrou puis est refusé, statut final « Approuvé BM » (S9-03).
- **Interface** : Chromium hors réseau, 390/768/1440 px : 9/9 (AUH) et 36/36 (recette de création existante, adaptée au nouveau mode par défaut). Portes du dépôt : `verifier-js`, `verifier-html`, `verifier-liens` sans nouvel écart.

## 6. Mise en production (non exécutée, autorisation explicite requise)

1. Relire et fusionner la PR (label `human-review`, chemins en liste d'exclusion).
2. Appliquer `20261103120000_…sql` (contrôles post-déploiement en fin de fichier).
3. `sw.js` : incrémenter `CACHE_VERSION` pour diffuser `aflp-access.js` 1.1.0 aux terminaux (le serveur protège dès l'étape 2, ce point ne concerne que l'affichage).
4. Vérifier que l'envoi d'emails Auth (SMTP) est configuré, sinon utiliser le mode « mot de passe provisoire ».
5. Créer les comptes réels (ex. ESSOU Kamon Alphonse, N'Djébonoua ; MESSOU Koffi César Jules, Botro, « à confirmer » ; VALEA Issiaka, Diabo) après confirmation individuelle des emails.

## 7. Retour arrière

Appliquer `20261103120100_…_rollback.sql` : supprime gardes et politiques, **désactive** les comptes AUH (aucune suppression), rétablit la contrainte d'origine en `NOT VALID` et les deux fonctions de production à l'identique (empreintes vérifiées). Testé (phase ROLLBACK), puis réapplication testée (phase REJEU).

## 8. Risques résiduels

| # | Risque | Recommandation |
|---|---|---|
| R1 | Le **Unit Head** peut apposer « Approuvé BM » et confirmer ses propres RT (inchangé, hors mandat) | Décider s'il doit hériter des mêmes gardes |
| R2 | Tout compte actif (UH, ZH…) peut insérer une **avance active** | Restreindre `avances_ins` aux rôles financiers |
| R3 | Le **Unit Head** lit villages, RT et achats de tous les clusters ; peut créer un RT hors cluster | Étendre les politiques RESTRICTIVES au UH (prêtes, rôle à ajouter) |
| R4 | 5 fonctions SECURITY DEFINER de tableau de bord (`campaign_dashboard`, `campaign_farmer_history`, `aflp_coop_dashboard`…) peuvent agréger tous les clusters | Audit dédié |
| R5 | Consentements et pièces d'identité producteur (`peut_editer_terrain`) refusés à l'AUH **comme au UH** ; `missions` réservée au paramétrage | Arbitrage métier |
| R6 | Refus hors ligne : le serveur renvoie un message explicite, mais la conservation de l'opération rejetée dépend du terminal (non testable sur ce banc) | Recette sur APK |
| R7 | Banc en PostgreSQL 16, production 17.6 | Rejouer le banc sur une branche Supabase avant application |
| R8 | Le refus de création de RT hors cluster remonte « village introuvable » (le village est invisible) | Message à adapter côté interface |
| R9 | Les politiques « liste noire » `*_write` restent la couche permissive des écritures terrain | Les remplacer à terme par des listes blanches |
