"""Extraction EN LECTURE SEULE depuis Supabase (API REST), avec le compte de l'utilisateur.

Sécurité :
  * aucune clé de service : l'utilisateur se connecte avec SON compte FBMS ; la RLS
    serveur (private.pheno_peut_lire_cluster) décide de ce qu'il peut lire ;
  * uniquement des requêtes GET / HEAD : ce module ne sait pas écrire ;
  * le mot de passe est demandé à l'exécution (getpass), jamais stocké ni journalisé ;
  * l'URL et la clé publique sont lues dans les variables d'environnement
    FBMS_SUPABASE_URL et FBMS_SUPABASE_ANON_KEY (clé publique, déjà présente dans l'application) ;
  * l'instantané ne contient ni nom de producteur, ni téléphone, ni coordonnée GPS :
    la parcelle n'y figure que sous forme d'empreinte (md5) pour détecter les doublons.
"""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROLES_AUTORISES = {"Branch Manager", "Assistant Branch Manager", "Zonal Head"}


class AccesRefuse(Exception):
    pass


def verifier_role(role):
    """Le rapport de Direction est réservé aux rôles de management (garde-fou client ;
    la vraie barrière reste la RLS serveur)."""
    if role not in ROLES_AUTORISES:
        raise AccesRefuse(f"Rôle « {role} » non autorisé pour le rapport de Direction.")
    return True


class ClientLecture:
    def __init__(self, url=None, cle=None):
        self.url = (url or os.environ.get("FBMS_SUPABASE_URL", "")).rstrip("/")
        self.cle = cle or os.environ.get("FBMS_SUPABASE_ANON_KEY", "")
        if not self.url or not self.cle:
            raise SystemExit("Définissez FBMS_SUPABASE_URL et FBMS_SUPABASE_ANON_KEY (voir METHODOLOGIE_REPORTING.md).")
        self.jeton = None
        self.uid = None

    def _req(self, methode, chemin, corps=None, entetes=None):
        h = {"apikey": self.cle, "Accept": "application/json"}
        if self.jeton:
            h["Authorization"] = f"Bearer {self.jeton}"
        h.update(entetes or {})
        data = json.dumps(corps).encode() if corps is not None else None
        if data:
            h["Content-Type"] = "application/json"
        r = urllib.request.Request(self.url + chemin, data=data, headers=h, method=methode)
        with urllib.request.urlopen(r, timeout=60) as rep:
            return rep.status, dict(rep.headers), rep.read()

    def connecter(self, email=None):
        email = email or input("Courriel FBMS : ").strip()
        mdp = getpass.getpass("Mot de passe FBMS (non affiché, non enregistré) : ")
        _, _, b = self._req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": mdp})
        del mdp
        d = json.loads(b)
        self.jeton, self.uid = d["access_token"], d["user"]["id"]
        prof = self.lire("profils", "role,actif", {"user_id": f"eq.{self.uid}"})
        role = prof[0]["role"] if prof and prof[0].get("actif") else None
        verifier_role(role)
        return role

    def lire(self, table, colonnes, filtres=None):
        q = {"select": colonnes}
        q.update(filtres or {})
        lignes, debut = [], 0
        while True:
            _, _, b = self._req("GET", f"/rest/v1/{table}?{urllib.parse.urlencode(q)}",
                                entetes={"Range": f"{debut}-{debut + 999}"})
            lot = json.loads(b)
            lignes += lot
            if len(lot) < 1000:
                return lignes
            debut += 1000

    def compter(self, table, filtres):
        q = {"select": "id"}
        q.update(filtres)
        _, h, _ = self._req("HEAD", f"/rest/v1/{table}?{urllib.parse.urlencode(q)}",
                            entetes={"Prefer": "count=exact", "Range": "0-0"})
        cr = h.get("Content-Range") or h.get("content-range") or "*/0"
        tot = cr.split("/")[-1]
        return int(tot) if tot.isdigit() else None


def extraire(client: ClientLecture, role: str) -> dict:
    gel = datetime.now(timezone.utc).isoformat()
    camps = client.lire("campaigns", "id,name,campaign_type,is_current,status")
    reelle = [c for c in camps if c["campaign_type"] == "REAL" and c["is_current"]]
    rid = reelle[0]["id"] if len(reelle) == 1 else None
    panels = client.lire("pheno_panels", "id,campaign_id,cluster_code,village_id,statut,mode_selection,pi_village,pi_champ,created_at,designe_le,plot_id")
    for p in panels:
        pid = p.pop("plot_id", None)
        p["plot_hash"] = hashlib.md5(str(pid).encode()).hexdigest() if pid else None
    used = {p["campaign_id"] for p in panels} | ({rid} if rid else set())

    def achats(t):
        try:
            return client.compter(t, {"campaign_id": f"eq.{rid}"}) if rid else None
        except Exception:
            return None  # NON DISPONIBLE (droits ou table absente), jamais 0

    obs = client.lire("pheno_observations", "id,visite_id,arbre_id,retrouve,f,n,p,chute,chute_preuve,photo_ref,photo_exception")
    for o in obs:
        o["photo_ref_presente"] = bool(o.pop("photo_ref", None))
        o["photo_exception"] = bool((o.get("photo_exception") or "").strip())
    return {
        "gel_le": gel, "source": f"Supabase {client.url} (API REST, lecture seule, compte {role})",
        "nature": "REEL", "perimetre_rls": role,
        "campagnes": [{"id": c["id"], "nom": c["name"], "type": c["campaign_type"], "courante": c["is_current"],
                       "statut": c["status"]} for c in camps if c["id"] in used],
        "protocoles": client.lire("pheno_protocoles", "id,code,version,statut"),
        "panels": panels,
        "arbres": client.lire("pheno_arbres", "id,panel_id,role,statut,code_suivi,proba_inclusion,remplace_arbre_id,activation_le"),
        "visites": client.lire("pheno_visites", "id,panel_id,campaign_id,cluster_code,semaine_iso,date_observation,saisie_le,recu_serveur_le,soumis_le,valide_le,statut,temporalite,mode_saisie,validation_exceptionnelle,row_version"),
        "observations": obs,
        "corrections": client.lire("pheno_corrections", "id,visite_id,statut"),
        "supervision": client.lire("pheno_v_supervision", "*"),
        "cible_programme": client.lire("aflp_program_targets", "target_mt,source,campaign_id"),
        "achats": {"field_lots": achats("field_lots"), "field_shipments_bev": achats("field_shipments"),
                   "ops_bag_requests": achats("ops_bag_requests"), "aflp_bag_envelopes": achats("aflp_bag_envelopes"),
                   "aflp_incidents": achats("aflp_incidents")},
    }
