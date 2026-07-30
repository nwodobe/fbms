# LBA Control — Modèle de sécurité

Le principe unique dont tout le reste découle : **le navigateur n'est jamais une autorité.**
Il ne détient aucun secret, ne décide d'aucune permission, et sa version des faits n'engage rien tant que le
serveur ne l'a pas acceptée. Chaque contrôle décrit ici existe **en base** ; l'interface les double pour le
confort, jamais pour la protection.

---

## 1. Surfaces et menaces prises au sérieux

| Menace | Contre-mesure structurelle |
| --- | --- |
| Un client lit les données d'un autre client | RLS `tenant_id = app.current_tenant_id()` sur 100 % des tables métier + tests d'isolation |
| Un pisteur voit la marge du LBA ou les opérations d'un collègue | Politiques `SELECT` restreintes par `app.is_agent_owner()` ; les tables de marge/TCB sont hors de sa portée |
| Une société partenaire voit sa concurrente | Cloisonnement par `partner_company_id` + portail externe désactivé au MVP |
| Un client suspendu continue d'écrire via l'API | `app.tenant_can_write()` évalué dans **chaque** politique `INSERT`/`UPDATE` |
| Un utilisateur efface une transaction gênante | Aucune suppression physique : politiques `DELETE` restrictives `USING (false)` |
| Un utilisateur maquille l'historique | `audit_log` sans politique `UPDATE` ni `DELETE`, alimenté par triggers, horloge serveur |
| Une capture d'écran active un abonnement | Seule une fonction `SECURITY DEFINER` réservée au super-admin confirme un paiement |
| Un super-admin fouille les données d'un client | Aucun accès par défaut ; session d'assistance motivée, expirable et auditée |
| Vol de clé côté client | Aucune clé `service_role` dans le bundle ; seule la clé publiable est exposée |
| Rejeu de synchronisation hors ligne | Idempotence par UUID d'appareil + `ON CONFLICT DO NOTHING` |

---

## 2. Identité, session et authentification

- **Supabase Auth**, un compte par personne physique. Le partage de compte est détectable par
  `user_devices` (appareils distincts, sessions concurrentes anormales).
- Le JWT porte, dans `app_metadata` (**non modifiable par l'utilisateur**) : `tenant_id`, `role`.
  Ce point est décisif : si ces valeurs étaient dans `user_metadata`, un utilisateur pourrait s'auto-promouvoir.
- **Mots de passe robustes** : longueur minimale 12, vérification côté client (Zod) et politique Supabase.
- **Limitation des tentatives** : `failed_login_count` + `locked_until` sur `users`, verrouillage temporaire
  progressif.
- **Sessions expirables**, rafraîchissement court, révocation d'appareil (`user_devices.revoked_at`).
- **MFA préparé** pour les administrateurs : `users.mfa_enrolled_at`, exigence par rôle documentée et
  activable via Supabase Auth — non forcée au MVP, conformément à la commande (« MFA préparé »).

---

## 3. Rôles et séparation des tâches

| Rôle | Lecture | Écriture | Interdits structurels |
| --- | --- | --- | --- |
| `super_admin` | Plateforme, abonnements, paiements | Tenants, plans, confirmations, suspensions | **Aucune donnée métier** hors session d'assistance active |
| `proprietaire` | Tout son tenant | Validations sensibles, paramètres | Ne peut pas supprimer une écriture clôturée |
| `gestionnaire` | Tout son tenant | Financements, avances, achats, transferts, réceptions, dépenses | Aucun paramètre plateforme, aucune modification d'abonnement |
| `comptable` | Finances, dépenses, TCB, rapports | Paiements, commissions, dépenses | **Ne modifie pas les poids physiques** |
| `responsable_terrain` | Pisteurs, achats, stocks, livraisons | Opérations terrain | Pas d'accès aux marges consolidées |
| `pisteur` | **Ses seules** avances, achats, stocks, livraisons, sacs, alertes | Ses achats et dépenses autorisées | Ne voit ni la marge du LBA ni les opérations des autres pisteurs |
| `auditeur` | Tout en lecture + journal d'audit | **Rien** | Aucune création, aucune modification |
| `magasinier`¹, `logistique`¹, `partenaire_externe`¹ | Périmètre restreint | Restreint | ¹ Politiques écrites et testées, rôle non attribuable au MVP |

**Séparation des tâches** (CDC §5, DCP §3.1), appliquée par contrainte serveur :

1. Le créateur d'une avance ne peut pas être son approbateur (`created_by <> approved_by`).
2. Une dépense saisie par son bénéficiaire exige une validation par un autre utilisateur.
3. Une correction de poids après clôture exige demande + motif + approbateur distinct.
4. Une réaffectation inter-sociétés exige motif + approbateur.
5. Une suspension d'abonnement conserve auteur, date, motif et notification.

---

## 4. Row Level Security

**RLS est activée sur toutes les tables exposées, sans exception**, et chacune possède les quatre politiques
demandées (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).

### Forme canonique d'une table métier

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <t>_select ON public.<t> FOR SELECT TO authenticated
  USING (app.can_read_tenant(tenant_id) AND <restriction de rôle>);

CREATE POLICY <t>_insert ON public.<t> FOR INSERT TO authenticated
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND app.tenant_can_write()
              AND app.current_role() = ANY (ARRAY[...]));

