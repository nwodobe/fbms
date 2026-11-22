"""Référentiel unique de l'Intelligence marché AFLP : listes de valeurs, colonnes de la base et questionnaires.

Une seule source : la base Excel, les fiches papier, le moteur et (plus tard) l'écran FBMS lisent ces définitions.
"""

VERSION = "1.0.0"
CLUSTERS = ["SAKASSOU", "BOTRO", "BROBO", "DJEBONOUA", "BEOUMI", "DIABO"]
LIB = {"SAKASSOU": "Sakassou", "BOTRO": "Botro", "BROBO": "Brobo", "DJEBONOUA": "N'Djébonoua", "BEOUMI": "Béoumi", "DIABO": "Diabo"}

MODULES = {
    "M01": "CCAK et environnement réglementaire", "M02": "Prix et transactions", "M03": "Producteurs",
    "M04": "Acheteurs et coopératives", "M05": "Mouvements commerciaux et logistiques", "M06": "Qualité des noix",
    "M07": "Climat et environnement social", "M08": "Marché national et international", "M09": "Activités et capacités ANAGROCI",
    "M10": "Risques et opportunités",
}
CATEGORIES = {"A": "Agronomique", "B": "Commerciale de marché", "C": "Opérationnelle ANAGROCI"}
TYPES_ACTEUR = ["PRODUCTEUR", "ACHETEUR_PISTEUR", "COOPERATIVE", "TRANSPORTEUR", "AUTORITE", "TRANSFORMATEUR", "AUTRE", "DOCUMENT"]
NATURES_SOURCE = ["TRANSACTION_VERIFIEE", "OBSERVATION_DIRECTE", "DECLARATION", "SOURCE_OFFICIELLE", "INFORMATION_INDIRECTE"]
STATUTS = ["CONFIRME", "CORROBORE", "NON_CONFIRME", "CONTESTE", "OBSOLETE"]
NATURES_PRIX = ["DEMANDE_VENDEUR", "PROPOSE_ACHETEUR", "PAYE"]
STADES_COMMERCIAUX = ["BORD_CHAMP", "MAGASIN_INTERIEUR", "MAGASIN_USINE", "MAGASIN_PORTUAIRE", "AUTRE"]
PAIEMENT = ["COMPTANT", "DIFFERE", "AVANCE_DEJA_RECUE", "MOBILE_MONEY", "INCONNU"]
GRANDEURS_VOLUME = ["ANNONCEE_ESTIMEE", "OBSERVEE_PHYSIQUEMENT", "ACHETEE_OU_EXPEDIEE", "RECEPTIONNEE_OFFICIELLEMENT"]
QUALITE_NATURE = ["MESUREE", "DECLAREE"]
PANELS = ["FIXE", "TOURNANT", "HORS_PANEL"]

# Colonnes de la feuille OBSERVATIONS (une ligne = un fait rapporté)
COLONNES = [
    ("id_observation", "Identifiant unique (fiche-ligne), ex. SAK-2027W05-014"),
    ("date_observation", "Date de l'enquête (AAAA-MM-JJ)"),
    ("heure", "Heure de l'enquête (HH:MM)"),
    ("date_fait", "Date du fait rapporté (peut différer de l'enquête)"),
    ("cluster", "Code cluster"), ("village", "Village ou marché"), ("panel", "FIXE / TOURNANT / HORS_PANEL"),
    ("categorie", "A agronomique · B commerciale · C opérationnelle ANAGROCI"),
    ("module", "M01 à M10"), ("type_acteur", "Type d'acteur interrogé ou document"),
    ("theme", "Code du thème (voir QUESTIONNAIRES)"), ("valeur", "Valeur ou constat (nombre ou texte court)"),
    ("unite", "Unité normalisée (FCFA/kg, kg, %, oui/non)"),
    ("valeur_origine", "Montant ou quantité tels que dits (ex. 20 000 F le sac)"), ("unite_origine", "Unité d'origine"),
    ("nature_prix", "DEMANDE_VENDEUR / PROPOSE_ACHETEUR / PAYE (thèmes prix seulement)"),
    ("stade_commercial", "BORD_CHAMP / MAGASIN_INTERIEUR / ..."),
    ("quantite_kg", "Quantité concernée, si vérifiable"), ("grandeur_volume", "ANNONCEE_ESTIMEE / OBSERVEE_PHYSIQUEMENT / ACHETEE_OU_EXPEDIEE / RECEPTIONNEE_OFFICIELLEMENT"),
    ("paiement", "COMPTANT / DIFFERE / ..."), ("frais_deductions", "Frais, déductions, services inclus"),
    ("kor_lbs", "KOR mesuré (lbs/80 kg)"), ("humidite_pct", "Humidité mesurée (%)"), ("methode_qualite", "Méthode / appareil"),
    ("qualite_nature", "MESUREE / DECLAREE"),
    ("nature_source", "TRANSACTION_VERIFIEE / OBSERVATION_DIRECTE / DECLARATION / SOURCE_OFFICIELLE / INFORMATION_INDIRECTE"),
    ("chaine_source", "Origine première de l'information (code anonyme) : deux lignes de même chaîne ne sont PAS indépendantes"),
    ("preuve", "Référence de preuve facultative (photo du reçu, document)"),
    ("lot_ref", "Identifiant de lot ou de mouvement si preuve fiable (évite le double comptage)"),
    ("enqueteur", "Code agent"), ("refus", "OUI si l'acteur a refusé de répondre (on n'insiste pas)"),
    ("statut_fiabilite", "CONFIRME / CORROBORE / NON_CONFIRME / CONTESTE / OBSOLETE"),
    ("valide_par", "Code validateur (Chef de Zone ou BM)"), ("date_validation", "AAAA-MM-JJ"),
    ("commentaire", "Texte libre court, sans nom de personne"),
]

