"""Matrice de rapprochement et recommandations argumentées (règles déterministes).

Chaque recommandation distingue : fait confirmé, hypothèse, information à obtenir, action envisagée,
responsable, échéance, coût (documenté ou INCONNU), autorité de décision.
Garde-fous : aucune prévision de volume ; aucune décision d'achat ou de financement ; un signal non confirmé
ne fonde jamais une conclusion établie.
"""
from . import referentiel as RF


def _r(niveau, titre, fait, hypothese, info, action, resp, echeance, cout, autorite):
    return dict(niveau=niveau, titre=titre, fait_confirme=fait, hypothese=hypothese, information_a_obtenir=info,
                action=action, responsable=resp, echeance=echeance, cout=cout, autorite=autorite, statut="A_EXAMINER")


def matrice_rapprochement(res, agro=None):
    """Une ligne par cluster : agronomie | producteurs | transactions | prix | logistique | capacités ANAGROCI.
    `agro` : résultats du moteur de l'Observatoire (facultatif), lus tels quels, jamais recalculés."""
    lignes = {}
    op = res.get("operationnel", {})
    for cl, d in res["clusters"].items():
        if agro and cl in agro.get("clusters", {}):
            a = agro["clusters"][cl]
            ag = (f"{a['champs_actifs']} champ(s) suivi(s), {a['champs_visites_valides']} visité(s) ; "
                  + ("données insuffisantes" if a["champs_visites_valides"] == 0 else "tendance descriptive du panel"))
        else:
            ag = "NON DISPONIBLE"
        rc = d["recolte_commencee"]
        prod = f"récolte commencée : {rc['oui']}/{rc['repondants']} producteurs interrogés" if rc else "non enquêté"
        vt = d["volume_transactions"]["kg"]
        trans = f"{vt:,.0f} kg documentés".replace(",", " ") if vt else "aucune transaction documentée"
        p = d["prix_paye"]
        prix = (f"médiane payée {p['mediane']:.0f} FCFA/kg (n={p['n']})" if p["statut"] == "VALIDE"
                else ("n/d" if p["n"] == 0 else f"{p['n']} prix payé(s) : effectif insuffisant"))
        logi = f"{d['logistique_etablie']} constat(s) établi(s)" if d["logistique_etablie"] else "aucun constat"
        cap = ("lots FBMS : " + ("NON DISPONIBLE" if op.get("lots") is None else str(op.get("lots")))
               + " · fonds : " + ("NON DISPONIBLE" if op.get("fonds") is None else str(op.get("fonds"))))
        lignes[cl] = {"agronomie": ag, "producteurs": prod, "transactions": trans, "prix": prix, "logistique": logi, "capacites": cap}
    return lignes


def recommander(res, agro=None):
    recos = []
    g = res["global"]
    reg = res["reglementaire"]
    if res["type_rapport"] == "ETAT_INITIAL_VEILLE":
        recos.append(_r(
            "PROPOSITION_OPERATIONNELLE", "Lancer le panel fixe d'enquête marché",
            f"Aucune observation de marché structurée n'est enregistrée ; {g['villages_fixes_prevus']} villages fixes proposés (2 par cluster).",
            "Une collecte régulière dans les mêmes villages rendra les évolutions comparables d'une semaine à l'autre.",
            "Validation de la liste des villages fixes et des enquêteurs ; disponibilité des motos et du carburant.",
            "Former les Chefs d'Unité et assistants aux 5 fiches ; premier passage dans les villages fixes la semaine suivante.",
            "Chefs de Zone, Chefs d'Unité", "Semaine suivante", "INCONNU (carburant sur budget moto existant à chiffrer)",
            "Branch Manager"))
    if not reg["reference_2027_etablie"]:
        recos.append(_r(
            "SIGNAL_A_VERIFIER", "Référence réglementaire 2027 non publiée",
            "Les prix planchers 2026 (400 FCFA/kg bord champ, 425 magasin intérieur) sont documentés ; aucun prix ni date d'ouverture 2027 n'est publié.",
            "Une annonce interviendra probablement avant l'ouverture, comme le 6 février en 2026 (hypothèse calendaire, non garantie).",
            "Communiqué officiel du CCAK pour 2027 (prix par stade, date d'ouverture, agréments).",
            "Ne pas utiliser 400 FCFA/kg dans les budgets 2027 comme prix acquis ; veille hebdomadaire des communiqués.",
            "Branch Manager (veille documentaire)", "Hebdomadaire jusqu'à l'annonce", "NUL", "Branch Manager"))
    recos.append(_r(
        "PROPOSITION_OPERATIONNELLE", "Vérifier les agréments CCAK avant l'ouverture 2027",
        "En 2026, tout intervenant dans l'achat devait être agréé par le CCAK (délégation régionale, AIP).",
        "La règle sera reconduite en 2027 (probable, non confirmé).",
        "Liste des agréments détenus par ANAGROCI et statut des intermédiaires (RT, coopératives).",
        "Inventorier les agréments et pièces exigibles ; préparer les dossiers manquants.",
        "Branch Manager avec le service conformité", "Avant l'ouverture de la campagne 2027", "INCONNU", "Direction"))
    for cl, d in res["clusters"].items():
        p = d["prix_paye"]
        if p["statut"] == "VALIDE" and d["evolution_prix_paye"] is not None and abs(d["evolution_prix_paye"]) >= 10:
            recos.append(_r("SIGNAL_A_VERIFIER", f"Variation du prix payé : {d['libelle']}",
                            f"Médiane payée {p['mediane']:.0f} FCFA/kg (n={p['n']}), {d['evolution_prix_paye']:+.0f} FCFA/kg sur une semaine (mêmes stade et règles).",
                            "Variation liée à la qualité, à la concurrence ou à la liquidité : non établi.",
                            "Qualité (KOR, humidité) des lots comparés ; nombre d'acheteurs actifs.",
                            "Recouper dans les villages fixes et tournants du cluster.", "Chef de Zone", "Semaine suivante", "NUL", "Branch Manager"))
        dv = d["disponibilite_verifiee"]["kg"]
        if dv and agro and agro.get("clusters", {}).get(cl, {}).get("champs_visites_valides", 0) == 0:
            recos.append(_r("OBSERVATION", f"Noix disponibles vérifiées sans suivi agronomique : {d['libelle']}",
                            f"{dv:,.0f} kg observés physiquement.".replace(",", " "), "Stock d'une campagne antérieure ou récolte précoce : non établi.",
                            "Date de récolte des noix observées.", "Aucune action d'achat ; documenter l'origine.", "Chef d'Unité",
                            "Semaine suivante", "NUL", "Branch Manager"))
    if g["signaux"]:
        recos.append(_r("SIGNAL_A_VERIFIER", "Signaux non confirmés à recouper",
                        f"{g['signaux']} information(s) non confirmée(s), contestée(s) ou ancienne(s).", "", "Seconde source indépendante.",
                        "Recouper avant toute mention parmi les conclusions.", "Chefs de Zone", "Semaine suivante", "NUL", "Branch Manager"))
    recos.append(_r("OBSERVATION", "Aucune décision d'achat ni de financement proposée",
                    "Aucune transaction ni disponibilité vérifiée en quantité suffisante dans le panel ; fonds disponibles non sourcés." if res["type_rapport"] == "ETAT_INITIAL_VEILLE"
                    else "Les constats du panel ne mesurent pas l'ensemble du marché régional.",
                    "", "Achats FBMS, fonds approuvés, prix 2027.", "Aucune.", "Branch Manager", "Sans objet", "SANS OBJET", "Direction"))
    return recos
