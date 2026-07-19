# Etape 2C-A - Correction design du module Audit distances

Date: 2026-07-19
Module: `fbms/audit_distances.html`

## Objectif

Corriger le module le plus faible visuellement identifie en Etape 2B: Audit distances.

Le but est de rendre l'interface plus professionnelle, lisible et decisionnelle, sans changer le moteur metier existant.

## Changements realises

- Refonte visuelle complete de la page Audit distances.
- Ajout d'un header premium ANAGROCI/PJS.
- Ajout d'un bandeau hero expliquant l'objectif metier du controle.
- Ajout de KPI cards plus lisibles: villages, OK, a controler, anomalies.
- Separation claire entre panneau de parametres et tableau d'ecarts.
- Amelioration du tableau: statut visuel, sticky header, sticky action, meilleure lecture mobile.
- Conservation des liens Portail, Carte, Hubs et du slot utilisateur.
- Conservation du theme commun `../shared/pjs-theme.css`.

## Points volontairement non modifies

- Aucune table Supabase modifiee.
- Aucune migration.
- Aucun changement de logique de calcul GPS.
- Aucune modification des fonctions metier principales: `load`, `pickHub`, `dataRows`, `render`, `saveHub`, `valide`.
- Le comportement de validation de distance reste identique: la distance validee est ecrite dans `data.s1.distanceHubRoutiere` du village.

## Controle avant fusion

- 1 fichier applicatif modifie: `fbms/audit_distances.html`.
- 1 rapport ajoute: `docs/step2c_audit_distances_design_20260719.md`.
- Aucune donnee touchee.
- Aucune logique metier destructrice.

## Limite restante

Le module est visuellement ameliore, mais il reste encore une limite fonctionnelle: la validation utilise toujours un `prompt()` navigateur. Cette logique sera a remplacer plus tard par un vrai panneau de justification avec motif, ancienne distance, nouvelle distance, validateur et impact ALIS.

## Prochaine action recommandee

Continuer l'Etape 2C avec le module ALIS, puis auditer l'ensemble Audit distances + ALIS avant de passer aux autres modules.
