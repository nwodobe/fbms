# 08 — Corrections recommandées

Les corrections sont classées par **rapport entre le risque évité et l'effort**, pas par
sévérité seule. Une correction d'une ligne qui referme un BLOCKER passe avant une refonte qui
règle trois défauts moyens.

Aucune de ces corrections n'a été appliquée : cette campagne établit un état de référence, comme
demandé. Chacune renvoie à l'anomalie du rapport 05 et au test qui la prouve — et qui servira à
vérifier qu'elle est réellement corrigée.

---

## Avant tout : la condition de faisabilité

**Le projet n'a aucun environnement de test.** Un seul projet Supabase, une seule branche
publiée, pas de préproduction. Tant que c'est le cas :

- aucune correction touchant `supabase/**` ne peut être essayée avant d'être subie ;
- aucun test d'écriture sous charge ne peut être exécuté honnêtement ;
- la campagne de charge en production restera limitée à la lecture seule.

**Recommandation n° 0, préalable à toutes les autres** : créer un second projet Supabase de
test, y rejouer les scripts de `supabase/`, y charger un volume comparable à la production, et
y diriger les scripts de `tests/load/`. Sans cela, les corrections ci-dessous seront livrées
sans filet. Marche à suivre : `tests/load/LISEZ-MOI.md` §3.

---

## Les cinq corrections prioritaires

### 1. Ne plus jamais annoncer « validé » pour un achat non enregistré — BUG-002

**Risque évité** : perte d'achats sans trace, sur des téléphones dont le stockage est plein
après une journée de collecte hors ligne. C'est le seul défaut BLOCKER du registre et le seul
qui, à lui seul, justifie un NO-GO.

**Correction, en deux temps.**

*Immédiat, effort très faible* — `terrain/achats.html:293` : faire remonter l'échec au lieu de
l'avaler, et refuser l'annonce de succès si l'écriture n'a pas eu lieu. La fonction `store()`
doit renvoyer un booléen, et `save()` doit le tester avant d'afficher son message.

*De fond, effort moyen* — sortir les photos de reçu de `localStorage`. Deux voies :
envoyer la photo vers Supabase Storage **avant** de mettre l'achat en file (au prix d'un achat
non enregistrable hors ligne, ce qui n'est pas acceptable ici), ou stocker les photos dans
IndexedDB — sans quota comparable, et déjà utilisé par `fbms/index.html`. La seconde voie est la
bonne.

**Vérification** : `T-INT-04` doit passer au vert.

---

### 2. Une seule implémentation de la synchronisation des achats — BUG-009, BUG-008

**Risque évité** : brouillons non validés comptés comme des achats, photos de reçus stockées en
base64 dans la table transactionnelle (≈ 450 Mo/jour à 100 agents), et une incertitude
permanente sur ce qui est réellement envoyé.

**Correction, effort moyen.** Trois couches se réécrivent aujourd'hui `window.syncAll` :
`terrain/achats.html:619`, `terrain/achats_dropdown_patch.js:71`, `shared/anagroci-audit.js:156`.
Décider laquelle fait autorité — celle de la page est la plus complète, c'est elle qui envoie la
photo vers Storage et qui filtre correctement les brouillons — et faire des deux autres de
simples **observateurs** : elles peuvent journaliser et valider, elles ne doivent plus émettre
de requêtes.

C'est la correction au meilleur rendement du registre : elle referme deux anomalies HIGH, divise
par cent le volume écrit dans `achats`, et rend le comportement enfin descriptible.

**Vérification** : `T-INT-14` et `T-INT-15` au vert, `kor` toujours présent en base.

---

### 3. Fermer les cinq pages ouvertes — BUG-001

**Risque évité** : le référentiel FBMS — CRUD complet sur villages, RT et producteurs — s'ouvre
sans authentification, y compris pour un compte que le Branch Manager vient de désactiver.

**Correction, effort faible.**

