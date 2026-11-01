# Formation AFLP FLEET · Thèmes B, C et D

Trois présentations de 12 diapositives chacune, même format que le thème A :
- même héros fictif, Yao ;
- même moto rouge sans logo ;
- charte PJS Global ;
- notes du formateur sous chaque diapositive.

Captures de l'application : test de bout en bout, **données fictives** uniquement.

**Exercices en salle :** on remplit le formulaire puis on touche **Annuler**. Valider un achat, une demande ou un incident fictif créerait un vrai enregistrement en production. Un accident ou un incident critique fictif immobiliserait réellement la moto.

## Règles enseignées (vérifiées dans le code et en production, 1er novembre 2026)

### B. Carburant, plein complet et justificatifs

**Formulaire** : `moto/moto-app.js`, `validerCarburant`.
- Champs : date, compteur, litres (de 0 à 60), montant, plein complet ou partiel, mode de paiement (dotation ou argent personnel), station.
- Photo du reçu obligatoire.

**Serveur** : `moto_carburant_declarer`.
- Un achat de plus de 45 jours est refusé.
- Le reçu reste « à vérifier ». Il est vérifié ou rejeté par l'ABM, le BM ou Finance. Personne ne vérifie son propre achat (`moto_justificatif_verifier`).

**Remboursement** : seules les avances personnelles **vérifiées** peuvent être demandées (`moto_remboursement_demander`).

**Consommation** : mesurée plein à plein (`moto_v_conso_intervalles`). Paramètres en production :

| Paramètre | Valeur |
|---|---|
| Référence | 3 L/100 km |
| Vérification | 3,6 L/100 km |
| Vérification prioritaire | 4,2 L/100 km |

### C. Entretien préventif

**Le Chef d'unité signale** (Opérations › Demande d'entretien, même hors connexion).
- Une demande ne vaut jamais autorisation (`moto_maintenance_demander`).
- Le Chef d'unité n'a aucun pouvoir financier.

**Aucune dépense** d'entretien ou de réparation sans autorisation individuelle et préalable du BM, quel que soit le montant (guide, migration 6).

**Circuit** :
1. Le coordinateur établit le devis.
2. Le BM autorise.
3. Le garage fait les travaux.
4. Le Chef de zone contrôle les travaux.
5. L'opération est inscrite au carnet.

Seule une opération contrôlée conforme remet à zéro sa propre échéance.

**Constat important.** En production, les intervalles d'entretien du modèle APSONIC AP150-30 sont encore en **brouillon** (`HYPOTHESE`) :

| Opération | Intervalle |
|---|---|
| Vidange | 1 500 km / 60 j |
| Entretien | 1 000 km / 30 j |
| Révision | 5 000 km / 180 j |

**Aucune échéance n'est donc calculée** tant que le BM ne les a pas requalifiés et approuvés. Les diapositives n'affichent aucun intervalle.

### D. Panne, crevaison, accident

**Formulaire** (Opérations › Déclarer un incident) :
- **Types** : panne, accident, crevaison, anomalie.
- **Gravités**, libellés exacts :
  - « Mineure : la moto peut rouler » ;
  - « Majeure : rouler avec prudence jusqu'au garage » ;
  - « Critique : arrêt immédiat ».
- **Description** : 10 caractères minimum.
- **Case à cocher** : « La moto est arrêtée et en sécurité ».

**Immobilisation** (`exigeImmobilisation` dans `moto-core.js`, et `moto_incident_declarer` sur le serveur) :
- Un accident, quelle que soit sa gravité, ou un incident critique immobilise la moto immédiatement sur le téléphone, même hors connexion.
- Le serveur ouvre l'immobilisation à la réception.
- Un accident est aussi inscrit au registre des incidents AFLP.

**Remise en service** : par un responsable, après réparation et contrôle.

**Premiers secours** : les consignes générales sont présentées comme telles. Aucun numéro d'urgence n'est inventé.

## Prompts des images (ChatGPT, même conversation que le thème A, 1er novembre 2026)

Les prompts commencent par « Image suivante, même personnage, même moto rouge sans logo, même étalonnage cinéma 16:9. », sauf l'ouverture de chaque épisode (« Nouvel épisode… »). Ils se terminent par « Aucun texte. » (ou « Aucun texte lisible. » pour les scènes avec un écran ou un ticket).

Chaque image porte la mention « Illustration · image générée par IA ».

### C. Entretien préventif

**C01.** Fin d'après-midi dans la cour de village en latérite : Yao rentre en roulant doucement, la chaîne visiblement détendue et sèche fait un bruit métallique ; des poules s'écartent, des voisins tournent la tête.

**C02.** Plan moyen : Yao assis sur sa moto hausse les épaules avec un sourire insouciant en entendant un grincement, la main sur le réservoir ; voisin flou en arrière-plan.

**C03.** Très gros plan macro : chaîne sèche et rouillée qui pend sous le bras oscillant, pignon aux dents usées en pointe, poussière de latérite.

**C04.** Piste isolée en pleine savane, soleil de midi : la chaîne a sauté et pend au sol ; Yao accroupi, désemparé.

