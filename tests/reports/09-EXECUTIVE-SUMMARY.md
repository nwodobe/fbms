# 09 — Synthèse de direction

**Question posée** : ANAGROCI FBMS peut-il être utilisé en conditions réelles par une centaine
de personnes, sans perte de données ni dysfonctionnement métier ?

**Réponse** : **non, pas en l'état** — et pour une raison qui n'a rien à voir avec le nombre
d'utilisateurs.

---

## 1. En une page

L'application a été soumise à **285 ouvertures de pages**, **17 scénarios d'intégrité des
données**, **14 contrôles d'accès**, **5 scénarios de panne**, **4 profils de réseau** et une
**campagne de charge de 1 à 100 utilisateurs simultanés**. Tout a été exécuté ; rien n'a été
déduit d'une simple lecture de documentation.

**Ce qui va bien.** Le cœur du produit — la saisie d'un achat sur le terrain — est bien conçu
sur le point le plus difficile : **il ne crée jamais de doublon**. Double-clic nerveux, coupure
réseau en pleine transmission, téléphone éteint pendant l'envoi, page rechargée, deux onglets
ouverts : dans les cinq cas, un achat reste un achat. Sur 500 tentatives d'envoi simultané du
même enregistrement par 25 utilisateurs, **zéro doublon**. C'est un vrai acquis, et il est rare.
La saisie fonctionne aussi hors réseau : enregistrer un achat prend 95 millisecondes, que la
liaison soit excellente ou inexistante.

**Ce qui bloque.** Une anomalie, une seule, suffit à interdire la mise en service :

> Quand la mémoire du téléphone est pleine — ce qui arrive après une journée de collecte hors
> réseau avec photos de reçus — l'agent saisit son achat, appuie sur « Valider », **et l'écran
> lui répond « Achat validé »**. L'achat n'existe nulle part : ni sur le téléphone, ni sur le
> serveur. Aucune alerte, aucune trace.

Le cahier de charge le classe lui-même comme motif d'arrêt : *« opération déclarée réussie alors
qu'elle n'est pas enregistrée »*. Cette anomalie ne dépend pas du nombre d'utilisateurs : elle
frapperait aussi bien une équipe de dix personnes.

**Ce qui n'a pas pu être mesuré.** L'environnement d'exécution de cette campagne n'a pas accès
au site publié ni à la base de données. **La capacité réelle du serveur à 100 utilisateurs n'a
donc pas été mesurée.** Les scripts sont écrits, testés et prêts ; il manque une autorisation
réseau et un environnement de test.

---

## 2. Les cinq choses à retenir

**1. Un achat peut disparaître en silence, avec un message de succès.**
Quand le stockage du téléphone est saturé, l'échec d'enregistrement est avalé par le code sans
que personne n'en soit averti. Correction estimée : quelques lignes pour l'alerte immédiate, un
travail plus conséquent pour sortir les photos de reçus du stockage saturable.

**2. Un producteur enrôlé est enregistré comme « non référencé ».**
Quand l'agent choisit un producteur dans la liste des producteurs déjà recensés, l'application
ne le reconnaît pas, réclame son numéro de téléphone, le marque « à régulariser » et **ne relie
pas l'achat au producteur dans la base**. La traçabilité producteur — la raison d'être du
référentiel — ne se construit pas. C'est l'anomalie au plus fort impact métier, et elle survient
à **chaque** saisie.

**3. Deux reçus papier identiques passent sans alerte.**
Rien n'empêche d'enregistrer deux fois le même numéro de reçu, avec des poids et des montants
différents. Le code de l'application prévoit pourtant un message « Bloqué reçu doublon » pour
une protection qui n'a jamais été posée dans la base.

**4. Deux personnes qui modifient la même fiche village : l'une des deux perd son travail.**
Sur 500 modifications concurrentes provoquées volontairement, **211 ont été écrasées sans que
personne ne soit averti** — ni celui dont le travail a disparu, ni celui qui l'a effacé. Ce
risque grandit mécaniquement avec le nombre d'utilisateurs : c'est le défaut qui se réveille en
passant de 10 à 100.

