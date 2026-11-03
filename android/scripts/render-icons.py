#!/usr/bin/env python3
"""Génère les icônes Android ANAGROCI FIELD BUYING à partir du logo officiel PJS FBMS.

    python android/scripts/render-icons.py            (depuis la racine du dépôt)

Source : android/icon-source/pjs-fbms-icon.png (logo sur fond blanc).
Produit :
  - mipmap-*/ic_launcher.png             icône classique (tuile blanche arrondie)
  - mipmap-*/ic_launcher_foreground.png  avant-plan de l'icône adaptative (Android 8+)
  - mipmap-anydpi-v26/ic_launcher.xml    icône adaptative : fond blanc + logo dans la zone sûre
  - drawable-xxhdpi/splash_logo.png      logo de l'écran de démarrage (carte blanche sur vert)
  - android/store/icon-512.png           icône de diffusion
Tout est embarqué dans l'APK : aucune ressource réseau, l'icône et l'écran de démarrage
s'affichent hors ligne. Dépendance : Pillow (pip install Pillow).
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
SRC = os.path.join(ANDROID, 'icon-source', 'pjs-fbms-icon.png')
RES = os.path.join(ANDROID, 'app', 'src', 'main', 'res')
STORE = os.path.join(ANDROID, 'store')
if len(sys.argv) > 1:
    SRC = sys.argv[1]

WHITE = (255, 255, 255, 255)
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
ADAPTIVE = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def logo():
    im = Image.open(SRC).convert('RGB')
    diff = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).convert('L')
    box = diff.point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(box).convert('RGBA')
    # Fond blanc du fichier source rendu transparent (anti-crénelage conservé)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            a = 255 - min(r, g, b)
            if a < 8:
                px[x, y] = (255, 255, 255, 0)
            elif a < 255 and min(r, g, b) > 200:
                px[x, y] = (r, g, b, min(255, a * 3))
    return im


def place(canvas, mark, width_ratio):
    w = int(canvas.width * width_ratio)
    h = int(mark.height * w / mark.width)
    m = mark.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(m, ((canvas.width - w) // 2, (canvas.height - h) // 2))
    return canvas


def tile(size, mark):
    s = size * 4  # suréchantillonnage pour des bords nets
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(c).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=WHITE)
    place(c, mark, 0.80)
    return c.resize((size, size), Image.LANCZOS)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def main():
    mark = logo()
    for d, px in LEGACY.items():
        save(tile(px, mark), os.path.join(RES, f'mipmap-{d}', 'ic_launcher.png'))
    for d, px in ADAPTIVE.items():
        # Zone sûre Android : cercle de 66 dp sur 108 dp -> logo large de 62 dp
        fg = place(Image.new('RGBA', (px * 4, px * 4), (0, 0, 0, 0)), mark, 62 / 108)
        save(fg.resize((px, px), Image.LANCZOS), os.path.join(RES, f'mipmap-{d}', 'ic_launcher_foreground.png'))
    os.makedirs(os.path.join(RES, 'mipmap-anydpi-v26'), exist_ok=True)
    with open(os.path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/ic_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                '</adaptive-icon>\n')
    with open(os.path.join(RES, 'values', 'ic_launcher_colors.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')

    # Écran de démarrage : carte blanche avec le logo, sous-titre clair sur fond vert ANAGROCI
    W, H = 720, 560
    sp = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(sp)
    dr.rounded_rectangle([160, 40, W * 2 - 160, 820], radius=90, fill=WHITE)
    card = Image.new('RGBA', (W * 2 - 320, 780), (0, 0, 0, 0))
    place(card, mark, 0.82)
    sp.alpha_composite(card, (160, 40))
    font = None
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(p):
            font = ImageFont.truetype(p, 56)
            break
    text = 'AFLP 2027 | Field Operations'
    if font:
        tw = dr.textlength(text, font=font)
        dr.text(((W * 2 - tw) / 2, 900), text, font=font, fill=(191, 240, 207, 255))
    save(sp.resize((W, H), Image.LANCZOS), os.path.join(RES, 'drawable-xxhdpi', 'splash_logo.png'))

    save(tile(512, mark), os.path.join(STORE, 'icon-512.png'))
    print('Icônes générées dans', RES)


if __name__ == '__main__':
    main()
