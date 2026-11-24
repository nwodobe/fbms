"""Règles déterministes : résultats du moteur -> matrice opérationnelle et recommandations.

Trois niveaux, jamais plus :
  OBSERVATION                 constat sans implication opérationnelle démontrée
  SIGNAL_A_VERIFIER           tendance ou anomalie à confirmer
  PROPOSITION_OPERATIONNELLE  action argumentée : sources, responsable, coût, conditions

Garde-fous codés (et testés) :
  * aucune recommandation financière chiffrée sans données d'achat ET fonds confirmés ;
  * un palier expérimental n'est jamais une autorisation de dépense ;
  * une sélection non probabiliste ne produit jamais d'extrapolation ;
  * aucune action n'est exécutée : tout reste soumis à approbation humaine.
"""
from . import config as C

NIVEAUX = ("OBSERVATION", "SIGNAL_A_VERIFIER", "PROPOSITION_OPERATIONNELLE")


def _reco(niveau, titre, constat, sources, responsable, cout, conditions, echeance, cluster="TOUS"):
    assert niveau in NIVEAUX
    return {"niveau": niveau, "titre": titre, "constat": constat, "sources": sources,
            "responsable": responsable, "cout": cout, "conditions_approbation": conditions,
            "echeance": echeance, "cluster": cluster, "statut": "A_EXAMINER"}


def matrice(res):
    """Une ligne par cluster : financement, RH, logistique, approvisionnement, risques."""
    appro = res["approvisionnement"]
    lignes = {}
    for cl, d in res["clusters"].items():
        r = d["agregat"]["f"]["ratio"]
        flor = r["valeur"] if r["statut"] == "VALIDE" else None
        if appro["fonds_disponibles"] is None:
            fin = "NON DISPONIBLE (fonds non confirmés, aucune donnée d'achat)"
        else:
            fin = "À analyser"
        if d["champs_actifs"] < d["champs_prevus"]:
            rh = f"Installer {d['champs_prevus'] - d['champs_actifs']} champ(s) restant(s)"
        elif d["visites_non_realisees"]:
            rh = f"{d['visites_non_realisees']} visite(s) non réalisée(s) : renforcer la supervision"
        else:
            rh = "Rythme de visite conforme"
        if flor is not None and flor >= C.PALIERS_EXPERIMENTAUX[0] and d["confiance"] in ("MOYENNE", "BONNE"):
            logi = "Vérifier par anticipation sacs, motos, véhicules, transporteurs"
        else:
            logi = "Aucun déclencheur démontré"
        if appro["achats_constates"]:
            ap = "Noix disponibles constatées : rapprocher marché et achats"
        else:
            ap = "Aucune noix disponible corroborée (0 lot, 0 BEV)"
        risques = []
        if d["confiance"] in ("INSUFFISANTE", "FAIBLE"):
            risques.append("couverture faible")
        if d["agregat"]["chutes_prematurees"]:
            risques.append("chutes prématurées")
        q = d["qualite"]
        if q["validations_bloquees_72h"] or q["incoherentes"] or q["recues_apres_48h"]:
            risques.append("qualité des données")
        lignes[cl] = {"financement": fin, "rh": rh, "logistique": logi, "approvisionnement": ap,
                      "risques": ", ".join(risques) or "aucun signal"}
    return lignes


