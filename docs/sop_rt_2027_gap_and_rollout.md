# AFLP 2027 · Alignement FBMS et SOP RT

**Statut :** correctif de lecture prudent, sur branche uniquement. **Non prêt pour production.**  
**Référence :** SOP-AFLP-RT-001, « Gestion des ressources confiées aux RT » (document fourni), et audit du 12 novembre 2026.  
**Dépôt :** `nwodobe/fbms`, base de travail du 11 novembre 2026.

## Constat vérifié

- `operations/field-buying.js` affichait les avances de `avances` comme « avancées » et les achats `achats` sans distinguer `statut_validation` de `validated_at`.
- `terrain/cash.html` expose une réconciliation estimative qui ne représente pas encore la confirmation Wave/RT, les dépenses vérifiées et les restitutions.
- `avances` n'a pas de colonnes de référence Wave vérifiée, confirmation Finance ou accusé RT. Ne pas inférer un versement effectif d'une ligne insérée.
- `reconciliations` ne contient pas les visas RT/UH et la gestion d'un désaccord.
- `field_shipments` possède des champs transport, mais l'obligation d'un BEV signé reste à démontrer.
- `sacherie_ct_rt_stock` calcule déjà sacs vides et pleins. Ne pas créer un second compte sacherie.
- Le contrôle serveur `fb_prevent_achat_over_advance` additionne les achats et avances, mais son comportement sous concurrence nécessite une épreuve avec deux écritures simultanées. Aucun test de charge n'a été effectué sur la production.

## Modifications présentes dans cette branche

1. `shared/rt-sop-ledger.js` : fonctions pures de calcul, sans écriture ou validation métier.
2. `operations/field-buying.js` : sélection des champs de validation achat existants, indicateurs de preuve et avertissement explicite sur les soldes historiques non confirmés.
3. `operations/field-buying.html` : chargement du calculateur avant le module Field Buying.
4. `tests/rt-sop-ledger.mjs` et `tests/rt-sop-integration-static.mjs` : simulations et assertions.

**Important :** les avances historiques ne possèdent pas encore les champs de confirmation souhaités. Le calculateur signale donc un montant à justifier **indéterminé**. L'écran n'affiche pas de déchargement définitif en l'absence de preuves. Cette approche est volontairement conservatrice.

## Corrections structurantes à réaliser en staging

| Priorité | Écart | Évolution proposée | Test de recette |
|---|---|---|---|
| P0 | Demande vs avance payée | Ajouter un cycle de demande / autorisation / confirmation Finance / accusé RT, avec référence Wave unique et preuve protégée | Demande sans confirmation ne crée pas un crédit |
| P0 | Achat enregistré vs accepté UH | Circuit d'approbation UH côté serveur et statut immuable avec historique | Reçu sans preuve = en attente |
| P0 | Restitution | Écriture financière de retour avec justificatif et validation Finance | 300 000 - 200 000 - 10 000 = 90 000 FCFA à justifier |
| P0 | Rapprochement signé | PDF numéroté, RT en accord / réserve / désaccord, signatures manuscrites scannées, contre-signature UH et revue ZH | Correction après signature conserve l'original et ouvre une nouvelle version |
| P0 | Concours d'achats | Verrou ou atomisation des contrôles de disponible sur la même identité RT/campagne | 2 achats simultanés ne peuvent dépasser le disponible |
| P0 | Sécurité | Tester droits réellement accordés et politiques RLS / RPC, y compris vues `security_invoker` | Assistant UH ne valide pas une dépense et n'accède pas aux autres clusters |
| P1 | RCN / BEV | Formaliser remise signée au prestataire avant passage EN_TRANSIT | 300 kg achetés - 200 kg BEV = 100 kg sous garde RT |
| P1 | GRN | Réconciliation BEV vs GRN sans imputation automatique | 200 vs 195 kg = 5 kg à expliquer |
| P1 | Sacherie | Afficher tous les types de mouvements du registre canonique dans la carte RT | 100 reçus, 25 utilisés, 15 sortis = 75 vides + 10 pleins |
| P1 | Pilotage | Indicateurs par RT, cluster et campagne avec lien vers preuve | Inconnu affiché « non vérifié », pas zéro |

## Schéma cible (proposition, non appliquée)

Avant d'ajouter de nouvelles tables, vérifier si le dépôt dispose d'un modèle de demandes de financement utilisable. À défaut, préférer des écritures événementielles append-only aux modifications silencieuses :

- `rt_funding_requests` : RT, campagne, montant demandé, prévision d'achat, demandeur BM, statut et dates.
- `rt_funding_events` : demande, type d'événement (CONFIRM_FINANCE, ACK_RT, CASH_WITHDRAWAL, REFUND_CONFIRMED), référence unique, document et acteur.
- `rt_purchase_reviews` : achat, décision UH, signature logique, date, motif et historique.
- `rt_weekly_reconciliation` : campagne, RT, période, **snapshot figé**, états des trois cartes, bilan des écarts, accord/réserve/désaccord, preuves de signatures et versions.
- `rt_audit_events` : identité, changement, motif, horodatage, référence originale; corrections par événements compensateurs.

Toute table exposée doit avoir des règles RLS restrictives et testées. Privilégier les vues `security_invoker` et les RPC contrôlées avec `auth.uid()`. Les données financières et preuves signées doivent être privées.

Aucune migration SQL n'est fournie comme « prête à déployer » sans validation du modèle, environnement de test et recette RLS.

## Statut honnête des simulations

- **Tests de calculs unitaires synthétiques** : exécutés localement pour les scénarios Wave, validation UH, restitution, stock RCN et sacherie.
- **Tests d'intégration navigation** : assertions statiques proposées. Le code d'origine sur cette branche doit être contrôlé par CI.
- **Flux Wave réel, signature RT, BEV, GRN, synchronisation Android et concurrence Supabase** : **NON TESTÉS**.
- Aucun versement Wave, aucun droit et aucune ligne de production n'ont été modifiés.

## Critères de sortie avant déploiement

1. Tous les mouvements ont un identifiant unique par campagne et une preuve accessible aux seuls rôles autorisés.
2. Le solde à justifier est distinct du disponible Wave/espèces et n'est pas calculé comme « officiel » sur des données non vérifiées.
3. Chaque semaine RT et UH peuvent signer un rapprochement immuable, avec réserve possible.
4. BEV signé = sortie de garde RT / entrée transit, puis GRN = réception rapprochée.
5. Tous les contrôles concurrentiels, hors connexion et permissions RLS passent sur staging.
6. QFS, Finance et Branch Manager valident les domaines de leur compétence.
7. La fusion et le déploiement production nécessitent une autorisation explicite distincte.

**Documentation utile :** https://supabase.com/docs/guides/database/postgres/row-level-security
