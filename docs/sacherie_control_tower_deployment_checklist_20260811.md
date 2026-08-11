# Checklist de déploiement — Sacherie Control Tower

## Avant Production

- [x] Source de vérité choisie : `rcn_jute_movements`.
- [x] Bridge legacy conçu et testé sur données synthétiques.
- [x] Backfill idempotent testé.
- [x] Stock global / Cluster / RT testé.
- [x] Déchiré, réparation et REBUT testés.
- [x] Inventaire avec écart HOLD testé.
- [x] Perte soumise puis approuvée BM testée.
- [ ] RLS par rôle / cluster testée avec plusieurs profils.
- [ ] Upload de preuve Storage raccordé à l'UI.
- [ ] Confirmation de réception RT intégrée.
- [ ] Backfill des 11 mouvements historiques validé sur copie.
- [ ] Quality Gates GitHub verts.
- [ ] Recette 390×844, 768×1024 et 1440×900.
- [ ] Migration Production relue.
- [ ] Rollback Production vérifié.

## Après Production

- [ ] Comparer le total source legacy au total canonique.
- [ ] Vérifier chaque cluster.
- [ ] Vérifier chaque RT ayant déjà reçu des sacs.
- [ ] Vérifier les sacs déchirés historiques.
- [ ] Vérifier que le module V1 reste accessible en lecture / transition.
- [ ] Vérifier que `DOTATION_RT` ne peut être créée que via l'approval SOP-006.
- [ ] Réaliser un inventaire physique réel contrôlé sur un cluster pilote.
