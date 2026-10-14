#!/usr/bin/env python3
"""Generate original local Library acceptance fixtures. Requires FFmpeg on PATH and Pillow for WebP encoding.
Outputs go to ignored work/media-fixtures, never to the distributable content tree.
No external media or network is used. FFmpeg is a developer tool, not a runtime dependency.
"""
import math
from pathlib import Path
import shutil
import struct
import subprocess
import wave
from PIL import Image

root = Path(__file__).resolve().parents[1]
out = root / 'work' / 'media-fixtures'
out.mkdir(parents=True, exist_ok=True)
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise SystemExit('Install FFmpeg separately to generate development media fixtures.')

def encode(*args):
    subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)

with wave.open(str(out / 'Moon-chimes.wav'), 'wb') as wav:
    wav.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
    wav.writeframes(b''.join(struct.pack('<h', round(1800 * math.sin(2 * math.pi * (440 if n < 220500 else 554.37) * n / 22050))) for n in range(22050 * 24)))
encode('-i', str(out / 'Moon-chimes.wav'), '-c:a', 'libmp3lame', '-b:a', '96k', str(out / 'Moon-chimes.mp3'))
encode('-f', 'lavfi', '-i', 'testsrc2=size=480x320:rate=12', '-t', '18', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out / 'Moving-colors.mp4'))
encode('-i', str(out / 'Moving-colors.mp4'), '-c:v', 'libvpx-vp9', '-b:v', '200k', '-an', str(out / 'Moving-colors.webm'))
encode('-f', 'lavfi', '-i', 'testsrc2=size=480x320:rate=1', '-frames:v', '1', str(out / 'Color-card.png'))
encode('-i', str(out / 'Color-card.png'), '-frames:v', '1', str(out / 'Color-card.jpg'))
with Image.open(out / 'Color-card.png') as picture:
    picture.save(out / 'Color-card.webp', 'WEBP', lossless=True)
paragraph = ('Mira planted a little garden beside the moon station. Every morning she counted the green shoots, checked the water, and turned the leaves toward the lamp. '
             'Her friend Pip kept a notebook of tiny discoveries: a new root, a silver pebble, a leaf shaped like a heart. They learned that growing something takes time, attention, and a little room to try again.\n\n')
(out / 'The-moon-garden.txt').write_text('THE MOON GARDEN\nAn original kidOS reading fixture\n\n' + ''.join(f'Chapter {i}: A small discovery\n\n' + paragraph * 4 for i in range(1, 6)), encoding='utf8')
(out / 'Not-a-picture.png').write_bytes(b'<html><script>not an image</script></html>')
# A signature-valid truncated image checks decoder error reporting after import.
(out / 'Damaged-picture.png').write_bytes((out / 'Color-card.png').read_bytes()[:33])
print(out)
