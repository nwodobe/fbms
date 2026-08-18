# AFLP Farmer Registry — Architecture Phase 1

Date : 18 août 2026  
Version : 1.2.0

## Objet

La Phase 1 enrichit le module Producteurs existant sans créer une application parallèle. `producteurs` reste la table maître. `producteurs.id` est la clé technique immuable des relations ; `producteurs.code` est le Farmer ID lisible, unique et généré côté serveur.

## Composants

```text
fbms/index.html
  -> shared/uppercase.js
     -> shared/farmer-enrollment-phase1.js
     -> shared/farmer-registry-read-phase1.js
     -> shared/farmer-registry-privacy-phase1.js
  -> IndexedDB historique fbms_local_db / store producteurs
  -> Supabase producteurs
  -> Supabase farmer_consents
  -> Supabase farmer_identity_documents
  -> Supabase farmer_change_log
  -> farmer_passport_summary_v
```

L’extension réutilise le modal, le store IndexedDB, la synchronisation et les référentiels existants. Elle ne réécrit pas le monolithe.

## Enrôlement Phase 1

L’enrôlement conserve les contrôles historiques et ajoute :

- prénoms structurés ;
- année de naissance ou tranche d’âge ;
- téléphone alternatif ;
- langue préférée ;
- statut opérationnel ;
- RT obligatoire et cohérent avec le village ;
- consentement AFLP avec date, agent, méthode, version et périmètres ;
- détection de doublon non bloquante ;
- Passport Completion, maturité et Risk Profile.

## Identifiants

- `producteurs.id` : ID technique créé sur le terminal et conservé après synchronisation.
- `producteurs.code` : Farmer ID, par exemple `MLAN-0001`, attribué par un seul trigger serveur.
- Les repères `TMP-*` restent uniquement locaux.
- Le Farmer ID est immuable après attribution.

## Données sensibles

Le numéro de pièce n’est pas conservé dans `producteurs.data` ni dans IndexedDB. Il est enregistré dans `farmer_identity_documents`, sous RLS. Le champ de compatibilité `producteurs.id_document_number` reste présent mais est toujours remis à `NULL` par le serveur. Les journaux d’audit expurgent `id_document_number`, `pieceNum` et `document_number`.

Une seule preuve de pièce peut être `ACTIVE` par producteur. Le remplacement marque l’ancienne version `REPLACED`; le retrait la marque `WITHDRAWN`. Un même numéro peut être réactivé ultérieurement sans supprimer les événements antérieurs.

## Consentement et ordre des événements

`farmer_consents` est append-only. Toute évolution crée un nouvel événement lié au précédent par `supersedes_id`. Un consentement complet exige les sept périmètres : identité, agriculture, GPS, photos, formation, inspections et transactions.

Les tables `farmer_consents` et `farmer_identity_documents` possèdent un `event_order` monotone. Cet ordre serveur est l’autorité pour déterminer le dernier événement, même lorsque deux saisies partagent le même horodatage métier.

## Complétude Phase 1

- Identity : 30 points
- AFLP Assignment : 20 points
- Consentement complet : 15 points
- Parcelles : 15 points réservés à la Phase 2
- GPS : 10 points réservés à la Phase 2
- Production Baseline : 10 points réservés à la Phase 3

Un passeport `BASIC` atteint donc 65 %. Ce pourcentage mesure la complétude documentaire, jamais la performance Sustainability.

## Statuts séparés

- Opérationnel : `ACTIVE`, `INACTIVE`, `SUSPENDED`, `REVIEW_REQUIRED`
- Maturité : `INCOMPLETE`, `BASIC`, `MAPPED`, `BASELINE`, `VERIFIED`
- Risque : `NOT_ASSESSED`, `LOW`, `MEDIUM`, `HIGH`, `REVIEW_REQUIRED`
- Synchronisation locale : `pending`, `synced`, avec erreur locale conservée en cas d’échec

## Sécurité et non-régression

Les nouvelles tables ont la RLS activée. Le serveur contrôle le village, le RT, le Farmer ID, le consentement et les indicateurs calculés. Les profils historiques sans périmètre configuré conservent temporairement leur accès afin d’éviter un verrouillage accidentel. Aucune table existante ni aucun code producteur historique n’a été supprimé ou renuméroté.