CREATE POLICY <t>_update ON public.<t> FOR UPDATE TO authenticated
  USING (tenant_id = app.current_tenant_id() AND app.tenant_can_write() AND <rôle>)
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY <t>_delete ON public.<t> FOR DELETE TO authenticated
  USING (false);          -- transactions métier : jamais de suppression physique
```

### Pourquoi `FORCE ROW LEVEL SECURITY` n'est pas activé

`FORCE` étend RLS au propriétaire des tables. Il n'est volontairement pas utilisé, et c'est un choix
qu'il faut assumer explicitement :

- Les rôles d'exécution (`anon`, `authenticated`) **ne sont jamais propriétaires**. RLS s'applique donc
  intégralement à tout ce qui arrive par l'API — c'est-à-dire à 100 % du trafic applicatif.
- Les fonctions `SECURITY DEFINER` s'exécutent avec les droits du propriétaire et **doivent** pouvoir
  écrire. C'est précisément ce qui permet d'avoir un journal d'audit qu'aucun utilisateur ne peut
  alimenter directement : le trigger écrit, l'utilisateur non. Avec `FORCE`, le trigger serait bloqué
  par sa propre politique `INSERT … WITH CHECK (false)` et l'audit deviendrait impossible.

Le risque résiduel est donc l'accès direct à la base avec le rôle propriétaire — un accès de niveau
administrateur d'infrastructure, qui relève des contrôles d'accès Supabase et non de RLS.

### Pourquoi `DELETE … USING (false)`

La commande demande deux choses qui paraissent contradictoires : créer des politiques pour `DELETE`
(§3) et interdire toute suppression physique des transactions métier (§3). Les deux sont respectées à la
lettre : **la politique existe, elle est testée, et elle refuse**. L'annulation métier passe par
`status = 'annule'` + `cancelled_at` + `cancelled_by` + `cancellation_reason` + entrée d'audit.

Les tables de **référentiel** (zones, localités, transporteurs, véhicules…) autorisent `DELETE` aux rôles
d'administration tant qu'aucune transaction ne les référence — c'est du nettoyage de paramétrage, pas de la
destruction de preuve.

### Cloisonnement du pisteur

```sql
USING (
  tenant_id = app.current_tenant_id()
  AND (app.current_role() <> 'pisteur' OR app.is_agent_owner(field_agent_id))
)
```

Les tables `tcb_snapshots`, `margin*`, `expense_allocations` consolidées et les vues de marge globale
n'accordent **aucune** politique `SELECT` au rôle `pisteur`.

### Accès du super-administrateur

```sql
app.can_read_tenant(t) :=
     t = app.current_tenant_id()
  OR (app.is_platform_admin() AND app.has_support_access(t));
