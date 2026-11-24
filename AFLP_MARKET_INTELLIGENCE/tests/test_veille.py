"""Tests du moteur de l'Intelligence marché AFLP. DONNÉES 100 % FICTIVES, en mémoire, aucun réseau.
Exécution : python -m unittest discover -s tests -v  (depuis AFLP_MARKET_INTELLIGENCE)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from veille import moteur as M, recommandations as R, sources_publiques as S  # noqa: E402

SEM = "2027-W08"  # 22 au 28 février 2027
PANEL = {"BOTRO": {"fixes": ["VILLAGE-FICTIF-1", "VILLAGE-FICTIF-2"]}}
_n = [0]


def obs(**k):
    _n[0] += 1
    base = dict(id_observation=f"FIC-{_n[0]:04d}", date_observation="2027-02-24", cluster="BOTRO", village="VILLAGE-FICTIF-1",
                module="M02", theme="P08_PRIX_PAYE", nature_prix="PAYE", stade_commercial="BORD_CHAMP", unite="FCFA/kg",
                nature_source="DECLARATION", chaine_source=None, statut_fiabilite="CONFIRME", type_acteur="PRODUCTEUR")
    base.update(k)
    return base


class TestVeille(unittest.TestCase):

    def test_etat_initial_sans_observation(self):
        r = M.consolider([], SEM, S.CCAK, panel=PANEL)
        self.assertEqual(r["type_rapport"], "ETAT_INITIAL_VEILLE")
        self.assertEqual(r["clusters"]["BOTRO"]["prix_paye"]["statut"], "NON_DISPONIBLE")
        self.assertEqual(r["clusters"]["BOTRO"]["confiance"], "INSUFFISANTE")

    def test_prix_annonce_propose_paye_separes(self):
        o = [obs(valeur=420), obs(valeur=430), obs(valeur=425),
             obs(valeur=500, nature_prix="DEMANDE_VENDEUR"), obs(valeur=390, nature_prix="PROPOSE_ACHETEUR")]
        c = M.consolider(o, SEM)["clusters"]["BOTRO"]
        self.assertEqual(c["prix_paye"]["mediane"], 425)
        self.assertEqual(c["prix_paye"]["n"], 3)
        self.assertEqual(c["prix_demande"]["n"], 1)

    def test_mediane_seulement_si_effectif_suffisant(self):
        c = M.consolider([obs(valeur=420), obs(valeur=430)], SEM)["clusters"]["BOTRO"]
        self.assertIsNone(c["prix_paye"]["mediane"])
        self.assertEqual(c["prix_paye"]["statut"], "EFFECTIF_INSUFFISANT")

    def test_stades_non_melanges(self):
        o = [obs(valeur=420), obs(valeur=425), obs(valeur=430), obs(valeur=460, stade_commercial="MAGASIN_INTERIEUR")]
        self.assertEqual(M.consolider(o, SEM)["clusters"]["BOTRO"]["prix_paye"]["max"], 430)

    def test_non_confirme_hors_conclusions(self):
        o = [obs(valeur=420, statut_fiabilite=None), obs(valeur=430, statut_fiabilite="NON_CONFIRME"), obs(valeur=425, statut_fiabilite="NON_CONFIRME")]
        r = M.consolider(o, SEM)
        self.assertEqual(r["clusters"]["BOTRO"]["prix_paye"]["n"], 0)
        self.assertEqual(r["global"]["signaux"], 3)

    def test_meme_rumeur_une_seule_source(self):
        o = [obs(valeur=450, statut_fiabilite=None, chaine_source="RUMEUR-X", theme="A02_PRIX_AFFICHE", nature_prix="PROPOSE_ACHETEUR"),
             obs(valeur=450, statut_fiabilite=None, chaine_source="RUMEUR-X", theme="A02_PRIX_AFFICHE", nature_prix="PROPOSE_ACHETEUR")]
        r = M.consolider(o, SEM)
        self.assertTrue(all(s["statut"] == "NON_CONFIRME" for s in r["signaux"]))

    def test_sources_independantes_corroborent_ou_contestent(self):
        o = [obs(valeur=420, statut_fiabilite=None, chaine_source="A"), obs(valeur=425, statut_fiabilite=None, chaine_source="B")]
        r = M.consolider(o, SEM)
        self.assertEqual(r["clusters"]["BOTRO"]["observations_etablies"], 2)  # CORROBORE
        o2 = [obs(valeur=400, statut_fiabilite=None, chaine_source="A"), obs(valeur=520, statut_fiabilite=None, chaine_source="B")]
        r2 = M.consolider(o2, SEM)
        self.assertTrue(all(s["statut"] == "CONTESTE" for s in r2["signaux"]))

    def test_lot_non_double_compte(self):
        o = [obs(module="M05", theme="A07_STOCK_VU", grandeur_volume="OBSERVEE_PHYSIQUEMENT", quantite_kg=8000, lot_ref="LOT-1", nature_prix=None),
             obs(module="M05", theme="A07_STOCK_VU", grandeur_volume="OBSERVEE_PHYSIQUEMENT", quantite_kg=8000, lot_ref="LOT-1", nature_prix=None, village="VILLAGE-FICTIF-2")]
        self.assertEqual(M.consolider(o, SEM)["clusters"]["BOTRO"]["disponibilite_verifiee"]["kg"], 8000)

    def test_grandeurs_de_volume_separees(self):
        o = [obs(module="M03", theme="P04_QTE_RECOLTEE", grandeur_volume="ANNONCEE_ESTIMEE", quantite_kg=2000, nature_prix=None)]
        c = M.consolider(o, SEM)["clusters"]["BOTRO"]
        self.assertEqual(c["volume_annonce"]["kg"], 2000)
        self.assertIsNone(c["disponibilite_verifiee"]["kg"])  # une intention n'est pas un stock

    def test_information_ancienne_exclue(self):
        o = [obs(valeur=v, date_fait="2027-01-20") for v in (420, 425, 430)]
        r = M.consolider(o, SEM)
        self.assertEqual(r["clusters"]["BOTRO"]["prix_paye"]["n"], 0)
        self.assertTrue(all(s["ancienne"] for s in r["signaux"]))

    def test_evolution_seulement_si_comparable(self):
        o = [obs(valeur=v) for v in (420, 425, 430)] + [obs(valeur=v, date_observation="2027-02-17") for v in (400, 405, 410)]
        self.assertEqual(M.consolider(o, SEM)["clusters"]["BOTRO"]["evolution_prix_paye"], 20)
        o2 = [obs(valeur=v) for v in (420, 425, 430)] + [obs(valeur=400, date_observation="2027-02-17")]
        self.assertIsNone(M.consolider(o2, SEM)["clusters"]["BOTRO"]["evolution_prix_paye"])

    def test_refus_respecte_et_compte(self):
        r = M.consolider([obs(refus="OUI", valeur=None, theme="P03_RECOLTE_DEBUT", module="M03", nature_prix=None)], SEM)
        self.assertEqual(r["clusters"]["BOTRO"]["refus"], 1)
        self.assertIsNone(r["clusters"]["BOTRO"]["recolte_commencee"])

    def test_doublon_identifiant_rejete(self):
        o = obs(valeur=420)
        r = M.consolider([o, dict(o)], SEM)
        self.assertEqual(r["anomalies"][0]["type"], "DOUBLON_IDENTIFIANT")

    def test_reglementation_2026_non_reportee_sur_2027(self):
        r = M.consolider([], SEM, S.CCAK)
        self.assertFalse(r["reglementaire"]["reference_2027_etablie"])
        titres = [x["titre"] for x in R.recommander(r)]
        self.assertIn("Référence réglementaire 2027 non publiée", titres)

    def test_aucune_decision_achat(self):
        recos = R.recommander(M.consolider([], SEM, S.CCAK, panel=PANEL))
        self.assertTrue(any(x["titre"].startswith("Aucune décision d'achat") for x in recos))
        self.assertFalse(any("acheter" in x["action"].lower() and x["niveau"] == "PROPOSITION_OPERATIONNELLE" for x in recos))


if __name__ == "__main__":
    unittest.main(verbosity=2)
