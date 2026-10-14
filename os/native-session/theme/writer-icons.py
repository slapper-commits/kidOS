"""Rebuild original kidOS toolbar pixel icons (Pillow 12.3, no network/fonts).

This is an asset-authoring tool, not a native runtime dependency. Run from any
working directory. It writes only the adjacent writer image assets.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE / 'writer/config/soffice.cfg/modules/swriter/images'
INK, NAVY, TEAL = '#202e2d', '#233c65', '#23776f'
PAPER, CREAM, GOLD, BLUE = '#fffef5', '#f3edcf', '#f1c65d', '#a5c8d8'


def icon(name):
    image = Image.new('RGBA', (24, 24))
    d = ImageDraw.Draw(image)
    def rect(box, fill, outline=INK, width=1): d.rectangle(box, fill, outline, width=width)
    def line(points, color=INK, width=2): d.line(points, fill=color, width=width)
    def page():
        d.polygon([(5, 2), (14, 2), (19, 7), (19, 21), (5, 21)], PAPER, INK)
        d.polygon([(14, 2), (14, 7), (19, 7)], BLUE, INK)
    if name == 'new':
        page()
        line([(8, 12), (16, 12)], TEAL)
        line([(12, 8), (12, 16)], TEAL)
    elif name == 'open':
        rect((2, 6, 10, 9), GOLD)
        rect((2, 8, 21, 20), GOLD)
        d.polygon([(3, 11), (21, 11), (18, 20), (1, 20)], CREAM, INK)
        line([(5, 4), (14, 4), (14, 8)], TEAL)
        d.polygon([(11, 6), (17, 6), (14, 10)], TEAL)
    elif name == 'save':
        d.polygon([(3, 3), (18, 3), (21, 6), (21, 21), (3, 21)], TEAL, INK)
        rect((6, 3, 16, 10), PAPER)
        rect((12, 4, 14, 8), NAVY, NAVY)
        rect((6, 14, 18, 21), CREAM)
        line([(9, 17), (15, 17)], NAVY, 1)
    elif name in ('undo', 'redo'):
        line([(5, 9), (14, 9), (18, 13), (18, 18), (13, 21)], TEAL, 3)
        d.polygon([(3, 9), (10, 3), (10, 15)], NAVY)
        if name == 'redo': image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    elif name == 'picture':
        rect((2, 3, 21, 21), PAPER)
        rect((4, 5, 19, 19), BLUE, BLUE)
        d.ellipse((13, 6, 17, 10), GOLD)
        d.polygon([(4, 18), (10, 11), (15, 18)], TEAL)
        d.polygon([(11, 19), (17, 13), (19, 16), (19, 19)], NAVY)
    elif name == 'pdf':
        page()
        rect((2, 13, 21, 21), NAVY)
        # P / D / F, drawn as pixels so no font dependency enters the artifact.
        for coords in [[(5, 15), (7, 15), (7, 17), (5, 17), (5, 19)], [(10, 19), (10, 15), (12, 15), (13, 16), (13, 18), (12, 19), (10, 19)], [(16, 19), (16, 15), (19, 15)]]:
            line(coords, PAPER, 1)
        line([(16, 17), (18, 17)], PAPER, 1)
    elif name == 'print':
        rect((6, 2, 17, 10), PAPER)
        rect((2, 9, 21, 18), TEAL)
        rect((6, 14, 17, 22), PAPER)
        line([(8, 17), (15, 17)], NAVY, 1)
        line([(8, 19), (14, 19)], NAVY, 1)
        rect((17, 11, 19, 12), GOLD, GOLD)
    elif name == 'help':
        d.ellipse((2, 2, 21, 21), GOLD, INK)
        line([(8, 8), (8, 6), (14, 6), (16, 8), (16, 10), (12, 13), (12, 15)], NAVY)
        rect((11, 18, 13, 19), NAVY, NAVY)
    return image


COMMANDS = [('AddDirect', 'new'), ('OpenFromWriter', 'open'), ('Save', 'save'),
            ('Undo', 'undo'), ('Redo', 'redo'), ('InsertGraphic', 'picture'),
            ('ExportDirectToPDF', 'pdf'), ('Print', 'print'), ('HelpIndex', 'help')]
for prefix, size in [('sc', 16), ('lc', 24), ('xc', 32)]:
    strip = Image.new('RGBA', (size * len(COMMANDS), size))
    for index, (_, name) in enumerate(COMMANDS):
        glyph = icon(name).resize((size, size), Image.Resampling.NEAREST)
        strip.paste(glyph, (index * size, 0))
    (OUT / 'Bitmaps').mkdir(parents=True, exist_ok=True)
    strip.save(OUT / f'Bitmaps/{prefix}_userimages.png', optimize=False, compress_level=9)
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<!-- Original kidOS icons. Native command mapping; no executable content. -->',
             '<image:imagescontainer xmlns:image="http://openoffice.org/2001/image" xmlns:xlink="http://www.w3.org/1999/xlink">',
             f'  <image:images xlink:href="Bitmaps/{prefix}_userimages.png">']
    for index, (command, _) in enumerate(COMMANDS):
        lines.append(f'    <image:entry image:command=".uno:{command}" image:bitmap-index="{index}"/>')
    lines += ['  </image:images>', '</image:imagescontainer>']
    (OUT / f'{prefix}_imagelist.xml').write_text('\n'.join(lines) + '\n')
