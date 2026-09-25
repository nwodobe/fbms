# Procédure de synchronisation hors ligne — Niveau 1

Date : 14 août 2026 · Migration 08

## 1. La règle qui prime sur toutes les autres

| Ce qui peut naître hors ligne | Ce qui ne le peut **jamais** |
|---|---|
| Saisie d'un achat | Autorisation d'une nouvelle avance |
| Mouvement de sacs | Ouverture d'un cycle de financement |
| Mouvement de stock | Déblocage d'un cycle |
| Déclaration de réconciliation | Approbation d'une exception ou d'un ajustement |

Une exposition financière ne se décide pas sur la foi d'un cache local. Si le
serveur ne peut pas confirmer l'exposition au moment de la décision, l'opération
est **mise en attente ou refusée** — jamais accordée « en attendant ».

Cette règle n'est pas déclarative : `n1_sync_ressource_autorisee()` n'accepte que
`achats`, `sacs_mouvements`, `n1_stock_mouvements` et `reconciliations`. Une
avance poussée depuis la file locale est **rejetée avec un motif explicite**
(vérifié, T08).

## 2. Cycle de vie d'une opération hors ligne

```
1. Saisie          → le terminal produit une clé d'idempotence AVANT tout envoi
2. File locale     → statut « en attente », visible par l'utilisateur
3. Envoi           → n1_sync_pousser(clé, terminal, ressource, charge)
4. Accusé serveur  → ACCEPTE | DOUBLON | REJETE
5. Purge locale    → UNIQUEMENT si purge_locale_autorisee = true
```

**Le terminal ne supprime jamais une ligne locale avant l'accusé serveur.** Sans
réponse, la ligne reste en attente et sera rejouée. C'est le correctif de P1-4.

## 3. Les dix situations éprouvées

| # | Situation | Comportement | Preuve |
|---|---|---|---|
| 1 | Perte de réseau pendant la saisie | La ligne reste en file locale | conception |
| 2 | Double clic | Deuxième envoi → `DOUBLON`, **même identifiant serveur** | T08 |
| 3 | Nouvelle tentative après temporisation | idem, sans seconde écriture | T08 |
| 4 | Même événement poussé par deux appareils | `DOUBLON` + conflit `DOUBLE_TERMINAL` ouvert | T08 |
| 5 | Ordre d'arrivée différent | Chaque clé est traitée indépendamment | conception |
| 6 | Divergence locale / serveur | Conflit `VALEUR_DIVERGENTE`, arbitrage requis | conception |
| 7 | Appareil perdu | `n1_sync_etat()` restitue l'état complet du compte | T08 |
| 8 | Reconnexion après plusieurs jours | Rejeu ; les tardifs lèvent `SYNCHRONISATION_TARDIVE` | T07, T08 |
| 9 | Stockage local saturé ou corrompu | La file serveur fait foi ; rien n'est perdu côté serveur | T08 |
| 10 | Refus serveur d'une opération créée hors ligne | Rejet **conservé** et consultable | T08 |

> Les cas 1, 5, 6 et 9 sont couverts par la conception serveur mais dépendent
> aussi du comportement du terminal, non modifié dans cette intervention. Ils
> devront être rejoués en recette terrain avec un vrai téléphone (document 12).

## 4. Appels

### Pousser une opération

```sql
select public.n1_sync_pousser(
  'IDEM-<uuid produit par le terminal>',
  'TEL-<identifiant de l''appareil>',
  'achats',
  '{"local_id":"...","date":"2026-08-14","rt_id":"...","producteur_id":"...",
    "poids_net":100,"prix_kg":500,"montant":50000,"numero_recu":"R-0042"}'::jsonb,
  '2026-08-14T09:12:00Z');
```

Réponse :

```json
{ "resultat": "ACCEPTE", "accuse": true,
  "enregistrement": "…uuid serveur…", "purge_locale_autorisee": true }
```

| `resultat` | Sens | Purge locale |
|---|---|---|
| `ACCEPTE` | Écrit pour la première fois | ✅ |
| `DOUBLON` | Déjà reçu ; le même identifiant serveur est renvoyé | ✅ |
| `REJETE` | Refusé, motif dans `message` | ✅ après affichage à l'utilisateur |
| `EN_ATTENTE` | Reçu, traitement non terminé | ❌ |

### Conserver un refus

Un refus métier annule sa transaction — l'accusé de rejet disparaîtrait avec
elle. Le client doit donc, **après avoir reçu l'erreur**, appeler dans une
nouvelle transaction :

```sql
select public.n1_sync_enregistrer_rejet(
  'IDEM-…', 'TEL-…', 'achats', '<charge>'::jsonb, '<message d''erreur reçu>');
```

Sans cet appel, l'agent ne saurait jamais **pourquoi** son achat n'est pas passé.

### Consulter l'état

```sql
select public.n1_sync_etat('TEL-A');   -- un appareil
select public.n1_sync_etat();          -- tous les appareils du compte
```

Retourne : acceptées, rejetées, en attente, conflits ouverts, dernière réception,
et la liste des rejets avec leur motif.

## 5. Récupération après panne ou changement de téléphone

**La vérité est côté serveur, pas dans le téléphone.**

1. Se connecter avec le même compte sur le nouvel appareil.
2. `select public.n1_sync_etat();` — sans argument, tous appareils confondus.
3. Toute opération `ACCEPTE` est en base : rien à ressaisir.
4. Toute opération `REJETE` doit être corrigée puis ressaisie.
5. Ce qui n'apparaît nulle part n'a jamais atteint le serveur : à ressaisir
   depuis les formulaires papier, s'ils existent.

C'est la raison d'être du protocole papier (document 09) : sans lui, une
opération saisie sur un téléphone perdu et jamais synchronisée est
irrécupérable — aucune trace, nulle part.

## 6. Conflits

| Type | Quand |
|---|---|
| `DOUBLE_TERMINAL` | Même clé d'idempotence poussée par deux appareils |
| `VALEUR_DIVERGENTE` | Charge locale différente de la valeur serveur |
| `ORDRE_INVERSE` | Événements reçus dans un ordre incohérent |
| `ENREGISTREMENT_VERROUILLE` | Le serveur a clôturé pendant que le terminal était hors ligne |

Arbitrage par un rôle de contrôle, décision motivée obligatoire :

```sql
select public.n1_sync_arbitrer_conflit('<uuid>', 'Le terminal B est un rejeu du terminal A');
```

Les conflits ne sont **pas visibles par un agent de terrain** (RLS vérifiée en
T08) : un arbitrage en cours n'est pas une information de terrain.

## 7. Alerte de retard

`n1_detecter_anomalies()` lève `SYNCHRONISATION_TARDIVE` (P1) dès que le délai
entre la saisie sur le terminal et la réception serveur dépasse
`seuil_synchronisation_heures` (48 h par défaut).

Un délai long n'est pas seulement un problème technique : c'est une exposition
financière non mesurée pendant tout ce temps.

## 8. Ce qui reste à faire côté terminal

Le code du terminal **n'a pas été modifié** (angle mort A-08). Il doit être
adapté pour :

1. produire une `cle_idempotence` **avant** le premier envoi, et la conserver ;
2. produire et conserver un `terminal_id` stable ;
3. appeler `n1_sync_pousser` au lieu d'un `insert` direct ;
4. ne purger la file locale que sur `purge_locale_autorisee = true` ;
5. appeler `n1_sync_enregistrer_rejet` après chaque erreur métier ;
6. afficher le nombre d'opérations non synchronisées, en permanence ;
7. alerter l'utilisateur au-delà du seuil de retard.