**5. Le référentiel FBMS s'ouvre sans mot de passe.**
Cinq pages publiées ne passent pas par l'écran de connexion, dont celle du référentiel — la
cible du bouton « FBMS Référentiel » du portail. Conséquence concrète : **désactiver un compte
ne referme pas cet écran sur le téléphone de la personne**. Les données du serveur restent
protégées (aucune n'était visible pendant le test), mais l'interface et les données déjà
présentes sur l'appareil, elles, restent accessibles.

---

## 3. Tableau des anomalies principales

| ID | Problème | Gravité | Utilisateurs affectés | Reproductible | Cause probable | Correction |
|---|---|---|---:|---|---|---|
| BUG-002 | Achat annoncé « validé » et perdu (mémoire du téléphone pleine) | **BLOCKER** | Tout agent en saisie hors réseau prolongée | Oui, 100 % | Échec d'écriture avalé par le code | Vérifier l'écriture ; sortir les photos du stockage saturable |
| BUG-001 | Cinq pages ouvertes sans authentification | CRITICAL | Tous, y compris les comptes désactivés | Oui, 100 % | Le portail pointe vers la page non protégée au lieu de la passerelle | Ajouter le verrou aux pages concernées |
| BUG-003 | Saisies disparues après une écriture interrompue | CRITICAL | Tout agent | Oui, 100 % | Erreur de lecture avalée, repart d'une liste vide | Mettre en quarantaine et alerter |
| BUG-006 | Modification de village écrasée sans avertissement | CRITICAL | Superviseurs, Branch Manager | Oui — 211 cas sur 500 | Contrôle de conflit non atomique | Écriture conditionnelle côté base |
| BUG-005 | Producteur enrôlé enregistré comme provisoire | HIGH | Tout agent, à chaque achat | Oui, 100 % | Deux conventions de nommage incompatibles | Aligner la clé de recherche |
| BUG-007 | Même reçu papier accepté deux fois | HIGH | Contrôle de gestion | Oui, 500 cas sur 500 | Aucune contrainte d'unicité en base | Index unique, après arbitrage métier |
| BUG-009 | Trois mécanismes de synchronisation superposés | HIGH | Tout agent | Oui | Correctifs empilés sans être fusionnés | Une seule implémentation |
| BUG-008 | Photos de reçus stockées dans la table des achats | HIGH | Tous | Oui | Conséquence de BUG-009 | Idem |
| BUG-010 | Le portail et la base ne connaissent plus les mêmes rôles | HIGH | 8 rôles sur 15 | Oui | Un fichier de sécurité mis à jour, l'autre non | Aligner les deux listes |
| BUG-013 | RCN TRACE : 11 s d'attente en 3G, 36 s en 2G | HIGH | Utilisateurs du module en zone de collecte | Oui | 1,04 Mo de code chargé d'un bloc | Découpage du module |

Le registre complet compte **23 anomalies** : 1 BLOCKER, 3 CRITICAL, 8 HIGH, 6 MEDIUM, 5 LOW.
Détail et preuves : `05-BUGS.md`.

---

## 4. Résultats de la campagne de charge

| Charge | Succès | Erreurs | p50 | p95 | p99 | Verdict |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 100 % | 0 % | 1 ms | 2 ms | 4 ms | cible émulée |
| 5 | 100 % | 0 % | 1 ms | 2 ms | 3 ms | cible émulée |
| 10 | 100 % | 0 % | 1 ms | 2 ms | 3 ms | cible émulée |
| 25 | 100 % | 0 % | 1 ms | 6 ms | 8 ms | cible émulée |
| 50 | 100 % | 0 % | 0 ms | 5 ms | 28 ms | cible émulée |
| 75 | 100 % | 0 % | 0 ms | 12 ms | 26 ms | cible émulée |
| 100 | 100 % | 0 % | 0 ms | 10 ms | 21 ms | cible émulée |

**Ces chiffres ne valident pas la production**, et il faut le dire clairement plutôt que de les
laisser rassurer : ils ont été obtenus contre un serveur de laboratoire, qui n'a jamais eu plus
d'une requête à traiter à la fois. Ce qu'ils établissent réellement :

- **cent utilisateurs demandent environ 43 requêtes par seconde** au serveur en régime de
  saisie — le chiffre à donner à celui qui dimensionnera la base ;
- **le client ne se dégrade pas quand le serveur est lent** : à 150 ms de latence injectée, le
  débit ne baisse que de 5 % et aucune file d'attente ne se forme ;
- **aucune fuite entre utilisateurs**. La simulation hybride — 90 utilisateurs protocole et
  10 navigateurs réels en même temps, sur la même cible, pendant trois minutes — s'est terminée
  avec **zéro échec de parcours, zéro erreur JavaScript, zéro mélange d'identité et zéro
  doublon**, pour 249 ouvertures de pages et 16 saisies d'achat complètes.

---

## 5. Verdict

# NO-GO

L'application n'est pas suffisamment fiable pour être confiée à 100 utilisateurs en l'état.

Ce verdict repose sur **un critère d'arrêt explicite du cahier de charge, constaté par
l'expérience** : une opération déclarée réussie alors qu'elle n'est pas enregistrée (BUG-002),
accompagnée de deux autres pertes silencieuses (BUG-003, BUG-006).

**Ce verdict n'est pas un jugement sur la charge.** Aucune anomalie bloquante n'est causée par
le nombre d'utilisateurs. La même campagne menée à dix utilisateurs aurait donné le même
verdict. C'est une nuance importante : le produit n'est pas « trop petit pour 100 personnes »,
il a des défauts de fiabilité qu'il faut traiter quel que soit l'effectif.

### Nombre maximal d'utilisateurs validé

**Aucun palier n'est validé en production.**

Ce n'est pas une réponse évasive, c'est la seule réponse honnête : le site publié et sa base de
données sont injoignables depuis l'environnement de cette campagne. Ce qui a été démontré :
le **client** encaisse 100 utilisateurs simultanés sans erreur ni fuite, y compris lors d'une
arrivée brutale de 10 à 100 en dix secondes. Ce qui reste inconnu : ce que fait le serveur en
face.

### Principal goulot d'étranglement

**Ce n'est pas le serveur — c'est ce que le client lui demande**, et la façon dont il le demande.

Trois sources dominent, toutes mesurées :

1. **RCN TRACE** émet 40 requêtes et télécharge 1,04 Mo de code à chaque ouverture, dont quatre
   lectures du même profil utilisateur. Cent ouvertures dans la même minute — le début d'une
   journée — produisent une pointe d'environ 67 requêtes par seconde.
2. **La carte** interroge trois tables toutes les 20 secondes, alors qu'elle dispose déjà d'un
   abonnement temps réel aux mêmes tables. Cent cartes ouvertes = 15 requêtes par seconde en
   permanence, sans que personne ne touche à rien.
3. **La synchronisation du référentiel** envoie une requête par fiche, en série, chacune
   précédée d'une lecture de contrôle — deux requêtes par fiche là où une seule suffirait pour
   l'ensemble.

Ces trois points se corrigent sans rien changer au métier et divisent la charge de fond avant
même de savoir ce que le serveur supporte.

### Les cinq corrections prioritaires

| # | Correction | Anomalie | Effort |
|---|---|---|---|
| 1 | Ne plus annoncer « validé » quand l'enregistrement a échoué ; sortir les photos du stockage saturable | BUG-002 | Faible puis moyen |
| 2 | Une seule implémentation de la synchronisation des achats (aujourd'hui trois superposées) | BUG-009, BUG-008 | Moyen |
| 3 | Poser le verrou d'authentification sur les cinq pages ouvertes | BUG-001 | Faible |
| 4 | Réconcilier les rôles du portail et ceux de la base | BUG-010 | Faible, mais à faire avec précaution |
| 5 | Rendre le contrôle de conflit atomique sur les fiches village | BUG-006 | Moyen |

À quoi s'ajoute une correction très courte et à fort effet métier : **aligner la liste des
producteurs sur la clé de recherche** (BUG-005), qui rétablirait la traçabilité producteur.

### Risque métier principal

**La perte silencieuse d'achats en fin de journée de collecte.**

C'est le scénario qui coûte le plus cher, parce qu'il est invisible : l'agent croit avoir
enregistré, le producteur est payé, et rien ne remonte. L'écart n'apparaît qu'à la
réconciliation de caisse, plusieurs jours plus tard, sans moyen de savoir ce qui manque. Il
frappe précisément le moment où le stockage du téléphone est le plus rempli — la fin d'une
journée hors réseau, c'est-à-dire le cas d'usage central du produit.

Le second risque, moins spectaculaire mais permanent : **la traçabilité producteur ne se
constitue pas** (BUG-005). Chaque achat est enregistré sans lien vers le producteur enrôlé.

### Recommandation de mise en production

**Ne pas déployer à 100 utilisateurs avant d'avoir traité les cinq corrections prioritaires.**
Un déploiement progressif reste envisageable, sous conditions :

1. **Créer un environnement de test.** C'est le préalable à tout le reste. Il n'existe
   aujourd'hui aucun endroit où essayer une correction avant de la subir : un seul projet
   Supabase, une seule branche publiée. Tant que c'est le cas, chaque correction est livrée
   sans filet.
2. **Corriger les points 1 à 5**, puis rejouer les tests d'intégrité fournis
   (`node tests/e2e/02-integrite-donnees.mjs`) : les scénarios qui échouent aujourd'hui doivent
   passer au vert. C'est une vérification objective, pas une appréciation.
3. **Mesurer la production**, dans cet ordre : la couche statique d'abord (sans aucun risque),
   puis la base en lecture seule, puis l'écriture **sur l'environnement de test uniquement**.
4. **Déployer par paliers** : une équipe, puis un cluster, puis la branche — en surveillant à
   chaque palier l'écart entre les achats saisis et les achats en base. C'est la seule mesure
   qui détecte une perte silencieuse.

En attendant, une mesure de terrain immédiate, sans aucune modification de code : **demander aux
agents de synchroniser avant que le téléphone ne se remplisse**, et vérifier chaque soir que le
nombre d'achats en base correspond au nombre de reçus papier. Ce n'est pas une solution ; c'est
un garde-fou le temps que la correction arrive.

---

## 6. Ce que cette campagne n'a pas couvert

Par honnêteté, et parce que ces angles morts pèsent sur le verdict :

| Non couvert | Raison |
|---|---|
| Capacité réelle du serveur Supabase | Injoignable depuis cet environnement |
| Tenue du site publié à 100 ouvertures | Injoignable — script prêt, sans risque |
| Déploiement effectif des règles de sécurité en base | Non vérifiable sans accès à la production. **C'est la vérification la plus importante restante** |
| Comportement à la volumétrie réelle (nombre de villages, de producteurs, d'achats) | Inconnue. Toutes les lectures de référentiel sont intégrales, sans pagination : le comportement à 5 000 villages n'a rien à voir avec celui à 40 |
| Modules RCN TRACE, Assistant IA, Passeport producteur — dans leur détail fonctionnel | Volume comparable à celui de tout le reste de la suite ; mériteraient chacun leur campagne |
| Firefox, Safari | Seul Chromium est installable dans cet environnement |
| Rendu cartographique réel | Bibliothèque Leaflet inaccessible |

Tout le détail, les preuves et les commandes pour rejouer chaque test se trouvent dans les
rapports 01 à 08 et dans `tests/README.md`.
