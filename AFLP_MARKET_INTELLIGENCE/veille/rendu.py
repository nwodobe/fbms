"""Rendu : base de veille Excel, registre CCAK, fiches terrain imprimables, rapport PDF, brouillon Outlook."""
from __future__ import annotations

import hashlib
import io
import os
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import referentiel as RF
from . import recommandations as R
from . import sources_publiques as S

C = {"emerald": "#008F37", "forest": "#053B23", "lime": "#8DC556", "pale": "#E0F3DE", "orange": "#EE9E00",
     "texte": "#323131", "attenue": "#7A7878", "filet": "#E8E7E7", "blanc": "#FFFFFF"}
K = {k: colors.HexColor(v) for k, v in C.items()}
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def date_fr(iso):
    d = date.fromisoformat(str(iso)[:10])
    return f"{d.day} {MOIS[d.month - 1]} {d.year}"


# ------------------------------------------------------------------ panel
def tirage_panel(villages_par_cluster, graine="AFLP-MARCHE-2027-v1"):
    """Tirage reproductible (empreinte SHA-256 de graine + village) : limite le biais des villages faciles d'accès.
    2 villages fixes par cluster ; les autres forment l'ordre de rotation du panel tournant. PROPOSITION à valider."""
    panel = {}
    for cl in RF.CLUSTERS:
        vs = sorted(villages_par_cluster.get(cl, []), key=lambda v: hashlib.sha256(f"{graine}|{cl}|{v}".encode()).hexdigest())
        panel[cl] = {"fixes": vs[:2], "rotation": vs[2:], "graine": graine}
    return panel


# ------------------------------------------------------------------ Excel helpers
def _xl(ws, ligne, valeurs, entete=False, zebre=False):
    from openpyxl.styles import Alignment, Font, PatternFill
    for j, v in enumerate(valeurs, 1):
        c = ws.cell(row=ligne, column=j, value=v)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if entete:
            c.font = Font(bold=True, color="FFFFFF", name="Calibri")
            c.fill = PatternFill("solid", fgColor=C["forest"][1:])
        else:
            c.font = Font(name="Calibri", color=C["texte"][1:])
            if zebre:
                c.fill = PatternFill("solid", fgColor=C["pale"][1:])


def _larg(ws, w):
    from openpyxl.utils import get_column_letter
    for j, x in enumerate(w, 1):
        ws.column_dimensions[get_column_letter(j)].width = x


