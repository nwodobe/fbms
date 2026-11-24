#!/usr/bin/python3
"""Contrôle indépendant des vrais pixels et fichiers du catalogue satellite.

Exécution depuis la racine :
  /usr/bin/python3 tests/cartes-hors-ligne/valider-paquet.py
Dépendances locales : GDAL et numpy; aucun accès réseau.
"""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from osgeo import gdal

RACINE = Path(__file__).resolve().parents[2]
CARTES = RACINE / "cartes-hors-ligne"
RAYON = 6378137.0
LIMITE = math.pi * RAYON


def verifier(condition, message):
    if not condition:
        raise ValueError(message)


def lire_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def indice_tuile(lon, lat, zoom):
    return ((lon + 180) / 360 * 2 ** zoom,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** zoom)


def verifier_zone(zone):
    manifeste_path = (CARTES / zone["manifest"]).resolve()
    verifier(manifeste_path.is_relative_to(CARTES.resolve()), "Manifeste hors du répertoire de cartes.")
    octets = manifeste_path.read_bytes()
    verifier(hashlib.sha256(octets).hexdigest() == zone["manifestSha256"], "SHA256 du manifeste incorrect.")
    manifeste = json.loads(octets)
    for cle in ("id", "name", "version", "bounds", "minZoom", "maxZoom", "totalBytes"):
        verifier(manifeste[cle] == zone[cle], "Catalogue et manifeste divergent : " + cle)
    verifier(zone["manifest"] == zone["id"] + "/" + zone["version"] + "/manifest.json",
             "Chemin du manifeste incohérent avec son identifiant ou sa version immuable.")
    verifier(manifeste["schemaVersion"] == 1 and manifeste["kind"] == "satellite", "Nature du paquet inattendue.")
    verifier(manifeste["tileSize"] == 256 and manifeste["scheme"] == "xyz" and manifeste["format"] == "png", "Format du pilote inattendu.")
    verifier(manifeste["source"]["allowOffline"] is True and manifeste["source"]["allowCommercial"] is True, "Droits hors ligne/commerciaux absents.")
    verifier(manifeste["source"]["resolutionMetres"] == zone["resolutionMetres"], "Résolution source incohérente.")
    verifier(manifeste["source"]["acquiredAt"] == zone["acquiredAt"], "Date satellite incohérente.")
    qualite = manifeste["quality"]
    verifier(qualite["reviewStatus"] == "verified", "Inspection visuelle non validée.")
    verifier(qualite["zoneNoDataPercent"] == 0, "Zone avec des données manquantes.")
    verifier(qualite["zoneCloudPercent"] <= 1 and qualite["zoneCloudShadowPercent"] <= 1, "Zone trop nuageuse pour le pilote.")
    ouest, sud, est, nord = manifeste["bounds"]
    verifier(-180 <= ouest < est <= 180 and -80 <= sud < nord <= 80, "Bornes WGS84 invalides.")
    attendues = set()
    for zoom in range(manifeste["minZoom"], manifeste["maxZoom"] + 1):
        x0, y0 = indice_tuile(ouest, nord, zoom)
        x1, y1 = indice_tuile(est, sud, zoom)
        attendues |= {(zoom, x, y) for x in range(math.floor(x0), math.ceil(x1))
                      for y in range(math.floor(y0), math.ceil(y1))}
    tuiles = manifeste["tiles"]
    recues = {(t["z"], t["x"], t["y"]) for t in tuiles}
    verifier(recues == attendues and len(recues) == len(tuiles), "Grille XYZ incomplète ou doublonnée.")
    verifier(manifeste["tileCount"] == len(tuiles) <= 2048, "Nombre de tuiles incorrect.")
    bornes = [RAYON * math.radians(ouest),
              RAYON * math.log(math.tan(math.pi / 4 + math.radians(sud) / 2)),
              RAYON * math.radians(est),
              RAYON * math.log(math.tan(math.pi / 4 + math.radians(nord) / 2))]
    total = 0
    for tuile in tuiles:
        path = (manifeste_path.parent / tuile["path"]).resolve()
        verifier(path.is_relative_to(manifeste_path.parent), "Tuile hors du répertoire du paquet.")
        data = path.read_bytes()
        verifier(len(data) == tuile["bytes"], "Taille incorrecte : " + tuile["path"])
        verifier(hashlib.sha256(data).hexdigest() == tuile["sha256"], "SHA256 incorrect : " + tuile["path"])
        raster = gdal.Open(str(path)).ReadAsArray()
        verifier(raster.shape == (4, 256, 256), "PNG RGBA 256 attendu : " + tuile["path"])
        zoom, x, y = tuile["z"], tuile["x"], tuile["y"]
        pas = 2 * LIMITE / 2 ** zoom
        xs = -LIMITE + x * pas + (np.arange(256) + 0.5) * pas / 256
        ys = LIMITE - y * pas - (np.arange(256) + 0.5) * pas / 256
        dedans = ((xs[None, :] >= bornes[0]) & (xs[None, :] <= bornes[2])
                  & (ys[:, None] >= bornes[1]) & (ys[:, None] <= bornes[3]))
        verifier(not np.any((raster[3] == 0) & dedans), "Trou transparent dans la zone : " + tuile["path"])
        total += len(data)
    verifier(total == manifeste["totalBytes"] <= 20 * 1024 * 1024, "Poids du paquet incorrect ou supérieur à 20 Mio.")
    return {"id": manifeste["id"], "tuiles": len(tuiles), "octets": total,
            "controle": "SHA256, grille XYZ, dimensions, transparence, qualité déclarée : réussi",
            "reseau": "aucun", "testAndroid": "non exécuté par ce contrôle"}


def main():
    gdal.UseExceptions()
    catalogue = lire_json(CARTES / "catalogue.json")
    verifier(catalogue["schemaVersion"] == 1 and catalogue["zones"], "Catalogue vide ou incompatible.")
    ids = [zone["id"] for zone in catalogue["zones"]]
    verifier(len(set(ids)) == len(ids), "Identifiants de zones doublonnés.")
    print(json.dumps([verifier_zone(zone) for zone in catalogue["zones"]], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
