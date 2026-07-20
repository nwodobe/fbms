# Étape 3B — Cash / Avances RT

Date : 20/07/2026
Projet : ANAGROCI Operations Suite / Farmer Buying
Priorité : Programme Farmer Buying

## 1. Décision

RCN Trace reste volontairement repoussé en dernière position.

L'Étape 3B se concentre sur le module Cash / Avances RT, avec un objectif métier simple :

> empêcher qu'un RT achète au-delà de son avance disponible et renforcer la réconciliation avance → paiement → achat.

## 2. Fichiers modifiés

### Fichier applicatif partagé

- `shared/anagroci-audit.js`

### Rapport ajouté

- `docs/step3b_cash_avances_controls_20260720.md`

Aucun fichier `terrain/cash.html` n'a été modifié directement.

## 3. Contrôles ajoutés sur les avances RT

Les gardes métier Cash bloquent maintenant :

1. Date future sur une avance.
2. RT manquant.
3. RT hors référentiel / hors cluster lorsque la liste des RT est chargée.
4. Montant d'avance invalide.
5. Nouvelle avance si le RT a un solde ouvert non réconcilié.

Le principe appliqué est :

> pas de réconciliation, pas de nouvelle avance.

## 4. Contrôles ajoutés sur la réconciliation

La réconciliation bloque maintenant :

1. RT manquant.
2. Cash restant et valeur stock tous deux vides.
3. Cash restant négatif.
4. Valeur stock négative.
5. Réconciliation sans aucune activité cash/achat détectée pour le RT.

Les écarts métier restent visibles dans le module, mais les saisies absurdes ou vides sont bloquées.

## 5. Contrôle achat vs avance disponible

La sécurité Achats Terrain a été renforcée avec une lecture du solde cash RT.

Avant d'enregistrer un achat, le garde Farmer Buying calcule :

```text
avance totale RT - achats déjà payés = solde disponible
```

Sources utilisées localement :

- `anagroci_ref_cash.avServer`
- `anagroci_avances`
- `anagroci_ref_cash.paye`
- `anagroci_achats` non synchronisés

Si l'achat dépasse le solde disponible, il est bloqué avec le message :

```text
Avance RT insuffisante. Solde disponible : X FCFA. Réconciliez ou ajoutez une avance avant achat.
```

Ce contrôle est volontairement non bloquant si aucune donnée cash n'est encore chargée sur l'appareil, afin d'éviter de bloquer abusivement un agent hors ligne sans cache initial.

## 6. Protection de la file locale Cash

Les files locales suivantes sont désormais normalisées avant/après synchronisation :

- `anagroci_avances`
- `anagroci_recons`

Métadonnées locales ajoutées :

- `device_id`
- `sync_attempts`
- `last_attempt_at`
- `last_error`
- `recovered_at`

Ces champs sont retirés temporairement avant l'appel à la synchronisation existante, afin de ne pas envoyer de colonnes inconnues à Supabase.

## 7. Audit ajouté

Actions bloquées tracées :

- `cash_advance_blocked_by_guard`
- `cash_reconciliation_blocked_by_guard`
- `achat_blocked_by_farmer_buying_guard` avec raison `advance_exceeded`

Installation tracée :

- `cash_control_guards_installed`

## 8. Ce qui n'a pas été fait

Aucune migration Supabase.
Aucune suppression de table.
Aucune modification de données.
Aucun changement direct dans `terrain/cash.html`.
Aucun changement dans RCN Trace.
Aucun changement dans Sacs / Command Center.

## 9. Limites volontaires

Cette étape sécurise le frontend et le cache local.

Les améliorations suivantes restent à traiter plus tard :

1. Table distante dédiée aux métadonnées de synchronisation.
2. Workflow d'approbation BM pour déblocage exceptionnel d'avance.
3. Conservation distante des justificatifs de paiement.
4. Rapport BM consolidé par RT : avance, achats, sacs, stock, solde, écart.

## 10. Conclusion

L'Étape 3B renforce le cœur financier du Farmer Buying : un RT ne peut plus recevoir une nouvelle avance si son solde précédent est ouvert, et un achat terrain est bloqué lorsqu'il dépasse le solde d'avance disponible connu localement.
