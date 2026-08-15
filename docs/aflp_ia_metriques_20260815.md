# Assistant IA AFLP — définitions des mesures

**15 août 2026**

Ce document définit chaque mesure, **et surtout ce qu'elle ne mesure pas**. Une
mesure dont on ignore la limite finit par être citée comme une preuve.

---

## 1. La règle qui gouverne tout ce document

> **Ne pas calculer l'exactitude sur l'absence de plainte.**
> Un retour utilisateur positif n'est pas, à lui seul, une preuve que le chiffre
> est correct.

Un utilisateur qui reçoit « le cluster de Béoumi compte 1 équipe RT » n'a aucun
moyen de savoir si c'est vrai. Il sait seulement que la phrase répond à sa
question. Compter son approbation comme une validation d'exactitude
fabriquerait un indicateur rassurant et faux.

C'est pourquoi les boutons de l'interface s'appellent **« Réponse utile »** et
**« À revoir »**, et non « juste » et « faux ». Le vocabulaire de l'interface est
une décision de mesure, pas d'ergonomie.

---

## 2. Les cinq définitions

```
Taux de compréhension =
    questions comprises correctement / questions métier évaluables

Taux de couverture =
    questions ayant obtenu une réponse fondée / questions métier évaluables

Exactitude des intentions =
    intentions correctement détectées / questions revues par un humain

Exactitude des entités =
    portées correctement détectées / questions revues par un humain

Exactitude des réponses =
    réponses validées correctes / réponses revues par un humain
```

Les **trois dernières** ont pour dénominateur les questions **revues par un
humain**. Tant qu'aucune revue n'a eu lieu, elles n'existent pas — et le tableau
de bord affiche « à établir » plutôt qu'un chiffre inventé.

---

## 3. Statuts journalisés

Chaque question porte exactement un statut, dérivé de la réponse par
`AFLP_IA_JOURNAL.statutResultat` — jamais saisi à la main.

| Statut | Signification | Compte dans |
|---|---|---|
| `reponse_produite` | Intention comprise, confiance haute, chiffre calculé | compréhension, couverture |
| `compris` | Réservé à une validation humaine explicite | compréhension, couverture |
| `partiellement_compris` | Intention comprise, confiance moyenne ou faible | ni l'une ni l'autre |
| `clarification_demandee` | L'assistant a posé une question en retour | taux de clarification |
| `non_compris` | Aucune intention reconnue | taux de repli |
| `donnee_indisponible` | Intention comprise, donnée absente de FBMS | **ni erreur ni échec** |
| `erreur_technique` | Le calcul a échoué | taux d'erreur |

### `donnee_indisponible` n'est pas un échec

C'est un **succès de compréhension** doublé d'une **absence de donnée**. Le
compter comme une incompréhension pousserait, à la longue, à combler le vide par
une approximation — exactement ce qu'on cherche à éviter.

---

## 4. Le dénominateur : « questions métier évaluables »

Une question **hors périmètre** — « quel temps fera-t-il demain ? » — ne mesure
pas l'assistant. La compter ferait baisser le taux de compréhension sans qu'il y
ait quoi que ce soit à corriger.

### Ce qui est fait aujourd'hui — et sa limite

Le tableau de bord emploie **le total des questions** comme dénominateur. C'est
une **approximation par excès du dénominateur**, donc une **sous-estimation du
taux de compréhension**. Elle est écrite dans le code de l'écran, et rappelée
ici.

### Ce qui la lèvera

Dès qu'un relecteur marque une question `hors_perimetre` dans l'écran
d'administration, elle sort du dénominateur. La mesure devient exacte à mesure
que la revue avance — pas avant. Angle mort A-04.

---

## 5. Ce que le tableau de bord affiche

Écran : `terrain/aflp-ia-admin.html`, section « Mesures de compréhension »,
fenêtre glissante de 30 jours.

