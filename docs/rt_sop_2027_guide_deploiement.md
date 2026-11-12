# AFLP 2027 · Finalisation SOP RT · Dossier de mise en service

**État : branche de développement, PR #311 en brouillon. Aucune migration appliquée à Supabase production.**  
**Source de vérité :** SOP validé « Gestion des ressources confiées aux RT » et règles métier confirmées par le Branch Manager.

## Ce qui est implémenté sur la branche

| Domaine | Flux et preuve | Autorité |
|---|---|---|
| Demande de financement | BM demande une avance variable selon achats prévus, soldes et pièces | BM |
| Versement Wave | Référence unique et preuve d'un transfert réellement effectué | Finance |
| Accusé RT | Document signé du RT, photo ou PDF déposée par l'UH | UH |
| Comptabilisation | Inscription unique dans la table `avances`, uniquement après attestations Finance + RT | Finance |
| Achat RCN | Reçu et preuve de paiement; acceptation ou rejet historisés | UH |
| Restitution | Référence et preuve de restitution, montant déduit une fois | Finance |
| Situation hebdomadaire | Trois cartes : RCN, Wave, sacs vides/pleins; RT d'accord, réserve ou désaccord; signatures | RT + UH |
| BEV | RT remet les noix au prestataire, pièces RT/prestataire/UH, camion, sacs, poids, origine, destination | UH |
| Expédition | Contrôle serveur: pour la campagne réelle 2027, aucun départ VILLAGE sans BEV concordant | RPC et trigger |
| Réception/GRN | Vue relie BEV, expédition, ticket WMS et GRN réellement émis | Magasin/usine |
| Preuves | Objets dans bucket privé, liens courts de 60 secondes, RLS sur RT | Rôles habilités |

### Distinguer trois choses
1. **Un montant Wave annoncé** n'est pas un montant confirmé.
2. **Une image de signature manuscrite** est une attestation conservée et auditée ; ce n'est pas une signature électronique qualifiée au sens juridique.
3. **Un camion déchargé** n'a pas nécessairement un GRN officiel. Une différence BEV/GRN déclenche une investigation, sans déduction automatique imputée au RT.

## Comment ouvrir le module en test
Sur une publication de staging isolée, ouvrir `operations/rt-sop-console.html`. Depuis la Caisse existante, le lien « Gérer Wave, signatures et BEV » conduit au module. En l'absence de la migration, il affiche explicitement « Module non prêt » sans inventer de soldes.

Le RT peut signer sur papier, même sans smartphone. L'UH photographie et dépose la fiche. En ligne, il est également possible de recueillir deux signatures tracées volontairement sur écran (RT en présence de l'UH, puis UH). Une nouvelle version du bilan conserve l'ancienne version liée.

## Prérequis réels AVANT mise en production

1. **Créer et habiliter un véritable utilisateur Finance.** L'inventaire des profils actifs vérifié le 12/11/2026 ne comporte aucun compte ayant un rôle Finance. Sans ce compte, confirmation/validation des versements bloquées. Ne pas usurper le rôle Finance avec le BM.
2. **Tester les trois migrations dans un projet/une branche Supabase isolée** et vérifier la compatibilité avec les déclencheurs existants `achats`, `avances`, `field_shipments`, `field_stock_movements` et `wms_receptions`. Les simulations PostgreSQL du CI ne reproduisent pas l'intégralité du schéma Supabase existant.
3. **Tester la RLS réelle**, y compris comptes UH de clusters différents, Finance, BM, ZH, assistant UH et utilisateurs désactivés. Le bucket privé `rt-sop-evidence` doit rester non public.
4. **Contrôler la campagne** : les garde-fous de bypass sont destinés à `campaign_type='REAL'` et `year=2027`, non à la campagne de simulation.
5. **Revoir le BEV avec Logistique** : `origin_id` doit correspondre au village RT; le champ `document_ref` de l'expédition doit reprendre exactement le code BEV. Le déclencheur est volontairement bloquant, il peut interrompre les opérations si un ancien écran ne l'alimente pas.
6. **Valider WMS/GRN avec QFS et Logistique** et tester les réceptions directes, les cas de transit Bouaké, et les écarts de pesée. QFS reste autorité sanitaire.
7. **Tester hors connexion sur Android et iPhone** : les paiements/visas officiels ne sont PAS autorisés hors connexion, seule la préparation papier est prévue. Vérifier la transition au retour réseau.
8. **Former UH, ZH, Finance et BM**, documenter la garde des originaux, les délais d'archivage et l'accès aux preuves.
9. **Revue sécurité par Finance et SI** : données Wave et pièces signées sensibles; auditer les droits des RPC `SECURITY DEFINER` et des vues `security_invoker`.
10. **Plan de sauvegarde et de retour arrière** avant l'application des migrations. Les triggers nouveaux sont bloquants, ils doivent être désactivables via migration inverse autorisée et testée.

## Recette reproductible
GitHub Actions lance `.github/workflows/rt-sop-sql.yml`. Cette porte crée un PostgreSQL 17 sans données réelles et exécute:
- `tests/fixtures/rt-sop-pg-baseline.sql`
- `supabase/20261112180000_rt_sop_wave_finance.sql`
- `supabase/20261112181000_rt_sop_signed_bev_grn.sql`
- `supabase/20261112182000_rt_sop_real_campaign_guards.sql`
- `tests/fixtures/rt-sop-pg-tests.sql`

Scénarios fictifs: 300000 FCFA Wave confirmés, 200000 validés UH + 40000 en attente, 100000 FCFA restant à justifier, restitution 10000 => 90000 FCFA, idempotence, refus BM de confirmer comme Finance, blocage avances legacy sur campagne réelle, 200 kg BEV / 195 kg WMS/GRN => écart -5 kg et enquête, signatures RT réservées, isolation de la campagne de simulation.

Les tests statiques de l'interface et de la présence des protections sont exécutés dans Operations Suite PR. Ils ne remplacent pas un vrai test navigateur connecté à Supabase staging.

## Risques résiduels importants

- Aucun compte Finance actif dans FBMS production au 12/11/2026 : workflow Finance impraticable tant qu'un compte légitime n'existe pas.
- Aucune connexion API Wave Business officielle démontrée : confirmations faites après saisie humaine avec preuve, jamais en initiant un paiement.
- Aucun exercice bout-en-bout dans un projet Supabase staging réel ni test de sécurité cross-cluster authentifié : **NON TESTÉ**.
- Le stock RCN réel dépend du bon rattachement achat→lot→expédition existant. La référence BEV est maintenant obligatoire sur la campagne réelle; tous les parcours logistiques doivent être adaptés.
- La caisse principale affiche le ledger SOP nouveau mais conserve les vieux chiffres en « indicatif ».
- Le bilan signé en ligne conserve le contenu et le hash, mais un contrôle supplémentaire de réception des preuves est requis par Finance et UH.
- Les signatures sur tablette et photos des signatures ne prouvent pas à elles seules l'identité d'un signataire. L'UH atteste la présence du RT et conserve les originaux.
- Tous les flux financiers, signatures et expéditions sensibles exigent une connexion et des droits valides.

## Décision de sortie

**PR en brouillon, sans fusion ni migration en production**, tant que les prérequis ci-dessus ne sont pas clôturés.

Déploiement progressif conseillé : environnement de test → deux RT fictifs sur deux circuits logistiques → validation Finance/QFS/BM → campagne réelle sous surveillance.

*ANAGROCI · PJS GLOBAL · Known for Quality.*