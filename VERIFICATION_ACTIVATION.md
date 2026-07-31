# Vérification du parcours d'activation — projet hébergé

**Projet** `lba-control` (`fpraewmywcqwrjpcfzln`, eu-west-3) · **Date** 31 juillet 2026 ·
**Migrations appliquées** 33 (jusqu'à `20260730003300_invitation_expiry_sweep`)

Ce document rend compte d'une vérification menée sur la base **réellement hébergée**, et non sur la
base de test locale. La distinction a son importance : c'est exactement ce qui a permis de trouver
un défaut que la suite locale laissait passer depuis le premier jour (point 10 ci-dessous).

---

## Méthode, et ce qu'elle ne couvre pas

Les contrôles s'exécutent contre la base du projet, en reproduisant le mécanisme d'authentification
de PostgREST : `set role authenticated` puis `request.jwt.claims`. C'est le chemin de code que
Supabase emprunte en production — une politique qui passe ainsi passe pour un vrai utilisateur.

Chaque scénario tourne dans une **transaction annulée**. Après vérification, le projet est resté
exactement dans l'état où il était : 0 entreprise, 0 utilisateur, 0 ligne de journal.

**Deux limites, énoncées franchement.**

L'accès réseau sortant de l'environnement d'exécution refuse `supabase.co`. Il n'a donc pas été
possible d'appeler l'API d'authentification : ni créer un compte, ni obtenir un vrai jeton signé,
ni le décoder. Ce qui est vérifié, c'est **la fonction qui fabrique les revendications** et tout ce
que la base en fait ensuite. Ce qui ne l'est pas, c'est que Supabase Auth **appelle** effectivement
cette fonction — c'est un réglage du tableau de bord, pas du code.

Par ailleurs, le projet ne contenait **aucun compte d'authentification** au moment de la
vérification. Les étapes manuelles 3 à 5 du README (créer le compte, l'amorcer administrateur)
n'avaient pas été faites.

---

## Résultats

| # | Point demandé | État | Ce qui a été constaté |
| --- | --- | --- | --- |
| 1 | Le hook `custom_access_token` est actif | ⚠️ **non vérifiable d'ici** | Réglage de tableau de bord, invisible depuis la base. Voir « Comment le vérifier vous-même » |
| 2 | Mon compte est administrateur plateforme | ❌ **non fait** | `auth.users` = 0, `platform_admins` = 0. Les étapes 3 à 5 restent à faire |
| 3 | Le jeton contient le rôle plateforme attendu | ✅ | `app.custom_access_token` rend `{"role":"super_admin","tenant_id":null}` pour un administrateur actif |
| 4 | Créer un tenant depuis la console | ✅ | Une transaction, quatre objets : entreprise, marque, abonnement, invitation |
| 5 | Catégories et règles créées automatiquement | ✅ | **23 catégories de dépenses, 20 règles d'alerte**, sans intervention |
| 6 | L'invitation du propriétaire fonctionne | ✅ | Aperçu conforme : entreprise nommée, rôle annoncé, adresse concordante, **adresse jamais divulguée** |
| 7 | Le propriétaire accepté obtient tenant et rôle | ✅ | Ligne `users` active, et jeton réémis portant `tenant_id` de son entreprise + `proprietaire` |
| 8 | Il ne lit rien d'un autre tenant | ✅ | 0 société lue chez l'entreprise voisine ; **1 seule entreprise visible** — la liste des clients n'est jamais exposée |
| 9 | Un suspendu perd l'accès au rafraîchissement | ✅ | Revendications vidées (`{}`), et 0 ligne lisible avec le jeton réémis |
| 10 | Le lien expire et ne sert qu'une fois | ✅ **après correction** | Second usage refusé (statut `accepted`) ; invitation périmée refusée, puis marquée par le balayage |

---

## Le défaut trouvé, et pourquoi la suite locale l'avait manqué

`app.accept_invitation` contenait ceci :

```sql
update public.tenant_invitations set status = 'expired' where id = v_invitation.id;
raise exception 'Cette invitation a expiré le %…';
```

En PostgreSQL, `raise exception` annule la transaction en cours — **donc l'`update` qui le précède**.
Le statut restait `pending` indéfiniment. Écrire puis lever dans le même souffle n'écrit rien.

Le test local s'appelait *« refuse une invitation expirée et la marque comme telle »* et ne
vérifiait que le refus. La moitié de son nom était fausse. Un test dont le nom promet plus que son
corps est pire qu'un test absent : il donne une confiance qu'il ne justifie pas.

**Ce qui n'était pas cassé, malgré tout.** L'interface dérive l'expiration de `expires_at`
(`invitationState`) et affichait donc « périmée » correctement ; et `app.invite_user` renouvelle une
invitation en attente par `on conflict do update`, si bien que réinviter la même adresse
fonctionnait déjà. Ce qui était faux, c'est ce que la base racontait d'elle-même — à un export, à un
audit, à un décompte.

**Correction** (migration 3300) : l'écriture morte est retirée, et `app.expire_stale_invitations()`
marque réellement les invitations échues, appelée par la tâche quotidienne. Le test porte désormais
sur ce qui est vrai : le refus n'écrit rien, le balayage écrit.

---

## Ce que la vérification a ajouté à la suite de tests

| Test | Ce qu'il protège |
| --- | --- |
| `le balayage marque les invitations périmées, le refus ne le fait pas` | Le défaut ci-dessus ne peut plus revenir |
| `réserve le balayage à la plateforme` | Un client ne balaie pas chez les autres |
| `le propriétaire fraîchement accepté ne lit rien d'une autre entreprise` | Le cloisonnement ne dépend pas du chemin par lequel le compte est né |

Suite de base : **390 tests** (17 fichiers). Unitaires : 602. Parcours end-to-end : 288.

---

## Comment vérifier le hook vous-même, en une minute

Le produit a été construit pour répondre à cette question sans outil. Une fois votre compte créé et
amorcé (README §5, étapes 3 à 5), connectez-vous à l'application :

- **le hook est actif** → la console plateforme s'ouvre ;
- **le hook est inactif** → vous arrivez sur `/activation`, qui affiche « Configuration du serveur
  incomplète » et le chemin exact du réglage manquant.

Ce diagnostic n'est pas une devinette : si la base dit « ce compte est actif et rattaché » pendant
que le jeton ne porte rien, c'est que rien ne recopie l'une dans l'autre.

En SQL, une fois au moins un compte rattaché existant, la même question se pose ainsi :

```sql
-- Ce que le hook DEVRAIT produire pour ce compte.
select app.custom_access_token(jsonb_build_object(
  'user_id', '<uuid-du-compte>',
  'claims', jsonb_build_object('app_metadata', '{}'::jsonb)));
```

Si le résultat porte le tenant et le rôle mais que l'application n'en voit rien, le hook n'est pas
branché — la fonction est juste, personne ne l'appelle.
