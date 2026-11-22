# Dictionnaire des indicateurs : Observatoire AFLP 2027

Implémentation de référence : `generateur/moteur.py` (version moteur 1.0.0). En cas d'écart entre ce document et le code,
le code fait foi et l'écart est un défaut à corriger.

## Règles communes

| Code | Règle |
|---|---|
| R1 | Seuls les champs de la campagne `REAL` courante comptent. Champs d'une campagne SIMULATION ou QA : exclus et listés « hors périmètre ». |
| R2 | Visite **retenue** = statut `VALIDE` + temporalité `NORMALE` + reçue par le serveur avant le gel. |
| R3 | Brouillon, SOUMIS, EN_VERIFICATION, CORRECTION_DEMANDEE, RETROSPECTIVE, INCOHERENTE : comptés à part, jamais dans les indicateurs. |
| R4 | Un champ compte **une fois par semaine** : parmi plusieurs visites retenues, on garde la plus récente (date d'observation, puis validation, puis réception). |
| R5 | Un arbre compte une fois par visite. Proportions calculées sur les **titulaires** seulement (règle des vues `pheno_v_*`). Réserves activées comptées à part ; une observation sur une réserve non activée est ignorée et signalée. |
| R6 | `PAS_VU`, arbre non retrouvé et valeur absente sortent du dénominateur. Jamais comptés `NON`. |
| R7 | Absence de donnée = `None` = « NON DISPONIBLE » ou « n/d ». Jamais 0. |
| R8 | Mode `DESIGNATION` : statut `SUIVI_ARBRES_DESIGNES`, nature « tendance descriptive du panel ». Aucune extrapolation au village ou au cluster, aucun palier. |
| R9 | Un pourcentage n'est affiché que si son dénominateur ≥ 10 arbres (`SEUIL_MIN_ARBRES_POURCENTAGE`). Sinon : « k/n (effectif faible) ». |
| R10 | Semaine ISO lundi 00:00 à dimanche 23:59:59, heure d'Abidjan (UTC+0). Rapport « PROVISOIRE » si le gel précède la clôture. |

## Famille A : couverture et qualité

| Indicateur | Objectif | Numérateur / dénominateur | Sources | Agrégation | Validation | Limites | Décision associée |
|---|---|---|---|---|---|---|---|
| Champs prévus | Référence d'installation | Plan déclaré le 17/11/2026 : 4 par cluster, 6 à N'Djébonoua et Diabo (28) | `config.CHAMPS_PREVUS` | cluster | BM | Paramètre, pas une mesure ; à confirmer par document approuvé | Calendrier d'installation |
| Champs actifs | Champs réellement suivis | `pheno_panels` statut ACTIF, campagne réelle, installés avant clôture | `pheno_panels` | cluster | ZH | Un champ installé le dimanche compte comme attendu | Supervision |
| Taux d'installation | Avancement du dispositif | champs actifs / champs prévus | idem | cluster | BM | | Renfort d'installation |
| Champs visités validés | Activité de la semaine | champs distincts avec ≥ 1 visite retenue (R2, R4) | `pheno_visites` | cluster | ZH | Une visite non synchronisée est inconnue du serveur | Relance des équipes |
| Couverture hebdomadaire | Part du dispositif observée | champs visités validés / champs actifs | idem | cluster | ZH | ≤ 100 % par construction (R4) | Supervision |
| Visites non réalisées | Trous de collecte | champs actifs − champs visités validés | idem | cluster | ZH | Inclut les visites faites mais non validées | Relance |
| En attente de validation | Goulot de validation | visites SOUMIS + EN_VERIFICATION de la semaine | `pheno_visites.statut` | cluster | ZH | | Validation |
| Validations > 72 h | Retard de validation | visites en attente dont `soumis_le` < gel − 72 h (toutes semaines) | `soumis_le` | cluster | ZH | | Escalade BM |
| Arbres observés | Base des proportions | titulaires avec une observation dans les visites retenues | `pheno_observations` | champ, cluster | UH | Plafonné à 10 par champ ; dépassement = anomalie | |
| Arbres non retrouvés | Fiabilité du marquage | observations `retrouve = false` | idem | cluster | UH | Jamais comptés négatifs | Remarquage, réserve |
| Photos | Preuve | photos présentes / arbres retrouvés ; exceptions documentées à part | `photo_ref`, `photo_exception` | cluster | ZH | Présence de référence, pas contrôle du fichier | Rappel protocole |
| Reçues > 48 h | Retard de synchronisation | visites dont `recu_serveur_le − saisie_le` > 48 h | `pheno_visites` | cluster | ZH | | Synchronisation |
| Reçues après clôture | Tardiveté | visites de la semaine reçues après dimanche 23:59 mais avant le gel | idem | cluster | BM | Incluses, mais signalées | |
| Doublons écartés | Double comptage évité | visites retenues non gardées par R4 | idem | cluster | ZH | | Formation |
| Rétrospectives / incohérentes | Saisies après coup | temporalité ≠ NORMALE | `temporalite` | cluster | ZH | Hors indicateurs principaux | Contrôle |
| Corrections en attente | Données contestées | `pheno_corrections` statut PROPOSEE | idem | cluster | ZH | | Arbitrage |

## Famille B : progression agronomique (titulaires observés, visites retenues)

| Indicateur | Définition | Formule | Agrégation | Limites | Décision |
|---|---|---|---|---|---|
| Floraison | Arbre portant des fleurs le jour de la visite | `f = OUI` / (`f = OUI` + `f = NON`) | champ ; cluster = ratio poolé des comptes | Descriptif du panel (R8) ; R9 | Observation seulement |
| Nouaison | Jeunes noix présentes | idem sur `n` | idem | idem | Préparer l'intensification du suivi |
| Pommes | Pommes formées | idem sur `p` | idem | idem | Préalerte logistique à vérifier |
| Maturité vue agent (cumul) | Arbres titulaires ayant eu au moins une chute de fruits mûrs vue par l'agent depuis le début de campagne | arbres distincts `chute = MURE` et preuve ≠ DECLAREE_PRODUCTEUR | cluster | Un arbre compte une fois par campagne | Signal à vérifier |
| Maturité déclarée producteur | idem, déclaration du producteur seulement | arbres distincts `chute = MURE`, preuve DECLAREE_PRODUCTEUR, non vus par l'agent | cluster | Jamais additionnée à la précédente | Recoupement |
| Chutes prématurées | Risque agronomique | arbres `chute = PREMATUREE` | cluster | Jamais comptées en maturité | Investigation |
| Évolution | Variation d'une semaine à l'autre | différence en points des proportions | cluster | Seulement si les deux semaines sont valides **et** portent sur les mêmes champs (panel apparié) | |
| Palier expérimental 10/20/30 % | Préalerte du protocole v0.9 | non calculé en mode DESIGNATION | cluster | **Jamais une autorisation de dépense** | |

## Niveau de confiance par cluster

| Niveau | Condition |
|---|---|
| INSUFFISANTE | aucun champ visité validé |
| FAIBLE | couverture < 50 % ou installation < 50 % du plan |
| MOYENNE | couverture ≥ 50 % et installation ≥ 50 % |
| BONNE | couverture ≥ 75 %, installation ≥ 75 %, aucune validation bloquée > 72 h |

## Classification des recommandations

`OBSERVATION` · `SIGNAL_A_VERIFIER` · `PROPOSITION_OPERATIONNELLE` (avec sources, responsable, coût connu ou « INCONNU »,
conditions d'approbation, échéance). Règles dans `generateur/recommandations.py`. Aucune action n'est exécutée.
Garde-fou : aucune recommandation financière chiffrée tant que les achats (lots, BEV) et les fonds disponibles ne sont pas sourcés.
