# AFLP Farmer Registry — Limites connues

1. Le GPS Level 1 utilise un point représentatif. Le polygone complet est préparé dans `geometry_geojson`, mais aucun parcours de contour n’est encore actif.
2. PostGIS est disponible dans le projet Supabase mais n’est pas installé. Le GeoJSON évite de bloquer le MVP ; une migration PostGIS pourra être ajoutée lors du GPS Level 2.
3. La surface GPS vérifiée est saisie par la supervision. Elle n’est pas encore calculée automatiquement à partir d’un polygone.
4. Le questionnaire `AFLP-SUST-2026.1` est une baseline opérationnelle. Il ne constitue ni une certification ni un score ESG.
5. Le texte de consentement `AFLP-DATA-CONSENT-2026.1` doit conserver une validation juridique avant généralisation à grande échelle.
6. Les fichiers de preuve exigent une connexion pour l’envoi vers Supabase Storage. Les formulaires et données structurées restent utilisables offline.
7. Une suppression du stockage du navigateur avant synchronisation peut supprimer les données uniquement locales.
8. Le moteur offline conserve une outbox par opération. Il n’affiche pas encore une interface avancée d’arbitrage champ par champ pour deux modifications concurrentes d’une même parcelle.
9. Les baselines évitent les collisions de version par verrou transactionnel. Les fiches DRAFT modifiées simultanément par deux appareils restent soumises à la règle du dernier envoi serveur ; l’audit conserve les changements.
10. Les coordonnées GPS sont visibles uniquement aux rôles terrain et supervision. Les vues agrégées restent accessibles sans coordonnées aux autres rôles autorisés.
11. `RT / Field Partner` conserve l’enrôlement basic prévu en Phase 1. La capture des parcelles, baselines et inspections nécessite un rôle terrain interne autorisé.
12. Achats et Sacs peuvent encore contenir l’ancien Farmer ID lisible dans `producteur_id`. Les vues 360 acceptent temporairement l’ID technique ou le code afin de préserver l’historique.
13. La normalisation définitive de `achats.producteur_id` et `sacs_mouvements.producteur_id` vers `producteurs.id`, avec FK validées, doit être livrée comme migration d’intégration contrôlée après mise à jour des appareils terrain.
14. Les formations réutilisent `sessions_formation` et `participants_formation`. La création de sessions reste dans le module missions/formation existant.
15. Les preuves sont listées par entité dans le Passport. L’interface ne génère pas encore d’URL signée de téléchargement pour chaque document.
16. Le dashboard du registre est intégré à la vue Producteurs sélectionnée par village. Une vue exécutive multi-zones dédiée peut exploiter `farmer_registry_dashboard_v` sans modifier le modèle.
17. La carte Leaflet nécessite le chargement initial de la librairie et des tuiles. Les points restent enregistrés hors ligne même si le fond cartographique n’est pas disponible.
18. Les avertissements Supabase hérités hors périmètre Farmer Registry, notamment certaines anciennes fonctions SECURITY DEFINER et la protection contre les mots de passe compromis, ne sont pas tous corrigés par cette livraison.
