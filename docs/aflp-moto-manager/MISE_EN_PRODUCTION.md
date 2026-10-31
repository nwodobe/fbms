# AFLP Moto Manager — journal de mise en production

**Date :** 31/10/2026 · **Autorisation :** M. KOUASSI (Branch Manager), message du 31/10/2026 06:20 UTC · **Exécution :** Claude

## 1. Pré-contrôles (lecture seule, production)

| Contrôle | Résultat |
|---|---|
| Version PostgreSQL | 17.6 |
| Schéma `private` et droit d'usage `authenticated` | Présent, accordé |
| Objets `moto_*` préexistants (risque de conflit) | 0 |
| Bucket `moto-documents` préexistant | Absent |
| Le propriétaire des fonctions (`postgres`) lit `storage.objects` | Oui |
| Comptes requis | 4 Unit Head actifs, clusters reconnus (Sakassou, Botro, Brobo, Djébonoua) ; ABM actif |

## 2. Action sur les comptes

Compte Zonal Head « Test » (adresse personnelle de M. KOUASSI, jamais connecté) **désactivé** (`actif = false`). Réversible depuis l'écran Administration de FBMS. Motif : avec le module, ce compte aurait eu la lecture de toute la flotte et le droit d'autoriser des dépenses d'incident.

## 3. Migrations appliquées (`apply_migration`, atomiques)

| Ordre | Nom Supabase | Fichier source |
|---|---|---|
| 1 | `aflp_moto_manager_1_schema_securite` | `20261031090000_…_1_schema_securite.sql` |
| 2 | `aflp_moto_manager_2a_rpc`, `_2b_rpc`, `_2c_rpc` | `20261031090100_…_2_rpc.sql` (transmis en 3 lots ordonnés) |
| 3 | `aflp_moto_manager_3_vues_kpi` | `20261031090200_…_3_vues_kpi.sql` |
| 4 | `aflp_moto_manager_4_search_path` | `20261031090400_…_4_search_path.sql` |

Le SQL transmis est le fichier du dépôt sans les lignes de commentaire, validé au préalable sur une réplique locale.

**Preuve d'intégrité :** empreinte md5 de chacune des 76 fonctions comparée entre la production et la version testée. 75 identiques ; 1 différence (`moto_controle_depart`) prouvée limitée à un commentaire de fin de ligne omis (empreinte identique une fois ce commentaire retiré).

## 4. Contrôles post-installation (production)

| Contrôle | Attendu | Obtenu |
|---|---|---|
| Tables `moto_*` | 23 | 23 |
| Tables sans RLS | 0 | 0 |
| Vues | 12 | 12 |
| Fonctions exécutables par `anon` | 0 | 0 |
| Fonctions internes d'écriture exposées | 0 | 0 |
| Tables écrivables directement par `authenticated` | 0 | 0 |
| Tables lisibles par `anon` | 0 | 0 |
| SECURITY DEFINER sans `search_path` | 0 | 0 |
| Bucket `moto-documents` public | non | non |
| Politiques de stockage | 2 | 2 |
| Règles d'entretien actives | 0 (aucune périodicité inventée) | 0 |

## 5. Test fonctionnel en production, annulé automatiquement

Bloc exécuté avec les identités réelles (BM, ABM, Unit Head Sakassou, Unit Head Botro), terminé par une exception qui annule tout.

| Test | Résultat |
|---|---|
| T1 Anonyme : lecture et création | Refusées |
| T2 BM : création d'une moto | OK (MOTO-001) |
| T3 Document avec un fichier inexistant | Refusé : « Fichier introuvable dans le stockage privé » |
| T4 BM : préaffectation au Unit Head Sakassou | PREAFFECTEE |
| T5 BM : lecture de la flotte | 1 moto |
| T6 Mise en service sans remise | Refusée |
| T7 ABM : préaffectation | Refusée (réservée au BM) |
| T8 ABM : lecture du journal | 3 lignes (création, préaffectation) |
| T9 Unit Head Sakassou : lecture | 1 moto (son cluster) |
| T10 Unit Head : saisie avant remise | Refusée |
| T11 Unit Head Botro : lecture | 0 moto |
| T12 Écriture directe en table | Refusée |

Après annulation : 0 moto, 0 ligne de journal, 0 affectation, séquence remise à 1 (la première vraie moto sera MOTO-001).

## 6. Conseiller Supabase

- **Sécurité :** « fonctions SECURITY DEFINER appelables par les utilisateurs connectés ». C'est voulu : ce sont les seules portes d'écriture, et chacune contrôle compte, rôle, périmètre et séparation des tâches. « search_path non figé » sur 9 fonctions utilitaires : corrigé (migration 4).
- **Performance :** index non encore utilisés (tables vides), clés étrangères non indexées, `auth.uid()` réévalué dans 4 politiques. Sans effet à l'échelle de 4 motos ; à revoir au-delà de quelques centaines de motos.

## 7. Retour arrière

`supabase/20261031090300_aflp_moto_manager_rollback.sql`, niveau 1 : coupe tous les droits du module sans toucher aux données.
