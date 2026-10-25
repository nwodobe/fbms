# Démarrage de l'enrôlement direct · Béoumi, Brobo, Diabo

Version 1.0 · 25/10/2026 · Statut : **prêt à lancer, sous deux conditions** (§3). Aucun enrôlement n'a été réalisé ni saisi pour préparer ce document.

## 1. Constat (relu en base le 25/10/2026)

| Cluster | Zone | Villages actifs (statut Approuvé BM) | Producteurs en base | dont enrôlés directement | Origine des dossiers existants | Compte Unit Head actif |
|---|---|---:|---:|---:|---|---|
| Béoumi | Gbêkê 2 | 10 | 24 | **0** | auto-enrôlement RT du 27/08/2026 | **aucun** |
| Brobo | Gbêkê 1 | 9 | 14 | **0** | idem | **aucun** |
| Diabo | Gbêkê 2 | 12 | 18 | **0** | idem | **aucun** |
| *Pour comparaison* Botro / N'Djebonoua / Sakassou | | | 85 / 64 / 76 | 69 / 40 / 61 | enrôlement par l'agent | 1 chacun |

**Cause principale** : aucun compte terrain n'a de périmètre sur ces trois clusters. Seuls les deux Chefs de Zone (portée terrain globale) et le Branch Manager peuvent y enrôler. Ce n'est pas un défaut de l'application.

## 2. Ce qui a été vérifié (transaction annulée, aucune donnée conservée)

Test `tests/sql/regularisation_aflp/06_enrolement_direct_beoumi_brobo_diabo.sql`. Il simule la synchronisation hors ligne d'un enrôlement direct (`offline_sync_batch`, opération `FARMER_ENROLL`) avec les comptes réels :

| Cas | Attendu | Observé |
|---|---|---|
| E1 · Chef de Zone, village de Béoumi | accepté | SYNCED |
| E2 · Chef de Zone, village de Brobo | accepté | SYNCED |
| E3 · Chef de Zone, village de Diabo | accepté | SYNCED |
| E4 · Unit Head de Botro, village de Béoumi | refusé | NEEDS_REVIEW, « Village ou RT hors de votre périmètre » (42501), aucun producteur créé |
| E5 · consentement par le Chef de Zone, règle actuelle | refusé | REFUSÉ (correctif P0-1 non appliqué) |
| E6 · même consentement après P0-1 (dans la transaction) | accepté | ACCEPTÉ |

Les 31 villages ont des coordonnées, un rayon de 1 500 m et un préfixe de Farmer ID. La génération des identifiants est donc prête.

## 3. Conditions de démarrage

1. **Consentements** : sans le correctif P0-1, un Chef de Zone peut enrôler mais **ne peut pas enregistrer le consentement**. Le dossier reste alors incomplet. Décision attendue : autorisation écrite d'appliquer `supabase/PREPARE_20261025_consentements_roles_aflp_et_separation_taches.sql`.
2. **Qui enrôle** : deux options, à trancher par le Branch Manager.
   - **Option 1, immédiate** : les Chefs de Zone enrôlent eux-mêmes (Gbêkê 1 pour Brobo, Gbêkê 2 pour Béoumi et Diabo).
     - Limite : avec le correctif P1-1 (séparation des tâches), un Chef de Zone ne peut pas approuver un dossier qu'il a saisi. La vérification revient à l'autre Chef de Zone ou au Branch Manager.
   - **Option 2, recommandée pour la campagne** : créer un compte Unit Head ou Assistant Unit Head par cluster. Ce compte porte le périmètre `cluster = BEOUMI`, `BROBO` ou `DIABO`.
     - La création se fait dans `shared/admin.html`, par le Branch Manager. Un agent ne la fait pas.
     - Les codes à utiliser sont les codes cluster (`BEOUMI`, `BROBO`, `DIABO`), pas les libellés. Le compte N'Djebonoua porte `DJEBONOUA`, ce qui fonctionne parce que l'accès compare les codes.

## 4. Pilote : six clusters, deux parcours

| Parcours | Clusters | Dossiers | Où se suit le dossier |
|---|---|---:|---|
| **A · Enrôlement direct**, producteurs déjà enrôlés | Botro, N'Djebonoua, Sakassou | 15 (5 par cluster) | classeur, onglet `Pilote_30` |
| **B · Régularisation RT-producteur** | Béoumi, Brobo, Diabo | 15 (5 par cluster) | classeur, onglet `Pilote_30` + fichier 08 |
| **A · Enrôlement direct**, nouveaux producteurs | Béoumi, Brobo, Diabo | 15 créneaux (5 par cluster) | classeur, onglet `Enrolement_direct_15` |

Total pilote : 45 dossiers. Les six clusters ont chacun au moins 5 dossiers. Béoumi, Brobo et Diabo testent les deux parcours.

Villages proposés pour les nouveaux enrôlements (les deux meilleurs scores de recensement du cluster, modifiables par le Chef de Zone) :
- Béoumi : DIACOHOU (3), FARI M'BABO (2) ;
- Brobo : ALLOUKRO (3), SINANVESSOU (2) ;
- Diabo : ADIEKRO (3), KOUASSI-GOLIKRO (2).

Les créneaux sont vides : aucun nom, aucun identifiant. Le Farmer ID est reporté dans le classeur **après** sa création par FBMS.

## 5. Procédure d'enrôlement direct (agent présent chez le producteur)

1. **Avant la tournée, avec réseau** : se connecter avec son propre compte, faire « Préparer le terrain », attendre « Prêt pour le terrain ». Un téléphone par agent tant que les PR #262 et #264 ne sont pas publiées.
2. **Recherche préalable** : chercher le producteur par nom et téléphone.
   - S'il existe déjà, en particulier comme RT-producteur, **on ne crée pas de doublon** : on suit le parcours B.
3. **Identité** : pièce présentée, nom, prénoms, sexe, année de naissance, téléphone. En cas de doute, on n'enrôle pas et on note « Revoir ».
4. **Notice** : lecture de la notice AFLP-NOTICE-2026.1. Elle est **en attente de validation juridique** et s'utilise en pilote seulement.
5. **Consentement** : chaque périmètre est demandé séparément, puis on saisit Oui (tous), Partiel ou Non (refus). La date est celle du jour, jamais une autre.
6. **Parcelles** : une fiche par parcelle réelle, avec le bouton GPS au centre de la parcelle et une précision ≤ 15 m. Sinon, on réessaie.
   - Les coordonnées tapées à la main ne valent pas un point GPS.
7. **Production, Sustainability, inspection** : comme dans les fichiers 05 et 09. On répond « Non vérifié » pour ce qui n'a pas été contrôlé.
8. **Le soir** : synchroniser, contrôler le journal (0 en attente, 0 en échec), puis reporter le Farmer ID dans `Enrolement_direct_15`.
9. **Sous 48 h** : vérification par un superviseur qui n'a pas saisi le dossier.

## 6. Critères de démarrage et de réussite

| Critère | Cible |
|---|---|
| P0-1 appliqué (autorisation écrite) | avant le premier enrôlement |
| Compte(s) avec périmètre sur le cluster | avant le premier enrôlement |
| Nouveaux enrôlements par cluster | 5 |
| Doublons créés avec un RT-producteur existant | 0 |
| Enrôlés avec statut de consentement saisi | 100 % |
| Parcelles avec GPS ≤ 15 m | 100 % des parcelles relevées |
| Opérations hors ligne perdues | 0 |
