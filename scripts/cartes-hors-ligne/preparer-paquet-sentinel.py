#!/usr/bin/python3
"""Prépare localement un petit fond satellite Sentinel-2 libre pour FBMS.

Dépendances gratuites : Python 3, GDAL et numpy (paquets système).
Aucune clé, aucun compte AWS, aucun calcul cloud. Les plages COG nécessaires
sont lues depuis le jeu de données public AWS Open Data.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from osgeo import gdal, osr

API = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-c1-l2a"
LICENCE = "https://cds.climate.copernicus.eu/licences/ec-sentinel"
REGISTRE = "https://registry.opendata.aws/sentinel-2-l2a-cogs/"
R = 6378137.0
LIMITE = math.pi * R


def lire_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def mercator(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def indice_tuile(lon, lat, zoom):
    n = 2 ** zoom
    return ((lon + 180) / 360 * n,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def bornes_tuile(x, y, zoom):
    pas = 2 * LIMITE / 2 ** zoom
    return (-LIMITE + x * pas, LIMITE - (y + 1) * pas,
            -LIMITE + (x + 1) * pas, LIMITE - y * pas)


def analyser_scl(dataset):
    array = dataset.ReadAsArray()
    labels, counts = np.unique(array, return_counts=True)
    hist = {str(int(k)): int(v) for k, v in zip(labels, counts)}
    count = int(array.size)
    fraction = lambda ids: round(sum(hist.get(str(x), 0) for x in ids) * 100 / count, 6)
    return {
        "zoneCloudPercent": fraction([8, 9, 10]),
        "zoneCloudShadowPercent": fraction([3]),
        "zoneNoDataPercent": fraction([0, 1]),
        "zoneUnclassifiedPercent": fraction([7]),
        "zoneCastShadowPercent": fraction([2]),
        "sclHistogram": hist,
        "sclPixelCount": count,
        "sclResolutionMetres": 20,
        "sclResampling": "nearest",
        "reviewStatus": "needs-review",
        "note": "La classification est algorithmique. Elle ne garantit pas l'absence de voile atmosphérique ni l'exactitude du repérage au sol."
    }


def choisir_scene(args):
    if args.item:
        return json.loads(Path(args.item).read_text(encoding="utf-8"))
    params = {
        "collections": COLLECTION,
        "bbox": ",".join(map(str, args.bbox)),
        "datetime": args.start + "T00:00:00Z/" + args.end + "T23:59:59Z",
        "limit": "20",
        "query": json.dumps({"eo:cloud_cover": {"lt": 5}}),
    }
    result = lire_json(API + "/search?" + urllib.parse.urlencode(params))
    candidates = result.get("features", [])
    if not candidates:
        raise ValueError("Aucune scène de moins de 5 % de nuages dans la période. Élargir explicitement la période.")
    # Cette présélection ne remplace jamais le contrôle local SCL de la zone.
    candidates.sort(key=lambda item: (item["properties"].get("eo:cloud_cover", 100), item["id"]))
    return candidates[0]


def valider(args):
    west, south, east, north = args.bbox
    if not (-180 <= west < east <= 180 and -80 <= south < north <= 80):
        raise ValueError("Emprise WGS84 invalide.")
    width = math.radians(east - west) * R * math.cos(math.radians((south + north) / 2))
    height = math.radians(north - south) * R
    if not (100 <= width <= 10_000 and 100 <= height <= 10_000):
        raise ValueError("Chaque côté de la zone pilote doit mesurer de 100 m à 10 km.")
    if width * height > 25_000_000:
        raise ValueError("Ce pilote est limité à 25 km²; préparer plusieurs petits paquets.")
    if not 10 <= args.zoom_min <= args.zoom_max <= 14:
        raise ValueError("Zoom attendu : 10 <= min <= max <= 14 pour la source 10 m.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,79}", args.id):
        raise ValueError("Identifiant : lettres ASCII minuscules, chiffres et tirets, 3 à 80 caractères.")
    if Path(args.output).exists() and any(Path(args.output).iterdir()):
        raise ValueError("Le répertoire de sortie doit être vide pour éviter une publication partielle mélangée.")


def source_distante(item, cle):
    asset = item.get("assets", {}).get(cle, {})
    url = asset.get("href", "")
    parsed = urllib.parse.urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname not in {
        "e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com",
        "sentinel-cogs.s3.us-west-2.amazonaws.com",
    } or not parsed.path.endswith(".tif") or parsed.query or parsed.username):
        raise ValueError("Source non reconnue dans le jeu public Sentinel-2 COG : " + cle)
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
        if response.headers.get("Accept-Ranges", "").lower() != "bytes":
            raise ValueError("Le serveur ne déclare pas de lecture partielle COG.")
    return "/vsicurl/" + url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", nargs=4, required=True, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", help="Version de paquet; l’incrémenter si un contenu publié change. Par défaut : date d’acquisition.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", default="2026-01-01")
    parser.add_argument("--end", default="2026-03-01")
    parser.add_argument("--item", help="Item STAC local déjà sélectionné; conserver ce fichier comme provenance.")
    parser.add_argument("--zoom-min", type=int, default=12)
    parser.add_argument("--zoom-max", type=int, default=14)
    args = parser.parse_args()
    valider(args)
    gdal.UseExceptions()
    gdal.SetConfigOption("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    gdal.SetConfigOption("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    gdal.SetConfigOption("GDAL_HTTP_TIMEOUT", "30")
    gdal.SetConfigOption("GDAL_HTTP_CONNECTTIMEOUT", "15")
    gdal.SetConfigOption("GDAL_HTTP_MAX_RETRY", "1")
    item = choisir_scene(args)
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    (root / "source-stac.json").write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    west, south, east, north = args.bbox
    bottom_left, top_right = mercator(west, south), mercator(east, north)
    extent = (*bottom_left, *top_right)
    # Déterminer la qualité avant la lecture du RGB, pour abandonner tôt.
    scl = gdal.Warp("", source_distante(item, "scl"), format="MEM", dstSRS="EPSG:3857",
                    outputBounds=extent, xRes=20, yRes=20, resampleAlg="near", dstNodata=0)
    quality = analyser_scl(scl)
    quality["sceneCloudPercent"] = item["properties"].get("eo:cloud_cover")
    (root / "controle-scl.json").write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if quality["zoneNoDataPercent"] or quality["zoneCloudPercent"] > 1 or quality["zoneCloudShadowPercent"] > 1:
        raise ValueError("Zone rejetée pour données manquantes, nuages ou ombres de nuage. Voir controle-scl.json et choisir une autre scène.")
    # Le raster intermédiaire est limité à la zone, à la résolution native 10 m.
    rgb = gdal.Warp("", source_distante(item, "visual"), format="MEM", dstSRS="EPSG:3857",
                    outputBounds=extent, xRes=10, yRes=10, resampleAlg="bilinear", dstAlpha=True)
    if rgb is None or rgb.RasterCount != 4:
        raise ValueError("Impossible de lire le RGB géoréférencé avec transparence.")
    gdal.GetDriverByName("GTiff").CreateCopy(str(root / "apercu-georeference.tif"), rgb, options=["COMPRESS=DEFLATE"])
    gdal.Translate(str(root / "apercu.png"), rgb, format="PNG")
    tiles = []
    for zoom in range(args.zoom_min, args.zoom_max + 1):
        xf0, yf0 = indice_tuile(west, north, zoom)
        xf1, yf1 = indice_tuile(east, south, zoom)
        for x in range(math.floor(xf0), math.ceil(xf1)):
            for y in range(math.floor(yf0), math.ceil(yf1)):
                tile = gdal.Warp("", rgb, format="MEM", dstSRS="EPSG:3857", outputBounds=bornes_tuile(x, y, zoom),
                                 width=256, height=256, resampleAlg="average", dstAlpha=True)
                relative = Path("tiles") / str(zoom) / str(x) / (str(y) + ".png")
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                gdal.Translate(str(path), tile, format="PNG")
                data = path.read_bytes()
                tiles.append({"z": zoom, "x": x, "y": y, "path": relative.as_posix(),
                              "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    date = item["properties"]["datetime"]
    manifest = {
        "schemaVersion": 1, "id": args.id, "name": args.name, "version": args.version or date[:10],
        "kind": "satellite", "bounds": args.bbox, "minZoom": args.zoom_min, "maxZoom": args.zoom_max,
        "tileSize": 256, "scheme": "xyz", "format": "png",
        "source": {
            "name": "Copernicus Sentinel-2 L2A / Earth Search COG", "collection": item["collection"],
            "itemId": item["id"], "url": API + "/collections/" + item["collection"] + "/items/" + item["id"],
            "acquiredAt": date, "resolutionMetres": 10, "licenceUrl": LICENCE,
            "attribution": "Contains modified Copernicus Sentinel data " + date[:4] + ". COG: Element 84 / AWS Open Data.",
            "accessInformationUrl": REGISTRE, "allowOffline": True, "allowCommercial": True,
        },
        "quality": quality, "tiles": tiles, "tileCount": len(tiles),
        "totalBytes": sum(tile["bytes"] for tile in tiles),
        "preparedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "usageNote": "Démonstration sur une zone publique de Bouaké. Aucune parcelle ni arbre réel enregistré. Résolution 10 m; les arbres individuels doivent être représentés par leurs propres coordonnées GPS."
    }
    path = root / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(path), "scene": item["id"], "tiles": len(tiles), "bytes": manifest["totalBytes"], "quality": quality}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
