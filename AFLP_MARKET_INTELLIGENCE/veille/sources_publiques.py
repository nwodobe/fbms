"""Veille documentaire initiale (22/11/2026) : informations PUBLIQUES, chacune avec sa source et son statut.

Règles :
  * aucune disposition 2026 n'est reprise automatiquement pour 2027 (champ `applicable_2027`) ;
  * plusieurs médias reprenant le même communiqué = UNE chaîne de source (champ `chaine_source`) ;
  * le communiqué original du CCAK n'a pas été consulté directement : statut au mieux CORROBORE tant qu'il ne l'est pas.
"""

CCAK = [
    # id, date_publication, date_effet, campagne, zone, disposition, consequence, source, url, chaine, statut, applicable_2027
    dict(id="CCAK-2026-001", date_publication="2026-02-06", date_effet="2026-02-09", campagne="2026", zone="National",
         disposition="Prix bord champ plancher de la noix de cajou bien séchée et triée : 400 FCFA/kg (baisse de 25 FCFA par rapport à 2025), annoncé par le Ministre de l'Agriculture à Yamoussoukro ; prix minimum révisable, bilan annoncé fin avril 2026.",
         consequence="Référence légale minimale d'achat bord champ pour 2026 uniquement.",
         source="AIP ; APA News ; Africa24", url="https://www.aip.ci/316084/cote-divoire-aip-le-prix-bord-champ-de-lanacarde-fixe-a-400-fcfa-kg-pour-la-campagne-2026-ministre/",
         chaine="Annonce ministérielle du 06/02/2026", statut="CORROBORE", applicable_2027="NON : campagne 2026"),
    dict(id="CCAK-2026-002", date_publication="2026-02-17", date_effet="2026-02-09", campagne="2026", zone="National",
         disposition="Prix planchers obligatoires 2026 : 400 FCFA/kg bord champ ; 425 FCFA/kg magasin intérieur acheteur ; 454 FCFA/kg magasin usine ; 484 FCFA/kg magasin portuaire.",
         consequence="Écart de 25 FCFA/kg entre bord champ et magasin intérieur : repère pour comparer les prix par stade commercial.",
         source="Koaci (17/02 et 13/05/2026), Burkina24, Bénin WebTV, relais AIP", url="https://www.koaci.com/article/2026/05/13/cote-divoire/societe/cote-divoire-filiere-anacarde-appel-au-respect-des-prix-officiels-fixes-par-le-gouvernement_196632.html",
         chaine="Communiqué CCAK prix planchers 2026", statut="CORROBORE", applicable_2027="NON : campagne 2026"),
    dict(id="CCAK-2026-003", date_publication="2026-02-17", date_effet="2026-02-09", campagne="2026", zone="National",
         disposition="Date officielle d'ouverture de la campagne de commercialisation 2026 : 9 février 2026.",
         consequence="Repère calendaire ; la date 2027 reste à publier.", source="Koaci ; RFI via AllAfrica",
         url="https://fr.allafrica.com/stories/202603170469.html", chaine="Communiqué CCAK ouverture 2026", statut="CORROBORE", applicable_2027="NON"),
    dict(id="CCAK-2026-004", date_publication="2026-02-12", date_effet="2026-02-09", campagne="2026", zone="Régions (ex. Daloa)",
         disposition="Tout intervenant dans l'achat doit être agréé par le Conseil Coton Anacarde Karité ; comités de veille chargés du respect du prix bord champ.",
         consequence="Vérifier les agréments des acteurs ANAGROCI et des intermédiaires avant l'ouverture 2027.",
         source="AIP (délégation régionale Daloa)", url="https://www.aip.ci/cote-divoire-aip-anacarde-la-campagne-de-commercialisation-2026-lancee-dans-le-departement-de-daloa/",
         chaine="Délégation régionale CCAK Daloa", statut="CORROBORE", applicable_2027="À VÉRIFIER : principe permanent probable, texte 2027 non publié"),
    dict(id="CCAK-2026-005", date_publication="2026-03-17", date_effet="2026-03", campagne="2026", zone="National",
         disposition="Prolongation de mesures de sécurisation de la filière ; le régulateur évoque un bon démarrage, prix bord champ respecté et enlèvement régulier.",
         consequence="Contenu exact des mesures non établi.", source="RFI via AllAfrica ; Bénin WebTV",
         url="https://fr.allafrica.com/stories/202603170469.html", chaine="Communication CCAK mars 2026", statut="NON_CONFIRME", applicable_2027="NON"),
    dict(id="CCAK-2026-006", date_publication="2026-05-13", date_effet="2026-05-13", campagne="2026", zone="National",
         disposition="Rappel du CCAK à tous les opérateurs du respect des prix planchers obligatoires, sur fond de préoccupations de producteurs liées à leur non-respect.",
         consequence="Signal : écarts de prix sous le plancher signalés en cours de campagne 2026 (ampleur non mesurée).",
         source="Koaci", url="https://www.koaci.com/article/2026/05/13/cote-divoire/societe/cote-divoire-filiere-anacarde-appel-au-respect-des-prix-officiels-fixes-par-le-gouvernement_196632.html",
         chaine="Communiqué CCAK 13/05/2026", statut="CORROBORE", applicable_2027="NON"),
    dict(id="CCAK-2026-007", date_publication="2026-03-25", date_effet="2026-03-25", campagne="Institutionnel", zone="National",
         disposition="Présidence du Conseil d'administration du CCA-K : M. Ehui Kouassi Jérôme succède à M. Ouattara Blidia.",
         consequence="Interlocuteur institutionnel ; pas d'effet commercial direct établi.", source="Abidjan.net",
         url="https://news.abidjan.net/dossier/4095-activites-du-conseil-du-coton-et-de-lanacarde/articles", chaine="Communication officielle", statut="CORROBORE", applicable_2027="OUI (institutionnel)"),
    dict(id="CCAK-2026-008", date_publication="2026-08-13", date_effet="2026-08-13", campagne="Préparation", zone="National",
         disposition="Remise de 309 motos et 5 véhicules pour renforcer l'encadrement et la recherche dans la filière anacarde.",
         consequence="Encadrement public renforcé ; effet sur le marché non établi.", source="Abidjan.net",
         url="https://news.abidjan.net/dossier/4095-activites-du-conseil-du-coton-et-de-lanacarde/articles", chaine="Communication CCAK", statut="NON_CONFIRME", applicable_2027="Sans objet"),
    dict(id="CCAK-2027-001", date_publication="2026-11-22", date_effet="", campagne="2027", zone="National",
         disposition="Prix bord champ, prix planchers par stade et date d'ouverture de la campagne 2027 : AUCUNE publication officielle trouvée à la date de veille. Un article (Capmad) évoque 400 FCFA/kg pour « 2026-2027 », sans communiqué cité.",
         consequence="Ne pas utiliser 400 FCFA/kg comme référence 2027. Surveiller l'annonce (en 2026 : Journées nationales, début février).",
         source="Recherche documentaire du 22/11/2026", url="https://www.capmad.com/article/ibrahim-kalil-konate-et-jaimentino-co-lancent-une-commission-ivoiro-bissau-guineenne-sur-lanacarde",
         chaine="Aucune source officielle", statut="CONTESTE", applicable_2027="EN ATTENTE"),
]