| Mesure | Source | Limite |
|---|---|---|
| Questions | `count(*)` | — |
| Comprises | `reponse_produite` + `compris` | — |
| Partiellement | `partiellement_compris` | — |
| Clarifications | `clarification_demandee` | — |
| Non comprises | `non_compris` | inclut les questions hors périmètre non encore triées |
| Donnée absente | `donnee_indisponible` | — |
| Erreurs techniques | `erreur_technique` | — |
| Latence moyenne | `avg(latency_ms)` | mesurée **côté client**, réseau compris |
| Couche linguistique | `count(*) where language_layer_used` | vaut 0 tant qu'elle est désactivée |
| Intention la plus posée | `mode(detected_intent)` | — |
| **Exactitude validée** | — | **« à établir »** tant qu'aucune revue humaine n'a eu lieu |

### Répartition par intention et par portée

Disponible dans la vue SQL `public.aflp_ia_metriques`, agrégée par jour, version
de catalogue, intention et type de portée.

```sql
select detected_intent, sum(questions) q, sum(non_comprises) nc
from public.aflp_ia_metriques
where jour > current_date - 30
group by 1 order by nc desc, q desc;
```

Une intention qui concentre les incompréhensions signale un défaut de
vocabulaire, pas un défaut d'utilisateur.

---

## 6. La vue respecte la RLS de celui qui l'interroge

`public.aflp_ia_metriques` est déclarée `with (security_invoker = true)`.

Conséquence **voulue** : un utilisateur ordinaire n'y voit que l'agrégat de
**ses** questions ; les rôles de supervision voient tout.

Sans cette option, une vue s'exécute avec les droits de son propriétaire et
devient un contournement propre de la RLS — le journal entier serait lisible par
tout compte connecté. C'est le piège classique, et il est vérifié par exécution :
`.github/agent-tests/aflp-ia-journal-rls.mjs` §7 constate qu'un agent voit
1 question et un superviseur 2, sur la même vue.

---

## 7. Métriques locales, en mode hors ligne

`AFLP_IA_JOURNAL.metriquesLocales()` calcule les mêmes répartitions sur la **file
non encore synchronisée**. Elles servent à deux choses :

- vérifier que le dispositif tourne quand le réseau est absent ;
- estimer le retard de synchronisation (`enFile`).

Elles ne remplacent pas la vue : elles ne voient que ce qui n'est pas encore
parti.

---

## 8. Latence

Mesurée côté client, de la soumission de la question à l'affichage de la
réponse. Elle inclut donc le réseau et le rendu, pas seulement le calcul.

| Chemin | Ordre de grandeur attendu |
|---|---|
| Déterministe, données déjà chargées | quelques millisecondes |
| Couche linguistique active | délai réseau + modèle, plafonné à 6 000 ms côté client |

Un dépassement du délai n'est pas une erreur affichée : la couche linguistique
abandonne et le résultat déterministe est servi. La question est journalisée avec
`language_layer_used = false` et le motif dans la trace.

---

## 9. Coût et jetons

Quand la couche linguistique est active, `AFLP_IA_LANGUE.etat()` expose `tokens`
et `coutEstime`, cumulés sur la session de navigation, alimentés par le champ
`usage` renvoyé par la fonction Edge.

**Ce n'est pas une comptabilité.** Le compteur repart à zéro à chaque
rechargement, et la limitation de débit serveur vit en mémoire d'instance
(angle mort A-06). Le plafond de coût qui fait foi est celui du fournisseur.

---

## 10. Ce qu'aucune de ces mesures ne dira

- **Si un chiffre est juste.** Cela exige de recalculer à la main sur les données
  FBMS. C'est le rôle de la revue humaine, et de rien d'autre.
- **Si la question posée était la bonne.** Un Branch Manager peut poser une
  question précise et obtenir une réponse exacte à côté de son besoin réel.
- **Si le vocabulaire du terrain est couvert.** Le corpus de 188 formulations est
  écrit par l'auteur du moteur. Tant que les formulations réelles n'arrivent pas
  par le journal, « 188/188 » mesure la cohérence interne, pas la couverture
  (angle mort A-01).
