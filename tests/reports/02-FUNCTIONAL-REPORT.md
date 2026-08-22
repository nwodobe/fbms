# 02 — Tests fonctionnels

**Exécution** : Chromium 131 (binaire Playwright 1.49.1), 19 pages × 5 personas × 3 largeurs
(390×844, 768×1024, 1440×900) = **285 ouvertures réelles**.
**Données brutes** : `tests/reports/donnees/01-parcours-pages.json`
**Rejouer** : `node tests/e2e/01-parcours-pages.mjs`

> Rappel de périmètre : les pages exécutées sont les octets exacts du dépôt ; le backend est
> l'émulateur local (01-MAPPING §0). Les conclusions sur le **comportement des pages** valent
> pour la production. Les temps de chargement mesurés ici sont des **planchers** : la latence
> réseau réelle s'y ajoute.

---

## 1. Résultat d'ensemble

| Indicateur | Valeur |
|---|---|
| Ouvertures effectuées | 285 |
| Ouvertures ayant abouti à un rendu | 285 / 285 |
| Ouvertures avec **erreur JavaScript non gérée** | **34** |
| Ouvertures avec ressource interne en échec (4xx / réseau) | 0 (hors 404 hérités, §5) |
| Débordement horizontal (3 largeurs) | 0 / 285 |
| Images sans attribut `alt` | 2 sur `fbms/index.html` (défaut déjà consigné dans les référentiels du dépôt) |

---

## 2. Matrice d'accès observée

Chaque case est le résultat d'une ouverture réelle de la page avec la session du persona,
lue à l'écran : `levé` = interface accessible, `refusé` = écran « Accès non autorisé »,
`connexion` = formulaire de connexion.

| Page | Branch Manager | Supervisor | Agent Recenseur | Consultation | Compte **désactivé** |
|---|---|---|---|---|---|
| `index.html` | levé | levé | levé | levé | connexion |
| `terrain/achats.html` | levé | levé | levé | refusé | connexion |
| `terrain/sacs.html` | levé | levé | levé | refusé | connexion |
| `terrain/sacherie_v2.html` | levé | levé | levé | refusé | connexion |
| `terrain/cash.html` | levé | levé | refusé | refusé | connexion |
| `terrain/command.html` | levé | **refusé** | refusé | levé | connexion |
| `terrain/aflp-ia-admin.html` | levé | refusé | refusé | refusé | connexion |
| `fbms/app.html` | levé | levé | levé | refusé | connexion |
| `fbms/fbms_hubs.html` | levé | levé | levé | levé | connexion |
| `fbms/fbms_carte.html` | levé | levé | levé | levé | connexion |
| `fbms/audit_distances.html` | levé | levé | refusé | refusé | connexion |
| `logistique/alis_fbms.html` | levé | levé | refusé | refusé | connexion |
| `rcntrace/index.html` | levé | levé | levé | levé | connexion |
| `shared/admin.html` | levé | refusé | refusé | refusé | connexion |
| **`fbms/index.html`** | levé | levé | levé | levé | **levé** |
| **`logistique/index.html`** | levé | levé | levé | levé | **levé** |
| **`logistique.html`** | levé | levé | levé | levé | **levé** |
| **`logistique/ancien.html`** | levé | levé | levé | levé | **levé** |
| **`suite/index.html`** | levé | levé | levé | levé | **levé** |

Les 14 premières lignes sont **exactement conformes** à la table `ACCESS` de
`shared/auth-gate.js:43`. Aucun écart. Le portail JavaScript fait ce qu'il annonce.

Les cinq dernières lignes sont le défaut **BUG-001** : ces pages ne chargent pas
`shared/auth-gate.js` et s'ouvrent pour n'importe qui, y compris un compte désactivé.
Détail et impact : rapport 07.

**Point d'attention métier, pas un défaut technique** : un `Supervisor` ne peut pas ouvrir le
Command Center (`command:["bm","direction"]`), alors qu'il peut ouvrir tous les modules de
saisie qu'il est censé encadrer. Choix délibéré ou oubli ? À trancher par le métier.

