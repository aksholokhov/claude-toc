#!/bin/bash
# Renders the frames record.sh captured and builds the README media.
# Needs uv (Pillow + fontTools are pulled per run), ffmpeg and ImageMagick.
set -e
cd "$(dirname "$0")"; D=..
command ls | grep '^f.*json$' | xargs -P 6 -I{} sh -c 'uv run -q --with pillow --with fonttools python termshot.py render {} $(basename {} .json).png'
: > concat.txt
while read f d; do echo "file '$PWD/$f.png'" >> concat.txt; echo "duration $d" >> concat.txt; done < durations.txt
echo "file '$PWD/$(tail -1 durations.txt | cut -d' ' -f1).png'" >> concat.txt
ffmpeg -loglevel error -y -f concat -safe 0 -i concat.txt \
  -vf "scale=1400:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none" \
  -loop 0 $D/walkthrough.gif
# Stills: frame numbers follow record.sh's route.
magick f012.png -strip $D/plan-brief.png
magick f017.png -strip $D/diff-preview.png
magick f021.png -strip $D/delta.png
magick f023.png -strip $D/lazygit.png
magick f025.png -strip $D/keys.png
W=$(magick identify -format %w f012.png); X=$((W * 1446 / 2000 + 8))
magick f012.png -crop $((W - X))x960+$X+0 +repage -strip $D/sidebar-plan.png
magick f017.png -crop $((W - X))x960+$X+0 +repage -strip $D/sidebar-artifacts.png