def base_veille(chemin, panel, res=None):
    """Classeur de collecte et de consolidation. OBSERVATIONS est vide : aucune donnée fictive."""
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = Workbook()
    ws = wb.active; ws.title = "LISEZ-MOI"
    lignes = [
        ("Objet", "Base de collecte et de consolidation de l'Intelligence marché AFLP (catégorie B : données commerciales ; A et C seulement pour rapprochement)."),
        ("Règle 1", "Une ligne = un fait rapporté. Ne jamais modifier une ligne validée : ajouter une ligne et tracer le changement dans HISTORIQUE_STATUTS."),
        ("Règle 2", "Prix demandé, proposé et payé sont distincts (colonne nature_prix). Unité normalisée FCFA/kg ; garder le montant et l'unité d'origine."),
        ("Règle 3", "Une estimation orale ou une intention de vente n'est jamais un stock disponible (colonne grandeur_volume)."),
        ("Règle 4", "chaine_source : origine première de l'information. Deux agents répétant la même rumeur = une seule chaîne."),
        ("Règle 5", "Pas de nom, pas de téléphone, pas de coordonnée GPS de personne. Un refus est noté et respecté."),
        ("Règle 6", "Aucune information confidentielle de concurrent ; aucune discussion de coordination de prix ou de territoires."),
        ("Statuts", "CONFIRME · CORROBORE · NON_CONFIRME · CONTESTE · OBSOLETE (validation par le Chef de Zone ou le Branch Manager)."),
        ("Panel", "Feuille PANEL : 2 villages fixes par cluster tirés de façon reproductible parmi les 60 villages approuvés FBMS (PROPOSITION à valider) ; rotation du panel tournant."),
        ("Version", f"Référentiel {RF.VERSION}, généré le {date.today().isoformat()}"),
    ]
    _xl(ws, 1, ["Élément", "Contenu"], entete=True)
    for i, l in enumerate(lignes, 2):
        _xl(ws, i, l, zebre=i % 2 == 1)
    _larg(ws, [16, 120])

    ws = wb.create_sheet("OBSERVATIONS")
    _xl(ws, 1, [c for c, _ in RF.COLONNES], entete=True)
    for j, (_, aide) in enumerate(RF.COLONNES, 1):
        ws.cell(row=2, column=j, value=aide).font = ws.cell(row=2, column=j).font.copy(italic=True, color=C["attenue"][1:])
    _larg(ws, [16] * len(RF.COLONNES))
    ws.freeze_panes = "B3"
    listes = {"cluster": RF.CLUSTERS, "panel": RF.PANELS, "categorie": list(RF.CATEGORIES), "module": list(RF.MODULES),
              "type_acteur": RF.TYPES_ACTEUR, "nature_prix": RF.NATURES_PRIX, "stade_commercial": RF.STADES_COMMERCIAUX,
              "grandeur_volume": RF.GRANDEURS_VOLUME, "paiement": RF.PAIEMENT, "qualite_nature": RF.QUALITE_NATURE,
              "nature_source": RF.NATURES_SOURCE, "statut_fiabilite": RF.STATUTS, "refus": ["OUI", "NON"]}
    wl = wb.create_sheet("LISTES")
    for j, (col, vals) in enumerate(listes.items(), 1):
        _xl(wl, 1, [None] * (j - 1) + [col], entete=True) if False else None
        wl.cell(row=1, column=j, value=col)
        for i, v in enumerate(vals, 2):
            wl.cell(row=i, column=j, value=v)
        idx = [c for c, _ in RF.COLONNES].index(col) + 1
        lettre = get_column_letter(j)
        dv = DataValidation(type="list", formula1=f"=LISTES!${lettre}$2:${lettre}${len(vals) + 1}", allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{get_column_letter(idx)}3:{get_column_letter(idx)}5000")
    _xl(wl, 1, list(listes), entete=True)

    wt = wb.create_sheet("THEMES")
    _xl(wt, 1, ["Fiche", "Code thème", "Module", "Catégorie", "Question", "Réponse attendue", "Unité"], entete=True)
    i = 2
    for fiche, q in RF.QUESTIONNAIRES.items():
        for code, mod, cat, txt, rep, unite in q["questions"]:
            _xl(wt, i, [fiche, code, mod, cat, txt, rep, unite], zebre=i % 2 == 1); i += 1
    _larg(wt, [14, 22, 8, 9, 70, 34, 10])

    wp = wb.create_sheet("PANEL")
    _xl(wp, 1, ["Cluster", "Village fixe 1", "Village fixe 2", "Ordre de rotation (panel tournant)", "Graine du tirage", "Statut"], entete=True)
    for i, cl in enumerate(RF.CLUSTERS, 2):
        p = panel.get(cl, {"fixes": [], "rotation": []})
        f = p["fixes"] + [None, None]
        _xl(wp, i, [RF.LIB[cl], f[0], f[1], " → ".join(p["rotation"]), p.get("graine"), "PROPOSITION À VALIDER (BM)"], zebre=i % 2 == 1)
    _larg(wp, [14, 22, 22, 90, 22, 26])

    wh = wb.create_sheet("HISTORIQUE_STATUTS")
    _xl(wh, 1, ["id_observation", "date", "ancien statut", "nouveau statut", "motif", "par"], entete=True)
    _larg(wh, [20, 12, 16, 16, 60, 12])

    wc = wb.create_sheet("CAPACITES_ANAGROCI")
    _xl(wc, 1, ["Semaine", "Indicateur", "Valeur", "Nature (OBJECTIF / CAPACITE / PROMESSE / REALISE / RECONNU)", "Source", "Date"], entete=True)
    _larg(wc, [10, 40, 14, 40, 40, 12])

    if res:
        wr = wb.create_sheet("CONSOLIDATION")
        _xl(wr, 1, ["Cluster", "Observations", "Établies", "Villages visités", "Fixes visités / prévus", "Prix payé médian", "n prix payés",
                    "Évolution (FCFA/kg)", "Points d'achat actifs / contrôlés", "Récolte commencée (oui / répondants)",
                    "Volume documenté (kg)", "Disponibilité vérifiée (kg)", "Signaux", "Confiance"], entete=True)
        for i, (cl, d) in enumerate(res["clusters"].items(), 2):
            cv = d["couverture_panel_fixe"]; pa = d["points_achat"]; rc = d["recolte_commencee"]
            _xl(wr, i, [d["libelle"], d["observations"], d["observations_etablies"], len(d["villages_visites"]),
                        f"{cv[0]}/{cv[1]}" if cv else None, d["prix_paye"]["mediane"], d["prix_paye"]["n"], d["evolution_prix_paye"],
                        f"{pa['actifs']}/{pa['controles']}" if pa else None, f"{rc['oui']}/{rc['repondants']}" if rc else None,
                        d["volume_transactions"]["kg"], d["disponibilite_verifiee"]["kg"], d["signaux"], d["confiance"]], zebre=i % 2 == 1)
        _larg(wr, [14] * 14)
    wb.save(chemin)


def lire_observations(chemin):
    from openpyxl import load_workbook
    wb = load_workbook(chemin, read_only=True, data_only=True)
    ws = wb["OBSERVATIONS"]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    cols = list(rows[0])
    res = []
    for r in rows[2:]:
        if not r or not r[0]:
            continue
        d = dict(zip(cols, r))
        for k in ("date_observation", "date_fait", "date_validation"):
            if isinstance(d.get(k), datetime):
                d[k] = d[k].date().isoformat()
        res.append(d)
    return res


def registre_ccak(chemin):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active; ws.title = "REGISTRE_CCAK"
    cols = ["id", "date_publication", "date_effet", "campagne", "zone", "disposition", "consequence", "source", "url", "chaine", "statut", "applicable_2027"]
    _xl(ws, 1, ["ID", "Date de publication", "Date d'effet", "Campagne", "Zone", "Disposition applicable", "Conséquence commerciale",
                "Source", "Lien", "Chaîne de source", "Statut", "Validité 2027"], entete=True)
    for i, r in enumerate(S.CCAK, 2):
        _xl(ws, i, [r[c] for c in cols], zebre=i % 2 == 1)
    _larg(ws, [15, 12, 11, 12, 16, 70, 50, 30, 40, 26, 14, 30])
    ws.freeze_panes = "B2"
    wi = wb.create_sheet("INTERNATIONAL")
    ci = ["id", "produit", "qualite", "origine", "unite", "incoterm", "periode", "valeur", "source", "url", "statut"]
    _xl(wi, 1, ["ID", "Produit", "Qualité", "Origine", "Devise / unité", "Incoterm", "Période", "Valeur", "Source", "Lien", "Statut"], entete=True)
    for i, r in enumerate(S.INTERNATIONAL, 2):
        _xl(wi, i, [r[c] for c in ci], zebre=i % 2 == 1)
    _xl(wi, len(S.INTERNATIONAL) + 3, ["Note", S.NOTE_CONVERSION])
    _larg(wi, [9, 22, 14, 24, 14, 20, 14, 40, 30, 40, 14])
    wh = wb.create_sheet("HISTORIQUE_STATUTS")
    _xl(wh, 1, ["ID", "Date", "Ancien statut", "Nouveau statut", "Motif", "Par"], entete=True)
    for i, r in enumerate(S.CCAK + S.INTERNATIONAL, 2):
        _xl(wh, i, [r["id"], "2026-11-22", "", r["statut"], "Création du registre (veille documentaire initiale)", "Veille"])
    _larg(wh, [15, 12, 14, 14, 60, 10])
    wb.save(chemin)


# ------------------------------------------------------------------ fiches terrain PDF
def fiches_pdf(chemin):
    st = ParagraphStyle("c", fontName="Helvetica", fontSize=9.5, leading=12, textColor=K["texte"])
    stb = ParagraphStyle("b", parent=st, fontName="Helvetica-Bold")
    sth = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=K["blanc"])
    doc = SimpleDocTemplate(chemin, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
                            title="AFLP Intelligence marché : fiches terrain")
    E = []
    for k, (fiche, q) in enumerate(RF.QUESTIONNAIRES.items()):
        if k:
            E.append(PageBreak())
        t = Table([[Paragraph(f"ANAGROCI - AFLP · Intelligence marché · {q['titre']}", sth)]], colWidths=[186 * mm])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), K["forest"]), ("LINEBELOW", (0, 0), (-1, -1), 3, K["lime"]),
                               ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        E.append(t); E.append(Spacer(1, 4))
        ent = [["Date : ____/____/______  Heure : ____h____", "Cluster : ______________  Village : ______________________"],
               ["Panel :  FIXE  /  TOURNANT  /  HORS PANEL", "Type d'acteur : ______________  Code agent : ________"],
               ["Date du fait rapporté (si différente) : ____/____/______", "Refus de répondre :  OUI  /  NON"]]
        te = Table([[Paragraph(a, st), Paragraph(b, st)] for a, b in ent], colWidths=[93 * mm, 93 * mm])
        te.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, K["filet"]), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        E.append(te); E.append(Spacer(1, 3))
        E.append(Paragraph("<b>Consigne :</b> " + q["consigne"], st)); E.append(Spacer(1, 3))
        rows = [[Paragraph("<b>Code</b>", st), Paragraph("<b>Question</b>", st), Paragraph("<b>Réponse</b>", st),
                 Paragraph("<b>Source</b> : V = vu · R = reçu/preuve · D = dit · I = entendu dire", st)]]
        for code, mod, cat, txt, rep, unite in q["questions"]:
            rows.append([Paragraph(code.split("_")[0], stb), Paragraph(txt + f"<br/><font size=7.5 color='{C['attenue']}'>{rep}</font>", st), "", "V   R   D   I"])
        tq = Table(rows, colWidths=[14 * mm, 96 * mm, 42 * mm, 34 * mm], repeatRows=1)
        tq.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, K["filet"]), ("BACKGROUND", (0, 0), (-1, 0), K["pale"]),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        E.append(tq); E.append(Spacer(1, 4))
        E.append(Paragraph("Prix : toujours noter le montant et l'unité dits (ex. 20 000 F le sac de 80 kg), le lieu (bord champ, magasin) "
                           "et s'il s'agit d'un prix demandé, proposé ou payé. Quantité : préciser si elle est vue, dite ou prouvée par un reçu. "
                           "Ne jamais écrire de nom ni de numéro de téléphone.", st))
        E.append(Spacer(1, 6))
        E.append(Paragraph("Vérifié par (Chef d'Unité) : ________________   Saisi dans la base le : ____/____/______   Validé (Chef de Zone) : ________________", st))
    doc.build(E)


