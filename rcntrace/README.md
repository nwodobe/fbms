# RCN TRACE — Modules 1 & 2

Application de traçabilité et de bilan matière pour ANAGROCI (PJS Global).
Couvre la chaîne **REC → QLT → RCN → BIN → TRF → CAL** :

- **Module 1** — Réception temporaire, sampling (calcul KOR), décision GM,
  déchargement/pesée, analyse finale, création du lot officiel, stock et BIN
  collectives, transfert.
- **Module 2** — Calibrage : réception du transfert, opération CAL, arrêts,
  sorties par calibre, rejets/pertes/résidus, bilan matière et clôture.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Shell SPA (sidebar + topbar), design system partagé ANAGROCI |
| `rcntrace.js` | Moteur métier + magasin local (localStorage). KOR, états, allocation BIN proportionnelle, bilan matière, généalogie, audit |
| `rcntrace-ui.js` | Router par ancre + rendu des 16 écrans + liaisons UI → moteur |
| `rcntrace-sync.js` | Synchronisation Supabase offline-first (write-through + file d'attente + hydratation) |
| `../supabase/rcntrace.sql` | Schéma Supabase (modèle §10) + `rcn_state`/`rcn_audit` + RLS + amorce des référentiels |
| `../supabase/rcntrace_etl.sql` | ETL & BI : vues de dépliage `rcn_state` → modèle normalisé, fonction `rcn_etl_refresh()`, vues d'indicateurs `rcn_bi_*` (§14) |

## Reporting BI

L'application écrit en temps réel dans `rcn_state` (agrégats JSONB, offline-first).
Pour l'analytique :

- Les vues `rcn_v_*` déplient `rcn_state` vers le modèle normalisé (toujours à jour).
- `select rcn_etl_refresh();` matérialise ces vues dans les tables physiques `rcn_*`
  (à planifier, ou à appeler à la demande par un profil actif).
- Les vues `rcn_bi_*` répondent directement aux indicateurs du cahier (§14.2) :
  cohérence KOR, délais du parcours, âge/occupation des BIN, écarts de transfert,
  rendement par calibre, pertes & résidus, bilan matière par opération. Elles
  s'ouvrent dans n'importe quel outil BI (Supabase, Metabase, export Excel/PDF).

## v2 — enrichissements terrain (rapports Bouaké / Yakro 2026)

Aligné sur les vrais classeurs d'exploitation :

- **Référentiels réels** : coopératives + codes LBA, origines (Dianra, Mankono…),
  entrepôts, format BIN `<entrepôt>-BIN-nn` (ex. `BKE-002-BIN-017`).
- **Déchargement enrichi** : reçu magasin (W/H), n° fiche CCA, BIN de
  déchargement, catégories de sacs (bon / humide / déchiré / reconditionné).
- **BIN = contenant vivant** : composition par contributeur avec fournisseur,
  KOR et sacs.
- **Module Séchage / triage** : avant/après (humidité, NC, KOR, sacs), BIN
  « after drying », perte = envoyé − récupéré (généalogie préservée).
- **Transfert** : transporteur / voyage / chauffeur, qualité au départ et à
  l'arrivée, perte de transit %.

> À valider avec le magasin avant implémentation : la définition exacte des
> poids (réfaction, GRN, payé) et la règle physique de sortie d'une BIN
> mélangée. Non codés tant que non confirmés.

## Prototype V1

Conforme au cahier des charges : saisie manuelle, fonctionnement hors connexion
(brouillons conservés dans le navigateur), référentiels configurables. Les
données de démonstration reproduisent les exemples chiffrés du cahier
(KOR 48.41, BIN-017 60/25/15, bilan 1000 = 965 + 25 + 10).

Aucune tolérance industrielle n'est inventée : tout écart reste visible jusqu'à
justification. Aucune correction n'efface le passé (journal d'audit versionné).

## Règles métier clés implémentées

- `KOR = (GK + Spotted/2 + Immature/2) × 0,17637` — valeur exacte conservée,
  affichage à 2 décimales.
- Écart KOR conforme **seulement** si strictement inférieur à 1 ; sinon
  `BLOQUÉ_QUALITÉ`.
- Une valeur vide ≠ zéro.
- Le poids net physique commande le stock ; le poids main-d'œuvre est séparé.
- Le lot officiel (RCN) porte l'identité ; la BIN porte la position.
- Après mélange : traçabilité par contributeurs + bilan matière (répartition
  proportionnelle R-03).
- Triple validation du transfert (Entrepôt → QA/Lab → Calibrage).
- CAL hérite des contributeurs de TRF ; aucune origine ressaisie.

## Accès

Le module est protégé par le portail d'authentification partagé
(`shared/auth-gate.js`, `data-module="rcntrace"`). Réinitialiser la
démonstration : bouton ⟳ en haut à droite.

## Points à valider avant production (§16.1)

Formats officiels des identifiants, liste exacte des neuf calibres et des motifs
d'arrêt, matrice de compatibilité des lots en BIN, règle de sortie de BIN
(proportion/FIFO/LIFO), tolérances de bilan matière.