```

`has_support_access` exige une ligne `platform_support_sessions` **active, motivée et non expirée**. Ouvrir
une session est elle-même une action auditée. Hors session, un super-admin qui interroge une table métier
reçoit zéro ligne — ce n'est pas une convention d'interface, c'est le comportement de la base.

### Verrou de l'abonnement

```sql
app.tenant_can_write() := subscription.status IN ('trial','active','grace_period','pending_payment')
```

`suspended_read_only`, `suspended`, `expired`, `cancelled` ⇒ **aucune écriture**, en base, quel que soit le
chemin d'accès. La lecture et les exports restent autorisés en `suspended_read_only` : le non-paiement bloque
la saisie avant de bloquer l'accès aux données (DMQ §1.3, CDC §20.4).

---

## 5. Opérations privilégiées

Aucune n'est réalisable depuis le navigateur avec les droits de l'utilisateur :

| Opération | Mécanisme |
| --- | --- |
| Créer un tenant, inviter son administrateur | Edge Function + `SECURITY DEFINER` |
| Confirmer un paiement d'abonnement | `app.confirm_subscription_payment()` — super-admin uniquement, idempotente |
| Suspendre / réactiver un tenant | `SECURITY DEFINER` + audit obligatoire |
| Ouvrir une session d'assistance | `SECURITY DEFINER`, motif obligatoire, expiration obligatoire |
| Réserver du stock | `app.reserve_stock()` — transactionnelle, verrou de ligne |
| Recalculer un score | Fonction serveur versionnée |

Toutes fixent `search_path = pg_catalog, app, public` — sans quoi un objet homonyme créé dans un schéma
utilisateur pourrait détourner l'exécution avec les droits du propriétaire.

---

## 6. Validation des entrées

- **Zod côté client et côté serveur** : les schémas de `src/domain/schemas` sont partagés entre les
  formulaires React Hook Form et les Edge Functions. Une même règle, une seule définition.
- **Contraintes SQL en dernier rempart** : `CHECK`, `NOT NULL`, `FOREIGN KEY`, `EXCLUDE`, unicité.
  Une règle qui protège de l'argent existe toujours au niveau base, même si elle est déjà côté client.
- **XSS** : React échappe par défaut ; `dangerouslySetInnerHTML` est proscrit. En-têtes CSP au déploiement.
- **CSRF** : authentification par jeton `Authorization: Bearer`, pas de cookie de session ambiant.
- **Injection SQL** : requêtes paramétrées via supabase-js ; aucune concaténation de SQL côté client.

---

## 7. Fichiers et stockage

| Contrôle | Valeur |
| --- | --- |
| Buckets | **Privés**, un par usage (`proofs`, `tickets`, `branding`) |
| Accès | URLs signées de courte durée uniquement — aucune URL publique |
| Types autorisés | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (contrôle MIME **et** extension) |
| Taille | 5 Mo par fichier (2 Mo après compression pour les photos terrain) |
| Compression | Redimensionnement et recompression côté client avant mise en file hors ligne |
| Chemins | Préfixés par `tenant_id/` ; politiques Storage alignées sur les politiques RLS |
| Journalisation | Tout export sensible génère une entrée `audit_log` (`sensitive_export`) |

---

## 8. Secrets et dépôt

- `.env.example` versionné, **sans aucun secret**, uniquement des noms de variables.
- `.env`, `.env.local` ignorés par git.
- Seules `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` sont exposées au bundle — par construction
  publiques et sans pouvoir propre, puisque tout est protégé par RLS.
- La clé `service_role` n'existe **que** dans l'environnement serveur (Edge Functions, CI). Elle n'apparaît
  dans aucun fichier versionné et n'est jamais préfixée `VITE_`.
- Un test automatisé échoue si un fichier suivi contient un motif de clé de service ou un JWT.

---

## 9. Audit

Journalisés obligatoirement (CMD §22) : connexion, création, modification, annulation, validation, changement
de société, changement de poids, changement de prix, changement de montant, changement de statut,
confirmation de paiement, suspension, réactivation, export sensible.

Chaque entrée porte : tenant, utilisateur, appareil, action, table, enregistrement, ancienne valeur, nouvelle
valeur, **date serveur**, adresse IP si disponible, justification.

Le journal est **non modifiable par les utilisateurs ordinaires** : aucune politique `UPDATE`/`DELETE`
n'existe sur `audit_log`, pour aucun rôle. Les triggers écrivent en `SECURITY DEFINER`.

---

## 10. Conservation, sortie et continuité

- La suspension pour impayé **ne détruit rien** : lecture seule à J+5, blocage opérationnel à J+30, données
  conservées, archivage possible à J+90 après préavis contractuel, **aucune suppression automatique**.
- Le client conserve un **droit d'export** pendant la suspension (lecture et exports autorisés en
  `suspended_read_only`).
- Sauvegardes automatiques quotidiennes, restauration testée, pièces jointes incluses (critère CA-14).
