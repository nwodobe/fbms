# 10 — Corrections apportées

Ce rapport documente les **cinq corrections prioritaires** de `08-RECOMMENDATIONS.md`.
Les rapports 01 à 09 ne sont pas réécrits : ils restent l'état de référence du 22 août 2026,
mesuré **avant** ces corrections. C'est cet écart qui donne leur valeur aux chiffres ci-dessous.

**Rejouer la preuve** : `node tests/e2e/02-integrite-donnees.mjs` et
`node tests/e2e/04-securite-acces.mjs`.

---

## Résultat mesuré

| Suite | Avant | Après |
|---|---|---|
| Intégrité des données (17 scénarios) | 10 conformes | **15 conformes** |
| Contrôle d'accès (14 contrôles) | 9 conformes | **11 conformes** |

Sept scénarios ont basculé au vert : **T-INT-04, T-INT-05, T-INT-08, T-INT-14, T-INT-15,
S-12, S-13**. Aucun scénario auparavant conforme n'a régressé.

Portes du dépôt, après correction :

```
verifier-html.mjs   20 page(s) · 3 écart(s) historique(s) · 0 nouveau(x)
verifier-liens.mjs  20 page(s) · 4 lien(s) cassé(s) hérité(s) · 0 nouveau(x)
verifier-js.mjs     75 fichier(s) · 1 erreur(s) héritée(s) · 0 nouvelle(s)
```

Aucun défaut nouveau, et **aucune ligne ajoutée à un référentiel** : les écarts qui subsistent
sont ceux qui existaient déjà avant cette campagne.

---

## C1 · BUG-002 — Un achat ne peut plus être annoncé enregistré sans l'être

**Fichier** : `terrain/achats.html`

Trois changements, du symptôme vers la cause.

**L'échec d'écriture remonte.** `store()` renvoyait `undefined` et avalait
`QuotaExceededError` dans un `catch` vide. Il renvoie désormais un booléen, et `save()` le teste
**avant** d'annoncer quoi que ce soit et **avant** de vider le formulaire — la saisie de l'agent
reste à l'écran pour être réessayée :

> « Enregistrement IMPOSSIBLE : la mémoire de cet appareil est saturée. L'achat n'a PAS été
> enregistré et votre saisie est conservée à l'écran. Synchronisez les achats en attente pour
> libérer de la place, puis réessayez. »

**La cause du remplissage disparaît.** Les photos de reçu — 100 à 250 ko chacune en base64 —
vivaient dans la file `localStorage`, dont le quota est de 5 à 10 Mo. Elles sont déplacées dans
**IndexedDB** (`anagroci_photos_recus`), qui n'a pas ce plafond. La file ne transporte plus que
du texte, et quelques dizaines d'achats photographiés hors ligne ne la saturent plus.

