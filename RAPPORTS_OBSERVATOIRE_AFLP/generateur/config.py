"""Paramètres du générateur de rapport hebdomadaire de l'Observatoire AFLP.

Toute valeur ici est un PARAMÈTRE DE GESTION, pas une donnée mesurée. Les modifier
change le rapport : chaque changement doit être noté dans METHODOLOGIE_REPORTING.md.
"""

VERSION_MOTEUR = "1.0.0"
FUSEAU = "Africa/Abidjan"  # UTC+0 toute l'année, sans heure d'été

# Ordre d'affichage des six clusters (codes de la table aflp_clusters).
CLUSTERS = ["SAKASSOU", "BOTRO", "BROBO", "DJEBONOUA", "BEOUMI", "DIABO"]
LIBELLES_CLUSTERS = {
    "SAKASSOU": "Sakassou", "BOTRO": "Botro", "BROBO": "Brobo",
    "DJEBONOUA": "N'Djébonoua", "BEOUMI": "Béoumi", "DIABO": "Diabo",
}
ZONES = {"SAKASSOU": "GBEKE_1", "BROBO": "GBEKE_1", "DJEBONOUA": "GBEKE_1",
         "BOTRO": "GBEKE_2", "BEOUMI": "GBEKE_2", "DIABO": "GBEKE_2"}

# Plan d'échantillonnage DÉCLARÉ par le Branch Manager le 17/11/2026 :
# 2 villages par cluster (3 à N'Djébonoua et Diabo) x 2 champs par village.
# À confirmer dans un document approuvé. Sert uniquement à mesurer l'installation.
CHAMPS_PREVUS = {"SAKASSOU": 4, "BOTRO": 4, "BROBO": 4, "DJEBONOUA": 6, "BEOUMI": 4, "DIABO": 6}

ARBRES_SUIVIS_PAR_CHAMP = 10   # A001 à A010 ; A011 et A012 = réserves

# Un pourcentage de stade n'est affiché que si son dénominateur (arbres OUI + NON)
# atteint ce seuil. En dessous : on affiche le rapport brut « k/n », jamais un %.
SEUIL_MIN_ARBRES_POURCENTAGE = 10
# Une évolution d'une semaine sur l'autre n'est calculée que si les deux semaines
# ont un dénominateur valide ET le même ensemble de champs (panel apparié).
EXIGER_PANEL_APPARIE = True

# Paliers EXPÉRIMENTAUX de préalerte (protocole v0.9). Jamais une autorisation de dépense.
PALIERS_EXPERIMENTAUX = (0.10, 0.20, 0.30)

# Seuils de qualité
DELAI_SYNCHRO_ALERTE_H = 48
DELAI_VALIDATION_ALERTE_H = 72

# Niveaux de confiance
CONFIANCE = ("INSUFFISANTE", "FAIBLE", "MOYENNE", "BONNE")

# Charte PJS Global (valeurs reprises du skill de marque ; texte jamais en noir pur)
COULEURS = {
    "emerald": "#008F37", "forest": "#053B23", "pine": "#00712C", "lime": "#8DC556",
    "pale": "#E0F3DE", "mist": "#F1F9EF", "orange": "#EE9E00", "texte": "#323131",
    "attenue": "#7A7878", "filet": "#E8E7E7", "bordure": "#D2D0D0", "surface": "#F4F4F3",
    "danger": "#C0392B", "info": "#0A5531", "blanc": "#FFFFFF",
}
