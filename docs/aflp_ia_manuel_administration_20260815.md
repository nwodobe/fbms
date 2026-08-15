# Assistant IA AFLP — manuel d'administration et politique de publication

**15 août 2026 · écran `terrain/aflp-ia-admin.html`**

---

## 1. Qui entre, et ce qui l'en empêche

L'écran est atteint depuis le Command Center BM, bouton **« Assistant IA · Admin »**
— visible pour les comptes de niveau `bm` uniquement.

**Deux verrous, et le second est le seul qui protège vraiment.**

| Verrou | Ce qu'il fait | Ce qu'il ne fait pas |
|---|---|---|
| `auth-gate.js` avec `data-module="admin"` | Masque l'écran à tout rôle hors niveau `bm` | **Ne protège aucune donnée.** La clé publique Supabase est en clair dans les pages : qui la lit peut interroger la base directement |
| Politiques RLS | Refusent côté serveur : lecture du journal complet, correction, publication | — |

Un bouton absent de cette page n'est pas une protection. Un `insert` refusé par
PostgreSQL en est une. C'est pourquoi l'écran **affiche le refus du serveur**
quand il survient, au lieu de le masquer.

### Ce que chaque rôle peut faire

| Rôle | Voir le journal | Corriger | Ajouter une formulation | Publier |
|---|:---:|:---:|:---:|:---:|
| Branch Manager | tout | oui | oui | **oui** |
| Assistant BM · Head of Field · Procurement | tout | oui | oui | non |
| Supervisor | tout (base) · **écran refusé** | oui (base) | oui (base) | non |
| Agent Recenseur | ses questions | non | non | non |
| Consultation uniquement | ses questions | non | non | non |

L'écart pour `Supervisor` est assumé : l'écran est plus restrictif que la base.
Un superviseur peut proposer une correction par l'API, pas par cette page.

---

## 2. Le workflow, et pourquoi il n'a pas de raccourci

```
Question enregistrée
   → Revue humaine
      → Correction proposée
         → Validation
            → Ajout au catalogue BROUILLON
               → Tests automatiques
                  → Publication d'une nouvelle version
```

> **Une question ne modifie JAMAIS le catalogue en production.**

Ce n'est pas une consigne d'usage : c'est une propriété de la base.
Le déclencheur `aflp_ia_form_fige` refuse toute modification d'une formulation
appartenant à une version publiée. Pour corriger, il **faut** ouvrir une nouvelle
version.

Sans cette contrainte, « corriger une formulation » et « publier une nouvelle
version » seraient le même geste — et la version journalisée avec chaque question
ne voudrait plus rien dire. « Pourquoi l'assistant a-t-il répondu cela le
12 mars ? » deviendrait sans réponse.

---

## 3. Revoir les questions

### Les filtres

| Filtre | Ce qu'il montre | Quand l'utiliser |
|---|---|---|
| **À revoir** (par défaut) | Non comprises, partielles, clarifications, erreurs | Revue quotidienne |
| Non comprises | Aucune intention reconnue | Trouver le vocabulaire manquant |
| Partiellement | Intention comprise, confiance basse | Trouver les formulations ambiguës |
| Clarification | L'assistant a demandé une précision | Vérifier que la demande était justifiée |
| Donnée absente | Intention comprise, donnée inexistante | Décider s'il faut collecter la donnée |
| Toutes | Tout le journal | Analyse ponctuelle |

Chaque ligne montre la question, un extrait de la réponse produite, l'intention
et la portée détectées, la confiance, et si la couche linguistique est
intervenue.

### Trois lectures utiles

- **Une même question revient et n'est jamais comprise** → il manque une
  formulation. C'est le cas le plus fréquent, et le plus simple à corriger.
- **Une intention concentre les confiances basses** → ses groupes de mots-clés
  sont trop étroits, ou ceux d'une intention voisine trop larges.
- **Beaucoup de clarifications sur la même intention** → deux intentions se
  disputent le même vocabulaire. Corriger une **exclusion**, pas ajouter un
  synonyme.

---

## 4. Corriger une interprétation

Bouton **Corriger** sur la ligne concernée.

| Champ | À renseigner quand |
|---|---|
| Intention correcte | L'assistant a compris autre chose, ou n'a rien compris |
| Portée correcte + identifiant | Le lieu était mal situé (`BEOUMI`, `GBEKE 1`…) |
| Période correcte | Jour, semaine ou campagne mal détectés |
| Commentaire de revue | **Toujours.** C'est ce qui rend la correction relisible dans six mois |
| *Ajouter comme formulation d'entraînement* | La question est bien formulée et devrait être reconnue |

Deux actions possibles :

- **Valider la correction** — enregistre une correction revue et nommée. Elle
  n'entre au catalogue publié qu'à la publication d'une nouvelle version.