**Une file illisible ne disparaît plus en silence** (BUG-003, corrigé au passage parce que
c'est le même mécanisme). `load()` mettait la valeur de côté et renvoyait une liste vide sans
rien dire. Elle est maintenant placée en quarantaine sous une clé horodatée et un bandeau rouge
s'affiche en tête de liste : « Données locales illisibles : N octets ont été mis de côté […]
Prévenez le Branch Manager AVANT de saisir ».

**Vérification** — T-INT-04 : quota saturé à 32 octets près, message d'échec de classe `err`,
0 en file, 0 sur le serveur, **et l'utilisateur le sait**. T-INT-05 : bandeau affiché, 646 octets
mis en quarantaine.

---

## C2 · BUG-009 et BUG-008 — Une seule synchronisation des achats

**Fichiers** : `terrain/achats_dropdown_patch.js`, `terrain/achats.html`

Trois implémentations de `syncAll` se superposaient au chargement. Celle de
`achats_dropdown_patch.js` — dont le rôle est la liste déroulante des RT et des producteurs —
**est supprimée** : elle poussait les brouillons et retirait le KOR de l'envoi.

Restait la question de fond : quelle que soit la couche qui pousse la ligne, elle ne doit
pouvoir envoyer ni un brouillon ni une photo en base64. Plutôt qu'un filtre que chaque couche
devrait se rappeler d'appliquer, la correction est **structurelle** :

- **Les brouillons vivent dans leur propre clé** (`anagroci_achats_brouillons`). Ils ne sont
  plus dans `anagroci_achats` : aucune couche de synchronisation ne les voit. Ils rejoignent la
  file au moment où ils sont validés, avec leur numéro de reçu. Les appareils déjà en service
  sont repris automatiquement au premier chargement (`migrerBrouillons()`).
- **Les photos ne sont plus dans l'enregistrement.** Elles partent vers Supabase Storage par
  `flushPhotos()`, indépendamment de l'envoi de la ligne, et seule l'URL est enregistrée. La
  colonne `recu_photo` de la table `achats` ne reçoit plus de base64.

**Un piège évité, qui méritait d'être vu.** La première version marquait les enregistrements
photographiés d'un champ `_photo_locale`. Or la couche d'audit
(`shared/anagroci-audit.js:payload()`) ne filtre qu'une liste fixe de champs techniques :
`_photo_locale` serait parti dans le corps de la requête et PostgREST aurait refusé la ligne
entière — `PGRST204, column does not exist`. Le champ a été retiré ; `flushPhotos()` parcourt
directement les clés d'IndexedDB. **Aucun champ nouveau n'est ajouté à l'enregistrement.**

**Vérification** — T-INT-15 : brouillon absent du serveur. T-INT-14 : URL Storage présente,
0 octet de base64 dans la table. T-INT-13 : le KOR arrive toujours en base (non-régression).

---

## C3 · BUG-001 — Les cinq pages ouvertes sont fermées

**Fichiers** : `fbms/index.html`, `logistique/index.html`, `logistique/ancien.html`,
`logistique.html`, `suite/index.html`

Chacune charge désormais `shared/auth-gate.js` avec le module qui lui correspond :
`fbms` pour le référentiel, `logistique` pour les trois pages logistiques, `portail` pour
l'ancien lanceur. `shared/auth-gate.js` lui-même n'est pas touché.

```
$ for f in $(git ls-files '*.html'); do grep -q auth-gate "$f" || echo "$f"; done
(aucune sortie)
```

**Vérification** — S-12 : toutes les pages servies passent par le portail. S-13 : sans session,
`fbms/index.html` affiche l'écran de connexion ; un compte désactivé ne l'ouvre plus. S-07 :
les 24 combinaisons page × persona restent conformes à la table `ACCESS` — le verrou ajouté ne
ferme la porte à personne qui l'avait légitimement.

---

## C4 · BUG-010 — Rôles portail / RLS : migration livrée, **non appliquée**

**Fichiers** : `docs/migrations/rls_roles_aflp_20260822.sql` (+ `_verify` et `_rollback`)

La correction porte sur `supabase/rls.sql`, que `CLAUDE.md` §3 interdit à toute modification par
un agent — et pour une bonne raison : `SECURITE.md` avertit qu'une couche modifiée sans l'autre
casse la sécurité **ou** casse l'accès des utilisateurs légitimes.

La migration est donc **écrite, commentée, vérifiable et livrée dans `docs/migrations/`**, à
exécuter par une personne, sur un projet de test d'abord. Elle aligne
`peut_editer_terrain()` et `peut_editer_config()` sur la correspondance rôle → niveau de
`shared/aflp-access.js`, et ajoute à `est_bm()` le seul libellé strictement équivalent au
Branch Manager.

**Ce qu'elle ne fait délibérément pas** : élargir `est_bm()` aux trois autres rôles de niveau
`bm` (Assistant Branch Manager, Head of Field, Procurement Officer), à qui le portail ouvre déjà
l'écran d'administration. Qui peut créer un compte et supprimer un achat est une décision
métier ; `SECURITE.md` tranche aujourd'hui au plus étroit, et ce n'est pas à un correctif
technique de l'élargir. **Question ouverte pour le Branch Manager.**

**Vérification** — S-14 reste en défaut, et c'est l'état exact des choses : il passera au vert
le jour où la migration sera exécutée. Le contrôle renvoie désormais vers le fichier.

---

## C5 · BUG-006 — Le contrôle de conflit devient atomique

**Fichier** : `fbms/index.html`, `RemoteVillages.upsert`

Le contrôle lisait `updated_at`, comparait en JavaScript, puis écrivait. Entre les deux, rien
n'empêchait une autre écriture de passer : **211 modifications sur 500 disparaissaient** sans
avertir personne.

La condition part maintenant **avec** l'écriture :

```js
await SB.from("villages").update(maj)
  .eq("id", copy.id)
  .eq("updated_at", baseUpdatedAt)      // « seulement si la version n'a pas bougé »
  .select("data, updated_at");
```

PostgreSQL réévalue la condition après avoir pris le verrou de ligne : la seconde écriture
concurrente n'affecte aucune ligne. Zéro ligne touchée signifie alors soit un conflit — la
fiche est relue et remonte à l'écran d'arbitrage, qui existait déjà — soit une fiche encore
absente du serveur, auquel cas l'insertion normale reprend la main.

**Aucun changement de schéma n'est nécessaire** : PostgREST accepte un filtre sur un `UPDATE`.
C'est ce qui permet de corriger ce défaut sans toucher à `supabase/**`.

**Vérification** — T-INT-08, réécrit pour exercer le vrai chemin de code dans deux navigateurs
authentifiés (et non plus par des appels HTTP fabriqués, qui rejouaient l'ancienne séquence) :
A accepté, B **signalé en conflit**, valeur finale celle de A. Une écriture acceptée, un conflit
annoncé, aucune perte silencieuse.

---

## Ce qui n'est pas dans cette correction

| Anomalie | Pourquoi |
|---|---|
| BUG-005 — producteur enrôlé enregistré comme provisoire | Hors des cinq priorités demandées. C'est pourtant la correction au plus fort impact métier et l'une des plus courtes : aligner la valeur de la liste déroulante sur la clé de recherche. T-INT-17 reste en défaut. |
| BUG-007 — même numéro de reçu accepté deux fois | Hors périmètre, et la correction demande un arbitrage métier avant l'index unique : le même numéro peut-il légitimement apparaître deux fois ? T-INT-02 reste en défaut. |
| BUG-011 — `shared/alis-hardening.js` inexécutable | Fichier en zone interdite (`auto-merge-denylist.txt`). |
| BUG-012 — aucune page mise en cache | `sw.js` et `i18n-sw.js` sont en zone interdite : un service worker fautif survit au correctif dans le cache des utilisateurs. |
| BUG-013 et suivants | Hors des cinq priorités. |

---

## Ce qui reste à vérifier avant toute mise en service

Ces corrections ont été éprouvées contre l'émulateur du banc, sur les octets réels des pages.
Trois vérifications ne peuvent se faire qu'ailleurs :

1. **`flushPhotos()` contre le vrai Supabase Storage.** Le bucket `recus` doit exister et la
   politique d'écriture doit autoriser les rôles concernés. L'émulateur accepte tout envoi ;
   la production, non. Si le bucket manque, `uploadRecu()` renvoie `null`, la photo reste dans
   IndexedDB et sera réessayée — le comportement dégrade proprement, mais la preuve n'arrive pas.
2. **L'écriture conditionnelle contre le vrai PostgREST.** La sémantique utilisée est standard,
   mais l'égalité sur un `timestamptz` passé en chaîne mérite d'être vue une fois en conditions
   réelles.
3. **La reprise des appareils déjà en service.** `migrerBrouillons()` déplace les brouillons
   existants au premier chargement ; les achats déjà en file qui portent encore une photo en
   base64 la conserveront jusqu'à leur synchronisation, puis elle sera retirée du corps envoyé.
   À observer sur un téléphone réel avant déploiement général.
