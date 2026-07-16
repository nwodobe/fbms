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
| `../supabase/rcntrace.sql` | Schéma Supabase (modèle §10) + RLS + amorce des référentiels |

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