---

## 3. Erreurs JavaScript relevées

Trois seulement, mais elles se répètent :

| Occurrences | Page | Message | Nature |
|---:|---|---|---|
| 15 / 15 | `logistique/alis_fbms.html` | `Unexpected token 'function'` | **Défaut réel de production** |
| 15 / 15 | `fbms/fbms_carte.html` | `map.createPane is not a function` | **Artefact du banc** — écarté |
| 4 / 15 | `fbms/index.html` | `Cannot read properties of undefined (reading 'potentiel20')` | **Défaut réel** — voir T-INT-09 |

### `logistique/alis_fbms.html` — le fichier de durcissement ne s'exécute pas

`shared/uppercase.js:127` injecte `shared/alis-hardening.js` sur cette page uniquement.
Ce fichier comporte une erreur de syntaxe (accolade excédentaire, ligne 39) et n'est donc
**jamais exécuté**. La porte du dépôt le confirme indépendamment :

```
$ node .github/scripts/verifier-js.mjs
~ historique shared/alis-hardening.js
68 fichier(s) JavaScript · 1 erreur(s) héritée(s) · 0 nouvelle(s)
```

Ce défaut est **déjà connu et daté** (`CLAUDE.md` §6, `js-baseline.json`). Ce que la campagne
ajoute : la confirmation que l'erreur se produit bien **à chaque ouverture de la page en
condition réelle**, dans les trois largeurs et pour les deux rôles autorisés. Les garde-fous
que ce fichier contient — 14 ko de code — sont absents en production.

### `fbms/fbms_carte.html` — faux positif écarté

`map.createPane is not a function` provient de la **doublure Leaflet** du banc
(`.github/vendor/doublures/leaflet.js`), qui n'implémente pas `createPane`. Le vrai Leaflet
1.9.4 l'implémente. Ce message est un artefact du harnais, **il n'est pas compté comme
défaut** — il est signalé ici pour que personne ne le retrouve plus tard en croyant à une
régression.

---

## 4. Formulaires — valeurs limites, caractères spéciaux, injection

Neuf cas passés sur le formulaire d'achat (`T-INT-10`, exécution réelle) :

| Cas | Valeur | Attendu | Obtenu |
|---|---|---|---|
| Poids négatif | `-50` | refus | **refusé** — « Poids net invalide (brut − tare doit être > 0) » |
| Poids nul | `0` | refus | **refusé** |
| Prix nul | `0` | refus | **refusé** — « Prix / kg invalide » |
| Humidité 99 % | `99` | refus | **refusé** — « Humidite invalide: doit etre entre 0 et 20% » |
| KOR 500 % | `500` | refus | **refusé** — « KOR invalide: doit etre entre 0 et 100% » |
| Poids extrême | `1 000 000 000 000` | accepté (pas de plafond métier) | accepté |
| Reçu de 5 000 caractères | `A×5000` | accepté | accepté, aucune troncature ni plantage |
| Injection | `<script>window.__XSS=1</script>` | accepté comme texte, **jamais exécuté** | accepté, **non exécuté** (`window.__XSS` reste indéfini) |
| Accents et Unicode | `REÇU_ÉÈÊ_ŒŽ_ᜠ` | accepté | accepté, conservé intact |

**Conclusion** : la validation métier côté client est sérieuse et complète. Deux réserves,
toutes deux mineures et signalées comme telles :

