"""Moteur de calcul de l'Observatoire AFLP : calcule TOUS les chiffres du rapport.

Principe : ce module ne rédige rien. Il transforme un instantané gelé (JSON extrait
en lecture seule) en un dictionnaire de résultats. Les textes du rapport sont
produits ensuite par des gabarits à partir de ces seuls résultats : aucun chiffre
n'est recalculé ni « amélioré » au moment de la rédaction.

Règles (voir DICTIONNAIRE_KPI.md) :
  R1  Seule la campagne REAL courante compte ; les champs d'une autre campagne
      (SIMULATION, QA) sont exclus et signalés.
  R2  Une visite contribue aux indicateurs principaux si et seulement si :
      statut VALIDE, temporalité NORMALE, reçue par le serveur avant le gel.
  R3  Brouillons, soumises, en vérification, corrections demandées, rétrospectives
      et incohérentes sont comptées à part, jamais dans les indicateurs.
  R4  Un champ compte une seule fois par semaine (dédoublonnage des visites
      concurrentes : date d'observation, puis validation, puis réception la plus récente).
  R5  Un arbre compte une seule fois par visite ; seules les observations de
      TITULAIRES entrent dans les proportions (règle des vues pheno_v_*).
      Les réserves activées sont comptées à part ; une réserve non activée
      n'augmente jamais le nombre d'arbres suivis.
  R6  PAS_VU, arbre non retrouvé et valeur absente sortent du dénominateur :
      ils ne sont jamais comptés NON.
  R7  Une donnée absente vaut None (affichée NON DISPONIBLE), jamais 0.
  R8  Sélection non probabiliste (DESIGNATION) : statut SUIVI_ARBRES_DESIGNES,
      tendance descriptive du panel, aucune extrapolation, aucun palier.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from . import config as C

STADES = ("f", "n", "p")
LIB_STADES = {"f": "Floraison", "n": "Nouaison (jeunes noix)", "p": "Pommes"}


# ---------------------------------------------------------------- utilitaires
def _dt(x):
    if x is None:
        return None
    if isinstance(x, datetime):
        return x
    s = str(x).replace("Z", "+00:00")
    if len(s) == 10:
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def bornes_semaine(semaine_iso: str):
    """'2026-W47' -> (lundi 00:00, dimanche 23:59:59.999999) en heure d'Abidjan (=UTC)."""
    an, num = semaine_iso.split("-W")
    lundi = date.fromisocalendar(int(an), int(num), 1)
    debut = datetime(lundi.year, lundi.month, lundi.day, tzinfo=timezone.utc)
    fin = debut + timedelta(days=7) - timedelta(microseconds=1)
    return debut, fin


def semaine_de(d) -> str:
    d = _dt(d).date() if not isinstance(d, date) or isinstance(d, datetime) else d
    a, w, _ = d.isocalendar()
    return f"{a}-W{w:02d}"


def semaine_precedente(semaine_iso: str) -> str:
    debut, _ = bornes_semaine(semaine_iso)
    return semaine_de((debut - timedelta(days=3)).date())


