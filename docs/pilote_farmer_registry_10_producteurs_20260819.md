# Pilote Farmer Registry — 10 producteurs, un seul village

Date : 19/08/2026
Projet : ANAGROCI Operations Suite / Farmer Registry
Statut : protocole opérationnel, prêt à exécuter
Responsable décision : Branch Manager
Socle testé : `main` au commit `c37cb08` (PR #173)

---

## 1. Ce que ce pilote teste, et ce qu'il ne teste pas

Le code est livré et les portes qualité sont vertes. Ce n'est plus le risque
principal.

```text
Le risque n'est plus le code.
Le risque est la qualité de saisie et la discipline des agents.
```

Ce pilote teste donc **les agents et les règles serveur ensemble**, sur un
périmètre assez petit pour être annulé sans dégât.

Il **ne** teste **pas** :

- le tracé polygonal GPS Level 2, absent du socle ;
- la conversion Achats/Sacs vers `producteurs.id`, migration distincte ;
- l'arbitrage champ par champ entre deux appareils, non disponible ;
- la montée en charge : dix dossiers ne mesurent aucune performance.

---

## 2. Choix du village

Un seul village, choisi parmi ceux qui ont assez de RT pour éprouver la règle
de cohérence village/RT sans improviser.

| Village | Cluster | Préfixe Farmer ID | Score | RT actifs | Géorepère posé |
|---|---|---|---|---|---|
| **SOUAFOUÈ KAN** | BEOUMI | `SOUA` | 84 | 6 | oui |
| AGBANOU | BOTRO | `AGBA12` | 79 | 6 | oui |
| KOUASSI-GOLIKRO | DIABO | `KOUA` | 81 | 4 | oui |
| DIACOHOU | BEOUMI | `DIAC` | 85 | 3 | oui |

**Recommandation : SOUAFOUÈ KAN.** Six RT actifs laissent de la marge pour le
cas de mauvais rattachement, le géorepère est posé, et le préfixe est propre.
Les Farmer ID attendus iront donc de `SOUA-0001` à `SOUA-0010`.

> Le préfixe `AGBA12` d'AGBANOU n'est pas une anomalie : la migration Phase 1
> ajoute un rang à deux chiffres quand la base de quatre lettres est déjà prise
> (`20260818_farmer_registry_phase1_consolidated.sql:58`). Quatre villages sur
> soixante sont dans ce cas. Rien à corriger.

### Point de propreté — traité le 19/08/2026

Les noms de villages portaient des espaces parasites en fin — `SOUAFOUÈ KAN `,
`KOUASSI-GOLIKRO `, `KOKOFLÉ `. Invisible dans un formulaire, visible dans les
en-têtes du Farmer Passport et dans les exports.

**C'est corrigé.** Le nom était stocké en quatre endroits, et les quatre ont été
nettoyés dans une seule transaction :

| Emplacement | Lignes corrigées |
|---|---|
| `villages.village` | 20 (19 actifs + 1 en `soft-delete`) |
| `villages.data->'s1'->>'village'` — **source de vérité** | 20 |
| `rt.village_nom` | 45 |
| `rt.data->>'villageNom'` | 45 |

Corriger la seule colonne `villages.village` n'aurait rien réglé : le JSONB
`data->'s1'` fait foi (`fn_sync_villages_colonnes`), et le prochain
enregistrement depuis l'interface aurait restauré l'espace.

Contrôles après correction : 0 occurrence restante sur les quatre emplacements,
0 doublon de nom créé par le nettoyage, 76 lignes `villages` et 125 lignes `rt`
inchangées, 0 producteur orphelin.

### Deux écarts constatés et volontairement non corrigés

- **Casse divergente sur 3 RT** : le RT porte `Lengbré` là où le village
  s'appelle `LENGBRÉ`, et deux cas semblables. Le rattachement se fait par
  `village_id`, pas par le nom : l'intégrité n'est pas en cause. Choisir la
  casse canonique est une décision de votre part, pas un nettoyage.
- **12 RT ont un nom d'agent avec espaces parasites** (`rt.data->>'nom'`).
  Autre champ que le nom de village, laissé intact.

---

## 3. Les dix dossiers à couvrir

Chaque ligne est un producteur réel, recruté normalement. Ce n'est pas une
simulation : ce sont de vrais consentements et de vraies parcelles. Ce qui est
choisi, c'est **la situation**, pas la donnée.

| # | Situation à couvrir | Ce que l'on vérifie |
|---|---|---|
| 1 | Dossier nominal complet | Chaîne entière jusqu'à `BASELINE` |
| 2 | Dossier nominal complet | Reproductibilité, Farmer ID incrémenté |
| 3 | Saisi **hors connexion** de bout en bout | `PENDING SYNC` puis Farmer ID définitif à la synchronisation |
| 4 | Saisi **hors connexion**, synchronisé le lendemain | Le brouillon local n'est pas écrasé par une lecture serveur |
| 5 | **Plusieurs parcelles** (au moins 3) | Chaque parcelle a son propre point GPS et son propre statut |
| 6 | **Plusieurs parcelles** dont une non cartographiée | Le passeport n'atteint pas `MAPPED` sans point GPS |
| 7 | **GPS à précision faible** (> 20 m annoncés) | La précision est bien enregistrée et visible, sans blocage |
| 8 | **Doublon potentiel** — même téléphone qu'un dossier déjà saisi | `possible_duplicate` puis `REVIEW_REQUIRED` |
| 9 | **Consentement partiel** — le producteur refuse une catégorie | `PARTIAL` : 8 points au lieu de 15, et `REVIEW_REQUIRED` |
| 10 | **Risque Sustainability critique** assumé, puis action corrective clôturée avec preuve | `REVIEW_REQUIRED`, action `CRITICAL`, vérification refusée puis accordée |

Le dossier 10 est le seul qui doit aller jusqu'à `VERIFIED`. C'est lui qui
prouve la chaîne complète, y compris le refus de vérification tant qu'une
action critique reste ouverte.

---

## 4. Ce que les agents doivent savoir avant de partir

### 4.1 Le piège qui produira le plus de faux signaux

**Douze des vingt-cinq questions Sustainability déclenchent un risque sur
`UNKNOWN` ou `NOT_VERIFIED`.** Cinq d'entre elles montent directement en
`REVIEW_REQUIRED` avec une action corrective `CRITICAL` :

| Code | Domaine | Question | Réponses déclenchantes |
|---|---|---|---|
| `B01` | Environnement | Brûlage non contrôlé ? | `YES`, `UNKNOWN`, `NOT_VERIFIED` |
| `C05` | Phytosanitaire | Pulvérisation pendant la floraison ? | `YES`, `UNKNOWN`, `NOT_VERIFIED` |
| `C06` | Phytosanitaire | Emballages de pesticides réutilisés ? | `YES`, `UNKNOWN`, `NOT_VERIFIED` |
| `D04` | Social & sécurité | Mineurs dans des activités dangereuses ? | `YES`, `UNKNOWN`, `NOT_VERIFIED` |
| `D05` | Social & sécurité | Exposition chimique des travailleurs ? | `YES`, `PARTIAL`, `UNKNOWN`, `NOT_VERIFIED` |

Sept autres — `B02`, `B03`, `C02`, `C03`, `C04`, `C07`, `D06` — produisent un
risque `HIGH`.

Conséquence à dire aux agents en clair :

```text
Un agent pressé qui laisse des questions sans réponse
ne produit pas un dossier neutre.
Il produit un dossier à risque, avec des actions correctives
critiques ouvertes au nom du producteur.
```

C'est voulu — `UNKNOWN` n'est pas `NO` — mais si personne ne l'explique avant
le départ, le pilote remontera une vague d'alertes qui ne dit rien du terrain
et tout de la formation.

### 4.2 Le barème exact, tel que le serveur le calcule

Extrait de `supabase/20260818_farmer_registry_complete.sql:531-539` :

| Bloc | Points | Condition serveur exacte |
|---|---|---|
| Identité | 30 | nom non vide **et** sexe **et** (année de naissance **ou** tranche d'âge) **et** téléphone normalisé à **10 chiffres** |
| Rattachement AFLP | 20 | `village_id` **et** `rt_id` renseignés |
| Consentement | 15 / **8** | `GRANTED` → 15 ; **`PARTIAL` → 8** ; sinon 0 |
| Parcelles | 10 | au moins une parcelle `ACTIVE` |
| GPS | 10 | au moins une parcelle en `POINT_CAPTURED` ou `GPS_VERIFIED` |
| Production Baseline | 10 | au moins une baseline `FINAL` |
| Sustainability | 5 | au moins une baseline Sustainability `FINAL` |

Les paliers de maturité, mêmes lignes :

```text
BASIC     identité 30 + rattachement 20 + consentement GRANTED
MAPPED    BASIC + au moins une parcelle + au moins un point GPS
BASELINE  MAPPED + Production Baseline FINAL + Sustainability FINAL
VERIFIED  BASELINE + vérification APPROVED par la supervision
```

Un téléphone à neuf chiffres coûte **les 30 points d'identité d'un coup**, pas
trois. C'est le deuxième motif d'échec attendu après les `UNKNOWN`.

### 4.3 Ce qui bascule un dossier en `REVIEW_REQUIRED`

Quatre causes, cumulatives :

- doublon potentiel détecté ;
- consentement `PARTIAL`, `REFUSED` ou `WITHDRAWN` ;
- au moins une action corrective `CRITICAL` ouverte ;
- marquage manuel pour revue.

### 4.4 Ce que l'agent recenseur ne peut pas faire

Vérifié par test RLS avant la fusion : capture GPS **autorisée** ; passage en
`GPS_VERIFIED` **refusé** ; clôture d'action corrective **refusée** ;
vérification du passeport **refusée**. Inutile de leur promettre le contraire.

---

## 5. Déroulé sur trois jours

| Jour | Objectif | Volume |
|---|---|---|
| J-1 | Briefing 45 min, vérification des téléphones, un dossier blanc à jeter | 0 réel |
| J0 | Dossiers 1 à 5 | 5 |
| J1 | Dossiers 6 à 10, contrôle des dossiers de J0 | 5 |
| J2 | Clôture, action corrective du dossier 10, décision GO / NO-GO | 0 |

Contrôle **le soir de chaque jour**, pas à la fin. Une erreur de saisie répétée
dix fois n'apprend rien de plus qu'une erreur repérée le premier soir.

---

## 6. Grille d'observation — une ligne par dossier

À remplir par le superviseur, pas par l'agent qui a saisi.

| Champ | Attendu |
|---|---|
| Farmer ID attribué | `SOUA-000N`, jamais `TMP-*` après synchronisation |
| Durée de saisie | minutes, montre en main |
| Nombre de reprises | combien de fois l'agent est revenu en arrière |
| Téléphone accepté du premier coup | oui / non |
| Questions laissées en `UNKNOWN` | nombre |
| `passport_completion` obtenu | 0 à 100 |
| `passport_stage` obtenu | `INCOMPLETE` / `BASIC` / `MAPPED` / `BASELINE` / `VERIFIED` |
| `risk_profile` obtenu | `NOT_ASSESSED` / `LOW` / `MEDIUM` / `HIGH` / `REVIEW_REQUIRED` |
| Actions correctives créées | nombre et priorité |
| Écart entre l'attendu et l'obtenu | libre, une phrase |

La dernière colonne est la seule qui compte vraiment. Un dossier conforme
n'apprend rien ; un écart inexpliqué est le livrable du pilote.

---

## 7. Requêtes de contrôle du soir

À exécuter par la supervision, en lecture seule. Remplacer le nom du village si
un autre a été retenu.

### 7.1 Vue d'ensemble des dix dossiers

```sql
select p.code as farmer_id,
       p.passport_stage,
       p.passport_completion,
       p.risk_profile,
       p.consent_status,
       p.possible_duplicate,
       p.review_required
from public.producteurs p
join public.villages v on v.id = p.village_id
where btrim(v.village) = 'SOUAFOUÈ KAN'
  and not p.deleted
  and p.created_at >= current_date - 3
order by p.code;
```

### 7.2 Couverture parcelles et GPS

```sql
select p.code as farmer_id,
       count(f.id) filter (where f.status = 'ACTIVE')                          as parcelles,
       count(f.id) filter (where f.gps_status = 'POINT_CAPTURED')              as points_captures,
       count(f.id) filter (where f.gps_status = 'GPS_VERIFIED')                as points_verifies,
       max(f.gps_accuracy_m)                                                   as pire_precision_m
from public.producteurs p
left join public.farmer_plots f on f.producteur_id = p.id and not f.deleted
join public.villages v on v.id = p.village_id
where btrim(v.village) = 'SOUAFOUÈ KAN' and not p.deleted
group by p.code
order by p.code;
```

### 7.3 Les `UNKNOWN` qui ont créé des actions correctives

C'est la requête qui distingue un vrai risque terrain d'un défaut de saisie.

```sql
select a.priority,
       a.status,
       a.question_code,
       count(*) as nb
from public.farmer_action_plans a
join public.producteurs p on p.id = a.producteur_id
join public.villages v on v.id = p.village_id
where btrim(v.village) = 'SOUAFOUÈ KAN'
  and a.status in ('OPEN','IN_PROGRESS','OVERDUE')
group by a.priority, a.status, a.question_code
order by a.priority desc, nb desc;
```

Croiser ensuite avec les réponses effectivement données :

```sql
select r.answer, count(*) as nb
from public.farmer_sustainability_answers r
join public.farmer_sustainability_baselines b on b.id = r.baseline_id
join public.producteurs p on p.id = b.producteur_id
join public.villages v on v.id = p.village_id
where btrim(v.village) = 'SOUAFOUÈ KAN'
group by r.answer
order by nb desc;
```

**Lecture** : si `UNKNOWN` et `NOT_VERIFIED` dépassent 15 % des réponses, le
problème est la formation, pas les vergers.

### 7.4 Contrôle d'absence de fuite de donnée sensible

```sql
select count(*) as numeros_piece_dans_producteurs
from public.producteurs
where id_document_number is not null and not deleted;
```

Doit rester à **0** : les numéros de pièce vivent dans
`farmer_identity_documents`, table privée sous RLS.

---

## 8. Critères GO / NO-GO

**GO** vers la généralisation aux six clusters si, et seulement si :

- les dix Farmer ID sont attribués, uniques, sans `TMP-*` résiduel ;
- les deux dossiers hors connexion se sont synchronisés sans perte ;
- aucun rattachement RT hors village n'a pu être enregistré ;
- le dossier 10 a bien été **refusé** à la vérification tant que l'action
  critique était ouverte, puis accepté après clôture avec preuve ;
- moins de 15 % de réponses `UNKNOWN` / `NOT_VERIFIED` sur l'ensemble ;
- la requête 7.4 renvoie 0 ;
- aucun agent n'a eu besoin d'appeler la supervision plus d'une fois par dossier.

**NO-GO**, et retour en formation, si l'un de ces signaux apparaît :

- un Farmer ID en double ou un `TMP-*` persistant ;
- une perte de saisie hors connexion, même partielle ;
- un numéro de pièce trouvé ailleurs que dans la table privée ;
- plus de 30 % de réponses `UNKNOWN` ;
- un dossier passé `VERIFIED` avec une action critique encore ouverte — ce
  serait une faille serveur, à remonter immédiatement.

---

## 9. Réversibilité

Le pilote porte sur de vrais producteurs : **rien ne doit être supprimé**. Si
la décision est NO-GO, les dix dossiers restent en base, marqués pour revue, et
sont repris par les agents formés. Le `soft-delete` n'est utilisé que pour un
dossier créé par erreur, jamais pour effacer une trace de pilote.

Les sept lignes producteurs historiques déjà en `soft-delete` ne sont ni
réactivées ni renumérotées à cette occasion.

---

## 10. Ce qui reste à faire après le pilote, quel qu'en soit le verdict

- recette authentifiée sur téléphone d'agent, jamais exécutée à ce jour ;
- arbitrage sur la casse canonique des noms de villages et de RT ;
- GPS Level 2 polygonal et installation éventuelle de PostGIS ;
- conversion physique Achats/Sacs vers `producteurs.id` ;
- arbitrage champ par champ des conflits entre deux appareils ;
- validation juridique du texte `AFLP-DATA-CONSENT-2026.1`.