- aucun plafond haut sur le poids : un `1e12` kg est accepté (le plafond réaliste serait le
  tonnage d'un camion) ;
- aucune limite de longueur sur `numero_recu` et `observation`, qui partent tels quels vers
  la base.

L'échappement HTML est correct partout où il a été sollicité : la fonction `esc()` est
appliquée de façon systématique dans les rendus (`achats.html`, `fbms_carte.html`,
`alis_fbms.html`, `fbms/index.html`).

---

## 5. Navigation et URL

| Vérification | Résultat |
|---|---|
| Ouverture directe de chaque page par son URL | 19 / 19 aboutissent |
| Retour navigateur | Aucun état perdu (aucune application à état d'URL) |
| Actualisation | Aucune perte, sauf le cas mesuré T-INT-12 (synchronisation en cours) |
| URL inexistante | Le serveur renvoie 404 ; **aucune page 404 personnalisée** dans le dépôt — l'utilisateur reçoit la page brute de GitHub Pages |
| Liens internes cassés | 4, tous déjà consignés dans `liens-baseline.json` : `fbms/index.html → ./manifest.webmanifest`, `fbms/index.html → ./icon-192.png`, et 2 liens du fichier de sauvegarde non servi |
| Débordement horizontal | 0 sur 285 ouvertures — la mise en page tient aux trois largeurs |

Le 404 de `fbms/index.html → ./manifest.webmanifest` a été **observé en direct** dans la console
du navigateur, pas seulement déduit du vérificateur de liens : la PWA n'a donc pas de manifeste
sur son écran principal.

---

## 6. Duplication de pages

`logistique.html` et `logistique/ancien.html` sont **strictement identiques** — 32 326 octets
chacun, même contenu. Trois pages logistiques distinctes sont servies (`logistique.html`,
`logistique/ancien.html`, `logistique/index.html`) alors que le portail n'en référence
**aucune** : il pointe vers `logistique/alis_fbms.html`. Ce sont trois surfaces d'attaque et
trois sources de confusion sans utilisateur déclaré.

---

## 7. Comportement transverse observé

| Constat | Preuve | Portée |
|---|---|---|
| Chaque page crée **plusieurs clients Supabase** | Avertissement Chromium répété : « Multiple GoTrueClient instances detected in the same browser context » sur `terrain/achats.html` | Chaque client porte son propre rafraîchissement de jeton et son propre verrou : source de latence, voir BUG-004 |
| Chaque ouverture de module écrit dans `audit_log` | `POST audit_log` relevé sur 8 pages sur 19 | Une écriture de plus par ouverture de page — compte dans le dimensionnement (rapport 04) |
| Chaque page lit `profils` avec `select=*` | `GET profils` relevé sur 19 pages sur 19 | Une lecture par chargement, systématique |
| La liste RT du formulaire d'achat est reconstruite de façon asynchrone | Trace du `set innerHTML` sur `#f_rt` depuis `renderRefs` (`achats_dropdown_patch.js:57`) **pendant la saisie du numéro de reçu** | BUG-004 : la sélection de l'opérateur est effacée sans avertissement |
| Un producteur choisi dans la liste des enrôlés est enregistré comme « provisoire » | T-INT-17 | BUG-005 |

---

## 8. Ce qui n'a pas été testé fonctionnellement

| Élément | Raison |
|---|---|
| Parcours métier complets du module RCN TRACE | `NON TESTÉ` — 24 fichiers, ≈ 30 tables ; hors de la fenêtre de cette campagne |
| Assistant IA AFLP | `NON TESTÉ` — même raison |
| Passeport producteur (`farmer-registry-*`) | `NON TESTÉ` — même raison |
| Export XLSX réel | `NON TESTÉ` — la bibliothèque XLSX est une doublure sur le banc ; le déclenchement de l'export est vérifié, pas le contenu du fichier |
| Rendu cartographique Leaflet | `NON TESTÉ` — doublure ; nécessite un accès à `unpkg.com` et aux tuiles OSM |
| Firefox et WebKit | `NON TESTÉ` — seul Chromium est installé dans cet environnement ; les navigateurs manquants ne peuvent pas être téléchargés (accès sortant refusé) |
| Envoi réel d'une photo vers Supabase Storage | `NON TESTÉ` en production ; l'émulateur accepte l'envoi, mais le bucket `recus` n'est pas sollicité par le chemin de code actif (voir T-INT-14) |
