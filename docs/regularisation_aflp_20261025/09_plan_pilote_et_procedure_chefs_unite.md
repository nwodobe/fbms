# Pilote AFLP · 30 producteurs, six clusters · procédure des Chefs d'Unité

Version 1.0 · 25/10/2026 · Statut : **prêt à lancer après application du correctif P0-1** (enregistrement des consentements par les rôles terrain). Sans ce correctif, l'étape 3 ci-dessous est bloquée pour les Unit Heads et Zonal Heads.

> Préparation n'est pas certification. Le pilote vérifie que le parcours fonctionne avec de vrais producteurs ; il ne qualifie personne pour une certification.

## 1. Échantillon (tiré le 25/10/2026, registre `regularisation_aflp.pilote_20261025`)

Tirage reproductible (empreinte fixe), producteurs actifs sans doublon ni revue d'identité ouverte.

| Cluster | Strate | Dossiers | Villages | Profil |
|---|---|---:|---:|---|
| Botro | Enrôlement direct (octobre 2026) | 5 | 2 | superficie formulaire (M1), attestation BM |
| N'Djebonoua | Enrôlement direct | 5 | 1 | idem |
| Sakassou | Enrôlement direct | 5 | 1 | idem |
| Béoumi | RT-producteurs | 5 | 3 | 4 × G3, 1 × G4 (origine la moins sûre) |
| Brobo | RT-producteurs | 5 | 5 | 3 × G2 (activité mixte), 2 × G1 |
| Diabo | RT-producteurs | 5 | 5 | 2 × G1, 2 × G2, 1 × G3 |

Pourquoi deux strates : Béoumi, Brobo et Diabo n'ont **aucun** enrôlement direct à ce jour ; leurs seuls dossiers sont des RT-producteurs. Le pilote y teste donc aussi la régularisation des RT (fichier 08).
Limite : les enrôlements directs sont concentrés sur 1 à 2 villages par cluster ; l'échantillon ne représente pas la diversité géographique des clusters.

La liste nominative et la fiche de saisie sont dans le classeur remis au Branch Manager (`AFLP_2027_Pilote_30_et_RT_producteurs_104.xlsx`), non versé dans le dépôt.

## 2. Organisation

| Rôle | Pilote |
|---|---|
| Agent / Assistant Unit Head | visite, saisie dans FBMS le jour même |
| Chef d'Unité | prépare la tournée, contrôle chaque dossier sous 48 h, remplit le classeur |
| Chef de Zone | vérifie sur place 3 dossiers par cluster, approuve les passeports qu'il n'a pas saisis |
| Branch Manager | arbitrage des risques HIGH / REVIEW_REQUIRED, bilan de fin de pilote |

Durée : 2 semaines. Matériel : téléphone avec FBMS préparé (« Préparer le terrain » avec réseau), batterie de secours, notice imprimée, classeur.

## 3. Procédure Chef d'Unité, dossier par dossier

**Avant la tournée (au bureau, avec réseau)**
1. Ouvrir FBMS, « Préparer le terrain », attendre « Prêt pour le terrain ».
2. Ouvrir chaque fiche de la tournée une fois (elle est alors disponible hors ligne).
3. Vérifier le journal de synchronisation : 0 opération en échec.

**Chez le producteur**
1. **Identité** : pièce, nom, téléphone. Doute → on s'arrête, on note « Revoir ».
2. **Notice** : lecture de AFLP-NOTICE-2026.1 (interprète si besoin, à noter).
3. **Accords** : chaque question posée séparément. Saisir dans FBMS, onglet Consentements : périmètres réellement acceptés, méthode (VERBAL / WRITTEN / WITNESSED), date du jour. Si une feuille signée ou marquée de l'empreinte existe : photo jointe.
4. **Superficies** : marcher jusqu'à chaque parcelle, nom local, superficie déclarée, bouton GPS au centre (précision ≤ 15 m, sinon réessayer). Une fiche par parcelle réelle.
5. **Parcelle provisoire** : quand toutes les parcelles réelles sont saisies, passer « EXPLOITATION DÉCLARÉE · À VÉRIFIER » en INACTIVE (jamais supprimer).
6. **Production** : baseline production (surface productive, production précédente, prévision, arbres productifs), puis finaliser.
7. **Sustainability** : 25 questions, réponse selon ce qui est vu ou documenté ; « Non vérifié » si non contrôlé. Photos de preuve. Finaliser.
8. **Inspection** : type BASELINE_CHECK, position GPS de l'inspecteur, réponses observées, finaliser. Vérifier les actions correctives créées (responsable, échéance).
9. **RT-producteur** : remplir en plus la vérification du fichier 08 (plantation exploitée par lui ? récolte la sienne ?). Décision : reste producteur / désactiver avec motif / revoir.

**Le soir**
1. Retour réseau : laisser synchroniser, puis contrôler le journal (0 en attente, 0 en échec).
2. Si des opérations restent en attente alors que le réseau est bon : vérifier si un collègue a saisi sur ce téléphone. Depuis les correctifs (PR #264 pour le registre, PR #262 pour Field Buying, non encore publiés), ses saisies ne partent jamais sous votre compte ; il doit se reconnecter pour les envoyer. Tant que ces PR ne sont pas publiées : **un téléphone = un agent** pendant le pilote.
3. Remplir le classeur (une ligne par dossier).

**Sous 48 h** : contrôle de complétude ; transmission au Chef de Zone pour vérification.

## 4. Critères de réussite

| Critère | Cible |
|---|---|
| Dossiers finalisés sans erreur bloquante | ≥ 27 / 30 |
| Parcelles réelles avec GPS ≤ 15 m | 100 % des parcelles relevées |
| Parcelle provisoire restée ACTIVE à côté de parcelles réelles | 0 |
| Notice remise et consentement saisis le jour de la visite | 100 % des dossiers visités |
| Vérification par un tiers | 100 % des dossiers approuvés |
| Opérations hors ligne perdues | 0 |

Mesures relevées : temps par étape, échecs de synchronisation, questions incomprises, taux de « Non vérifié » par critère. Bilan au Branch Manager en fin de pilote, puis ajustement du questionnaire si nécessaire (version 2026.3).

## 5. Interdits

Saisir une visite, une réponse ou une inspection non réalisée ; antidater ; répondre à la place du producteur ; approuver un dossier qu'on a saisi ; supprimer un dossier ou une parcelle.