# ------------------------------------------------------------------ rapport PDF
def _s():
    b = dict(fontName="Helvetica", textColor=K["texte"])
    return {"t": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=K["blanc"]),
            "st": ParagraphStyle("st", fontName="Helvetica", fontSize=8.5, leading=11, textColor=K["pale"]),
            "e": ParagraphStyle("e", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=K["emerald"], spaceBefore=6, spaceAfter=2),
            "c": ParagraphStyle("c", fontSize=9.5, leading=12.4, **b),
            "p": ParagraphStyle("p", fontSize=9.3, leading=12, leftIndent=9, **b),
            "pt": ParagraphStyle("pt", fontSize=7.6, leading=9.6, **b),
            "a": ParagraphStyle("a", fontName="Helvetica-Oblique", fontSize=7.6, leading=9.6, textColor=K["attenue"]),
            "cell": ParagraphStyle("cell", fontSize=7.6, leading=9.4, **b),
            "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=7.6, leading=9.4, textColor=K["blanc"])}


def _band(titre, sous, s):
    t = Table([[Paragraph(titre, s["t"])], [Paragraph(sous, s["st"])]], colWidths=[180 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), K["forest"]), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, -1), (-1, -1), 7), ("LINEBELOW", (0, -1), (-1, -1), 3, K["lime"])]))
    return t


