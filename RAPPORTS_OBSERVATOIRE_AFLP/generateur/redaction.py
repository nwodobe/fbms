"""Gabarits de rédaction : transforment les résultats du moteur en phrases.

Aucun calcul ici, sauf mise en forme. Chaque chiffre cité provient de `res`.
"""
from datetime import datetime

from . import config as C

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]


def date_fr(iso, heure=False):
    d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    s = f"{d.day} {MOIS[d.month - 1]} {d.year}"
    return s + (f" à {d:%H:%M}" if heure else "")


def periode(res):
    m = res["meta"]
    return f"semaine {m['semaine']} (du {date_fr(m['debut'])} au {date_fr(m['cloture'])})"


def cellule_ratio(r, avec_pct=True):
    """Pourcentage seulement si le dénominateur est valide ; sinon k/n ou n/d."""
    if r["statut"] == "NON_DISPONIBLE":
        return "n/d"
    if r["statut"] == "DENOMINATEUR_NUL":
        return "0 arbre lisible"
    if r["statut"] == "DENOMINATEUR_INSUFFISANT":
        return f"{r['num']}/{r['den']} (effectif faible)"
    return f"{r['valeur']:.0%} ({r['num']}/{r['den']})" if avec_pct else f"{r['num']}/{r['den']}"


def cellule_evolution(evo):
    e = evo["f"]
    if e["statut"] != "VALIDE":
        return "non comparable"
    d = e["delta_points"]
    return f"{'+' if d > 0 else ''}{d:.0f} pt floraison"


def cellule_maturite(d):
    if d["champs_visites_valides"] == 0:
        return "n/d"
    m = d["maturite"]
    return f"vue agent {m['arbres_mure_vue_agent']} · déclarée {m['arbres_mure_declaree']}"


def cellule_couverture(d):
    if not d["champs_actifs"]:
        return f"aucun champ (0/{d['champs_prevus']} installé)"
    return f"{d['champs_visites_valides']}/{d['champs_actifs']} visité(s) · {d['champs_actifs']}/{d['champs_prevus']} installé(s)"


NATURE_LIB = {
    "STATISTIQUE_REPRESENTATIVE": "Statistique représentative",
    "TENDANCE_DESCRIPTIVE_PANEL": "Tendance descriptive du panel",
    "DONNEES_INSUFFISANTES": "Données insuffisantes",
}


def faits_marquants(res):
    g, m = res["global"], res["meta"]
    f = []
    f.append(f"Dispositif : {g['champs_actifs']} champ suivi actif sur {g['champs_prevus']} prévus, "
             f"dans {g['clusters_avec_champ']} cluster(s) sur 6. "
             + (f"Aucun champ installé à {', '.join(C.LIBELLES_CLUSTERS[c] for c in g['clusters_sans_champ'])}."
                if g["clusters_sans_champ"] else "Les six clusters disposent d'au moins un champ."))
    nv = g["champs_visites_valides"]
    vc = g["visites_par_classe"]
    autres = sum(n for k, n in vc.items() if k != "RETENUE_CANDIDATE")
    f.append(f"Visites : {nv} champ(s) avec une visite validée à date normale cette semaine"
             + (f" ; {autres} autre(s) visite(s) connue(s) du serveur hors indicateurs (non validées, rétrospectives ou tardives)." if autres
                else " ; aucune autre visite connue du serveur.")
             + " Les visites restées sur un téléphone non synchronisé sont inconnues du serveur.")
    if g["hors_perimetre"]:
        h = g["hors_perimetre"]
        d = sum(1 for x in h if x["doublon_parcelle_reelle"])
        f.append(f"Anomalie de périmètre : {len(h)} champ installé dans la campagne « {h[0]['campagne_nom']} »"
                 + (f", sur une parcelle déjà suivie dans la campagne réelle" if d else "")
                 + ". Il est exclu des calculs.")
    a = res["approvisionnement"]
    f.append(f"Achats bord champ (FBMS, jusqu'au BEV) : {a['lots_bord_champ'] if a['lots_bord_champ'] is not None else 'NON DISPONIBLE'} lot, "
             f"{a['bev'] if a['bev'] is not None else 'NON DISPONIBLE'} BEV. Fonds disponibles et prix de marché : NON DISPONIBLES.")
    return f


