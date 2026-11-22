"""Tests de non-régression du moteur de l'Observatoire (mandat §9, cas 1 à 12).

DONNÉES 100 % FICTIVES, construites en mémoire. Aucun accès réseau, aucune base.
Les tests vérifient les CHIFFRES du moteur, indépendamment de tout texte rédigé.
Exécution : python -m unittest discover -s tests -v   (depuis RAPPORTS_OBSERVATOIRE_AFLP)
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from generateur import moteur, recommandations as R, extraction  # noqa: E402

REEL, SIMU = "camp-reelle-fictive", "camp-simulation-fictive"
SEM = "2027-W04"           # lundi 25/01/2027 -> dimanche 31/01/2027
GEL = "2027-02-01T08:00:00+00:00"


def base():
    inst = {"gel_le": GEL, "source": "FICTIF", "nature": "FICTIF",
            "campagnes": [{"id": REEL, "nom": "Réelle fictive", "type": "REAL", "courante": True},
                          {"id": SIMU, "nom": "Simulation fictive", "type": "SIMULATION", "courante": False}],
            "protocoles": [], "panels": [], "arbres": [], "visites": [], "observations": [],
            "corrections": [], "supervision": [], "achats": {"field_lots": 0, "field_shipments_bev": 0},
            "cible_programme": []}
    return inst


def ajouter_champ(inst, pid, cluster="BOTRO", camp=REEL, mode="DESIGNATION", plot=None):
    inst["panels"].append({"id": pid, "campaign_id": camp, "cluster_code": cluster, "statut": "ACTIF",
                           "mode_selection": mode, "pi_village": None, "pi_champ": None,
                           "created_at": "2027-01-10T10:00:00+00:00", "plot_hash": plot or pid})
    for k in range(12):
        inst["arbres"].append({"id": f"{pid}-a{k+1:02d}", "panel_id": pid,
                               "role": "TITULAIRE" if k < 10 else "RESERVE",
                               "statut": "ACTIF" if k < 10 else "RESERVE_EN_ATTENTE",
                               "code_suivi": f"A{k+1:03d}"})


def ajouter_visite(inst, vid, pid, cluster="BOTRO", statut="VALIDE", temporalite="NORMALE",
                   date_obs="2027-01-27", recu="2027-01-27T15:00:00+00:00", valide="2027-01-28T09:00:00+00:00",
                   f="OUI", n=10, camp=REEL, valeurs=None, saisie=None, soumis=None):
    inst["visites"].append({"id": vid, "panel_id": pid, "campaign_id": camp, "cluster_code": cluster,
                            "semaine_iso": moteur.semaine_de(date_obs), "date_observation": date_obs,
                            "saisie_le": saisie or recu, "recu_serveur_le": recu, "soumis_le": soumis or recu,
                            "valide_le": valide if statut == "VALIDE" else None, "statut": statut,
                            "temporalite": temporalite, "row_version": 1})
    for k in range(n):
        val = valeurs[k] if valeurs else f
        inst["observations"].append({"id": f"{vid}-o{k}", "visite_id": vid, "arbre_id": f"{pid}-a{k+1:02d}",
                                     "retrouve": val != "INTROUVABLE", "f": None if val == "INTROUVABLE" else val,
                                     "n": "NON", "p": "NON", "chute": "ABSENCE", "photo_ref_presente": True})


class TestMoteur(unittest.TestCase):

    def test_01_aucune_visite(self):
        inst = base(); ajouter_champ(inst, "P1")
        r = moteur.calculer(inst, SEM)
        self.assertEqual(r["type_rapport"], "DEPLOIEMENT_ET_QUALITE")
        self.assertEqual(r["message_agronomique"], "Données agronomiques insuffisantes")
        self.assertEqual(r["clusters"]["BOTRO"]["agregat"]["f"]["ratio"]["statut"], "NON_DISPONIBLE")

    def test_02_visite_locale_non_synchronisee(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", recu="2027-02-01T10:00:00+00:00")  # reçue APRÈS le gel
        r = moteur.calculer(inst, SEM)
        self.assertEqual(r["global"]["champs_visites_valides"], 0)
        self.assertEqual(r["global"]["visites_par_classe"].get("APRES_GEL"), 1)
        self.assertIsNone(r["global"]["visites_locales_non_synchronisees"])  # inconnu, pas 0

    def test_03_visite_non_validee(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", statut="SOUMIS")
        r = moteur.calculer(inst, SEM)
        self.assertEqual(r["global"]["champs_visites_valides"], 0)
        self.assertEqual(r["clusters"]["BOTRO"]["qualite"]["en_attente_validation"], 1)
        self.assertEqual(r["clusters"]["BOTRO"]["agregat"]["arbres_observes"], 0)

    def test_04_visites_concurrentes_meme_champ(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", f="NON", date_obs="2027-01-26", recu="2027-01-26T12:00:00+00:00")
        ajouter_visite(inst, "V2", "P1", f="OUI", date_obs="2027-01-28", recu="2027-01-28T12:00:00+00:00")
        r = moteur.calculer(inst, SEM)
        c = r["clusters"]["BOTRO"]
        self.assertEqual(c["champs_visites_valides"], 1)
        self.assertEqual(c["agregat"]["arbres_observes"], 10)          # et non 20
        self.assertEqual(c["agregat"]["f"]["OUI"], 10)                 # la plus récente est retenue
        self.assertEqual(c["qualite"]["visites_concurrentes_ecartees"], 1)
        self.assertLessEqual(c["couverture"]["valeur"], 1.0)

    def test_05_pas_vu_non_compte_non(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", valeurs=["OUI"] * 4 + ["NON"] * 6 + [], n=10)
        inst2 = copy.deepcopy(inst)
        for o in inst2["observations"][:3]:
            o["f"] = "PAS_VU"
        r = moteur.calculer(inst2, SEM)["clusters"]["BOTRO"]["agregat"]["f"]
        self.assertEqual(r["PAS_VU"], 3)
        self.assertEqual(r["NON"], 6)               # inchangé : PAS_VU n'est pas NON
        self.assertEqual(r["ratio"]["den"], 7)      # sorti du dénominateur
        self.assertEqual(r["ratio"]["statut"], "DENOMINATEUR_INSUFFISANT")  # 7 < 10 : pas de %

    def test_06_reserve_non_activee(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", n=12)      # observations aussi sur A011/A012 en attente
        r = moteur.calculer(inst, SEM)
        c = r["clusters"]["BOTRO"]
        self.assertEqual(c["agregat"]["arbres_observes"], 10)
        self.assertEqual(c["arbres_suivis_designes"], 10)
        self.assertTrue(any(a["type"] == "OBS_SUR_RESERVE_NON_ACTIVEE" for a in r["anomalies"]))

    def test_07_cluster_sans_observation(self):
        inst = base(); ajouter_champ(inst, "P1"); ajouter_visite(inst, "V1", "P1")
        r = moteur.calculer(inst, SEM)
        for cl in ("SAKASSOU", "DIABO"):
            self.assertIsNone(r["clusters"][cl]["agregat"]["f"]["ratio"]["valeur"])
            self.assertEqual(r["clusters"][cl]["nature"], "DONNEES_INSUFFISANTES")
            self.assertEqual(r["clusters"][cl]["confiance"], "INSUFFISANTE")

    def test_08_saisie_retrospective(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", temporalite="RETROSPECTIVE")
        r = moteur.calculer(inst, SEM)
        self.assertEqual(r["global"]["champs_visites_valides"], 0)
        self.assertEqual(r["clusters"]["BOTRO"]["qualite"]["retrospectives"], 1)

    def test_09_observation_apres_cloture(self):
        inst = base(); ajouter_champ(inst, "P1"); ajouter_visite(inst, "V1", "P1")
        rapport1 = moteur.calculer(inst, SEM)
        manifeste = rapport1["manifeste"]
        # Une visite tardive de la même semaine arrive après transmission
        inst2 = copy.deepcopy(inst); inst2["gel_le"] = "2027-02-08T08:00:00+00:00"
        ajouter_champ(inst2, "P2")
        ajouter_visite(inst2, "V9", "P2", recu="2027-02-03T10:00:00+00:00")
        r2 = moteur.calculer(inst2, "2027-W05", manifeste_precedent=manifeste)
        self.assertEqual(len(r2["complements"]), 1)
        self.assertEqual(r2["complements"][0]["nature"], "COMPLEMENT_TARDIF")
        # Le rapport transmis n'est pas modifié : recalculé sur son propre instantané, il est identique
        self.assertEqual(moteur.calculer(inst, SEM)["meta"]["empreinte_instantane"], rapport1["meta"]["empreinte_instantane"])
        self.assertEqual(rapport1["global"]["champs_visites_valides"], 1)

    def test_10_selection_non_probabiliste(self):
        inst = base()
        for k in range(4):
            ajouter_champ(inst, f"P{k}")
            ajouter_visite(inst, f"V{k}", f"P{k}", f="OUI")
        r = moteur.calculer(inst, SEM)
        c = r["clusters"]["BOTRO"]
        self.assertEqual(c["statut_statistique"], "SUIVI_ARBRES_DESIGNES")
        self.assertEqual(c["nature"], "TENDANCE_DESCRIPTIVE_PANEL")
        self.assertNotEqual(c["nature"], "STATISTIQUE_REPRESENTATIVE")
        textes = " ".join(x["constat"] for x in R.recommander(r))
        self.assertIn("non représentative", textes)

    def test_11_appro_indisponible(self):
        inst = base()
        for k in range(4):
            ajouter_champ(inst, f"P{k}")
            ajouter_visite(inst, f"V{k}", f"P{k}", f="OUI")
        inst["achats"] = {}
        r = moteur.calculer(inst, SEM)
        recos = R.recommander(r)
        financieres = [x for x in recos if x["niveau"] == "PROPOSITION_OPERATIONNELLE"
                       and ("financ" in x["titre"].lower() or "XOF" in x["constat"] or "FCFA" in x["constat"])]
        self.assertEqual(financieres, [])
        self.assertTrue(any(x["titre"] == "Aucune recommandation financière chiffrée" for x in recos))
        self.assertIsNone(r["approvisionnement"]["lots_bord_champ"])  # absent = NON DISPONIBLE, pas 0

    def test_12_utilisateur_non_autorise(self):
        for role in ("RT", "Unit Head", "Assistant Unit Head", "", None, "Inconnu"):
            with self.assertRaises(extraction.AccesRefuse):
                extraction.verifier_role(role)
        for role in ("Branch Manager", "Assistant Branch Manager", "Zonal Head"):
            extraction.verifier_role(role)

    # --- contrôles complémentaires
    def test_13_campagne_simulation_exclue(self):
        inst = base(); ajouter_champ(inst, "P1", plot="X")
        ajouter_champ(inst, "PS", camp=SIMU, plot="X")
        ajouter_visite(inst, "VS", "PS", camp=SIMU)
        r = moteur.calculer(inst, SEM)
        self.assertEqual(r["global"]["champs_actifs"], 1)
        self.assertEqual(r["global"]["champs_visites_valides"], 0)
        self.assertTrue(r["global"]["hors_perimetre"][0]["doublon_parcelle_reelle"])

    def test_14_arbre_introuvable_non_negatif(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", valeurs=["INTROUVABLE"] * 2 + ["OUI"] * 8)
        f = moteur.calculer(inst, SEM)["clusters"]["BOTRO"]["agregat"]["f"]
        self.assertEqual(f["NON_RETROUVE"], 2)
        self.assertEqual(f["NON"], 0)
        self.assertEqual(f["ratio"]["den"], 8)

    def test_15_pourcentage_valide(self):
        inst = base(); ajouter_champ(inst, "P1")
        ajouter_visite(inst, "V1", "P1", valeurs=["OUI"] * 3 + ["NON"] * 7)
        f = moteur.calculer(inst, SEM)["clusters"]["BOTRO"]["agregat"]["f"]["ratio"]
        self.assertEqual((f["num"], f["den"], f["valeur"], f["statut"]), (3, 10, 0.3, "VALIDE"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