def empreinte(instantane: dict) -> str:
    brut = json.dumps(instantane, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(brut).hexdigest()


def ratio(num, den, seuil=C.SEUIL_MIN_ARBRES_POURCENTAGE):
    """Retourne un dict lisible : jamais de % si le dénominateur est insuffisant."""
    if den is None:
        return {"num": None, "den": None, "valeur": None, "statut": "NON_DISPONIBLE"}
    if den == 0:
        return {"num": num, "den": 0, "valeur": None, "statut": "DENOMINATEUR_NUL"}
    if den < seuil:
        return {"num": num, "den": den, "valeur": None, "statut": "DENOMINATEUR_INSUFFISANT"}
    return {"num": num, "den": den, "valeur": round(num / den, 4), "statut": "VALIDE"}


# ---------------------------------------------------------------- moteur
def calculer(inst: dict, semaine: str, campagne_id: str | None = None,
             manifeste_precedent: dict | None = None) -> dict:
    gel = _dt(inst["gel_le"])
    debut, cloture = bornes_semaine(semaine)
    anomalies: list[dict] = []

    # --- R1 campagne
    camps = {c["id"]: c for c in inst.get("campagnes", [])}
    if campagne_id is None:
        reelles = [c for c in camps.values() if c.get("type") == "REAL" and c.get("courante")]
        if len(reelles) != 1:
            raise ValueError(f"Campagne réelle courante introuvable ou ambiguë ({len(reelles)}).")
        campagne_id = reelles[0]["id"]
    camp = camps.get(campagne_id, {"id": campagne_id, "nom": "INCONNUE", "type": "INCONNU"})

    panels_all = inst.get("panels", [])
    panels = [p for p in panels_all if p["campaign_id"] == campagne_id]
    hors = [p for p in panels_all if p["campaign_id"] != campagne_id]
    hashes_reels = {p.get("plot_hash") for p in panels if p.get("plot_hash")}
    hors_perimetre = [{
        "panel": p["id"][:8], "cluster": p["cluster_code"],
        "campagne_type": camps.get(p["campaign_id"], {}).get("type", "INCONNU"),
        "campagne_nom": camps.get(p["campaign_id"], {}).get("nom", "INCONNUE"),
        "doublon_parcelle_reelle": bool(p.get("plot_hash") and p["plot_hash"] in hashes_reels),
        "cree_le": p["created_at"],
    } for p in hors]

    panel_par_id = {p["id"]: p for p in panels}
    arbres = {a["id"]: a for a in inst.get("arbres", []) if a["panel_id"] in panel_par_id}
    titulaires_par_panel = defaultdict(int)
    reserves_attente = defaultdict(int)
    reserves_activees = defaultdict(int)
    for a in arbres.values():
        if a["role"] == "TITULAIRE" and a["statut"] in ("ACTIF", "REMPLACE"):
            titulaires_par_panel[a["panel_id"]] += 1 if a["statut"] == "ACTIF" else 0
        elif a["role"] == "RESERVE":
            if a["statut"] == "RESERVE_ACTIVEE":
                reserves_activees[a["panel_id"]] += 1
            else:
                reserves_attente[a["panel_id"]] += 1

    # Champs attendus : actifs et installés avant la clôture de la semaine.
    actifs = [p for p in panels if p["statut"] == "ACTIF" and _dt(p["created_at"]) <= cloture]

    # --- visites de la campagne
    visites = [v for v in inst.get("visites", []) if v["campaign_id"] == campagne_id and v["panel_id"] in panel_par_id]
    obs_par_visite = defaultdict(list)
    for o in inst.get("observations", []):
        obs_par_visite[o["visite_id"]].append(o)
    corrections_attente = defaultdict(int)
    for c in inst.get("corrections", []):
        if c.get("statut") == "PROPOSEE":
            corrections_attente[c["visite_id"]] += 1

    def classer(v):
        if _dt(v["recu_serveur_le"]) > gel:
            return "APRES_GEL"
        if v["statut"] == "BROUILLON":
            return "BROUILLON"
        if v["statut"] in ("SOUMIS", "EN_VERIFICATION"):
            return "EN_ATTENTE_VALIDATION"
        if v["statut"] == "CORRECTION_DEMANDEE":
            return "CORRECTION_DEMANDEE"
        if v["statut"] == "VALIDE":
            t = v.get("temporalite", "NORMALE")
            return {"NORMALE": "RETENUE_CANDIDATE", "RETROSPECTIVE": "RETROSPECTIVE"}.get(t, "INCOHERENTE")
        return "STATUT_INCONNU"

    def visites_semaine(sem):
        res = []
        for v in visites:
            if v["semaine_iso"] != sem:
                continue
            if semaine_de(v["date_observation"]) != v["semaine_iso"]:
                anomalies.append({"type": "SEMAINE_INCOHERENTE", "visite": v["id"][:8],
                                  "detail": "semaine_iso différente de la semaine de date_observation"})
            res.append(v)
        return res

    def retenir(vs):
        """R4 : une visite par champ et par semaine."""
        cand = defaultdict(list)
        for v in vs:
            if classer(v) == "RETENUE_CANDIDATE":
                cand[v["panel_id"]].append(v)
        retenues, ecartees = [], []
        for pid, lst in cand.items():
            lst.sort(key=lambda v: (str(v["date_observation"]), str(v.get("valide_le") or ""),
                                    str(v["recu_serveur_le"]), v["id"]), reverse=True)
            retenues.append(lst[0])
            ecartees.extend(lst[1:])
        return retenues, ecartees

    def mesurer_visite(v):
        """R5/R6 : comptage par arbre pour une visite retenue."""
        m = {"visite": v["id"], "panel": v["panel_id"], "cluster": v["cluster_code"],
             "titulaires_observes": 0, "titulaires_retrouves": 0, "non_retrouves": 0,
             "reserves_activees_observees": 0, "obs_ignorees": 0,
             "chute": defaultdict(int), "mure_vue_agent": 0, "mure_declaree": 0,
             "photos_attendues": 0, "photos_presentes": 0, "exceptions_photo": 0}
        for s in STADES:
            m[s] = {"OUI": 0, "NON": 0, "PAS_VU": 0, "NON_RETROUVE": 0, "NON_RENSEIGNE": 0}
        vus = set()
        for o in obs_par_visite.get(v["id"], []):
            a = arbres.get(o["arbre_id"])
            if a is None:
                m["obs_ignorees"] += 1
                anomalies.append({"type": "OBS_ARBRE_INCONNU", "visite": v["id"][:8], "detail": "arbre hors panel"})
                continue
            if o["arbre_id"] in vus:
                m["obs_ignorees"] += 1
                anomalies.append({"type": "OBS_EN_DOUBLE", "visite": v["id"][:8], "detail": a.get("code_suivi")})
                continue
            vus.add(o["arbre_id"])
            if a["role"] == "RESERVE":
                if a["statut"] == "RESERVE_ACTIVEE":
                    m["reserves_activees_observees"] += 1
                else:
                    m["obs_ignorees"] += 1
                    anomalies.append({"type": "OBS_SUR_RESERVE_NON_ACTIVEE", "visite": v["id"][:8], "detail": a.get("code_suivi")})
                continue
            m["titulaires_observes"] += 1
            retrouve = o.get("retrouve")
            if retrouve is True:
                m["titulaires_retrouves"] += 1
                m["photos_attendues"] += 1
                m["photos_presentes"] += 1 if o.get("photo_ref_presente") else 0
                m["exceptions_photo"] += 1 if o.get("photo_exception") else 0
            elif retrouve is False:
                m["non_retrouves"] += 1
            for s in STADES:
                if retrouve is False:
                    m[s]["NON_RETROUVE"] += 1
                elif o.get(s) in ("OUI", "NON", "PAS_VU"):
                    m[s][o[s]] += 1
                else:
                    m[s]["NON_RENSEIGNE"] += 1
            ch = o.get("chute") if retrouve is not False else "NON_RETROUVE"
            m["chute"][ch or "NON_RENSEIGNE"] += 1
            if ch == "MURE":
                if o.get("chute_preuve") == "DECLAREE_PRODUCTEUR":
                    m["mure_declaree"] += 1
                else:
                    m["mure_vue_agent"] += 1
        if m["titulaires_observes"] > C.ARBRES_SUIVIS_PAR_CHAMP:
            anomalies.append({"type": "DENOMINATEUR_GONFLE", "visite": v["id"][:8],
                              "detail": f"{m['titulaires_observes']} titulaires observés > {C.ARBRES_SUIVIS_PAR_CHAMP}"})
        m["chute"] = dict(m["chute"])
        return m

    def agreger(mesures, champs):
        g = {"champs": len(champs), "arbres_observes": 0, "arbres_retrouves": 0, "non_retrouves": 0,
             "reserves_activees_observees": 0, "chutes_prematurees": 0, "chutes_non_confirmees": 0,
             "mure_vue_agent": 0, "mure_declaree": 0, "photos_attendues": 0, "photos_presentes": 0,
             "exceptions_photo": 0, "panels": sorted(champs)}
        for s in STADES:
            g[s] = {"OUI": 0, "NON": 0, "PAS_VU": 0, "NON_RETROUVE": 0, "NON_RENSEIGNE": 0}
        for m in mesures:
            g["arbres_observes"] += m["titulaires_observes"]
            g["arbres_retrouves"] += m["titulaires_retrouves"]
            g["non_retrouves"] += m["non_retrouves"]
            g["reserves_activees_observees"] += m["reserves_activees_observees"]
            g["chutes_prematurees"] += m["chute"].get("PREMATUREE", 0)
            g["chutes_non_confirmees"] += m["chute"].get("NON_CONFIRME", 0)
            for k in ("mure_vue_agent", "mure_declaree", "photos_attendues", "photos_presentes", "exceptions_photo"):
                g[k] += m[k]
            for s in STADES:
                for k in g[s]:
                    g[s][k] += m[s][k]
        if not mesures:
            for s in STADES:
                g[s]["ratio"] = ratio(None, None)
        else:
            for s in STADES:
                g[s]["ratio"] = ratio(g[s]["OUI"], g[s]["OUI"] + g[s]["NON"])
        return g

    def analyser_semaine(sem):
        vs = visites_semaine(sem)
        retenues, ecartees = retenir(vs)
        mesures = [mesurer_visite(v) for v in retenues]
        par_cluster = {}
        for cl in C.CLUSTERS:
            ms = [m for m in mesures if m["cluster"] == cl]
            par_cluster[cl] = agreger(ms, {m["panel"] for m in ms})
        comptes = defaultdict(int)
        for v in vs:
            comptes[classer(v)] += 1
        return {"visites": vs, "retenues": retenues, "ecartees": ecartees, "mesures": mesures,
                "par_cluster": par_cluster, "comptes": dict(comptes)}

    cour = analyser_semaine(semaine)
    prec_sem = semaine_precedente(semaine)
    prec = analyser_semaine(prec_sem)

    # --- maturité cumulée (campagne, jusqu'à la clôture), sur visites retenues R2
    mure_cum = defaultdict(lambda: {"vue_agent": set(), "declaree": set()})
    for v in visites:
        if classer(v) != "RETENUE_CANDIDATE" or _dt(v["date_observation"]) > cloture:
            continue
        for o in obs_par_visite.get(v["id"], []):
            a = arbres.get(o["arbre_id"])
            if not a or a["role"] != "TITULAIRE" or o.get("chute") != "MURE":
                continue
            cle = "declaree" if o.get("chute_preuve") == "DECLAREE_PRODUCTEUR" else "vue_agent"
            mure_cum[v["cluster_code"]][cle].add(o["arbre_id"])

    # --- synthèse par cluster
    sup = {s["cluster_code"]: s for s in inst.get("supervision", []) if s.get("campaign_id") == campagne_id}
    clusters = {}
    for cl in C.CLUSTERS:
        p_actifs = [p for p in actifs if p["cluster_code"] == cl]
        modes = {p.get("mode_selection") for p in p_actifs}
        g = cour["par_cluster"][cl]
        gp = prec["par_cluster"][cl]
        n_actifs = len(p_actifs)
        n_visites = g["champs"]
        couverture = ratio(n_visites, n_actifs, seuil=1) if n_actifs else ratio(None, None)
        installation = ratio(n_actifs, C.CHAMPS_PREVUS[cl], seuil=1)
        if "DESIGNATION" in modes:
            statut_stat = "SUIVI_ARBRES_DESIGNES"
        elif modes == {"TIRAGE"} and all(p.get("pi_village") and p.get("pi_champ") for p in p_actifs):
            statut_stat = "PLAN_COMPLET"
        elif modes:
            statut_stat = "DESCRIPTIF_INTRA_CHAMP"
        else:
            statut_stat = "AUCUN_CHAMP"
        if n_visites == 0:
            nature = "DONNEES_INSUFFISANTES"
        elif statut_stat == "PLAN_COMPLET":
            nature = "STATISTIQUE_REPRESENTATIVE"
        else:
            nature = "TENDANCE_DESCRIPTIVE_PANEL"

        evolution = {}
        apparie = set(g["panels"]) == set(gp["panels"]) and g["panels"]
        for s in STADES:
            r1, r0 = g[s]["ratio"], gp[s]["ratio"]
            if r1["statut"] == "VALIDE" and r0["statut"] == "VALIDE" and (apparie or not C.EXIGER_PANEL_APPARIE):
                evolution[s] = {"delta_points": round((r1["valeur"] - r0["valeur"]) * 100, 1), "statut": "VALIDE"}
            else:
                evolution[s] = {"delta_points": None, "statut": "NON_COMPARABLE"}

        tit = sum(titulaires_par_panel[p["id"]] for p in p_actifs)
        mc = mure_cum[cl]
        maturite = {
            "arbres_mure_vue_agent": len(mc["vue_agent"]),
            "arbres_mure_declaree": len(mc["declaree"] - mc["vue_agent"]),
            "ratio_vue_agent": ratio(len(mc["vue_agent"]), tit) if n_visites else ratio(None, None),
        }
        s_sup = sup.get(cl, {})
        en_attente = sum(1 for v in cour["visites"] if v["cluster_code"] == cl and classer(v) == "EN_ATTENTE_VALIDATION")
        bloquees = sum(1 for v in visites if v["cluster_code"] == cl and classer(v) == "EN_ATTENTE_VALIDATION"
                       and v.get("soumis_le") and gel - _dt(v["soumis_le"]) > timedelta(hours=C.DELAI_VALIDATION_ALERTE_H))
        retard_sync = sum(1 for v in cour["visites"] if v["cluster_code"] == cl and v.get("saisie_le")
                          and _dt(v["recu_serveur_le"]) - _dt(v["saisie_le"]) > timedelta(hours=C.DELAI_SYNCHRO_ALERTE_H))
        apres_cloture = sum(1 for v in cour["visites"] if v["cluster_code"] == cl and _dt(v["recu_serveur_le"]) > cloture)

        # Confiance : couverture des champs installés ET installation vs plan.
        if n_visites == 0:
            confiance = "INSUFFISANTE"
        else:
            cv = couverture["num"] / couverture["den"]
            iv = installation["num"] / installation["den"]
            if cv >= 0.75 and iv >= 0.75 and bloquees == 0:
                confiance = "BONNE"
            elif cv >= 0.5 and iv >= 0.5:
                confiance = "MOYENNE"
            else:
                confiance = "FAIBLE"

        cl_vis = [v for v in cour["visites"] if v["cluster_code"] == cl]
        clusters[cl] = {
            "libelle": C.LIBELLES_CLUSTERS[cl], "zone": C.ZONES[cl],
            "champs_prevus": C.CHAMPS_PREVUS[cl], "champs_actifs": n_actifs,
            "champs_visites_valides": n_visites, "installation": installation, "couverture": couverture,
            "visites_non_realisees": max(n_actifs - n_visites, 0) if n_actifs else 0,
            "arbres_suivis_designes": tit,
            "reserves_en_attente": sum(reserves_attente[p["id"]] for p in p_actifs),
            "reserves_activees": sum(reserves_activees[p["id"]] for p in p_actifs),
            "statut_statistique": statut_stat, "nature": nature, "agregat": g, "evolution": evolution,
            "maturite": maturite, "confiance": confiance,
            "qualite": {
                "brouillons": sum(1 for v in cl_vis if classer(v) == "BROUILLON"),
                "en_attente_validation": en_attente,
                "validations_bloquees_72h": bloquees,
                "corrections_demandees": sum(1 for v in cl_vis if classer(v) == "CORRECTION_DEMANDEE"),
                "corrections_en_attente": sum(corrections_attente[v["id"]] for v in cl_vis),
                "retrospectives": sum(1 for v in cl_vis if classer(v) == "RETROSPECTIVE"),
                "incoherentes": sum(1 for v in cl_vis if classer(v) == "INCOHERENTE"),
                "visites_concurrentes_ecartees": sum(1 for v in cour["ecartees"] if v["cluster_code"] == cl),
                "recues_apres_48h": retard_sync, "recues_apres_cloture": apres_cloture,
                "photos_attendues": g["photos_attendues"], "photos_presentes": g["photos_presentes"],
                "exceptions_photo": g["exceptions_photo"], "arbres_non_retrouves": g["non_retrouves"],
                "pas_vu_floraison": g["f"]["PAS_VU"],
            },
            "supervision_serveur": s_sup or None,
        }

    # --- compléments / corrections par rapport à un rapport déjà transmis
    complements = []
    if manifeste_precedent:
        connu = {d["id"]: d["row_version"] for d in manifeste_precedent.get("visites", [])}
        sem_max = manifeste_precedent.get("semaine")
        for v in visites:
            if sem_max and v["semaine_iso"] > sem_max:
                continue
            if v["id"] not in connu:
                complements.append({"visite": v["id"][:8], "semaine": v["semaine_iso"], "nature": "COMPLEMENT_TARDIF",
                                    "recu_serveur_le": v["recu_serveur_le"], "statut": v["statut"]})
            elif v.get("row_version") != connu[v["id"]]:
                complements.append({"visite": v["id"][:8], "semaine": v["semaine_iso"], "nature": "CORRECTION_DOCUMENTEE",
                                    "recu_serveur_le": v["recu_serveur_le"], "statut": v["statut"]})

    # --- approvisionnement : FBMS couvre jusqu'au BEV ; aucune donnée PJS ici
    ach = inst.get("achats") or {}
    appro = {
        "lots_bord_champ": ach.get("field_lots"), "bev": ach.get("field_shipments_bev"),
        "demandes_sacs": ach.get("ops_bag_requests"), "enveloppes_sacs": ach.get("aflp_bag_envelopes"),
        "incidents": ach.get("aflp_incidents"),
        "fonds_disponibles": None, "prix_marche": None, "donnees_pjs": None,
    }
    appro["achats_constates"] = bool((appro["lots_bord_champ"] or 0) + (appro["bev"] or 0))
    cibles = inst.get("cible_programme") or []
    cible = {"target_mt": None, "rattachee_campagne_reelle": False, "source": None}
    for c in cibles:
        cible = {"target_mt": c["target_mt"], "source": c.get("source"),
                 "rattachee_campagne_reelle": c.get("campaign_id") == campagne_id,
                 "campagne_type": camps.get(c.get("campaign_id"), {}).get("type", "INCONNU")}

    total_retenues = len(cour["retenues"])
    prevus = sum(C.CHAMPS_PREVUS.values())
    res = {
        "meta": {
            "version_moteur": C.VERSION_MOTEUR, "semaine": semaine, "debut": debut.isoformat(),
            "cloture": cloture.isoformat(), "gel_le": gel.isoformat(), "semaine_cloturee": gel > cloture,
            "version_rapport": "DEFINITIVE" if gel > cloture else "PROVISOIRE_AVANT_CLOTURE",
            "source": inst.get("source"), "nature_donnees": inst.get("nature", "INCONNUE"),
            "empreinte_instantane": empreinte(inst),
            "campagne": {"id": campagne_id, "nom": camp.get("nom"), "type": camp.get("type")},
            "protocoles": inst.get("protocoles", []), "semaine_precedente": prec_sem,
        },
        "type_rapport": "AGRONOMIQUE" if total_retenues else "DEPLOIEMENT_ET_QUALITE",
        "message_agronomique": None if total_retenues else "Données agronomiques insuffisantes",
        "global": {
            "champs_prevus": prevus, "champs_actifs": len(actifs),
            "champs_visites_valides": total_retenues,
            "clusters_avec_champ": sum(1 for c in clusters.values() if c["champs_actifs"]),
            "clusters_sans_champ": [c for c, v in clusters.items() if not v["champs_actifs"]],
            "visites_par_classe": cour["comptes"],
            "visites_concurrentes_ecartees": len(cour["ecartees"]),
            "visites_locales_non_synchronisees": None,  # inconnues du serveur, par construction
            "hors_perimetre": hors_perimetre,
        },
        "clusters": clusters,
        "approvisionnement": appro, "cible": cible,
        "complements": complements, "anomalies": anomalies,
        "manifeste": {"semaine": semaine, "gel_le": gel.isoformat(),
                      "visites": [{"id": v["id"], "row_version": v.get("row_version")} for v in visites
                                  if v["semaine_iso"] <= semaine]},
    }
    return res