def evolution_texte(res):
    if res["type_rapport"] == "DEPLOIEMENT_ET_QUALITE":
        return ("Données agronomiques insuffisantes. Aucune visite validée n'est disponible pour la période : "
                "la floraison, la nouaison et la maturité ne peuvent pas être décrites cette semaine. "
                "Ce rapport est donc un rapport de déploiement et de qualité du dispositif. "
                "Les premières observations hebdomadaires doivent commencer la semaine suivante.")
    lignes = []
    for cl, d in res["clusters"].items():
        r = d["agregat"]["f"]["ratio"]
        if r["statut"] in ("VALIDE", "DENOMINATEUR_INSUFFISANT"):
            lignes.append(f"{d['libelle']} : floraison {cellule_ratio(r)}, nouaison {cellule_ratio(d['agregat']['n']['ratio'])}, "
                          f"évolution {cellule_evolution(d['evolution'])}.")
    return ("Sur les arbres désignés effectivement observés (tendance descriptive du panel, non représentative du cluster) : "
            + " ".join(lignes))


def confiance_texte(res):
    par = {}
    for cl, d in res["clusters"].items():
        par.setdefault(d["confiance"], []).append(d["libelle"])
    ordre = ["BONNE", "MOYENNE", "FAIBLE", "INSUFFISANTE"]
    return " ; ".join(f"{k.lower()} : {', '.join(par[k])}" for k in ordre if k in par) + "."


def note_branch_manager(res, recos, decision):
    """Paragraphe d'ouverture, chronologique, à la première personne du pluriel."""
    m, g = res["meta"], res["global"]
    prov = ("Cette version est provisoire : l'extraction a été faite avant la clôture du dimanche 23 h 59. "
            if m["version_rapport"] != "DEFINITIVE" else "")
    if res["type_rapport"] == "DEPLOIEMENT_ET_QUALITE":
        sans = len(g["clusters_sans_champ"])
        corps = (f"Le dispositif d'observation est en cours de mise en place. À la date d'extraction, "
                 f"{g['champs_actifs']} champ réel est actif sur les {g['champs_prevus']} prévus, "
                 f"et aucune visite n'a encore été validée. Nous ne pouvons donc rien conclure sur l'avancement biologique de la campagne. "
                 + (f"Le risque principal n'est pas agronomique : c'est l'absence de champ installé dans {sans} cluster(s) sur six."
                    if sans else "Le risque principal est l'absence de visites validées."))
    else:
        corps = (f"{g['champs_visites_valides']} champ(s) ont fait l'objet d'une visite validée sur {g['champs_actifs']} actifs. "
                 "Les tendances ci-dessous décrivent uniquement les arbres désignés par les Chefs d'Unité.")
    return prov + corps


def message_outlook_fr(res, recos):
    g, m = res["global"], res["meta"]
    props = [r for r in recos if r["niveau"] == "PROPOSITION_OPERATIONNELLE"][:2]
    txt = (f"Bonjour,\n\nVeuillez trouver ci-joint le point hebdomadaire de l'Observatoire agronomique AFLP ({m['semaine']}). "
           + ("Cette semaine reste une semaine d'installation : " if res["type_rapport"] != "AGRONOMIQUE" else "")
           + f"{g['champs_actifs']} champ suivi actif sur {g['champs_prevus']} prévus, {g['champs_visites_valides']} visite validée. "
           + ("Il n'y a donc pas encore de tendance agronomique à présenter, et je ne propose aucun engagement de moyens. "
              if res["type_rapport"] != "AGRONOMIQUE" else "")
           + "Les priorités de la semaine prochaine : "
           + "; ".join(p["titre"].lower() for p in props) + ". "
           + "Le rapport précise les limites des données et les points à vérifier.\n\nBien cordialement,\nInnocent KOUASSI\nBranch Manager, ANAGROCI")
    return txt


def message_outlook_en(res, recos):
    g, m = res["global"], res["meta"]
    txt = (f"Dear Neeraj,\n\nPlease find attached the weekly AFLP Agronomic Observatory note for {m['semaine']}. "
           + (f"This was still a set-up week: {g['champs_actifs']} monitored field is active out of {g['champs_prevus']} planned and "
              f"{g['champs_visites_valides']} visit has been validated so far, so there is no agronomic trend to report yet and I am not "
              "proposing any commitment of funds or logistics. " if res["type_rapport"] != "AGRONOMIQUE" else
              f"{g['champs_visites_valides']} of {g['champs_actifs']} active fields were visited and validated; trends describe designated trees only. ")
           + ("Next week the focus is on installing the remaining fields with the Zonal Heads and getting the weekly visits validated. "
              if g["champs_actifs"] < g["champs_prevus"] else "Next week the focus is on keeping weekly visit coverage and validation on time. ")
           + (f"The note also flags {len(g['hors_perimetre'])} field(s) recorded outside the real campaign, excluded from the figures."
              if g["hors_perimetre"] else "")
           + "\n\n"
           + "Best regards,\nInnocent KOUASSI\nBranch Manager, ANAGROCI")
    return txt