INTERNATIONAL = [
    # produit, qualite, origine, devise_unite, incoterm, periode, valeur, source, url, statut
    dict(id="INT-001", produit="RCN (offre)", qualite="non précisée", origine="Côte d'Ivoire vers Vietnam", unite="USD/tonne", incoterm="non précisé (offres)",
         periode="mai 2026", valeur="environ 960", source="Commodity Board (CMB)", url="https://commodity-board.com/nigeria-s-high-raw-nut-prices-reshuffle-global-cashew-trade-flows", statut="NON_CONFIRME"),
    dict(id="INT-002", produit="RCN (offre)", qualite="non précisée", origine="Nigeria vers Vietnam", unite="USD/tonne", incoterm="non précisé",
         periode="mai 2026", valeur="environ 1 600", source="Commodity Board (CMB)", url="https://commodity-board.com/nigeria-s-high-raw-nut-prices-reshuffle-global-cashew-trade-flows", statut="NON_CONFIRME"),
    dict(id="INT-003", produit="RCN importées (prix moyen)", qualite="toutes origines", origine="Vietnam (importations)", unite="USD/tonne", incoterm="prix moyen à l'import",
         periode="juillet 2026", valeur="environ 1 572 ; 255 888 t importées (−13,7 % sur un an)", source="Commodity Board, d'après statistiques vietnamiennes", url="https://commodity-board.com/cashew-market-softer-activity-despite-firmer-raw-nut-import-costs", statut="NON_CONFIRME"),
    dict(id="INT-004", produit="Amande WW320", qualite="WW320", origine="Vietnam", unite="EUR/kg", incoterm="FOB Hanoi",
         periode="novembre 2026", valeur="7,25 (stable)", source="Commodity Board", url="https://commodity-board.com/cashew-market-holds-firm-as-tanzania-ships-and-african-processors-advance", statut="NON_CONFIRME"),
    dict(id="INT-005", produit="Production RCN", qualite="", origine="Côte d'Ivoire, récolte 2026", unite="tonnes",
         incoterm="sans objet", periode="2026", valeur="1,35 à 1,40 Mt (CMB) contre environ 1,5 Mt (APEDA, MY26P)", source="Commodity Board ; APEDA (Inde)",
         url="https://commodity-board.com/cashew-market-tightens-as-west-african-crop-winds-down", statut="CONTESTE"),
    dict(id="INT-006", produit="Transformation locale", qualite="", origine="Côte d'Ivoire", unite="tonnes", incoterm="sans objet",
         periode="campagne 2026", valeur="achats des transformateurs supérieurs à 700 000 t ; plus de 600 000 t à transformer", source="Commodity Board",
         url="https://commodity-board.com/cashew-market-tightens-as-west-african-crop-winds-down", statut="NON_CONFIRME"),
]

NOTE_CONVERSION = ("Un prix CFR ou FOB en USD/tonne n'est pas comparable à un prix bord champ en FCFA/kg sans expliciter : "
                   "taux de change (EUR/XOF fixe à 655,957 ; USD/XOF variable, à dater), conversion tonne/kg, frais de collecte, "
                   "transport, magasinage, droits et taxes à l'export, fret maritime, marge et qualité (KOR). Le rapport ne fait aucune "
                   "conversion de ce type tant que ces éléments ne sont pas sourcés.")