def recommander(res):
    recos = []
    g, appro, cible = res["global"], res["approvisionnement"], res["cible"]
    camp = res["meta"]["campagne"]["nom"]

    # 1. Champs installés hors campagne réelle
    hors = g["hors_perimetre"]
    if hors:
        doublons = sum(1 for h in hors if h["doublon_parcelle_reelle"])
        types = sorted({h["campagne_type"] for h in hors})
        recos.append(_reco(
            "SIGNAL_A_VERIFIER", "Champ(s) installé(s) hors de la campagne réelle",
            f"{len(hors)} champ(s) de l'Observatoire rattaché(s) à une campagne {', '.join(types)}"
            + (f", dont {doublons} sur une parcelle déjà suivie dans « {camp} »" if doublons else "")
            + ". Leurs futures visites seront exclues du rapport. Vérifier s'il s'agit d'un essai (captures du guide) "
              "ou d'une erreur de sélection de campagne dans l'application avant les premières visites.",
            ["pheno_panels.campaign_id", "campaigns.campaign_type"], "Branch Manager",
            "NUL (vérification)", "Toute correction ou suppression en production exige l'autorisation explicite du Branch Manager",
            "Avant la première visite"))

    # 2. Installation du dispositif vs plan déclaré
    if g["champs_actifs"] < g["champs_prevus"]:
        manquants = {cl: d["champs_prevus"] - d["champs_actifs"] for cl, d in res["clusters"].items()
                     if d["champs_actifs"] < d["champs_prevus"]}
        recos.append(_reco(
            "PROPOSITION_OPERATIONNELLE", "Achever l'installation des champs suivis",
            f"{g['champs_actifs']} champ(s) actif(s) sur {g['champs_prevus']} prévus au plan déclaré du 17/11/2026. "
            f"Clusters sans aucun champ : {', '.join(C.LIBELLES_CLUSTERS[c] for c in g['clusters_sans_champ']) or 'aucun'}. "
            "Sans installation, aucune tendance par cluster n'est mesurable.",
            ["pheno_panels (statut ACTIF)", "plan d'échantillonnage déclaré"],
            "Chefs de Zone, avec Chefs d'Unité", "INCONNU (déplacements sur budget moto existant à confirmer)",
            "Calendrier d'installation par cluster validé par le Branch Manager",
            "Semaine suivante", cluster=", ".join(C.LIBELLES_CLUSTERS[c] for c in manquants)))

    # 3. Champs actifs sans visite validée
    sans_visite = [cl for cl, d in res["clusters"].items() if d["champs_actifs"] and d["champs_visites_valides"] == 0]
    if sans_visite:
        recos.append(_reco(
            "PROPOSITION_OPERATIONNELLE", "Réaliser et valider la première visite hebdomadaire",
            f"Champ(s) installé(s) sans visite validée cette semaine : {', '.join(C.LIBELLES_CLUSTERS[c] for c in sans_visite)}. "
            "Une visite saisie mais non synchronisée reste inconnue du serveur : elle n'apparaît pas ici.",
            ["pheno_visites", "pheno_v_supervision"], "Chef d'Unité (collecte), Chef de Zone (validation)",
            "NUL", "Aucune", "Semaine suivante", cluster=", ".join(C.LIBELLES_CLUSTERS[c] for c in sans_visite)))

    # 4. Validations en souffrance
    bloq = {cl: d["qualite"]["validations_bloquees_72h"] for cl, d in res["clusters"].items() if d["qualite"]["validations_bloquees_72h"]}
    if bloq:
        recos.append(_reco(
            "PROPOSITION_OPERATIONNELLE", "Débloquer les validations en attente depuis plus de 72 h",
            "Visites soumises non validées : " + ", ".join(f"{C.LIBELLES_CLUSTERS[c]} {n}" for c, n in bloq.items()) + ".",
            ["pheno_visites.soumis_le"], "Chefs de Zone", "NUL", "Aucune", "48 h"))

    # 5. Cible de travail non rattachée
    if cible["target_mt"] and not cible["rattachee_campagne_reelle"]:
        recos.append(_reco(
            "SIGNAL_A_VERIFIER", "Cible AFLP non rattachée à la campagne réelle",
            f"La cible de {int(cible['target_mt']):,} MT est enregistrée dans FBMS sur une campagne {cible.get('campagne_type')} ".replace(",", " ")
            + f"(source : {cible['source']}). Il s'agit d'une cible d'approvisionnement à confirmer par le plan approuvé, "
            "pas d'une prévision agronomique.",
            ["aflp_program_targets"], "Branch Manager", "NUL",
            "Confirmation du plan approuvé avant tout rattachement en production", "Avant le premier rapport à la Direction"))

    # 6. Tendances agronomiques par cluster (jamais plus qu'un signal)
    for cl, d in res["clusters"].items():
        r = d["agregat"]["f"]["ratio"]
        if r["statut"] != "VALIDE":
            continue
        txt = (f"Floraison constatée sur {r['num']}/{r['den']} arbres désignés observés ({r['valeur']:.0%}). "
               "Tendance descriptive du panel, non représentative du cluster.")
        if r["valeur"] >= C.PALIERS_EXPERIMENTAUX[0] and d["confiance"] in ("MOYENNE", "BONNE"):
            recos.append(_reco("SIGNAL_A_VERIFIER", f"Floraison à confirmer : {d['libelle']}", txt +
                               " Recouper avec les RT et le marché avant toute préparation logistique.",
                               ["pheno_observations.f"], "Chef de Zone", "NUL",
                               "Le palier expérimental n'autorise aucune dépense", "Semaine suivante", cluster=d["libelle"]))
        else:
            recos.append(_reco("OBSERVATION", f"Floraison : {d['libelle']}", txt, ["pheno_observations.f"],
                               "Branch Manager", "NUL", "Aucune", "Suivi hebdomadaire", cluster=d["libelle"]))
        if d["agregat"]["chutes_prematurees"]:
            recos.append(_reco("SIGNAL_A_VERIFIER", f"Chutes prématurées : {d['libelle']}",
                               f"{d['agregat']['chutes_prematurees']} arbre(s) avec chute prématurée.",
                               ["pheno_observations.chute"], "Chef d'Unité", "NUL", "Aucune", "Semaine suivante",
                               cluster=d["libelle"]))

    # 7. Garde-fou financier explicite
    if not appro["achats_constates"] or appro["fonds_disponibles"] is None:
        recos.append(_reco(
            "OBSERVATION", "Aucune recommandation financière chiffrée",
            "Aucun lot bord champ ni BEV enregistré dans FBMS pour la campagne réelle, fonds disponibles non confirmés, "
            "aucune donnée de marché structurée. Une observation agronomique ne peut pas être convertie en besoin financier.",
            ["field_lots", "field_shipments", "source fonds : NON DISPONIBLE"], "Branch Manager", "SANS OBJET",
            "Aucune", "Sans objet"))
    return recos


def decision_globale(res):
    """Phrase-cadre : quand faut-il recommander de ne prendre AUCUNE décision d'engagement de moyens."""
    conf = [d["confiance"] for d in res["clusters"].values()]
    if all(c in ("INSUFFISANTE", "FAIBLE") for c in conf):
        return ("Aucune décision d'engagement de moyens (financement, achat, logistique) n'est recommandée cette semaine : "
                "les données agronomiques sont insuffisantes. Les décisions proposées portent uniquement sur le dispositif de mesure.")
    return ("Les signaux ci-dessous appellent des vérifications ciblées. Aucun engagement de dépense n'est proposé "
            "sans confirmation terrain, données d'achat et approbation de la Direction.")
