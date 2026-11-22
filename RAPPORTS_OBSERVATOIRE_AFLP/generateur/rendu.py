"""Rendu des livrables : PDF de Direction, annexe Excel, registre des décisions, brouillon Outlook."""
from __future__ import annotations

import io
import json
import os
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from . import config as C
from . import redaction as T
from . import recommandations as R

K = {k: colors.HexColor(v) for k, v in C.COULEURS.items()}
STADES = (("f", "Floraison"), ("n", "Nouaison"), ("p", "Pommes"))


# ------------------------------------------------------------------ styles
def _styles():
    b = dict(fontName="Helvetica", textColor=K["texte"])
    return {
        "titre": ParagraphStyle("titre", fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=K["blanc"]),
        "sous": ParagraphStyle("sous", fontName="Helvetica", fontSize=8.5, leading=11, textColor=K["pale"]),
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=K["emerald"], spaceBefore=7, spaceAfter=2),
        "corps": ParagraphStyle("corps", fontSize=9.6, leading=12.6, alignment=TA_LEFT, **b),
        "puce": ParagraphStyle("puce", fontSize=9.4, leading=12.2, leftIndent=9, bulletIndent=0, **b),
        "petit": ParagraphStyle("petit", fontSize=7.6, leading=9.6, **b),
        "attenue": ParagraphStyle("attenue", fontName="Helvetica-Oblique", fontSize=7.6, leading=9.6, textColor=K["attenue"]),
        "cell": ParagraphStyle("cell", fontSize=7.8, leading=9.6, **b),
        "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=7.8, leading=9.6, textColor=K["texte"]),
        "entete": ParagraphStyle("entete", fontName="Helvetica-Bold", fontSize=7.8, leading=9.6, textColor=K["blanc"]),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=K["forest"], spaceAfter=4),
    }


def _bandeau(res, s, titre):
    m = res["meta"]
    vers = "VERSION DÉFINITIVE" if m["version_rapport"] == "DEFINITIVE" else "VERSION PROVISOIRE (avant clôture)"
    t = Table([[Paragraph(titre, s["titre"])],
               [Paragraph(f"Période de référence : {T.periode(res)} · Gel des données : {T.date_fr(m['gel_le'], True)} (heure d'Abidjan) · {vers}", s["sous"])]],
              colWidths=[180 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), K["forest"]), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
                           ("LINEBELOW", (0, -1), (-1, -1), 3, K["lime"])]))
    return t


def _pied(canvas, doc, res):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.8)
    canvas.setFillColor(K["attenue"])
    m = res["meta"]
    canvas.drawString(15 * mm, 9 * mm, f"ANAGROCI / PJS GLOBAL · Observatoire AFLP 2027 · Pilote : chiffres non officiels · "
                                       f"Moteur v{m['version_moteur']} · Empreinte instantané {m['empreinte_instantane'][:16]}")
    canvas.drawRightString(195 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _table(data, largeurs, s, zebre=True, entete=True):
    rows = [[c if not isinstance(c, str) else Paragraph(c, s["entete"] if (entete and i == 0) else s["cell"]) for c in r]
            for i, r in enumerate(data)]
    t = Table(rows, colWidths=[w * mm for w in largeurs], repeatRows=1 if entete else 0)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), 0.4, K["filet"]),
          ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
          ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if entete:
        st.append(("BACKGROUND", (0, 0), (-1, 0), K["forest"]))
    if zebre:
        for i in range(1 if entete else 0, len(rows)):
            if i % 2 == 0:
                st.append(("BACKGROUND", (0, i), (-1, i), K["pale"]))
    t.setStyle(TableStyle(st))
    return t


