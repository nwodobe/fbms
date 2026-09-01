# Audit droits RT / Producteurs — 01/09/2026

## Problème confirmé

- `Agent Recenseur` était déjà reconnu par `peut_editer_terrain()` et le moteur FIELD BUYING, mais l'ancienne policy `ALL` pouvait aussi contribuer à un droit DELETE selon `created_by`.
- `Zonal Head` n'était pas reconnu par `peut_editer_terrain()` dans FIELD BUYING.
- Le catalogue ACL central donnait `rt:update` au Zonal Head, mais pas `producteurs:update`; le rôle Agent Recenseur avait l'inverse : `producteurs:update` mais pas `rt:update`.
- La suppression logique `deleted=true` était déjà bloquée pour tout non-BM par `trg_suppr_rt` / `trg_suppr_prod` → `fbms_controler_suppression()`.

## Correctif

- helper serveur dédié `peut_modifier_rt_producteur()` incluant Zonal Head et Agent Recenseur;
- policies UPDATE limitées au périmètre via `private.farmer_registry_can_access_village()`;
- policies RESTRICTIVE DELETE réservées au Branch Manager, même en présence d'anciennes policies permissives `ALL`;
- module FIELD BUYING ciblé pour le Zonal Head : bouton Modifier uniquement sur fiches RT/Producteur, sans bouton Supprimer;
- l'Agent Recenseur continue d'utiliser les formulaires natifs déjà disponibles.

## Test transactionnel réel, rollback intégral

Profil de test temporairement positionné en `Zonal Head`, zone `GBEKE_2` :

- RT de DIABO modifié : **1**;
- RT de DJEBONOUA (hors zone) modifié : **0**;
- Producteur de GBEKE 2 modifié : **1**;
- RT supprimé physiquement : **0**.

Toutes les écritures de test ont été annulées par `ROLLBACK`.

## Point restant de gouvernance

Le profil actif `Agent Recenseur` observé au moment de l'audit n'a ni zone, ni cluster, ni village, ni RT renseigné. Le mécanisme historique de compatibilité lui conserve donc un accès large. Aucun périmètre n'a été inventé dans ce correctif. Il faut renseigner son périmètre réel dans Administration pour réduire l'accès aux seules fiches dont il a la charge.
