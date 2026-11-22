# Décision GO / NO-GO : synthèse pour le Branch Manager

*22/11/2026. Fondée sur `AUDIT_TECHNIQUE_FBMS.md`, `MATRICE_TESTS.csv` (52 lignes : 39 réussis, 2 échecs, 5 bloqués, 6 non exécutés), `RECETTE_ITEL.md`, `AUDIT_SECURITE_OTA.md`.*

## Recommandation

**NO-GO pour toute nouvelle diffusion générale. GO SOUS CONDITIONS pour un pilote sur canal de test.** C'est l'option B, avec un gel immédiat des publications stables (emprunté à l'option C) jusqu'à la fin du pilote.

## Pourquoi

1. **Trois OTA stables sont parties ce matin vers tout le parc sans pilote.** Elles fonctionnent en test, mais personne ne sait quels téléphones les ont activées.
2. **Le parcours complet n'est pas prouvé sur l'APK officielle** par un essai contrôlé avec données réelles.
3. **L'APK officielle de l'itel a été désinstallée puis réinstallée à 11:48**, ce qui efface les données locales. La cause doit être connue avant de confier la procédure à des agents.
4. **La migration de suivi contenait une faille de détournement**, corrigée mais non déployée.
5. **Le texte de consentement n'est pas validé juridiquement**, alors que 2 accords réels ont déjà été recueillis avec lui.

## Critères du mandat (§ 13)

| Critère | État |
|---|---|
| Cinq workflows verts sur le commit candidat | Satisfait : 4991f0a (PR #364) |
| Contrôles protégés respectés | Satisfait |
| Parcours Esri vérifié en conditions réelles | Partiel : navigateur du téléphone, pas l'APK officielle |
| APK officielle testée sans substitution par l'émulateur | **Non satisfait** : lectures seules uniquement |
| Aucun défaut critique de perte de données locales | Satisfait en test (IndexedDB 30/30) ; non vérifié sur l'APK officielle |
| Aucun contournement du consentement démontré | Satisfait (refus serveur PM001) |
| Migration testée et sécurisée, non déployée | Satisfait |
| Publication distinguée de l'activation | Satisfait dans le tableau ; **inopérant tant que la migration n'est pas appliquée** |
| Pilote réalisé | **Non satisfait** |
| Restauration vérifiée | Partiel : émulateur et local ; canal stable non testé |

## Les trois options

| | A. Diffusion générale immédiate | B. Pilote restreint puis déploiement progressif | C. Gel complet jusqu'à résolution |
|---|---|---|---|
| Avantages | Tous les agents ont vite les protections de #364 | Preuve sur vrais téléphones ; risque limité à 3 appareils | Risque technique minimal |
| Inconvénients | Quatrième publication non pilotée ; aucun suivi d'activation | Une installation manuelle par téléphone ; 7 jours | Les protections de #364 n'arrivent pas ; le terrain reste sur la version du matin |
| Risques techniques | Défaut visible sur tout le parc ; retour arrière jamais essayé sur le stable | Erreur de signature de l'APK pilote (sans perte : Android refuse) | Dette qui s'accumule ; correctifs en bloc plus tard |
| Effets sur les agents | Changements d'écran répétés sans explication | Trois agents formés, qui forment les autres | Aucun changement, mais aucune amélioration |
| Se justifie si | Un défaut grave en production exige un correctif urgent | Cas présent | Une perte de données réelle est constatée chez un agent |

## Pré-mortem : « le déploiement a échoué, pourquoi ? »

| Cause possible | Signe précurseur | Prévention |
|---|---|---|
| Des agents restent sur une ancienne version sans qu'on le sache | Écrans différents d'un agent à l'autre | Appliquer la migration de suivi avant le pilote |
| Un agent désinstalle l'application pour « réparer » et perd ses achats non synchronisés | Demandes d'APK par WhatsApp ; réinstallation du 22/11 sur l'itel | Consigne écrite « jamais désinstaller » ; file à zéro avant toute installation |
| Le prochain APK est refusé par Android | Message « application non installée » | Code ≥ 11, clé officielle, essai sur un téléphone avant diffusion |
| Zone sans réseau : contours bloqués en brouillon, agents qui abandonnent | Brouillons qui s'accumulent | Expliquer que le contour s'enregistre au retour du réseau ; mesurer pendant le pilote |
| Consentement contesté par un producteur ou un auditeur | Question d'un certificateur | Validation juridique du texte ; version en langue locale |
| Observatoire inutilisable : 0 champ complet sur 1 598 | Liste « à compléter » qui ne diminue pas | Campagne de relevé GPS et de comptage des arbres, par cluster |
| Clé Esri épuisée ou service indisponible | Carte grise | Message honnête déjà en place ; surveiller la consommation |

## Opérations préparées, en attente de votre autorisation

| N° | Opération | État |
|---|---|---|
| 1 | Fusionner la PR #364 (protections du point en attente et de l'accord) | Prête, 5 workflows verts, revue humaine requise (`sw.js`) |
| 2 | Fermer la PR #362 (remplacée par #364) | À décider |
| 3 | Fusionner la PR de recette (migration corrigée, tests, ce dossier) | Prête |
| 4 | Appliquer la migration de suivi en production | Prête, retour arrière prêt |
| 5 | Construire l'APK pilote 1.4.4 (code 11) sur canal « pilote » | Non commencée |
| 6 | Publier une OTA stable contenant #364 | **Non recommandée avant le pilote** |
| 7 | Valider le texte de consentement | Personne habilitée à désigner |

*Décision du Branch Manager : ______________________  Date : ____________*
