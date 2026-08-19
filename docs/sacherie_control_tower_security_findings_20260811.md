# Constats sécurité — Sacherie Control Tower

## Point P0 identifié

Deux politiques INSERT sont actuellement visibles sur `public.sacs_mouvements` en Production :

- `sacs_ins`, qui exige un utilisateur actif et exclut `DOTATION_RT` ;
- `sacs_mouvements_ins`, qui autorise l'insertion à un utilisateur actif sans cette exclusion.

PostgreSQL combine par défaut les policies permissives avec un OR. Tant que la seconde policy demeure, l'intention de blocage serveur de `DOTATION_RT` n'est donc pas suffisamment garantie par la RLS seule.

## Correctif attendu avant rollout

- supprimer ou remplacer la policy permissive historique ;
- conserver la lecture historique nécessaire ;
- imposer que toute nouvelle `DOTATION_RT` provienne de la RPC d'exécution d'une `bag_movement_request` approuvée ;
- tester un INSERT direct authentifié et confirmer son rejet ;
- tester l'exécution normale via RPC et confirmer son succès.

## Control Tower

Les nouvelles actions sont exposées par RPC Security Definer mais effectuent elles-mêmes les contrôles :

- utilisateur authentifié ;
- profil actif ;
- rôle / fonction autorisé ;
- périmètre cluster ;
- quantité disponible ;
- transitions d'état autorisées ;
- décision REBUT réservée au Branch Manager ;
- décision de perte réservée au Branch Manager.

Les helpers internes ne doivent pas être exécutables directement par `anon` ou `authenticated`.
