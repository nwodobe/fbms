# Protocole papier de secours — AFLP 2027

Date : 14 août 2026 · Migration 09

Document destiné aux équipes terrain. Il se lit sans connaissance technique.

## 1. Quand utiliser le papier

Le formulaire de secours s'utilise **uniquement** quand la saisie dans FBMS est
matériellement impossible :

- téléphone en panne, perdu, volé, ou batterie épuisée sans recharge possible ;
- application inaccessible ou bloquée ;
- rupture prolongée de réseau **et** file locale saturée.

> Une simple absence de réseau **ne justifie pas** le papier : FBMS fonctionne
> hors ligne et synchronise ensuite. Le papier est le dernier recours, pas la
> commodité du jour de pluie.

**Le papier ne dispense d'aucune règle.** Un achat sur papier reste soumis au
plafond, au financement disponible et à l'unicité du reçu. Il sera refusé à la
saisie si ces règles ne sont pas respectées — et il vaut mieux le savoir sur le
terrain que trois jours plus tard.

## 2. Qui autorise

| Décision | Qui |
|---|---|
| Créer une série de numéros | Branch Manager, **lui seul** |
| Attribuer une plage à un responsable | Branch Manager, Assistant BM, Head of Field, Procurement Officer, Supervisor |
| Utiliser un formulaire | Le responsable à qui la plage est attribuée |
| Déclarer un numéro annulé, perdu ou restitué | Un rôle de contrôle |
| Clôturer la journée | Un rôle de contrôle |

## 3. Attribution des numéros

Le numéro suit le format :

```
AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}
exemple : AFLP-AFLP2027-BOU-RT12-000042
```

Le format est **configurable** (paramètre `format_numero_papier`) : le programme
peut l'adapter sans toucher au code.

**Chaque numéro de la plage existe en base dès la création de la série.** C'est
ce qui permet de constater qu'un numéro *manque* : un numéro qui n'existerait
nulle part ne pourrait jamais être déclaré absent.

```sql
-- 1. Le BM crée la série (ici les numéros 1 à 200 pour le RT du cluster BOUAKE)
select public.n1_papier_creer_serie('BOUAKE', '<uuid du RT>', 1, 200);

-- 2. Un rôle de contrôle attribue la plage, en nommant qui la reçoit
select public.n1_papier_attribuer('<uuid de la série>', '<uuid du responsable>',
                                  'KOUAME Yao, chef d''équipe');
```

Tant qu'une plage n'est pas attribuée, ses numéros sont `DISPONIBLE` et **ne
peuvent justifier aucune opération**.

## 4. Sur le terrain

1. Remplir le formulaire **dans l'ordre des numéros**. Ne jamais sauter un
   numéro pour « garder » celui d'après.
2. Reporter sur le formulaire : date, producteur, poids brut, tare, poids net,
   prix au kilo, montant, numéro du reçu remis au producteur.
3. Faire signer le producteur.
4. Conserver la souche.

Si un formulaire est gâché — rature, erreur, papier mouillé — **il n'est pas
jeté** : il est déclaré annulé avec sa justification (§6).

## 5. Saisie ultérieure dans FBMS

Dès que l'application redevient utilisable, et **au plus tard à la clôture du
jour suivant** :

1. Saisir l'achat normalement dans FBMS.
2. Rapprocher immédiatement le formulaire papier :

```sql
select public.n1_papier_consommer('AFLP-AFLP2027-BOU-RT12-000042', 'achats', '<uuid de l''achat>');
```

L'opération est alors marquée `source_saisie = 'PAPIER_SECOURS'`, et la référence
papier est conservée **dans la transaction elle-même**.

Le système refuse :

- un numéro **inconnu du registre** — un formulaire hors registre ne justifie rien ;
- un numéro **non attribué** ;
- un numéro **déjà utilisé** — un formulaire ne justifie qu'une seule opération ;
- un numéro **annulé ou perdu**.

## 6. Formulaires perdus, annulés ou endommagés

Un numéro qui sort du circuit **sans avoir servi doit être justifié**. C'est la
seule façon de distinguer un carnet mouillé d'un achat non déclaré.

```sql
select public.n1_papier_declarer('AFLP-AFLP2027-BOU-RT12-000043', 'ANNULE',
       'Formulaire raturé lors de la pesée, remplacé par le 000044');

select public.n1_papier_declarer('AFLP-AFLP2027-BOU-RT12-000045', 'PERDU',
       'Formulaire égaré entre le village de X et le hub, recherche effectuée le 14/08');

select public.n1_papier_declarer('AFLP-AFLP2027-BOU-RT12-000046', 'RESTITUE',
       'Carnet rendu inutilisé au magasin en fin de campagne');
```

Une déclaration **sans justification est refusée**. Une perte déclarée lève
automatiquement une anomalie `PAPIER_MANQUANT` de criticité P1.

## 7. Clôture quotidienne

À faire chaque soir, par cluster :

```sql
select public.n1_papier_cloture_quotidienne('BOUAKE');
```

La clôture :

1. marque comme clôturés les numéros utilisés dans la journée ;
2. **signale tout numéro sauté** — c'est-à-dire un numéro encore attribué alors
   que des numéros antérieurs **et** postérieurs de la même série ont servi. Un
   tel trou est exactement ce qu'on cherche : soit le formulaire a été utilisé
   sans être saisi, soit il a disparu.

Chaque trou lève une anomalie P1 à traiter.

## 8. Registre imprimable

```sql
select * from public.n1_vue_registre_papier
where cluster = 'BOUAKE' and campagne = 'AFLP2027'
order by serie_code, numero_lisible;
```

Le registre indique pour chaque numéro : sa série, son état, la date
d'utilisation, l'opération qu'il justifie, et la justification s'il est sorti du
circuit.

## 9. Ce sur quoi l'intégrité repose — et ne repose pas

L'intégrité repose sur l'identifiant technique de la ligne et sur les contraintes
d'unicité de la base. **Elle ne repose jamais sur la lisibilité du numéro
imprimé** : un numéro effacé, mal recopié ou ambigu ne casse pas le registre, il
produit une anomalie à traiter.

## 10. Résumé pour affichage terrain

| Situation | Ce qu'on fait |
|---|---|
| Pas de réseau | On continue dans FBMS — il fonctionne hors ligne |
| Téléphone en panne | On passe au carnet de secours attribué |
| Formulaire gâché | On le déclare annulé, on ne le jette pas |
| Formulaire perdu | On le déclare perdu, avec ce qu'on sait |
| Retour au réseau | On saisit dans FBMS **et** on rapproche le numéro papier |
| Fin de journée | Clôture du registre par le responsable |
| Fin de campagne | Les carnets inutilisés sont déclarés restitués |
