# AFLP Farmer Registry — Data Dictionary Phase 1

| Champ technique | Label UI | Type | Obligatoire | Source | Validation | Preuve | Confidentialité | Description |
|---|---|---:|:---:|---|---|---|---|---|
| `producteurs.id` | Technical ID | text | Oui | Client | Unique, immuable | SYSTEM | Interne | Clé technique des relations |
| `producteurs.code` | Farmer ID | text | Après sync | Serveur | Unique, trigger serveur | SYSTEM | Interne | Identifiant lisible |
| `producteurs.nom` | Nom | text | Oui | Déclaré | Non vide | DECLARED | Personnel | Nom principal |
| `producteurs.prenoms` | Prénoms | text | Non | Déclaré | Texte | DECLARED | Personnel | Prénoms structurés |
| `producteurs.sexe` | Sexe | text | Oui | Déclaré | M/F/OTHER/UNKNOWN | DECLARED | Personnel | Sexe déclaré |
| `producteurs.birth_year` | Année de naissance | integer | Conditionnel | Déclaré | 1900 à année courante | DECLARED | Personnel | Alternative à la tranche d’âge |
| `producteurs.age_band` | Tranche d’âge | text | Conditionnel | Déclaré | Liste contrôlée | DECLARED | Personnel | Utilisée si l’année est inconnue |
| `producteurs.telephone` | Téléphone principal | text | Oui | Déclaré | 10 chiffres CI | DECLARED | Personnel | Contact et contrôle doublon |
| `producteurs.telephone_alt` | Téléphone alternatif | text | Non | Déclaré | 10 chiffres CI | DECLARED | Personnel | Second contact |
| `producteurs.preferred_language` | Langue préférée | text | Non | Déclaré | Liste contrôlée | DECLARED | Personnel | Langue de communication |
| `producteurs.id_document_type` | Type de pièce | text | Non | Document | Liste contrôlée | DOCUMENTED | Sensible | Type sans numéro |
| `producteurs.id_document_number` | Compatibilité | text | Non | Système | Toujours remis à NULL | SYSTEM | Très sensible | Ne doit pas contenir de valeur persistée |
| `farmer_identity_documents.document_number` | Numéro de pièce | text | Non | Document | Historisé | DOCUMENTED | Très sensible | Numéro isolé de la table maître |
| `producteurs.village_id` | Village | text | Oui | Référentiel | FK logique villages | DOCUMENTED | Interne | Village AFLP |
| `producteurs.rt_id` | RT | text | Oui | Référentiel | RT du même village | DOCUMENTED | Interne | RT de rattachement |
| `producteurs.operational_status` | Statut opérationnel | text | Oui | Métier | Liste contrôlée | SYSTEM | Interne | Actif, inactif, suspendu ou revue |
| `producteurs.passport_stage` | Passport stage | text | Oui | Calcul serveur | Règles explicites | CALCULATED | Interne | INCOMPLETE à VERIFIED |
| `producteurs.passport_completion` | Completion | smallint | Oui | Calcul serveur | 0 à 100 | CALCULATED | Interne | Complétude documentaire |
| `producteurs.risk_profile` | Risk Profile | text | Oui | Calcul serveur | Règles explicites | CALCULATED | Restreint | Pas un score ESG |
| `producteurs.possible_duplicate` | Possible Duplicate | boolean | Oui | Contrôle | Confirmation requise | CALCULATED | Interne | Alerte de similarité |
| `producteurs.review_required` | Review Required | boolean | Oui | Métier | Motif explicite | SYSTEM | Interne | Revue managériale requise |
| `producteurs.record_version` | Record version | bigint | Oui | Serveur | Incrément métier | SYSTEM | Interne | Verrou optimiste et audit |
| `farmer_consents.status` | Consent status | text | Oui | Producteur | GRANTED/PARTIAL/REFUSED/WITHDRAWN | DECLARED | Très sensible | État du consentement |
| `farmer_consents.scopes` | Périmètres autorisés | jsonb | Oui | Producteur | Objet de 7 périmètres | DECLARED | Très sensible | Catégories de données autorisées |
| `farmer_consents.consent_at` | Date consentement | timestamptz | Oui | Agent | Pas de date future incohérente | DOCUMENTED | Très sensible | Date de recueil |
| `farmer_consents.agent_id` | Agent | uuid | Oui | Auth | `auth.uid()` | SYSTEM | Interne | Agent ayant recueilli le consentement |
| `farmer_consents.text_version` | Version du texte | text | Oui | Système | Non vide | SYSTEM | Interne | Version légale utilisée |
| `farmer_consents.method` | Mode | text | Oui | Agent | VERBAL/WRITTEN/DIGITAL/WITNESSED | DOCUMENTED | Interne | Mode de recueil |
| `farmer_consents.supersedes_id` | Consentement précédent | uuid | Non | Serveur | Historique | SYSTEM | Très sensible | Chaîne de remplacement |
