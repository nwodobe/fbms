# Formation AFLP FLEET · Thème A : contrôle avant départ

Présentation de 12 diapositives, format « film » : un agent fictif (Yao, Chef d'unité près de Bouaké) part sans contrôle et chute. On rembobine, il fait le contrôle dans AFLP FLEET.

- Publiée comme présentation Claude (diapositives), téléchargeable en PowerPoint ou en PDF.
- Notes du formateur sous chaque diapositive.
- Statut : **en attente de validation du style par le Branch Manager** avant les thèmes B, C et D.

## Règles enseignées (vérifiées dans le code, pas supposées)

| Règle | Source |
|---|---|
| 12 points, dont 6 critiques : frein avant, frein arrière, pneus, direction, fuites, casque attaché | catalogue `AVANT_DEPART`, formulaire capturé dans `controle-avant-depart-mobile.png` |
| Point critique en défaut : contrôle INAPTE, incident critique, moto immobilisée sur le téléphone même hors connexion | `moto_controle_depart` (migration 2), `moto/moto-app.js:882`, test E2E `UI-INC-01` |
| Seul un responsable remet la moto en service | message affiché « Moto immobilisée : un responsable doit d'abord la remettre en service » |
| Défaut non critique : contrôle INAPTE, pas d'immobilisation automatique, message « faites une demande d'entretien » | `moto_controle_depart`, `moto/moto-app.js:882` |

## Déroulé

| N° | Scène | Image |
|---|---|---|
| 1 | Titre : « 5 h 58. Yao est en retard. » | A01 |
| 2 | La tentation : « Pas le temps. Je contrôle ce soir. » | A02 |
| 3 | Le détail : frein avant mou | A03 |
| 4 | La piste : des chèvres | A04 |
| 5 | La conséquence : chute, casque non attaché | A05 |
| 6 | Retour à 5 h 58 : Yao ouvre AFLP FLEET | A06 |
| 7 | Opérations › Contrôle avant départ | capture de l'application |
| 8 | Les 6 points critiques | A07 à A10 |
| 9 | Règle : point critique en défaut | capture de l'application |
| 10 | Réparation et remise en service | A11 |
| 11 | Règle : défaut non critique | capture de l'application |
| 12 | Les 3 règles à retenir | A12 |

Les captures de l'application viennent du test de bout en bout, sur des **données fictives** (moto « E2E 0001 FICTIF »).

## Prompts des images (ChatGPT, une seule conversation, 1er novembre 2026)

Chaque image porte la mention « Illustration · image générée par IA ». Aucune marque, aucun logo, aucune personne réelle identifiable.

**A01.** Génère une image photoréaliste, format paysage 16:9, style plan de film hollywoodien (lumière dorée de l'aube, profondeur de champ, étalonnage cinéma).
- Scène : village rural près de Bouaké en Côte d'Ivoire, sol de latérite rouge, maisons en banco aux toits de tôle, manguiers.
- Un agent terrain ivoirien (homme d'environ 30 ans, cheveux courts, chemise kaki, sac en bandoulière) se tient à côté d'une moto 150 cm³ générique de type commuter rouge, SANS aucun logo ni marque.
- Il regarde sa montre, pressé ; un gilet haute visibilité vert est accroché au guidon, pas porté.
- Plan large d'ouverture. Aucun texte, aucun logo.
- Garde exactement ce personnage et cette moto pour toutes les images suivantes de cette conversation.

Chaque prompt suivant commence par la même phrase de continuité, qui n'est pas répétée ci-dessous : « Image suivante, même personnage, même moto rouge sans logo, même étalonnage (cinéma) 16:9. »

Tous se terminent par « Aucun texte. »

**A02.** Même lieu. Il enfourche la moto à la hâte : casque posé sur la tête mais jugulaire non attachée qui pend, gilet vert toujours accroché au guidon, visage tendu. Plan moyen, léger contre-jour, poussière de latérite.

**A03.** Très gros plan macro dramatique : la main de l'agent serre le levier de frein avant, et le levier va jusqu'à toucher la poignée sans aucune résistance (frein mou, défaillant). Faible profondeur de champ, lumière rasante de l'aube, ambiance de suspense.

**A04.** Plan d'action au téléobjectif : l'agent descend à moto une piste de latérite entre les hautes herbes, sans gilet, jugulaire du casque flottante ; devant lui, un troupeau de chèvres traverse la piste. Poussière rouge, tension, effet bande-annonce.

**A05.** Juste après : la moto est couchée sur le flanc dans la poussière rouge au bord de la piste, l'agent est assis à côté, secoué mais indemne, aucune blessure visible, son casque a roulé au sol ; les chèvres s'éloignent. Atmosphère dramatique, poussière en suspension, aucun sang.

**A06.** Même cour de village à l'aube que la première image. Deuxième prise : cette fois l'agent est calme, accroupi à côté de la moto, son téléphone à la main pour faire sa liste de contrôle (écran non lisible), regard concentré et souriant. Lumière douce et chaude.

**A07.** Gros plan : l'agent teste les freins, la main droite serre fermement le levier de frein avant (qui résiste correctement) pendant que son pied appuie sur la pédale de frein arrière. Geste précis, lumière de l'aube, faible profondeur de champ.

**A08.** Plan macro : la main de l'agent passe sur la bande de roulement du pneu avant pour vérifier qu'il n'y a ni coupure ni hernie, un petit manomètre de pression posé sur la valve. Poussière rouge sur le caoutchouc, lumière rasante de l'aube.

**A09.** Plan large en plongée : l'agent tourne le guidon en butée pour vérifier que la direction est souple ; au premier plan, sous le moteur, il remarque une petite tache sombre d'huile sur la latérite et se penche pour regarder. Suspense discret.

**A10.** Plan poitrine : l'agent attache la jugulaire de son casque avec un clic net, il porte maintenant un gilet haute visibilité vert fluo sans inscription ; regard déterminé vers la caméra, léger sourire. Lumière dorée.

**A11.** Atelier de mécanicien de quartier en plein air, sous un auvent en tôle : un mécanicien (vu de dos ou de profil, visage non reconnaissable) règle le frein avant de la moto rouge posée sur sa béquille ; l'agent observe à côté, gilet vert, casque à la main. Outils, pneus empilés, aucune enseigne ni logo.

**A12.** Dernière image. Plan héroïque de fin de film : l'agent s'éloigne à moto sur une longue piste de latérite rouge au lever du soleil, gilet vert fluo et casque attaché, vu de trois quarts arrière en contre-plongée, savane et ronier en silhouette, poussière dorée, ciel orange.

## Vérification aux 3 largeurs

| Largeur | Méthode | Constat |
|---|---|---|
| 1440 × 900 | Présentation publiée, ouverte dans Chrome, 12 diapositives revues | Lisible. Trois défauts corrigés : mention « illustration » coupée (diapositives 6 et 8), surtitre peu contrasté (diapositive 5), mention assombrie (diapositives 3, 5 et 10) |
| 768 × 1024 | Rendu local de chaque diapositive, réduit à la taille affichée (environ 730 px de large) | Titres et messages lisibles |
| 390 × 844 | Même rendu, réduit à environ 370 px de large | Titres et messages lisibles. Surtitres, mention « illustration » et contenu des captures **illisibles à cette taille** (décoratifs, le message est porté par le titre) |

**Limite :** la fenêtre Chrome de l'utilisateur n'a pas pu être réduite à 768 et 390 px. Les deux petites largeurs sont donc une **simulation** de l'échelle d'affichage, pas un test sur un vrai téléphone.

À faire : ouvrir la présentation sur un téléphone d'agent, de préférence à l'horizontale.
