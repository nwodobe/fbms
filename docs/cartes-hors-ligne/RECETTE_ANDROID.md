# Recette Android exigée avant livraison des cartes hors ligne

Date de préparation : 24 novembre 2026.

**Statut : NON EXÉCUTÉE sur l'APK officielle.** Une recette **pilote** (émulateur Android 15, application du canal de test) a été exécutée le 24 novembre 2026 : ses résultats sont dans la [recette du 24 novembre 2026](RECETTE_20261124.md) et ne cochent aucune case ci-dessous. Cette checklist est une procédure de recette. Les cases ci-dessous ne sont pas des résultats. Les tests navigateur ou les preuves historiques d'autres fonctionnalités ne permettent pas de les cocher.

## Identification et règles de preuve

Renseigner avant l'essai :

| Champ | Valeur à renseigner |
|---|---|
| Testeur et date UTC | Non renseignés |
| Type de cible | Téléphone physique ou émulateur ; ne pas les confondre |
| Modèle, version Android et WebView | Non renseignés |
| APK réellement distribuée | Version, code, identifiant et SHA-256 non renseignés |
| Certificat de l'APK | Empreinte non renseignée |
| Installation avant/après | Dates et identité du paquet à relever sans réinstallation pendant le scénario OTA |
| Version Web initiale | Séquence, commit et origine non renseignés |
| Version Web candidate | Séquence, commit et empreintes non renseignés |
| Zone testée | Identifiant, version, manifeste, origine, date d'image et résolution non renseignés |
| Environnement des données métier | Recette autorisée ; aucune création fictive en production |
| Répertoire des preuves | Non renseigné |

L'APK officielle doit être identique à celle distribuée. Un APK debug, un autre applicationId ou un canal embarqué différent doit être présenté comme un pilote distinct. Il peut apporter des preuves complémentaires, mais ne remplace pas la cible exigée. Si seule une cible pilote est disponible, les essais sur APK officielle restent **non exécutés** et bloquent la diffusion stable.

N'enregistrer dans les preuves aucun nom de producteur, téléphone, montant ou coordonnée réelle de parcelle. Utiliser un environnement de recette et des données synthétiques autorisés ; expurger les journaux et captures. Ne jamais produire de faux enregistrements en production pour faciliter le test.

## A. Référence initiale et OTA d'introduction

- [ ] Identifier le binaire officiel et la version Web initiale avant toute intervention.
- [ ] Vérifier que les comptes et le périmètre de test permettent une recette isolée sans contourner l'authentification, les rôles ou la confiance OTA.
- [ ] Créer ou disposer, dans l'environnement autorisé, d'opérations synthétiques non synchronisées prises en charge par l'ancienne version ; relever leurs identifiants, compteurs et empreintes non sensibles.
- [ ] Télécharger la candidate par le mécanisme OTA prévu, avec une signature acceptée par le binaire concerné. Ne pas remplacer le natif, la clé ou le contenu en cours d'essai.
- [ ] Activer au redémarrage ; relever la séquence active et la confirmation du démarrage.
- [ ] Vérifier que la date de mise à jour du paquet Android n'a pas changé pendant cette OTA.
- [ ] Retrouver les opérations locales initiales, la session et les données préparées ; vérifier leur contenu et leur compte, pas seulement un compteur.

**Si ces conditions ne peuvent pas être réunies sur le binaire exigé sans toucher à la production, noter le blocage. Ne pas remplacer la preuve manquante par un résultat navigateur.**

## B. Téléchargement exhaustif d'une vraie zone satellite

- [ ] Choisir une zone issue d'une vraie image satellite, dont le manifeste contient source, date, résolution, attribution, emprise, niveaux de zoom, tailles et empreintes.
- [ ] Vérifier visuellement que l'image est géoréférencée et suffisamment dégagée pour l'usage annoncé ; relever les nuages ou pixels sans données éventuels.
- [ ] Relever espace disponible estimé, réserve prévue, volume annoncé et volume réellement écrit. Vérifier les besoins de la version précédente et des écritures temporaires.
- [ ] Télécharger une zone sans parcourir toute son emprise à l'écran.
- [ ] Vérifier tous les éléments attendus avant que la zone soit déclarée prête ; aucun fichier manquant ni erreur silencieuse.
- [ ] Relever la version du pack et l'empreinte du manifeste activé.

## C. Test décisif sans réseau et après redémarrage

