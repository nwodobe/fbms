/* ============================================================================
   AFLP MOTO MANAGER — contenus de formation (moto/moto-formation.js)
   Contenus de bonnes pratiques généraux, rédigés pour le pilote. Ils ne
   remplacent ni le manuel APSONIC AP150-30, ni une formation à la conduite.
   Aucune périodicité constructeur n'est affirmée ici.
   ========================================================================== */
(function (global) {
  'use strict';
  global.MOTO_FORMATION = [
    {
      code: 'CONTROLE_SECURITE', titre: 'Contrôle de sécurité avant départ', duree: '5 min',
      fiche: [
        'Faire le contrôle AVANT chaque départ, moto à l\'arrêt, moteur coupé.',
        'Freins avant et arrière : la moto doit s\'arrêter net en poussant à la main levier serré.',
        'Pneus : aucune coupure, hernie ou objet planté ; pression vérifiée au moins une fois par semaine.',
        'Direction : le guidon tourne librement, sans point dur ni jeu.',
        'Aucune fuite d\'huile ou de carburant sous la moto.',
        'Casque attaché et gilet haute visibilité portés.',
        'Un point critique en défaut = on ne part pas. La moto est immobilisée et l\'incident est déclaré, même sans réseau.'
      ],
      quiz: [
        { q: 'Le frein avant est mou au contrôle. Que faites-vous ?', r: ['Je pars doucement', 'Je ne pars pas et je déclare l\'anomalie critique', 'Je préviens en fin de journée'], b: 1 },
        { q: 'Sans réseau, une anomalie critique peut-elle être déclarée ?', r: ['Oui, elle est enregistrée et la moto est immobilisée sur le téléphone', 'Non, il faut attendre le réseau'], b: 0 },
        { q: 'À quel moment faire le contrôle avant départ ?', r: ['Une fois par semaine', 'Avant chaque départ', 'Après une panne seulement'], b: 1 },
        { q: 'Une fuite de carburant sous la moto est :', r: ['Un point non critique', 'Un point critique : pas de départ'], b: 1 },
        { q: 'Le casque doit être :', r: ['Accroché à la moto', 'Porté et attaché'], b: 1 }
      ]
    },
    {
      code: 'CARBURANT_JUSTIFICATIFS', titre: 'Carburant, plein complet et justificatifs', duree: '6 min',
      fiche: [
        'À chaque achat : date, compteur, litres, montant, plein complet ou partiel, photo lisible du reçu.',
        'Plein complet = réservoir rempli jusqu\'au même niveau à chaque fois. C\'est la seule façon de mesurer la consommation réelle.',
        'Faire au moins un plein complet de contrôle par mois.',
        'Argent reçu, argent dépensé, carburant acheté et carburant consommé sont quatre choses différentes.',
        'Confirmez dans l\'application le montant réellement reçu ; pour Mobile Money, le montant net après frais.',
        'Une alerte de consommation déclenche une vérification. Ce n\'est jamais une accusation.'
      ],
      quiz: [
        { q: 'Pourquoi faire des pleins complets ?', r: ['Pour mesurer la consommation réelle entre deux pleins', 'Pour dépenser plus vite la dotation'], b: 0 },
        { q: 'Vous recevez 9 900 FCFA sur un envoi Mobile Money de 10 000. Vous confirmez :', r: ['10 000', '9 900 et vous signalez l\'écart'], b: 1 },
        { q: 'Le reçu de la station est illisible :', r: ['Je saisis quand même sans photo', 'Je demande un reçu lisible et je le photographie'], b: 1 },
        { q: 'Une consommation au-dessus du seuil signifie :', r: ['Une faute de l\'agent', 'Une vérification à mener (compteur, plein, fuite, usage)'], b: 1 },
        { q: 'Vous avancez le carburant avec votre argent :', r: ['Je choisis « Avance personnelle » et je joins le reçu', 'Je ne déclare rien'], b: 0 }
      ]
    },
    {
      code: 'ENTRETIEN_PREVENTIF', titre: 'Entretien préventif', duree: '6 min',
      fiche: [
        'Chaîne : contrôler la tension et graisser régulièrement, plus souvent en saison poussiéreuse ou pluvieuse.',
        'Huile : vérifier le niveau chaque semaine. La périodicité de vidange est fixée par ANAGROCI dans l\'application.',
        'Filtre à air : à surveiller sur les pistes poussiéreuses.',
        'Toute réparation passe par une demande d\'entretien et une autorisation avant dépense.',
        'Conservez la facture : elle est photographiée et archivée dans le passeport de la moto.'
      ],
      quiz: [
        { q: 'Avant une réparation payante au garage :', r: ['Je paie et je demande le remboursement', 'Je fais une demande d\'entretien et j\'attends l\'autorisation'], b: 1 },
        { q: 'La périodicité de vidange est :', r: ['Celle paramétrée par ANAGROCI dans l\'application', 'Au choix du conducteur'], b: 0 },
        { q: 'Sur piste poussiéreuse, la chaîne :', r: ['Se graisse plus souvent', 'Ne se graisse jamais'], b: 0 },
        { q: 'La facture du garage :', r: ['Est jetée', 'Est photographiée et archivée'], b: 1 },
        { q: 'Le niveau d\'huile se vérifie :', r: ['Chaque semaine', 'Une fois par an'], b: 0 }
      ]
    },
    {
      code: 'INCIDENTS', titre: 'Panne, crevaison, accident', duree: '5 min',
      fiche: [
        'Mettre la personne et la moto en sécurité, hors de la chaussée.',
        'Déclarer l\'incident dans l\'application, avec photos si possible, même sans réseau.',
        'Accident ou incident critique : la moto est immobilisée automatiquement.',
        'La moto ne repart qu\'après diagnostic, réparation si nécessaire, contrôle et remise en service par un responsable.'
      ],
      quiz: [
        { q: 'Après un accident, la moto :', r: ['Repart si elle démarre', 'Est immobilisée jusqu\'au contrôle et à la remise en service'], b: 1 },
        { q: 'Première action après un incident sur la route :', r: ['Se mettre en sécurité', 'Remplir la déclaration en premier'], b: 0 },
        { q: 'Qui remet la moto en service après un incident critique ?', r: ['L\'agent lui-même', 'Un responsable, après un contrôle apte'], b: 1 },
        { q: 'Sans réseau, la déclaration :', r: ['Est enregistrée sur le téléphone puis envoyée au retour du réseau', 'Est impossible'], b: 0 },
        { q: 'Une crevaison réparée doit être :', r: ['Déclarée et tracée sur le pneu', 'Ignorée'], b: 0 }
      ]
    }
  ];
  global.MOTO_FORMATION_VIDEO = null; /* Aucun contenu vidéo réel disponible à la date de livraison. */
})(typeof window !== 'undefined' ? window : this);
