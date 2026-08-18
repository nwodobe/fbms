# AFLP Farmer Registry — Limites connues Phase 1

1. Parcelles et GPS parcelle sont prévus en Phase 2.
2. Production Baseline est prévue en Phase 3.
3. Sustainability Baseline, inspections et actions correctives ne sont pas encore actives.
4. La complétude maximale de la Phase 1 est 65 %.
5. Les profils historiques sans zone, cluster, village ou RT configuré conservent temporairement leur accès actuel.
6. La détection de doublon utilise le téléphone normalisé et le nom normalisé exact ; aucun algorithme phonétique n’est encore actif.
7. Le brouillon offline utilise le store Producteurs IndexedDB existant. Consentement et référence de pièce sont transportés avec le brouillon local, puis séparés côté serveur à la synchronisation.
8. Une réinitialisation du téléphone avant synchronisation peut supprimer les données uniquement locales.
9. Achats et Sacs utilisent encore leur ancien contrat de `producteur_id`. Leur bascule vers `producteurs.id` reste en Phase 6.
10. Le texte `AFLP-DATA-CONSENT-2026.1` doit recevoir une validation juridique avant déploiement général.
11. Le service worker historique et la recette sous coupure réseau prolongée doivent être vérifiés sur téléphone réel avant ouverture à tous les clusters.
12. L’interface Phase 1 enrichit le modal existant ; le wizard complet à six étapes viendra avec les phases Parcelles et Baselines.