- [ ] Activer le mode avion **et désactiver le Wi-Fi** ; vérifier l'absence effective de réseau.
- [ ] Forcer l'arrêt de l'application.
- [ ] Redémarrer le téléphone ou l'émulateur, puis rouvrir FBMS sans réseau.
- [ ] Ouvrir la zone prête, se déplacer dans une partie jamais consultée et examiner chaque niveau de zoom annoncé comme disponible.
- [ ] Vérifier que les images proviennent du stockage local et qu'aucune requête fournisseur n'est nécessaire pour les afficher.
- [ ] Vérifier l'attribution et les informations de date/résolution hors réseau.
- [ ] Afficher les parcelles, blocs et arbres préparés ; les positions proviennent de leurs coordonnées enregistrées. Les objets sans position restent explicitement signalés.
- [ ] Saisir un nouveau repère GPS autorisé hors réseau, fermer et relancer l'application ; retrouver le repère en attente.
- [ ] Vérifier que l'absence ou l'expiration d'un éventuel jeton en ligne ne bloque pas la lecture du pack local.

## D. Pannes, espace et intégrité

- [ ] Interrompre un téléchargement au milieu, fermer et relancer ; reprendre sans perdre la dernière version prête.
- [ ] Annuler une zone partielle ; vérifier la libération des seuls fichiers concernés et la conservation des opérations métier.
- [ ] Simuler un fichier absent, corrompu ou d'empreinte inattendue dans une source de recette ; refuser le statut prêt.
- [ ] Simuler un espace insuffisant ou un refus d'écriture IndexedDB ; afficher un état exact et conserver les données métier.
- [ ] Mettre à jour une zone avec une nouvelle version ; interrompre avant validation puis vérifier que l'ancienne fonctionne encore.
- [ ] Vérifier l'activation atomique après complétude et le nettoyage limité des versions remplacées.
- [ ] Déplacer et zoomer rapidement pendant plusieurs minutes ; relever ralentissement, blocage ou fermeture, particulièrement avec le délai natif de révocation des blobs.
- [ ] Supprimer une zone avec la commande du gestionnaire ; confirmer que les repères, observations, producteurs, photos et files en attente sont identiques avant/après.

## E. Compte, synchronisation et régression

- [ ] Changer de compte selon le parcours autorisé ; vérifier l'isolation des données métier et des affectations, sans purge des opérations en attente d'un autre compte.
- [ ] Revenir au compte initial et retrouver ses opérations en attente intactes.
- [ ] Rendre le réseau ; vérifier la reprise des synchronisations existantes, les accusés serveur et l'absence de doublons après plusieurs reprises.
- [ ] Couper le serveur métier tout en laissant un réseau présent ; vérifier que les opérations non reçues restent dans la file.
- [ ] Contrôler le parcours existant de capture GPS et ouverture de carte, la saisie manuelle et les objets sans coordonnées.
- [ ] Contrôler les largeurs 390 × 844, 768 × 1024 et 1440 × 900 au navigateur, et la taille réelle du téléphone séparément ; joindre les preuves sans les présenter comme interchangeables.

## F. Conservation des packs lors d'une OTA suivante

Ce test se déroule dans la chaîne de recette isolée autorisée. Il ne justifie pas une seconde publication inutile en production.

- [ ] Relever une zone prête et ses empreintes, ainsi que des opérations synthétiques en attente.
- [ ] Appliquer une OTA suivante de recette avec le même binaire natif et la même origine ; garder le schéma métier compatible.
- [ ] Vérifier les identités de version et l'absence de réinstallation.
- [ ] Passer hors réseau, forcer l'arrêt, redémarrer et afficher une portion du pack non vue depuis l'OTA.
- [ ] Comparer les données locales en attente et les métadonnées du pack à l'état précédent.
- [ ] Vérifier un retour arrière prévu par le moteur sans purge de la base des cartes ni des données métier.

## Verdict à compléter

| Critère critique | Résultat actuel | Preuve |
|---|---|---|
| APK officielle identifiée et utilisée | Non exécuté | Aucune |
| Vieilles opérations conservées lors de l'OTA d'introduction | Non exécuté | Aucune |
| Images satellite et zone complète | Non exécuté | Aucune |
| Mode avion, Wi-Fi coupé, arrêt forcé et redémarrage | Non exécuté | Aucune |
| Portions et zooms jamais consultés disponibles | Non exécuté | Aucune |
| Reprise, corruption, espace et suppression maîtrisés | Non exécuté | Aucune |
| Données métier et comptes préservés | Non exécuté | Aucune |
| Synchronisation sans doublons | Non exécuté | Aucune |
| Packs et file conservés après OTA suivante | Non exécuté | Aucune |
| Contenu signé identique au contenu testé | Non exécuté | Aucune |

**Décision actuelle : publication stable bloquée tant que ces contrôles critiques ne sont pas exécutés et documentés.** Un résultat manquant, indéterminé ou obtenu sur une autre cible doit rester explicitement identifié. Remplacer « Non exécuté » seulement par un résultat observé, avec sa preuve, sa date, le commit et l'environnement.
