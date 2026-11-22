#!/usr/bin/env python3
"""Compilation hebdomadaire de l'Intelligence marché AFLP (MVP option B).

Usage (depuis ce dossier) :
  python generer_rapport_marche.py --semaine 2026-W47 [--base sorties/BASE_VEILLE_MARCHE.xlsx]
         [--villages sorties/villages_approuves_fbms.json] [--observatoire ../RAPPORTS_OBSERVATOIRE_AFLP/sorties/RESULTATS_2026-W47.json]
         [--operationnel operationnel.json]
Sorties dans sorties/ (non versionné) : RAPPORT_MARCHE_HEBDO_<sem>.pdf, OUTLOOK_DIRECTION_<sem>.txt,
BASE_VEILLE_MARCHE.xlsx (créée si absente, consolidée sinon), REGISTRE_VEILLE_CCAK.xlsx, QUESTIONNAIRES_TERRAIN.pdf, RESULTATS_MARCHE_<sem>.json
"""
import argparse, json, os, shutil, sys
from datetime import datetime, timezone

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
from veille import moteur, rendu, recommandations as R, sources_publiques as S  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--semaine", required=True)
    ap.add_argument("--base", default=os.path.join(ICI, "sorties", "BASE_VEILLE_MARCHE.xlsx"))
    ap.add_argument("--villages", help="JSON {cluster: [villages]} extrait de FBMS (lecture seule)")
    ap.add_argument("--observatoire", help="RESULTATS_<sem>.json de l'Observatoire agronomique (lu, jamais recalculé)")
    ap.add_argument("--operationnel", help="JSON des repères FBMS (villages, producteurs, lots, fonds...)")
    ap.add_argument("--sorties", default=os.path.join(ICI, "sorties"))
    a = ap.parse_args()
    os.makedirs(a.sorties, exist_ok=True)
    vill = json.load(open(a.villages, encoding="utf-8")) if a.villages else {}
    panel = rendu.tirage_panel(vill)
    agro = json.load(open(a.observatoire, encoding="utf-8")) if a.observatoire else None
    op = json.load(open(a.operationnel, encoding="utf-8")) if a.operationnel else {}
    obs = rendu.lire_observations(a.base) if os.path.exists(a.base) else []
    res = moteur.consolider(obs, a.semaine, S.CCAK, op, panel)
    recos = R.recommander(res, agro)
    gel = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M") + " (heure d'Abidjan)"
    p = lambda n: os.path.join(a.sorties, n)  # noqa: E731
    if os.path.exists(a.base):
        shutil.copy(a.base, p(f"BASE_VEILLE_MARCHE_avant_{a.semaine}.xlsx"))  # la saisie n'est jamais écrasée
    rendu.base_veille(p("BASE_VEILLE_MARCHE.xlsx") if not os.path.exists(a.base) else p(f"CONSOLIDATION_MARCHE_{a.semaine}.xlsx"), panel, res)
    rendu.registre_ccak(p("REGISTRE_VEILLE_CCAK.xlsx"))
    rendu.fiches_pdf(p("QUESTIONNAIRES_TERRAIN.pdf"))
    rendu.rapport_pdf(res, recos, p(f"RAPPORT_MARCHE_HEBDO_{a.semaine}.pdf"), gel, agro)
    n = rendu.outlook(res, recos, p(f"OUTLOOK_DIRECTION_{a.semaine}.txt"))
    json.dump({"resultats": res, "recommandations": recos, "panel": panel}, open(p(f"RESULTATS_MARCHE_{a.semaine}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1, default=str)
    print(f"{a.semaine} · {res['type_rapport']} · {res['global']['observations']} observation(s) · {len(recos)} recommandation(s) · Outlook {n}")


if __name__ == "__main__":
    main()