**C05.** Sous un arbre au bord de la piste, un réparateur improvisé (vu de dos) bricole la chaîne ; Yao lui tend des billets génériques illisibles.

**C06.** Une semaine plus tôt, à l'aube : Yao pousse la chaîne du doigt pour vérifier sa tension ; elle bouge trop.

**C07.** Gros plan : Yao regarde le hublot de niveau d'huile, niveau bas, téléphone en main.

**C09.** Au bord de la piste, Yao refuse d'un geste l'offre d'un réparateur de passage et appelle son responsable.

**C10.** Garage de quartier propre : un mécanicien (de profil) vidange l'huile ; chaîne et pignon neufs sur l'établi ; Yao observe.

**C11.** Devant le garage, le Chef de zone (gilet orange sans inscription) vérifie la tension de la chaîne neuve et note sur son téléphone.

**C12.** Plan héroïque : Yao roule le matin sur une piste entre des anacardiers, moto propre, chaîne neuve.

### B. Carburant et justificatifs

**B01.** Matin au bord d'une route de village : Yao s'arrête près d'une table de vendeur d'essence en bouteilles et bidons ; vendeur de dos ; Yao regarde sa jauge, pressé.

**B02.** Gros plan : le vendeur (mains seules) verse l'essence avec un entonnoir artisanal ; Yao tend des billets et fait signe « pas besoin de reçu ».

**B03.** Très gros plan : la main de Yao sort de sa poche un ticket de caisse froissé, délavé, illisible.

**B04.** Fin de mois, petit bureau d'agence : une responsable administrative (de profil) montre l'écran de son ordinateur (illisible) et secoue la tête ; Yao gêné.

**B06.** Petite station-service de bourg, pompe générique sans marque : un pompiste (de dos) prend le pistolet ; Yao a son téléphone en main.

**B07.** Très gros plan : pistolet dans le réservoir rouge, l'essence arrive au niveau du col, plein complet.

**B08.** Gros plan net : Yao photographie un ticket posé à plat sur la selle, téléphone droit au-dessus ; ticket illisible.

**B11.** Le même bureau : la responsable, seule, examine la photo d'un ticket sur son ordinateur et coche une case sur une liste papier.

**B12.** Plan héroïque : Yao quitte la station au soleil levant et range son téléphone.

### D. Panne, crevaison, accident

**D01.** Crépuscule orageux : Yao roule vite sur une piste de latérite, phare allumé, éclair au loin.

**D02.** Au crépuscule : Yao, en mouvement lent, jette un regard inquiet vers sa roue arrière dégonflée.

**D03.** Très gros plan macro : la jante roule presque sur la latérite, pneu à plat déchiré sur le flanc.

**D04.** Tombée de la nuit : la moto dans le fossé, rétroviseur cassé ; Yao debout se tient le poignet, sans blessure visible ; deux villageois arrivent avec une lampe.

**D05.** Nuit, ruelle de village sous une ampoule : Yao pousse en cachette sa moto abîmée.

**D06.** Vingt minutes plus tôt : moto arrêtée à l'écart de la piste, moteur coupé, béquille ; Yao accroupi en sécurité regarde le pneu dégonflé.

**D08.** Au crépuscule, moto garée en sécurité : Yao saisit une déclaration sur son téléphone (écran illisible).

**D10.** Le lendemain : la moto abîmée est sanglée sur un tricycle de transport générique ; Yao, poignet bandé, vérifie la sangle.

**D12.** Plan héroïque : au lever du soleil après la pluie, Yao repart avec sa moto réparée, flaques qui reflètent le ciel.

## Vérification

| Largeur | Méthode | Constat |
|---|---|---|
| 1440 | Présentations publiées, ouvertes dans Chrome | B10, C9 et D8 contrôlées : lisibles |
| 1440, 768 et 390 | Rendu local de chaque diapositive, réduit à la taille affichée (environ 1300, 730 et 370 px de large) | Titres et messages lisibles aux trois largeurs |

**Défauts corrigés après rendu** :
- « » » isolé sur une ligne (C2) ;
- circuit illisible sur téléphone (C9) ;
- Yao coupé du cadrage (B6, D6) ;
- Yao masqué par le dégradé (D7) ;
- exercices qui auraient créé des données réelles (B12, C12, D12).

**Limites** :
- Les petites largeurs sont **simulées**, pas testées sur un vrai téléphone.
- Les surtitres « Scène N », la mention « illustration » et le contenu des captures restent illisibles à 390 px ; ils sont décoratifs.

## Incidents de génération (pour la prochaine fois)

**Envois et téléchargements.** Plusieurs prompts sont partis collés l'un à l'autre, ou ont été téléchargés avec la mauvaise image. Le pipeline final :
1. Donner le focus au champ de saisie par script, sans clic.
2. Envoyer avec le bouton « Envoyer ».
3. Attendre la fin de la génération (bouton « Arrêter » absent).
4. Télécharger la première image visible placée **entre** le prompt et le prompt suivant.

**Images écartées** : quatre fichiers étaient des copies d'images anciennes. Ils ont été écartés après contrôle visuel.