# Questionnaires : (code thème, module, catégorie, question courte, type de réponse, unité)
QUESTIONNAIRES = {
    "PRODUCTEUR": {
        "titre": "Fiche P · Producteur (3 producteurs par village, choisis comme indiqué au plan d'enquête)",
        "consigne": "Se présenter, expliquer le but (connaître la saison), demander l'accord. Pas de nom, pas de téléphone. Un refus est respecté.",
        "questions": [
            ("P01_ENTRETIEN", "M03", "A", "Avez-vous déjà nettoyé votre plantation cette saison ?", "OUI / NON / EN COURS", ""),
            ("P02_ETAT_ARBRES", "M03", "A", "Vos arbres ont-ils des fleurs ? Des petites noix ?", "FLEURS / PETITES NOIX / RIEN / NE SAIT PAS", ""),
            ("P03_RECOLTE_DEBUT", "M03", "B", "Avez-vous déjà ramassé des noix cette saison ?", "OUI / NON", ""),
            ("P04_QTE_RECOLTEE", "M03", "B", "Si oui, combien avez-vous ramassé en tout ? (dire l'unité : sacs, kg, bassines)", "nombre + unité", "kg"),
            ("P05_QTE_VENDUE", "M03", "B", "Combien avez-vous déjà vendu ?", "nombre + unité", "kg"),
            ("P06_STOCK_MAISON", "M03", "B", "Avez-vous des noix gardées à la maison ? L'agent les a-t-il vues ?", "OUI VU / OUI NON VU / NON", "kg"),
            ("P07_PRIX_PROPOSE", "M02", "B", "Quel prix un acheteur vous a-t-il proposé cette semaine ? Où et quand ?", "FCFA/kg ou montant d'origine", "FCFA/kg"),
            ("P08_PRIX_PAYE", "M02", "B", "Si vous avez vendu : quel prix avez-vous reçu ? Avez-vous un reçu ?", "FCFA/kg + reçu OUI/NON", "FCFA/kg"),
            ("P09_PAIEMENT", "M02", "B", "Avez-vous été payé tout de suite ou plus tard ?", "COMPTANT / DIFFERE / MOBILE MONEY", ""),
            ("P10_PRIX_ESPERE", "M03", "B", "À quel prix souhaitez-vous vendre ?", "FCFA/kg", "FCFA/kg"),
            ("P11_INTENTION", "M03", "B", "Comptez-vous vendre bientôt ou attendre ? Pourquoi ?", "VENDRE BIENTÔT / ATTENDRE + raison", ""),
            ("P12_ENGAGEMENT", "M03", "B", "Avez-vous déjà promis vos noix à un acheteur ? Y a-t-il un papier ?", "OUI ÉCRIT / OUI ORAL / NON / NE VEUT PAS DIRE", ""),
            ("P13_AVANCE", "M03", "B", "(Seulement si la personne en parle d'elle-même) Avez-vous reçu une avance ?", "OUI / NON / NON DEMANDÉ", ""),
            ("P14_SECHAGE", "M06", "B", "Comment séchez-vous les noix ? Combien de jours ?", "BÂCHE / SOL / AUTRE + jours", "jours"),
            ("P15_MAIN_OEUVRE", "M03", "A", "Trouvez-vous des personnes pour ramasser ?", "FACILE / DIFFICILE", ""),
            ("P16_DIFFICULTES", "M03", "B", "Quelle est votre plus grande difficulté pour vendre ?", "texte court", ""),
        ],
    },
    "ACHETEUR": {
        "titre": "Fiche A · Point d'achat, acheteur ou pisteur (observation et questions volontaires)",
        "consigne": "Observer ce qui est visible. Ne demander que des informations que l'acteur accepte de donner. Ne jamais discuter de prix à fixer ensemble, de partage de villages ou de stratégie : interdit.",
        "questions": [
            ("A01_POINT_ACTIF", "M04", "B", "Le point d'achat est-il ouvert et actif aujourd'hui ? (observé)", "ACTIF / INACTIF / FERMÉ DÉFINITIVEMENT", ""),
            ("A02_PRIX_AFFICHE", "M02", "B", "Quel prix d'achat est annoncé ou affiché ?", "FCFA/kg", "FCFA/kg"),
            ("A03_TRANSACTION_VUE", "M02", "B", "Une vente a-t-elle été vue ? Prix payé, poids, reçu ?", "FCFA/kg + kg + reçu", "FCFA/kg"),
            ("A04_PAIEMENT", "M02", "B", "Comment l'acheteur paie-t-il ? (s'il le dit)", "COMPTANT / DIFFÉRÉ / MOBILE MONEY", ""),
            ("A05_SACS", "M04", "B", "L'acheteur a-t-il des sacs ? (observé)", "OUI / PEU / NON", ""),
            ("A06_ENLEVEMENT", "M05", "B", "Depuis combien de jours le stock attend-il un camion ? (s'il le dit)", "jours", "jours"),
            ("A07_STOCK_VU", "M05", "B", "Stock visible au point d'achat (estimation en sacs, seulement si vu)", "sacs", "sacs"),
            ("A08_MOBILISATION", "M04", "B", "Des actions de mobilisation des producteurs sont-elles visibles ?", "texte court", ""),
            ("A09_NOUVEAU", "M04", "B", "Nouvel acheteur ou nouveau point d'achat dans la zone ?", "OUI / NON + type", ""),
            ("A10_QUALITE", "M06", "B", "Contrôle qualité observé (KOR, humidité) ? Valeur et appareil", "KOR lbs / humidité %", ""),
        ],
    },
    "COOPERATIVE": {
        "titre": "Fiche C · Coopérative ou groupement",
        "consigne": "Entretien avec un responsable volontaire. Aucun document confidentiel n'est demandé ni accepté.",
        "questions": [
            ("C01_ACTIVITE", "M04", "B", "La coopérative a-t-elle commencé à collecter cette saison ?", "OUI / NON / PRÉPARATION", ""),
            ("C02_VOLUME_DECLARE", "M04", "B", "Volume collecté déclaré publiquement ou documenté ?", "kg + nature", "kg"),
            ("C03_PRIX_MEMBRES", "M02", "B", "Prix payé aux membres (s'il est communiqué) ?", "FCFA/kg", "FCFA/kg"),
            ("C04_FINANCEMENT", "M04", "B", "La coopérative dispose-t-elle de fonds pour acheter ? (oui / non / ne dit pas)", "OUI / NON / NE DIT PAS", ""),
            ("C05_SACS_MAGASIN", "M04", "B", "Sacs et magasin disponibles ?", "OUI / NON / INSUFFISANT", ""),
            ("C06_VENTES_GROUPEES", "M01", "B", "Participation à des ventes groupées ou opérations CCAK ?", "texte court", ""),
            ("C07_DIFFICULTES", "M04", "B", "Principale difficulté de la saison ?", "texte court", ""),
        ],
    },
    "TRANSPORTEUR": {
        "titre": "Fiche T · Transporteur, chauffeur ou gare de chargement",
        "consigne": "Seulement des informations données volontairement. Aucun suivi de véhicule ou de personne.",
        "questions": [
            ("T01_DISPO_VEHICULES", "M05", "B", "Trouve-t-on facilement des camions cette semaine ?", "FACILE / DIFFICILE / IMPOSSIBLE", ""),
            ("T02_TARIF", "M05", "B", "Tarif de transport annoncé (trajet, unité) ?", "FCFA par sac / tonne / voyage", "FCFA"),
            ("T03_CHARGEMENTS", "M05", "B", "Chargements de noix vus aujourd'hui (nombre de camions, origine, destination si connue légalement)", "nombre", "camions"),
            ("T04_ROUTE", "M07", "B", "État de la route et des ponts vers les villages ?", "BON / DIFFICILE / COUPÉ", ""),
            ("T05_INCIDENT", "M05", "B", "Événement qui bloque les transports ?", "texte court", ""),
        ],
    },
    "VILLAGE": {
        "titre": "Fiche V · Contexte du village (une par visite)",
        "consigne": "Remplie par l'agent à chaque passage.",
        "questions": [
            ("V01_PLUIE", "M07", "A", "A-t-il plu cette semaine ? (vu ou dit)", "OUI VU / OUI DIT / NON", ""),
            ("V02_FEUX_MALADIES", "M07", "A", "Feux de brousse ou maladies des arbres vus ?", "OUI / NON + détail", ""),
            ("V03_EVENEMENT", "M07", "B", "Funérailles, fête, jour de marché qui occupent les producteurs ?", "texte court", ""),
            ("V04_ACCES", "M07", "B", "Accès au village (piste, pont) ?", "BON / DIFFICILE / COUPÉ", ""),
            ("V05_ACHETEURS_PRESENTS", "M04", "B", "Nombre d'acheteurs ou pisteurs vus dans le village", "nombre", ""),
            ("V06_REFUS", "M10", "B", "Nombre de personnes ayant refusé de répondre", "nombre", ""),
        ],
    },
}