def _graphique_installation(res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cl = list(res["clusters"].keys())
    lib = [res["clusters"][c]["libelle"] for c in cl]
    prev = [res["clusters"][c]["champs_prevus"] for c in cl]
    act = [res["clusters"][c]["champs_actifs"] for c in cl]
    vis = [res["clusters"][c]["champs_visites_valides"] for c in cl]
    fig, ax = plt.subplots(figsize=(7.2, 2.5), dpi=180)
    x = range(len(cl))
    ax.bar([i - 0.27 for i in x], prev, 0.26, label="Prévus (plan déclaré)", color=C.COULEURS["bordure"])
    ax.bar(list(x), act, 0.26, label="Installés (actifs)", color=C.COULEURS["emerald"])
    ax.bar([i + 0.27 for i in x], vis, 0.26, label="Visite validée (semaine)", color=C.COULEURS["lime"])
    ax.set_xticks(list(x)); ax.set_xticklabels(lib, fontsize=8, color=C.COULEURS["texte"])
    ax.set_ylabel("Champs", fontsize=8, color=C.COULEURS["texte"])
    ax.tick_params(axis="y", labelsize=7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", color=C.COULEURS["filet"], alpha=0.6); ax.set_axisbelow(True)
    ax.legend(fontsize=7, frameon=False, ncol=3, loc="upper left")
    ax.set_ylim(0, max(prev) + 2)
    for i, v in enumerate(act):
        ax.text(i, v + 0.1, str(v), ha="center", fontsize=7, color=C.COULEURS["forest"])
    ax.set_title("Installation et couverture des champs suivis, par cluster", fontsize=9, color=C.COULEURS["forest"], loc="left", fontweight="bold")
    fig.tight_layout()
    buf = io.BytesIO(); fig.savefig(buf, format="png"); plt.close(fig); buf.seek(0)
    return buf


def _graphique_stades(res, historique):
    """Chronologie des stades : seulement si au moins 2 semaines VALIDES existent."""
    if not historique or len(historique) < 2:
        return None
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(7.2, 2.3), dpi=180)
    for cl in C.CLUSTERS:
        pts = [(h["semaine"], h["clusters"][cl]) for h in historique if h["clusters"].get(cl) is not None]
        if len(pts) >= 2:
            ax.plot([p[0] for p in pts], [p[1] * 100 for p in pts], marker="o", label=C.LIBELLES_CLUSTERS[cl])
    ax.set_ylabel("% arbres désignés en fleur", fontsize=8)
    ax.legend(fontsize=7, frameon=False, ncol=3)
    fig.tight_layout()
    buf = io.BytesIO(); fig.savefig(buf, format="png"); plt.close(fig); buf.seek(0)
    return buf


# ------------------------------------------------------------------ PDF
def pdf(res, recos, chemin, contexte_bm=None, historique=None):
    s = _styles()
    doc = SimpleDocTemplate(chemin, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm, bottomMargin=15 * mm,
                            title=f"ANAGROCI AFLP 2027 Intelligence agricole {res['meta']['semaine']}", author="Branch Manager ANAGROCI")
    E = []
    decision = R.decision_globale(res)
    # ---------------- PAGE 1 : NOTE DU BRANCH MANAGER
    E.append(_bandeau(res, s, "ANAGROCI | AFLP 2027 | Intelligence agricole hebdomadaire"))
    E.append(Spacer(1, 4))
    typ = "RAPPORT DE DÉPLOIEMENT ET DE QUALITÉ DU DISPOSITIF" if res["type_rapport"] != "AGRONOMIQUE" else "NOTE DU BRANCH MANAGER"
    E.append(Paragraph(f"NOTE DU BRANCH MANAGER · {typ}" if res["type_rapport"] != "AGRONOMIQUE" else typ, s["eyebrow"]))
    E.append(Paragraph(T.note_branch_manager(res, recos, decision), s["corps"]))
    if contexte_bm:
        E.append(Spacer(1, 3))
        E.append(Paragraph("<b>Contexte terrain (saisi par le Branch Manager, non calculé) :</b> " + contexte_bm, s["corps"]))
    E.append(Paragraph("FAITS MARQUANTS", s["eyebrow"]))
    for f in T.faits_marquants(res):
        E.append(Paragraph(f, s["puce"], bulletText="•"))
    E.append(Paragraph("ÉVOLUTION OBSERVÉE DE LA CAMPAGNE", s["eyebrow"]))
    E.append(Paragraph(T.evolution_texte(res), s["corps"]))
    E.append(Paragraph("NIVEAU DE CONFIANCE DANS LES DONNÉES", s["eyebrow"]))
    E.append(Paragraph("Confiance par cluster : " + T.confiance_texte(res) +
                       " Protocole actif : arbres désignés par les Chefs d'Unité (statut SUIVI_ARBRES_DESIGNES) : "
                       "les pourcentages éventuels décrivent ces arbres et ne représentent ni le village ni le cluster.", s["corps"]))
    att = [d["libelle"] for d in res["clusters"].values() if d["confiance"] in ("INSUFFISANTE", "FAIBLE")]
    E.append(Paragraph("CLUSTERS NÉCESSITANT UNE ATTENTION PARTICULIÈRE", s["eyebrow"]))
    E.append(Paragraph(", ".join(att) + " : couverture nulle ou faible." if att else "Aucun.", s["corps"]))
    E.append(Paragraph("CONSÉQUENCES OPÉRATIONNELLES POSSIBLES", s["eyebrow"]))
    E.append(Paragraph(decision, s["corps"]))
    E.append(Paragraph("DÉCISIONS RECOMMANDÉES À LA DIRECTION", s["eyebrow"]))
    top = [r for r in recos if r["niveau"] == "PROPOSITION_OPERATIONNELLE"] + [r for r in recos if r["niveau"] == "SIGNAL_A_VERIFIER"]
    for i, r in enumerate(top[:3], 1):
        E.append(Paragraph(f"<b>{i}. {r['titre']}</b> <font color='{C.COULEURS['attenue']}'>[{r['niveau']}]</font><br/>"
                           f"{r['constat']}<br/><i>Responsable : {r['responsable']} · Coût : {r['cout']} · Échéance : {r['echeance']} · "
                           f"Condition : {r['conditions_approbation']}</i>", s["puce"]))
        E.append(Spacer(1, 2))
    E.append(PageBreak())

    # ---------------- PAGE 2 : TABLEAU COMPARATIF
    E.append(_bandeau(res, s, "Tableau comparatif des six clusters"))
    E.append(Spacer(1, 5))
    mat = R.matrice(res)
    data = [["Cluster", "Couverture", "Floraison", "Nouaison", "Maturité (cumul)", "Évolution", "Confiance", "Action proposée"]]
    for cl, d in res["clusters"].items():
        a = d["agregat"]
        data.append([f"<b>{d['libelle']}</b><br/><font size=6.5 color='{C.COULEURS['attenue']}'>{T.NATURE_LIB[d['nature']]}</font>",
                     T.cellule_couverture(d), T.cellule_ratio(a["f"]["ratio"]), T.cellule_ratio(a["n"]["ratio"]),
                     T.cellule_maturite(d), T.cellule_evolution(d["evolution"]), d["confiance"].capitalize(), mat[cl]["rh"]])
    E.append(_table(data, [24, 30, 19, 19, 22, 18, 17, 31], s))
    E.append(Spacer(1, 4))
    E.append(Paragraph(
        "<b>Légende.</b> <b>Statistique représentative</b> : plan d'échantillonnage probabiliste complet et documenté (aucun cluster à ce stade). "
        "<b>Tendance descriptive du panel</b> : arbres désignés par les Chefs d'Unité, décrit ces seuls arbres, aucune extrapolation. "
        f"<b>Données insuffisantes</b> : aucune visite validée. Un pourcentage n'est affiché que si au moins {C.SEUIL_MIN_ARBRES_POURCENTAGE} arbres "
        "lisibles (OUI ou NON) le fondent ; sinon le rapport brut k/n est donné. PAS_VU et arbre non retrouvé ne sont jamais comptés NON. "
        "« n/d » : non disponible, jamais zéro. Maturité : chute de fruits mûrs vue par l'agent, distinguée de la déclaration du producteur. "
        "Les paliers 10/20/30 % sont expérimentaux et n'autorisent aucune dépense.", s["petit"]))
    E.append(Spacer(1, 6))
    E.append(Paragraph("MATRICE OPÉRATIONNELLE : DE L'OBSERVATION À LA PRÉPARATION DES ACHATS", s["eyebrow"]))
    d2 = [["Cluster", "Financement", "Ressources humaines", "Logistique", "Approvisionnement", "Risques"]]
    for cl, l in mat.items():
        d2.append([res["clusters"][cl]["libelle"], l["financement"], l["rh"], l["logistique"], l["approvisionnement"], l["risques"]])
    E.append(_table(d2, [20, 34, 34, 30, 34, 28], s))
    E.append(Spacer(1, 4))
    a = res["approvisionnement"]; c = res["cible"]
    E.append(Paragraph(
        f"<b>Repères approvisionnement.</b> Cible de travail AFLP : {int(c['target_mt']) if c['target_mt'] else 'NON DISPONIBLE'} MT de RCN "
        f"({'rattachée' if c['rattachee_campagne_reelle'] else 'non rattachée'} à la campagne réelle dans FBMS ; à revérifier contre le plan approuvé). "
        "C'est une cible d'achat, pas une prévision. Périmètre FBMS : terrain jusqu'au BEV ; réception, GRN et aval relèvent de PJS (non consulté).",
        s["petit"]))
    E.append(PageBreak())

    # ---------------- ANNEXES
    E.append(_bandeau(res, s, "Annexes : couverture, qualité, décisions"))
    E.append(Spacer(1, 4))
    E.append(Image(_graphique_installation(res), width=180 * mm, height=62 * mm))
    gs = _graphique_stades(res, historique)
    E.append(Paragraph("CHRONOLOGIE DES STADES OBSERVÉS", s["eyebrow"]))
    if gs:
        E.append(Image(gs, width=180 * mm, height=57 * mm))
    else:
        E.append(Paragraph("Non disponible : moins de deux semaines de visites validées. Aucun graphique n'est construit sans données.", s["attenue"]))
    E.append(Paragraph("SUIVI DE LA QUALITÉ DES DONNÉES (SEMAINE)", s["eyebrow"]))
    q = [["Cluster", "Brouil.", "Attente valid.", "> 72 h", "Correct.", "Rétro.", "Incoh.", "Doublons écartés", "Reçues > 48 h", "Après clôture", "Photos", "Non retrouvés"]]
    for cl, d in res["clusters"].items():
        x = d["qualite"]
        q.append([d["libelle"], str(x["brouillons"]), str(x["en_attente_validation"]), str(x["validations_bloquees_72h"]),
                  str(x["corrections_demandees"]), str(x["retrospectives"]), str(x["incoherentes"]), str(x["visites_concurrentes_ecartees"]),
                  str(x["recues_apres_48h"]), str(x["recues_apres_cloture"]), f"{x['photos_presentes']}/{x['photos_attendues']}",
                  str(x["arbres_non_retrouves"])])
    E.append(_table(q, [20, 14, 15, 11, 13, 12, 12, 17, 16, 16, 14, 20], s))
    E.append(Spacer(1, 3))
    hp = res["global"]["hors_perimetre"]
    if hp or res["anomalies"] or res["complements"]:
        lignes = [f"Champ hors périmètre {h['panel']} ({h['cluster']}, campagne {h['campagne_type']}"
                  + (", doublon d'une parcelle réelle" if h["doublon_parcelle_reelle"] else "") + ")" for h in hp]
        lignes += [f"{x['type']} : visite {x['visite']} ({x['detail']})" for x in res["anomalies"][:8]]
        lignes += [f"{x['nature']} : visite {x['visite']} ({x['semaine']})" for x in res["complements"]]
        E.append(Paragraph("<b>Anomalies, compléments et corrections documentés :</b> " + " ; ".join(lignes) + ".", s["petit"]))
    E.append(Paragraph("TABLEAU DES DÉCISIONS ET ACTIONS", s["eyebrow"]))
    dd = [["#", "Niveau", "Décision / action", "Responsable", "Coût", "Échéance", "Condition d'approbation"]]
    for i, r in enumerate(recos, 1):
        dd.append([str(i), r["niveau"].replace("_", " ").lower(), f"<b>{r['titre']}</b>", r["responsable"], r["cout"], r["echeance"], r["conditions_approbation"]])
    E.append(_table(dd, [6, 24, 44, 28, 22, 20, 36], s))
    E.append(Spacer(1, 4))
    E.append(Paragraph(
        f"Source : {res['meta']['source']}. Campagne : {res['meta']['campagne']['nom']} ({res['meta']['campagne']['type']}). "
        "Règles de calcul : DICTIONNAIRE_KPI.md. Les chiffres sont produits par le moteur avant toute rédaction ; les textes sont des gabarits "
        "alimentés par ces seuls chiffres. Aucune photographie, aucun nom de producteur et aucune coordonnée GPS ne figurent dans ce rapport.",
        s["attenue"]))
    doc.build(E, onFirstPage=lambda c, d: _pied(c, d, res), onLaterPages=lambda c, d: _pied(c, d, res))


# ------------------------------------------------------------------ Excel
def _xl_entete(ws, ligne, valeurs):
    from openpyxl.styles import Alignment, Font, PatternFill
    for j, v in enumerate(valeurs, 1):
        c = ws.cell(row=ligne, column=j, value=v)
        c.font = Font(bold=True, color="FFFFFF", name="Calibri")
        c.fill = PatternFill("solid", fgColor=C.COULEURS["forest"][1:])
        c.alignment = Alignment(wrap_text=True, vertical="top")


def _xl_lignes(ws, debut, lignes):
    from openpyxl.styles import Alignment, Font, PatternFill
    for i, l in enumerate(lignes):
        for j, v in enumerate(l, 1):
            c = ws.cell(row=debut + i, column=j, value=v)
            c.font = Font(name="Calibri", color=C.COULEURS["texte"][1:])
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if i % 2 == 1:
                c.fill = PatternFill("solid", fgColor=C.COULEURS["pale"][1:])


def _largeurs(ws, w):
    from openpyxl.utils import get_column_letter
    for j, x in enumerate(w, 1):
        ws.column_dimensions[get_column_letter(j)].width = x


def excel(res, recos, chemin):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active; ws.title = "LISEZ-MOI"
    m = res["meta"]
    info = [("Rapport", "ANAGROCI | AFLP 2027 | Intelligence agricole hebdomadaire"), ("Semaine", m["semaine"]),
            ("Début", m["debut"]), ("Clôture", m["cloture"]), ("Gel des données (UTC = Abidjan)", m["gel_le"]),
            ("Version", m["version_rapport"]), ("Type de rapport", res["type_rapport"]),
            ("Campagne", f"{m['campagne']['nom']} ({m['campagne']['type']})"), ("Source", m["source"]),
            ("Empreinte SHA-256 de l'instantané", m["empreinte_instantane"]), ("Version du moteur", m["version_moteur"]),
            ("Règle", "Une valeur vide signifie NON DISPONIBLE, jamais zéro. Un % n'est rempli que si le dénominateur est valide."),
            ("Statistique", "Protocole SUIVI_ARBRES_DESIGNES : tendances descriptives du panel, aucune extrapolation au village ou au cluster.")]
    _xl_entete(ws, 1, ["Élément", "Valeur"]); _xl_lignes(ws, 2, info); _largeurs(ws, [34, 110])

    ws = wb.create_sheet("CLUSTERS")
    cols = ["Cluster", "Zone", "Champs prévus", "Champs actifs", "Champs visités validés", "Couverture (valeur)", "Couverture (statut)",
            "Arbres désignés suivis", "Réserves en attente", "Réserves activées", "Arbres observés", "Arbres non retrouvés"]
    for k, lib in STADES:
        cols += [f"{lib} OUI", f"{lib} NON", f"{lib} PAS_VU", f"{lib} non retrouvé", f"{lib} dénominateur", f"{lib} %", f"{lib} statut"]
    cols += ["Chutes prématurées", "Mûre vue agent (cumul)", "Mûre déclarée producteur (cumul)", "Évolution floraison (pt)",
             "Statut statistique", "Nature", "Confiance"]
    lignes = []
    for cl, d in res["clusters"].items():
        a = d["agregat"]
        l = [d["libelle"], d["zone"], d["champs_prevus"], d["champs_actifs"], d["champs_visites_valides"], d["couverture"]["valeur"],
             d["couverture"]["statut"], d["arbres_suivis_designes"], d["reserves_en_attente"], d["reserves_activees"],
             a["arbres_observes"] if d["champs_visites_valides"] else None, a["non_retrouves"] if d["champs_visites_valides"] else None]
        for k, _ in STADES:
            vis = d["champs_visites_valides"] > 0
            r = a[k]["ratio"]
            l += [a[k]["OUI"] if vis else None, a[k]["NON"] if vis else None, a[k]["PAS_VU"] if vis else None,
                  a[k]["NON_RETROUVE"] if vis else None, r["den"], r["valeur"], r["statut"]]
        l += [a["chutes_prematurees"] if d["champs_visites_valides"] else None,
              d["maturite"]["arbres_mure_vue_agent"] if d["champs_visites_valides"] else None,
              d["maturite"]["arbres_mure_declaree"] if d["champs_visites_valides"] else None,
              d["evolution"]["f"]["delta_points"], d["statut_statistique"], d["nature"], d["confiance"]]
        lignes.append(l)
    _xl_entete(ws, 1, cols); _xl_lignes(ws, 2, lignes); _largeurs(ws, [14] * len(cols))
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if isinstance(c.value, float) and c.value <= 1:
                c.number_format = "0.0%"
    ws.freeze_panes = "B2"

    ws = wb.create_sheet("QUALITE")
    qk = list(next(iter(res["clusters"].values()))["qualite"].keys())
    _xl_entete(ws, 1, ["Cluster"] + qk)
    _xl_lignes(ws, 2, [[d["libelle"]] + [d["qualite"][k] for k in qk] for d in res["clusters"].values()])
    _largeurs(ws, [14] + [13] * len(qk))

    ws = wb.create_sheet("MATRICE_OPERATIONNELLE")
    mat = R.matrice(res)
    _xl_entete(ws, 1, ["Cluster", "Financement", "Ressources humaines", "Logistique", "Approvisionnement", "Risques"])
    _xl_lignes(ws, 2, [[res["clusters"][c]["libelle"], l["financement"], l["rh"], l["logistique"], l["approvisionnement"], l["risques"]] for c, l in mat.items()])
    _largeurs(ws, [14, 40, 40, 36, 40, 30])

    ws = wb.create_sheet("RECOMMANDATIONS")
    _xl_entete(ws, 1, ["#", "Niveau", "Titre", "Constat", "Sources", "Responsable", "Coût", "Conditions d'approbation", "Échéance", "Cluster"])
    _xl_lignes(ws, 2, [[i, r["niveau"], r["titre"], r["constat"], ", ".join(r["sources"]), r["responsable"], r["cout"],
                        r["conditions_approbation"], r["echeance"], r["cluster"]] for i, r in enumerate(recos, 1)])
    _largeurs(ws, [4, 26, 34, 70, 30, 26, 22, 36, 18, 18])

    ws = wb.create_sheet("CONTROLES")
    g = res["global"]
    ctrl = [("Champs actifs (campagne réelle)", g["champs_actifs"]), ("Champs prévus (plan déclaré 17/11/2026)", g["champs_prevus"]),
            ("Champs avec visite validée NORMALE", g["champs_visites_valides"]),
            ("Visites concurrentes écartées (dédoublonnage)", g["visites_concurrentes_ecartees"]),
            ("Visites locales non synchronisées", "INCONNU DU SERVEUR"),
            ("Champs hors périmètre (autre campagne)", len(g["hors_perimetre"])),
            ("Anomalies moteur", len(res["anomalies"])), ("Compléments / corrections post-transmission", len(res["complements"]))]
    for k, v in g["visites_par_classe"].items():
        ctrl.append((f"Visites de la semaine : {k}", v))
    a = res["approvisionnement"]
    for k in ("lots_bord_champ", "bev", "demandes_sacs", "enveloppes_sacs", "incidents", "fonds_disponibles", "prix_marche", "donnees_pjs"):
        ctrl.append((f"Approvisionnement : {k}", "NON DISPONIBLE" if a[k] is None else a[k]))
    _xl_entete(ws, 1, ["Contrôle", "Valeur"]); _xl_lignes(ws, 2, ctrl); _largeurs(ws, [55, 30])

    ws = wb.create_sheet("HORS_PERIMETRE_ANOMALIES")
    _xl_entete(ws, 1, ["Type", "Référence", "Détail"])
    rows = [["HORS_PERIMETRE", h["panel"], f"{h['cluster']} · {h['campagne_nom']} ({h['campagne_type']}) · doublon parcelle réelle : {h['doublon_parcelle_reelle']}"] for h in g["hors_perimetre"]]
    rows += [[x["type"], x["visite"], x["detail"]] for x in res["anomalies"]]
    rows += [[x["nature"], x["visite"], f"{x['semaine']} · reçue {x['recu_serveur_le']} · {x['statut']}"] for x in res["complements"]]
    _xl_lignes(ws, 2, rows or [["AUCUNE", "", ""]]); _largeurs(ws, [28, 14, 90])
    wb.save(chemin)


def registre(res, recos, chemin):
    """Registre cumulatif : ajoute les recommandations de la semaine sans écraser les décisions déjà saisies."""
    from openpyxl import Workbook, load_workbook
    from openpyxl.worksheet.datavalidation import DataValidation
    cols = ["ID", "Semaine", "Date du rapport", "Niveau", "Titre", "Constat", "Cluster", "Responsable", "Échéance", "Coût",
            "Conditions d'approbation", "Statut", "Décision du Branch Manager", "Date de décision", "Transmis à la Direction", "Commentaire"]
    if os.path.exists(chemin):
        wb = load_workbook(chemin); ws = wb["REGISTRE"]
    else:
        wb = Workbook(); ws = wb.active; ws.title = "REGISTRE"
        _xl_entete(ws, 1, cols); _largeurs(ws, [12, 10, 12, 24, 34, 60, 16, 24, 16, 18, 34, 14, 30, 14, 14, 30])
        dv = DataValidation(type="list", formula1='"A_EXAMINER,APPROUVEE,REJETEE,EN_COURS,REALISEE,ABANDONNEE"', allow_blank=False)
        ws.add_data_validation(dv); dv.add("L2:L2000")
        ws.freeze_panes = "A2"
    existants = {(r[1], r[4]) for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0]}
    n = ws.max_row
    sem = res["meta"]["semaine"]
    ajout = 0
    for r in recos:
        if (sem, r["titre"]) in existants:
            continue
        n += 1; ajout += 1
        vals = [f"{sem}-{ajout:02d}", sem, res["meta"]["gel_le"][:10], r["niveau"], r["titre"], r["constat"], r["cluster"],
                r["responsable"], r["echeance"], r["cout"], r["conditions_approbation"], "A_EXAMINER", None, None, "NON", None]
        for j, v in enumerate(vals, 1):
            ws.cell(row=n, column=j, value=v)
    wb.save(chemin)
    return ajout


def outlook(res, recos, chemin):
    fr = T.message_outlook_fr(res, recos)
    en = T.message_outlook_en(res, recos)
    assert len(fr) <= 1024 and len(en) <= 1024, (len(fr), len(en))
    entete = ("BROUILLON NON ENVOYÉ · À relire avant envoi\n"
              "Destinataire : à sélectionner dans les contacts Outlook (aucune adresse n'est créée par le générateur)\n"
              f"Objet (FR) : AFLP 2027 | Observatoire agronomique | {res['meta']['semaine']}\n"
              f"Subject (EN) : AFLP 2027 | Agronomic Observatory | {res['meta']['semaine']}\n"
              f"Pièce jointe : RAPPORT_OBSERVATOIRE_{res['meta']['semaine']}.pdf\n")
    with open(chemin, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write(entete + f"\n===== VERSION FRANÇAISE ({len(fr)} caractères) =====\n\n" + fr +
                f"\n\n===== ENGLISH VERSION ({len(en)} characters) =====\n\n" + en + "\n")
    return len(fr), len(en)