def _tab(data, w, s):
    rows = [[Paragraph(str(c), s["h"] if i == 0 else s["cell"]) for c in r] for i, r in enumerate(data)]
    t = Table(rows, colWidths=[x * mm for x in w], repeatRows=1)
    st = [("GRID", (0, 0), (-1, -1), 0.4, K["filet"]), ("BACKGROUND", (0, 0), (-1, 0), K["forest"]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]
    st += [("BACKGROUND", (0, i), (-1, i), K["pale"]) for i in range(2, len(rows), 2)]
    t.setStyle(TableStyle(st))
    return t


def rapport_pdf(res, recos, chemin, gel, agro=None):
    s = _s()
    m = res["meta"]
    sous = f"Semaine {m['semaine']} (du {date_fr(m['debut'])} au {date_fr(m['fin'])}) · Clôture dimanche 23 h 59 · Données arrêtées le {gel}"
    doc = SimpleDocTemplate(chemin, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm, bottomMargin=15 * mm,
                            title=f"ANAGROCI AFLP 2027 Market Intelligence {m['semaine']}")

    def pied(c, d):
        c.saveState(); c.setFont("Helvetica", 6.8); c.setFillColor(K["attenue"])
        c.drawString(15 * mm, 9 * mm, "ANAGROCI / PJS GLOBAL · Intelligence marché AFLP · Panel d'enquête : ne mesure pas l'ensemble du marché régional · usage interne")
        c.drawRightString(195 * mm, 9 * mm, f"Page {d.page}"); c.restoreState()

    E = [_band("ANAGROCI | AFLP 2027 | Market Intelligence Weekly Report", sous, s)]
    init = res["type_rapport"] == "ETAT_INITIAL_VEILLE"
    E.append(Paragraph("EXECUTIVE MARKET BRIEF" + (" · ÉTAT INITIAL DE LA VEILLE" if init else ""), s["e"]))
    g = res["global"]
    if init:
        E.append(Paragraph(
            "Nous ouvrons cette semaine le dispositif d'Intelligence marché AFLP. Aucune observation de marché structurée n'est encore "
            "enregistrée : ce premier rapport ne décrit donc aucune tendance de prix ni d'activité commerciale dans nos six clusters. "
            "Il pose l'état des connaissances vérifiables, les lacunes et le plan de collecte. L'absence de transaction observée ne signifie pas "
            "l'absence de marché : à cette période de pré-campagne, les achats de noix nouvelles ne sont pas attendus, mais des stocks anciens "
            "ou des ventes informelles peuvent exister sans être visibles pour nous.", s["c"]))
        conf = "Confiance globale : INSUFFISANTE pour toute conclusion de marché local ; documentation réglementaire et internationale : sources publiques, statut indiqué ligne par ligne."
    else:
        conf = f"Observations : {g['observations']} dont {g['etablies']} établies ; {g['signaux']} signal(aux) à vérifier."
    E.append(Paragraph(conf, s["c"]))
    E.append(Paragraph("RÉGLEMENTATION (CCAK)", s["e"]))
    E.append(Paragraph(
        "Campagne 2026 (documentée, corroborée par plusieurs médias relayant le CCAK et le Ministère) : prix bord champ plancher de 400 FCFA/kg, "
        "annoncé le 6 février 2026 en baisse de 25 FCFA ; prix planchers par stade de 425 FCFA/kg (magasin intérieur), 454 (usine) et 484 (portuaire) ; "
        "ouverture le 9 février 2026 ; agrément CCAK exigé de tout intervenant dans l'achat. En mai 2026, le CCAK a rappelé l'obligation de "
        "respecter les prix planchers. " + (
            "<b>Campagne 2027 : aucun prix ni date d'ouverture publiés à ce jour.</b> Les dispositions 2026 ne sont pas reportées sur 2027."
            if not res["reglementaire"]["reference_2027_etablie"] else
            "<b>Campagne 2027 :</b> " + " ".join(r["disposition"] for r in res["reglementaire"]["registre"]
                                                if r.get("campagne") == "2027" and r.get("statut") in ("CONFIRME", "CORROBORE"))), s["c"]))
    E.append(Paragraph("PRODUCTEURS, ACHETEURS, PRIX ET MOUVEMENTS DANS NOS CLUSTERS", s["e"]))
    if init:
        op = res["operationnel"]
        E.append(Paragraph(
            f"Non disponible : aucune enquête de marché réalisée. Repères FBMS (lecture seule) : {op.get('villages', 'n/d')} villages approuvés, "
            f"{op.get('producteurs', 'n/d')} producteurs au registre, {op.get('declarations_production', 'n/d')} déclarations de production "
            "issues de l'enrôlement coopératif (niveau DÉCLARÉ, brouillon, non vérifiées) ; aucun lot ni BEV enregistré pour la campagne réelle. "
            "Ces chiffres décrivent notre dispositif, pas le marché.", s["c"]))
    else:
        for cl, d in res["clusters"].items():
            p = d["prix_paye"]
            if d["observations"]:
                E.append(Paragraph(f"{d['libelle']} : {d['observations_etablies']} constat(s) établi(s) ; prix payé "
                                   + (f"médian {p['mediane']:.0f} FCFA/kg (n={p['n']})" if p["statut"] == "VALIDE" else "non publiable") + ".", s["p"]))
    E.append(Paragraph("MARCHÉ INTERNATIONAL (SOURCES SECONDAIRES, NON CONFIRMÉES)", s["e"]))
    E.append(Paragraph(
        "Les publications spécialisées consultées décrivent pour 2026 une récolte ivoirienne élevée mais d'estimation divergente (1,35 à 1,40 Mt "
        "selon Commodity Board, environ 1,5 Mt selon l'APEDA), une qualité jugée plus faible et une forte progression des achats des transformateurs "
        "locaux. Elles citent des offres de RCN ivoiriennes vers le Vietnam autour de 960 USD/t en mai 2026 et un prix moyen des RCN importées "
        "au Vietnam d'environ 1 572 USD/t en juillet. Ces prix internationaux ne sont pas comparables à un prix bord champ en FCFA/kg sans "
        "conversion complète des frais, du change et de la qualité : aucune conversion n'est faite ici.", s["c"]))
    E.append(Paragraph("OPPORTUNITÉS ET RISQUES", s["e"]))
    if not init:
        E.append(Paragraph("Voir les signaux à vérifier et la matrice de rapprochement en page 2 ; aucune opportunité n'est retenue sans preuve, incertitude et action proposée.", s["c"]))
    else:
      E.append(Paragraph(
        "Risque principal : arriver à l'ouverture 2027 sans référence de prix locale, sans réseau d'enquête rodé et sans agréments vérifiés. "
        "Opportunité : la pré-campagne laisse trois mois environ pour roder la collecte avant les premières transactions (hypothèse calendaire, "
        "fondée sur l'ouverture du 9 février en 2026).", s["c"]))
    E.append(Paragraph("RECOMMANDATIONS À LA DIRECTION", s["e"]))
    top = [r for r in recos if r["niveau"] != "OBSERVATION"][:3]
    for i, r in enumerate(top, 1):
        E.append(Paragraph(f"<b>{i}. {r['titre']}</b> <font color='{C['attenue']}'>[{r['niveau']}]</font><br/>"
                           f"<b>Fait :</b> {r['fait_confirme']} <b>Hypothèse :</b> {r['hypothese'] or 'aucune'} "
                           f"<b>À obtenir :</b> {r['information_a_obtenir']}<br/><i>Action : {r['action']} · Responsable : {r['responsable']} · "
                           f"Échéance : {r['echeance']} · Coût : {r['cout']} · Décision : {r['autorite']}</i>", s["p"]))
        E.append(Spacer(1, 2))
    E.append(PageBreak())

    # Page 2
    E.append(_band("Market Watch par cluster", sous, s)); E.append(Spacer(1, 5))
    data = [["Cluster", "Activité producteurs", "Prix observés", "Activité acheteurs", "Flux commerciaux", "Risques", "Confiance", "Action proposée"]]
    for cl, d in res["clusters"].items():
        rc, pa, p = d["recolte_commencee"], d["points_achat"], d["prix_paye"]
        prix = "n/d" if p["n"] == 0 else (f"payé méd. {p['mediane']:.0f} (n={p['n']})" + (f", {d['evolution_prix_paye']:+.0f} vs S-1" if d["evolution_prix_paye"] is not None else "")
                                         if p["statut"] == "VALIDE" else f"{p['n']} prix payé(s), effectif insuffisant")
        vt, dv = d["volume_transactions"]["kg"], d["disponibilite_verifiee"]["kg"]
        flux = "n/d" if not (vt or dv) else f"documenté {vt or 0:.0f} kg · vérifié {dv or 0:.0f} kg"
        fixes = d["villages_fixes_prevus"]
        action = (f"Enquêter les villages fixes ({', '.join(fixes)})" if fixes and not d["observations"] else
                  ("Compléter le panel fixe" if d["couverture_panel_fixe"] and d["couverture_panel_fixe"][0] < d["couverture_panel_fixe"][1] else "Poursuivre le suivi"))
        data.append([d["libelle"], f"{rc['oui']}/{rc['repondants']} ont commencé la récolte" if rc else "n/d", prix,
                     f"{pa['actifs']}/{pa['controles']} points actifs" if pa else "n/d", flux,
                     f"{d['signaux']} signal(aux) à vérifier" if d["signaux"] else ("absence de données" if not d["observations"] else "aucun établi"),
                     d["confiance"].capitalize(), action])
    E.append(_tab(data, [18, 24, 24, 21, 22, 22, 16, 33], s)); E.append(Spacer(1, 4))
    E.append(Paragraph("<b>Lecture.</b> « n/d » : non disponible, jamais zéro. Prix en FCFA/kg, bord champ, prix PAYÉS seulement, statut confirmé ou corroboré ; "
                       "médiane publiée à partir de 3 prix comparables. Prix demandés et proposés suivis à part. Évolution affichée seulement si les deux semaines sont comparables. "
                       "Les indicateurs du panel ne mesurent pas l'ensemble du marché régional.", s["pt"]))
    E.append(Paragraph("MATRICE DE RAPPROCHEMENT : AGRONOMIE · PRODUCTEURS · TRANSACTIONS · PRIX · LOGISTIQUE · CAPACITÉS", s["e"]))
    mat = R.matrice_rapprochement(res, agro)
    d2 = [["Cluster", "Agronomie (Observatoire)", "Producteurs", "Transactions", "Prix", "Logistique", "Capacités ANAGROCI"]]
    for cl, l in mat.items():
        d2.append([RF.LIB[cl], l["agronomie"], l["producteurs"], l["transactions"], l["prix"], l["logistique"], l["capacites"]])
    E.append(_tab(d2, [17, 32, 26, 25, 23, 20, 37], s)); E.append(Spacer(1, 3))
    E.append(Paragraph("Lecture attendue : des jeunes noix observées dans des champs suivis ne signifient pas une disponibilité commerciale ; "
                       "sans transaction ni stock vérifié, on renforce l'observation et on prépare la logistique, sans considérer un financement d'achat comme nécessaire.", s["a"]))
    E.append(PageBreak())

    # Annexes
    E.append(_band("Annexes : registre CCAK, international, actions, anomalies", sous, s)); E.append(Spacer(1, 4))
    E.append(Paragraph("REGISTRE DES INFORMATIONS CCAK", s["e"]))
    d3 = [["ID", "Publication", "Disposition", "Statut", "Validité 2027"]]
    for r in S.CCAK:
        d3.append([r["id"], r["date_publication"], r["disposition"], r["statut"], r["applicable_2027"]])
    E.append(_tab(d3, [20, 17, 95, 20, 28], s))
    E.append(Paragraph("INFORMATIONS INTERNATIONALES ET SOURCES", s["e"]))
    d4 = [["ID", "Produit", "Origine", "Unité / incoterm", "Période", "Valeur", "Source", "Statut"]]
    for r in S.INTERNATIONAL:
        d4.append([r["id"], r["produit"], r["origine"], f"{r['unite']} · {r['incoterm']}", r["periode"], r["valeur"], r["source"], r["statut"]])
    E.append(_tab(d4, [11, 22, 26, 26, 15, 33, 27, 20], s))
    E.append(Paragraph(S.NOTE_CONVERSION, s["a"]))
    E.append(Paragraph("HISTORIQUE DES PRIX COMPARABLES ET GRAPHIQUES", s["e"]))
    E.append(Paragraph("Non disponible : aucune série de prix payés comparables. Aucun graphique n'est construit sans données.", s["a"]))
    E.append(Paragraph("SUIVI DES ACTIONS RECOMMANDÉES", s["e"]))
    d5 = [["#", "Niveau", "Action", "Responsable", "Échéance", "Coût", "Décision"]]
    for i, r in enumerate(recos, 1):
        d5.append([i, r["niveau"].replace("_", " ").lower(), f"{r['titre']} : {r['action']}", r["responsable"], r["echeance"], r["cout"], r["autorite"]])
    E.append(_tab(d5, [6, 22, 66, 28, 20, 20, 18], s))
    E.append(Paragraph("ANOMALIES ET SOURCES NON CONFIRMÉES", s["e"]))
    nc = [r["id"] for r in S.CCAK + S.INTERNATIONAL if r["statut"] in ("NON_CONFIRME", "CONTESTE")]
    E.append(Paragraph(f"Sources documentaires non confirmées ou contestées : {', '.join(nc)}. Anomalies de saisie : {len(res['anomalies'])}. "
                       f"Désaccords entre statut validé et statut calculé : {len(res['desaccords_statut'])}. "
                       "Le communiqué original du CCAK n'a pas été consulté directement : les dispositions 2026 restent au statut CORROBORE.", s["pt"]))
    doc.build(E, onFirstPage=pied, onLaterPages=pied)


def outlook(res, recos, chemin):
    m = res["meta"]
    init = res["type_rapport"] == "ETAT_INITIAL_VEILLE"
    fr = ("Bonjour,\n\nVeuillez trouver ci-joint " + ("le premier" if init else "le") + " rapport hebdomadaire d'Intelligence marché AFLP (" + m["semaine"] + "). "
          + ("Il s'agit d'un état initial : nous n'avons pas encore d'observations de marché structurées dans nos six clusters, donc aucune tendance de prix à présenter. "
             if res["type_rapport"] == "ETAT_INITIAL_VEILLE" else "")
          + ("Côté réglementation, les prix planchers 2026 sont documentés (400 FCFA/kg bord champ) mais rien n'est encore publié pour 2027 : "
             "je recommande de ne pas budgéter sur ce niveau comme acquis. " if not res["reglementaire"]["reference_2027_etablie"]
             else "La référence réglementaire 2027 est publiée et détaillée dans le rapport. ")
          + ("Nous lançons la semaine prochaine un panel fixe de 12 villages et vérifions nos agréments CCAK avant l'ouverture. " if init else "")
          + 
          "Le rapport détaille les sources et leur fiabilité.\n\nBien cordialement,\nInnocent KOUASSI\nBranch Manager, ANAGROCI")
    en = ("Dear Neeraj,\n\nPlease find attached the " + ("first " if init else "") + "AFLP Market Intelligence weekly report (" + m["semaine"] + "). "
          + ("It is a baseline: we do not yet have structured market observations in our six clusters, so there is no local price trend to report. "
             if res["type_rapport"] == "ETAT_INITIAL_VEILLE" else "")
          + ("On regulation, the 2026 floor prices are documented (CFA 400/kg farmgate) but nothing has been published for 2027 yet, so I suggest we do not treat that level as given in our budgets. "
             if not res["reglementaire"]["reference_2027_etablie"] else "The 2027 regulatory reference is now published and detailed in the report. ")
          + ("Next week we start a fixed panel of 12 villages and check our CCAK licences ahead of the opening. " if init else "")
          + "Sources and their reliability are detailed in the report.\n\n"
          "Best regards,\nInnocent KOUASSI\nBranch Manager, ANAGROCI")
    assert len(fr) <= 1024 and len(en) <= 1024, (len(fr), len(en))
    with open(chemin, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write("BROUILLON NON ENVOYÉ · Ne pas envoyer sans validation du Branch Manager\n"
                "Destinataire : à sélectionner dans les contacts Outlook (aucune adresse créée)\n"
                f"Objet : AFLP 2027 | Market Intelligence | {m['semaine']}\nPièce jointe : RAPPORT_MARCHE_HEBDO_{m['semaine']}.pdf\n\n"
                f"===== VERSION FRANÇAISE ({len(fr)} caractères) =====\n\n{fr}\n\n===== ENGLISH VERSION ({len(en)} characters) =====\n\n{en}\n")
    return len(fr), len(en)
