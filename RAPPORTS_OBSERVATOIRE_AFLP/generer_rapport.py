#!/usr/bin/env python3
"""Générateur du rapport hebdomadaire de l'Observatoire AFLP (option B).

Usage (depuis ce dossier) :
  # 1. Extraction en lecture seule avec votre compte FBMS, puis génération :
  python generer_rapport.py --semaine 2026-W48
  # 2. Régénération à l'identique depuis un instantané gelé (aucun accès réseau) :
  python generer_rapport.py --semaine 2026-W47 --instantane sorties/instantanes/INSTANTANE_xxx.json

Sorties (dossier sorties/, jamais versionné : les rapports contiennent des données internes) :
  RAPPORT_OBSERVATOIRE_YYYY-Www.pdf, ANNEXE_OBSERVATOIRE_YYYY-Www.xlsx, OUTLOOK_DIRECTION_YYYY-Www.txt,
  REGISTRE_DECISIONS.xlsx (cumulatif), RESULTATS_YYYY-Www.json, MANIFESTE_YYYY-Www.json, instantanes/
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
from generateur import moteur, rendu, recommandations as R  # noqa: E402


def semaine_par_defaut():
    """Le lundi, on rapporte la semaine ISO précédente (close la veille à 23 h 59)."""
    return moteur.semaine_precedente(moteur.semaine_de(datetime.now(timezone.utc).date()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--semaine", default=None, help="Semaine ISO, ex. 2026-W48 (défaut : semaine précédente)")
    ap.add_argument("--instantane", help="Instantané JSON gelé (sinon extraction Supabase en lecture seule)")
    ap.add_argument("--courriel", help="Courriel FBMS pour l'extraction")
    ap.add_argument("--contexte", help="Fichier texte : contexte terrain rédigé par le Branch Manager (inséré tel quel, signalé comme non calculé)")
    ap.add_argument("--sorties", default=os.path.join(ICI, "sorties"))
    a = ap.parse_args()
    sem = a.semaine or semaine_par_defaut()
    os.makedirs(os.path.join(a.sorties, "instantanes"), exist_ok=True)

    if a.instantane:
        inst = json.load(open(a.instantane, encoding="utf-8"))
    else:
        from generateur import extraction
        cli = extraction.ClientLecture()
        role = cli.connecter(a.courriel)
        inst = extraction.extraire(cli, role)
        nom = "INSTANTANE_" + inst["gel_le"][:16].replace(":", "") + "Z.json"
        json.dump(inst, open(os.path.join(a.sorties, "instantanes", nom), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"Instantané gelé : instantanes/{nom}")

    # Manifeste du rapport précédent : permet de tracer compléments et corrections sans réécrire l'ancien rapport.
    prec = os.path.join(a.sorties, f"MANIFESTE_{moteur.semaine_precedente(sem)}.json")
    manifeste = json.load(open(prec, encoding="utf-8")) if os.path.exists(prec) else None

    res = moteur.calculer(inst, sem, manifeste_precedent=manifeste)
    recos = R.recommander(res)

    # Historique des semaines déjà produites (pour la chronologie des stades)
    hist = []
    for f in sorted(glob.glob(os.path.join(a.sorties, "RESULTATS_*.json"))):
        r = json.load(open(f, encoding="utf-8"))
        if r["meta"]["semaine"] >= sem:
            continue
        hist.append({"semaine": r["meta"]["semaine"],
                     "clusters": {c: d["agregat"]["f"]["ratio"]["valeur"] for c, d in r["clusters"].items()}})
    cour = {"semaine": sem, "clusters": {c: d["agregat"]["f"]["ratio"]["valeur"] for c, d in res["clusters"].items()}}
    hist_valide = [h for h in hist + [cour] if any(v is not None for v in h["clusters"].values())]

    ctx = open(a.contexte, encoding="utf-8").read().strip() if a.contexte else None
    p = lambda n: os.path.join(a.sorties, n)  # noqa: E731
    rendu.pdf(res, recos, p(f"RAPPORT_OBSERVATOIRE_{sem}.pdf"), contexte_bm=ctx, historique=hist_valide)
    rendu.excel(res, recos, p(f"ANNEXE_OBSERVATOIRE_{sem}.xlsx"))
    n_fr, n_en = rendu.outlook(res, recos, p(f"OUTLOOK_DIRECTION_{sem}.txt"))
    ajout = rendu.registre(res, recos, p("REGISTRE_DECISIONS.xlsx"))
    json.dump(res, open(p(f"RESULTATS_{sem}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
    json.dump(res["manifeste"], open(p(f"MANIFESTE_{sem}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Semaine {sem} · {res['type_rapport']} · {res['meta']['version_rapport']}")
    print(f"Champs actifs {res['global']['champs_actifs']}/{res['global']['champs_prevus']} · visités validés {res['global']['champs_visites_valides']}")
    print(f"Recommandations {len(recos)} (registre : +{ajout}) · Outlook FR {n_fr} car. / EN {n_en} car.")
    print(f"Empreinte instantané : {res['meta']['empreinte_instantane']}")


if __name__ == "__main__":
    main()
