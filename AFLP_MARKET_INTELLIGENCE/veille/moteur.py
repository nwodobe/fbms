"""Moteur de consolidation hebdomadaire de l'Intelligence marché AFLP.

Ne rédige rien. Transforme les observations validées d'une semaine en indicateurs, en séparant
faits établis (CONFIRME, CORROBORE) et signaux à vérifier (NON_CONFIRME, CONTESTE).
Règles clés (DICTIONNAIRE_KPI.md) :
  * prix annoncé, proposé et payé ne sont jamais mélangés ; la tendance repose sur les prix PAYÉS ;
  * médiane pour des observations non pondérées ; moyenne pondérée seulement si toutes les quantités sont vérifiées ;
  * un même lot (lot_ref) n'est compté qu'une fois, quel que soit le nombre de lieux traversés ;
  * deux lignes de même chaîne de source ne font qu'UNE source ;
  * une case inconnue reste None (NON DISPONIBLE) ; l'absence de transaction observée n'est pas l'absence de marché ;
  * une information ancienne (fait daté de plus de 14 jours avant la semaine) sort des tendances de la semaine.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import referentiel as RF

SEUIL_PRIX = 3            # nb minimal de prix payés comparables pour publier une médiane
ECART_CONTESTE = 0.15     # écart relatif entre chaînes indépendantes au-delà duquel une valeur est CONTESTÉE
ANCIENNETE_MAX_J = 14
VILLAGES_FIXES_PAR_CLUSTER = 2
VILLAGES_TOURNANTS_PAR_CLUSTER = 1
ETABLIS = ("CONFIRME", "CORROBORE")


def _d(x):
    if x in (None, ""):
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    return date.fromisoformat(str(x)[:10])


def _f(x):
    try:
        return float(str(x).replace(" ", "").replace(",", ".")) if x not in (None, "") else None
    except ValueError:
        return None


def bornes(semaine):
    a, w = semaine.split("-W")
    lundi = date.fromisocalendar(int(a), int(w), 1)
    return lundi, lundi + timedelta(days=6)


def semaine_prec(semaine):
    l, _ = bornes(semaine)
    a, w, _ = (l - timedelta(days=7)).isocalendar()
    return f"{a}-W{w:02d}"


def statut_calcule(groupe):
    """Statut proposé pour un groupe (même thème, même village, même semaine).
    La validation humaine prime ; le moteur signale les désaccords."""
    # Chaîne absente = origine inconnue : jamais comptée comme source indépendante.
    chaines = {o.get("chaine_source") or "INCONNUE" for o in groupe}
    officielle = any(o.get("nature_source") in ("TRANSACTION_VERIFIEE", "SOURCE_OFFICIELLE") and o.get("preuve") for o in groupe)
    vals = [_f(o.get("valeur")) for o in groupe if _f(o.get("valeur")) is not None]
    if len(chaines) >= 2 and len(vals) >= 2:
        if (max(vals) - min(vals)) / max(min(vals), 1e-9) > ECART_CONTESTE:
            return "CONTESTE"
    if officielle:
        return "CONFIRME"
    if len(chaines) >= 2:
        return "CORROBORE"
    return "NON_CONFIRME"


def _stats_prix(vals):
    if not vals:
        return {"n": 0, "mediane": None, "min": None, "max": None, "statut": "NON_DISPONIBLE"}
    s = {"n": len(vals), "mediane": statistics.median(vals), "min": min(vals), "max": max(vals)}
    s["statut"] = "VALIDE" if len(vals) >= SEUIL_PRIX else "EFFECTIF_INSUFFISANT"
    if s["statut"] != "VALIDE":
        s["mediane"] = None
    return s


def consolider(observations, semaine, registre_ccak=None, operationnel=None, panel=None):
    debut, fin = bornes(semaine)
    sem_p = semaine_prec(semaine)
    anomalies, desaccords = [], []

    # --- tri et contrôles de base
    vues, propres = set(), []
    for o in observations:
        oid = o.get("id_observation")
        if not oid:
            anomalies.append({"type": "SANS_IDENTIFIANT", "detail": str(o)[:60]}); continue
        if oid in vues:
            anomalies.append({"type": "DOUBLON_IDENTIFIANT", "detail": oid}); continue
        vues.add(oid)
        if o.get("cluster") not in RF.CLUSTERS and o.get("type_acteur") != "DOCUMENT":
            anomalies.append({"type": "CLUSTER_INCONNU", "detail": oid}); continue
        if o.get("statut_fiabilite") and o["statut_fiabilite"] not in RF.STATUTS:
            anomalies.append({"type": "STATUT_INVALIDE", "detail": oid}); continue
        propres.append(o)

    def de_la_semaine(sem):
        d0, d1 = bornes(sem)
        res = []
        for o in propres:
            do = _d(o.get("date_observation"))
            if do is None or not (d0 <= do <= d1):
                continue
            df = _d(o.get("date_fait")) or do
            o = dict(o)
            o["ancienne"] = (d0 - df).days > ANCIENNETE_MAX_J
            res.append(o)
        return res

    cour, prec = de_la_semaine(semaine), de_la_semaine(sem_p)

    # --- statut : validation humaine prioritaire, statut calculé pour contrôle
    groupes = defaultdict(list)
    for o in cour:
        groupes[(o.get("theme"), o.get("village"), o.get("nature_prix"))].append(o)
    for g in groupes.values():
        sc = statut_calcule(g)
        for o in g:
            o["statut_calcule"] = sc
            o["statut_final"] = o.get("statut_fiabilite") or sc
            if o.get("statut_fiabilite") and o["statut_fiabilite"] != sc and sc == "CONTESTE":
                desaccords.append({"id": o["id_observation"], "valide": o["statut_fiabilite"], "calcule": sc})
    for o in prec:
        o["statut_final"] = o.get("statut_fiabilite") or "NON_CONFIRME"

    def etablis(lst):
        return [o for o in lst if o["statut_final"] in ETABLIS and not o["ancienne"] and o.get("refus") != "OUI"]

    def prix(lst, cl, nature, stade="BORD_CHAMP"):
        return [_f(o["valeur"]) for o in lst if o.get("cluster") == cl and o.get("module") == "M02"
                and o.get("nature_prix") == nature and o.get("stade_commercial") == stade and _f(o.get("valeur")) is not None
                and (o.get("unite") or "").upper() == "FCFA/KG"]

    def lots_uniques(lst, cl, grandeur):
        tot, vus = 0.0, set()
        n = 0
        for o in lst:
            if o.get("cluster") != cl or o.get("grandeur_volume") != grandeur or _f(o.get("quantite_kg")) is None:
                continue
            ref = o.get("lot_ref")
            if ref and ref in vus:
                continue
            if ref:
                vus.add(ref)
            tot += _f(o["quantite_kg"]); n += 1
        return {"kg": tot if n else None, "lignes": n}

    E_c, E_p = etablis(cour), etablis(prec)
    signaux = [o for o in cour if o["statut_final"] in ("NON_CONFIRME", "CONTESTE") or o["ancienne"]]

    clusters = {}
    for cl in RF.CLUSTERS:
        oc = [o for o in cour if o.get("cluster") == cl]
        villages = {o.get("village") for o in oc if o.get("village")}
        fixes_prevus = (panel or {}).get(cl, {}).get("fixes", [])
        fixes_vus = villages & set(fixes_prevus)
        paye = _stats_prix(prix(E_c, cl, "PAYE"))
        paye_p = _stats_prix(prix(E_p, cl, "PAYE"))
        evo = None
        if paye["statut"] == "VALIDE" and paye_p["statut"] == "VALIDE":
            evo = round(paye["mediane"] - paye_p["mediane"], 1)
        prod = [o for o in E_c if o.get("cluster") == cl and o.get("theme") == "P03_RECOLTE_DEBUT"]
        oui = sum(1 for o in prod if str(o.get("valeur")).upper() == "OUI")
        non = sum(1 for o in prod if str(o.get("valeur")).upper() == "NON")
        pts = [o for o in E_c if o.get("cluster") == cl and o.get("theme") == "A01_POINT_ACTIF"]
        actifs = sum(1 for o in pts if str(o.get("valeur")).upper() == "ACTIF")
        log = [o for o in E_c if o.get("cluster") == cl and o.get("module") == "M05"]
        refus = sum(1 for o in oc if o.get("refus") == "OUI")
        n_fiches = len({o["id_observation"].rsplit("-", 1)[0] for o in oc}) if oc else 0
        if not oc:
            confiance = "INSUFFISANTE"
        elif len(fixes_vus) >= VILLAGES_FIXES_PAR_CLUSTER and len(etablis(oc)) >= 5:
            confiance = "MOYENNE" if paye["statut"] != "VALIDE" else "BONNE"
        else:
            confiance = "FAIBLE"
        clusters[cl] = {
            "libelle": RF.LIB[cl], "observations": len(oc), "observations_etablies": len(etablis(oc)),
            "villages_visites": sorted(villages), "villages_fixes_prevus": fixes_prevus, "villages_fixes_visites": sorted(fixes_vus),
            "couverture_panel_fixe": (len(fixes_vus), len(fixes_prevus)) if fixes_prevus else None,
            "refus": refus, "fiches": n_fiches,
            "prix_paye": paye, "prix_paye_prec": paye_p, "evolution_prix_paye": evo,
            "prix_propose": _stats_prix(prix(E_c, cl, "PROPOSE_ACHETEUR")),
            "prix_demande": _stats_prix(prix(E_c, cl, "DEMANDE_VENDEUR")),
            "points_achat": {"actifs": actifs, "controles": len(pts)} if pts else None,
            "recolte_commencee": {"oui": oui, "repondants": oui + non} if prod else None,
            "volume_transactions": lots_uniques([o for o in E_c if o.get("nature_source") == "TRANSACTION_VERIFIEE"], cl, "ACHETEE_OU_EXPEDIEE"),
            "disponibilite_verifiee": lots_uniques(E_c, cl, "OBSERVEE_PHYSIQUEMENT"),
            "volume_annonce": lots_uniques(E_c, cl, "ANNONCEE_ESTIMEE"),
            "logistique_etablie": len(log),
            "signaux": sum(1 for o in signaux if o.get("cluster") == cl),
            "confiance": confiance,
        }

    reg = registre_ccak or []
    nouvelles = [r for r in reg if r.get("date_publication") and debut <= _d(r["date_publication"]) <= fin]
    ref_2027 = [r for r in reg if r.get("campagne") == "2027" and r.get("statut") in ETABLIS]
    total = sum(c["observations"] for c in clusters.values())
    return {
        "meta": {"semaine": semaine, "debut": debut.isoformat(), "fin": fin.isoformat(), "semaine_precedente": sem_p,
                 "version": RF.VERSION},
        "type_rapport": "MARCHE" if total else "ETAT_INITIAL_VEILLE",
        "global": {"observations": total, "etablies": len(E_c), "signaux": len(signaux),
                   "villages_visites": sum(len(c["villages_visites"]) for c in clusters.values()),
                   "villages_fixes_prevus": sum(len(c["villages_fixes_prevus"]) for c in clusters.values())},
        "clusters": clusters,
        "reglementaire": {"nouvelles_decisions_semaine": nouvelles, "reference_2027_etablie": bool(ref_2027),
                          "registre": reg},
        "operationnel": operationnel or {},
        "signaux": [{"id": o["id_observation"], "cluster": o.get("cluster"), "theme": o.get("theme"), "statut": o["statut_final"],
                     "ancienne": o["ancienne"], "valeur": o.get("valeur")} for o in signaux],
        "anomalies": anomalies, "desaccords_statut": desaccords,
    }