- Ajouter `<script defer src="../shared/auth-gate.js" data-module="fbms"></script>` à
  `fbms/index.html`, et faire pointer la tuile REF du portail sur `fbms/app.html` (la passerelle
  protégée existe déjà, elle n'est simplement pas utilisée).
- Décider du sort de `logistique.html`, `logistique/ancien.html`, `logistique/index.html` et
  `suite/index.html` : les protéger, ou les retirer. Deux d'entre elles sont des doublons
  strictement identiques, aucune n'est référencée par le portail.

**Attention** : `shared/auth-gate.js` fait partie des zones interdites aux agents
(`CLAUDE.md` §3). Ce n'est pas ce fichier qu'on modifie ici — on l'**ajoute** à des pages qui ne
le chargent pas. La modification reste à faire par une personne, avec vérification que
`fbms/index.html` fonctionne toujours hors ligne une fois le portail posé (son mécanisme
d'authentification propre coexistera avec le portail : ce point demande un essai réel).

**Vérification** : `S-12` et `S-13` au vert, matrice d'accès du rapport 02 §2 sans ligne en gras.

---

### 4. Réconcilier les rôles du portail et ceux de la base — BUG-010

**Risque évité** : un Branch Manager créé avec le libellé « Branch Manager / Head of Programme »
obtient l'écran d'administration et ne peut créer aucun compte ; un « Zonal Head » obtient les
écrans de saisie et ne peut rien enregistrer. Le défaut ne se voit qu'à l'usage, sur un compte
neuf, souvent au pire moment.

**Correction, effort faible en volume, élevé en précaution.** Les trois fonctions d'aide de
`supabase/rls.sql` — `est_bm()`, `peut_editer_terrain()`, `peut_editer_config()` — ne connaissent
que les six libellés historiques, alors que l'écran d'administration en propose quinze.
`supabase/20260818_farmer_registry_phase1_security.sql` connaît déjà les nouveaux : il suffit
d'aligner `rls.sql` sur la même liste.

**`supabase/**` est une zone interdite aux agents.** Cette correction se fait par une personne,
sur le projet de test d'abord, avec la vérification explicite qu'aucun compte existant ne perd
son accès — c'est exactement le scénario contre lequel `SECURITE.md` met en garde.

**Vérification** : `S-14` au vert, puis une connexion réelle avec un compte de chaque rôle.

---

### 5. Rendre le contrôle de conflit réellement atomique — BUG-006

**Risque évité** : le travail d'un utilisateur écrasé par un autre, sans que ni l'un ni l'autre
ne le sache. Le risque croît avec le nombre d'utilisateurs : c'est **le** défaut qui se réveille
en passant de 10 à 100.

**Correction, effort moyen.** Le client fait déjà presque tout : il conserve
`_serverUpdatedAt`, détecte `conflict`, dispose d'un écran d'arbitrage (`_conflictServer`).
Ce qui manque est un signal fiable venu du serveur. Deux voies :

- `UPDATE … WHERE id = ? AND updated_at = ?` et traiter « 0 ligne affectée » comme un conflit ;
- ou un déclencheur PostgreSQL refusant une écriture dont l'`updated_at` de référence est
  périmé, ce qui protège aussi les écritures venues d'ailleurs.

**Vérification** : `T-INT-08` au vert, et `tests/load/05-concurrence.js` avec
`ecrasements_silencieux = 0` à 25 utilisateurs.

---

## Corrections suivantes, par thème

### Intégrité des données

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 6 | Mettre en quarantaine une file locale illisible et l'annoncer, au lieu de repartir d'une liste vide | BUG-003 | Faible |
| 7 | Aligner la valeur de la liste des producteurs sur la clé de recherche (`code`) | BUG-005 | Faible |
| 8 | Décider avec le métier si `numero_recu` doit être unique, puis poser l'index partiel correspondant | BUG-007 | Faible + arbitrage |
| 9 | Donner une valeur par défaut à `v.s9` dans `scoreOf()` | BUG-018 | Très faible |

### Interface et saisie

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 10 | Préserver la sélection RT lors de la reconstruction de la liste | BUG-004 | Faible |
| 11 | Réserver la hauteur des blocs de Stock & Sacs pour ramener le CLS sous 0,1 | BUG-016 | Faible |
| 12 | Ne pas afficher « Poids net invalide » après un enregistrement réussi | BUG-022 | Très faible |

### Charge et performance

| # | Correction | Anomalie | Effort | Gain attendu |
|---|---|---|---|---|
| 13 | Envoyer les fiches par lot au lieu d'une requête par fiche (`syncNow`) | rapport 06 §5 | Moyen | Divise par 10 à 50 le nombre de requêtes d'une synchronisation |
| 14 | Partager un seul client Supabase par page | BUG-017 | Moyen | −3 lectures de `profils` par ouverture de RCN TRACE, fin de la contention sur le verrou de session |
| 15 | Ne pas écrire en base au simple chargement de RCN TRACE | BUG-013 | Faible | −100 écritures par vague d'ouverture |
| 16 | Découper le chargement de RCN TRACE (1,04 Mo, 29 scripts, 40 requêtes) | BUG-013 | **Élevé** | Le plus gros gain possible sur le temps d'ouverture |
| 17 | Allonger l'intervalle de la Cartographie et s'appuyer sur l'abonnement temps réel déjà en place | rapport 06 §4.2 | Faible | −9 requêtes/minute et par utilisateur |
| 18 | Paginer les lectures de référentiel | rapport 06 §5 | Moyen | Indispensable au-delà de quelques milliers de villages |
| 19 | Héberger localement le SDK Supabase et épingler `lucide` | BUG-021, 01-MAPPING §8 | Faible | Supprime la dépendance bloquante à un CDN tiers |

### Couche PWA

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 20 | Donner un repli sur cache à `i18n-sw.js`, ou fusionner les deux service workers | BUG-012 | Moyen |
| 21 | Corriger les chemins de `manifest.webmanifest` et `icon-192.png` dans `fbms/index.html` | BUG-019 | Très faible |

> `sw.js`, `i18n-sw.js` et `manifest.webmanifest` sont en zone interdite aux agents
> (`CLAUDE.md` §3) : **un service worker fautif survit au correctif dans le cache des
> utilisateurs**. Ces deux corrections se font à la main, avec un plan de retour arrière.

### Sécurité

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 22 | Trancher : les données doivent-elles être cloisonnées par zone ou cluster ? Si oui, appliquer le modèle de périmètres déjà écrit dans `docs/migrations/aflp_acces_perimetres_20260816.sql` | BUG-014 | Élevé + arbitrage |
| 23 | Restreindre la lecture de `achats` et `avances` aux rôles qui en ont l'usage | BUG-015 | Moyen |
| 24 | Faire échouer un rôle inconnu au lieu de lui accorder le niveau « agent » | BUG-023 | Très faible |

### Dette déjà connue

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 25 | Corriger l'accolade excédentaire de `shared/alis-hardening.js:39` — 14 ko de garde-fous absents d'un écran qui modifie des barèmes | BUG-011 | Très faible |
| 26 | Supprimer ou protéger les pages logistiques en doublon | BUG-020 | Faible |

---

## Ce qu'il faut mesurer avant de conclure quoi que ce soit sur la charge

Les corrections ci-dessus traitent ce qui a pu être observé. Trois mesures manquent, et aucune
recommandation de mise en production ne devrait être signée sans elles :

1. **La capacité réelle du serveur Supabase.** `NON TESTÉ` — hôte injoignable depuis
   l'environnement de cette campagne. Les scripts sont prêts (`tests/load/`), la première
   exécution est sans risque (`04-statique.js`, lecture seule).
2. **La volumétrie de production.** `NON CONFIRMÉ`. Toutes les lectures de référentiel sont
   intégrales et sans pagination : le comportement à 5 000 villages n'a rien à voir avec celui
   à 40. C'est la variable la plus déterminante du dimensionnement, et la seule qu'on ne peut
   pas deviner.
3. **Le comportement sous réseau réel de terrain.** Les mesures de latence de cette campagne
   sont des planchers de laboratoire ; le rapport 06 le dit à chaque tableau.