- **Marquer hors périmètre** — la question ne relève pas de FBMS. **À faire
  systématiquement** : ces questions sortent alors du dénominateur des mesures.
  Sans ce tri, le taux de compréhension est sous-estimé (voir
  [`aflp_ia_metriques_20260815.md`](aflp_ia_metriques_20260815.md) §4).

### Ce qui est enregistré

Une ligne dans `aflp_ia_feedback`, avec `approval_status = 'en_attente'`,
l'auteur, la date. La validation ultérieure inscrit `reviewed_by = auth.uid()` :
**personne ne peut valider au nom d'un autre**, la base le refuse.

---

## 5. Gérer les versions du catalogue

### Ouvrir un brouillon

Numéro au format `1.1.0`, plus un **motif** — ce que la version corrige, et
pourquoi. Une version naît toujours en brouillon ; la base refuse d'en créer une
directement publiée.

| Nature du changement | Incrément |
|---|---|
| Ajout d'une formulation | mineur (`1.0.0` → `1.1.0`) |
| Ajout d'une intention | mineur |
| Changement de `code`, de fonction ou de portée | **majeur** (`2.0.0`) — l'historique n'est plus comparable |
| Correction d'exclusion | correctif (`1.0.1`) |

### Ajouter des formulations

Deux chemins :

- depuis la revue d'une question, en cochant *Ajouter comme formulation
  d'entraînement* ;
- directement, pour une formulation rédigée.

Les doublons sont refusés par la base : l'unicité porte sur la **forme
normalisée**, donc « Combien de RT à Béoumi ? » et « combien de rt a beoumi »
comptent pour une seule.

### Le contrôle avant publication — obligatoire

Bouton **« Rejouer le contrôle de reconnaissance »**.

Il rejoue la couche de compréhension sur **toutes les formulations actives du
brouillon** et signale celles qui partent vers une autre intention.

> **Publier sans ce contrôle, c'est parier.** Les intentions partagent leur
> vocabulaire : ajouter un synonyme à l'une détourne, en moyenne, les questions
> d'une autre. C'est le seul endroit où cela se voit avant la production.

En cas d'échec, l'écran nomme chaque formulation fautive, l'intention attendue et
celle obtenue.

### Publier

Réservé au Branch Manager. Une confirmation rappelle qu'une version publiée
**ne peut plus être modifiée**.

Après publication :

- ses intentions et formulations sont **figées** par déclencheur ;
- elle ne peut pas redevenir un brouillon — on **retire** et on publie une
  version suivante ;
- toute modification est inscrite dans `aflp_ia_audit`.

### Annuler une modification non publiée

Bouton **Annuler** sur une formulation d'un brouillon. Sur une version publiée,
la base refuse — et c'est très bien ainsi.

---

## 6. Désactiver une formulation problématique

Bouton **Désactiver**. La formulation reste dans l'histoire mais sort du corpus
actif. À employer quand une formulation capture des questions qui ne lui
appartiennent pas.

Sur une version publiée, la base refuse : ouvrir un brouillon, y recopier le
corpus sans la formulation fautive, contrôler, publier.

---

## 7. Historique des modifications

Section **Historique** : les soixante dernières écritures sur les intentions et
les formulations, avec date, table, opération et détail.

Cette table est en **écriture unique** : un déclencheur refuse tout `UPDATE` et
tout `DELETE`, et `INSERT` est révoqué à `authenticated`. Les lignes n'arrivent
que par le déclencheur d'audit. Un audit que l'on peut réécrire ne prouve rien.

---

## 8. Ce que l'écran ne fait pas, et ne fera pas

| Action | Pourquoi elle est absente |
|---|---|
| Modifier un achat, une avance, une réconciliation | L'assistant est en **lecture seule**. Aucune de ses fonctions n'écrit dans une table transactionnelle, et le banc de sécurité le vérifie par exécution |
| Créer ou autoriser une avance | Idem |
| Lever un blocage de refinancement | La règle « pas de réconciliation = pas de refinancement » est portée par le moteur, pas par cet écran |
| Valider une perte, sanctionner un RT | Hors périmètre d'un outil d'administration de vocabulaire |
| Changer un rôle ou un plafond | Se fait dans `shared/admin.html`, sous d'autres politiques |
| Supprimer une question du journal | `DELETE` est révoqué. La purge est une commande d'administration, exécutée en SQL, avec une durée de rétention configurable |

---

## 9. Si l'écran affiche « Le journal n'est pas installé »

La migration `docs/migrations/aflp_ia_journal_20260815.sql` n'a pas été
appliquée. Voir
[`aflp_ia_langue_apprentissage_20260815.md`](aflp_ia_langue_apprentissage_20260815.md) §11.1.

L'assistant continue de répondre normalement : seuls la journalisation et cet
écran sont hors service.
