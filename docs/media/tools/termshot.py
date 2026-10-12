#!/usr/bin/env python3
"""Snapshot a tmux window (all panes, with ANSI colours) and render it as a
PNG in gruvbox-material dark.

  termshot.py snap  <socket> <target> <out.json>
  termshot.py render <in.json> <out.png> [--scale 1.0]

256-colour codes are snapped to the nearest gruvbox-material hue: toc's own
colours start as gruvbox hex, so this recovers them, and Claude's chrome
lands in the same palette.
"""
import json, re, subprocess, sys, unicodedata

GM = {  # gruvbox-material dark, medium (dotfiles nvim/lua/config/palette.lua)
    'bg0': '#292828', 'bg1': '#32302f', 'bg3': '#45403d', 'bg5': '#5a524c',
    'fg0': '#d4be98', 'fg1': '#ddc7a1', 'red': '#ea6962', 'orange': '#e78a4e',
    'yellow': '#d8a657', 'green': '#a9b665', 'aqua': '#89b482', 'blue': '#7daea3',
    'purple': '#d3869b', 'grey0': '#7c6f64', 'grey1': '#928374', 'grey2': '#a89984',
    'greenDim': '#757d4d',
}
BG, FG = GM['bg0'], GM['fg0']


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def xterm(n):
    base = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
            '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']
    if n < 16:
        return rgb(base[n])
    if n < 232:
        n -= 16
        v = [0, 95, 135, 175, 215, 255]
        return (v[n // 36], v[(n // 6) % 6], v[n % 6])
    g = 8 + (n - 232) * 10
    return (g, g, g)


PAL = [rgb(v) for v in GM.values()]


def ansi256(c):
    # chalk / ansi-styles rgbToAnsi256: how Claude Code downsamples a hex colour
    r, g, b = c
    if r == g == b:
        if r < 8:
            return 16
        if r > 248:
            return 231
        return round((r - 8) / 247 * 24) + 232
    return 16 + 36 * round(r / 255 * 5) + 6 * round(g / 255 * 5) + round(b / 255 * 5)


# 256-colour index → the gruvbox hue that produced it (first one wins).
BACK = {}
for _hex in [GM['bg3']] + list(GM.values()):  # the selection bg wins its index
    BACK.setdefault(ansi256(rgb(_hex)), rgb(_hex))


def from256(n):
    return BACK.get(n) or snap_gm(xterm(n))


def snap_gm(c):
    return min(PAL, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c)))


def snap(sock, target, out):
    fmt = '#{pane_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height}'
    ls = subprocess.run(['tmux', '-L', sock, 'list-panes', '-t', target, '-F', fmt], capture_output=True, text=True).stdout
    win = subprocess.run(['tmux', '-L', sock, 'display', '-p', '-t', target, '#{window_width} #{window_height}'], capture_output=True, text=True).stdout.split()
    panes = []
    for line in ls.strip().splitlines():
        pid, l, t, w, h = line.split()
        txt = subprocess.run(['tmux', '-L', sock, 'capture-pane', '-e', '-p', '-t', pid], capture_output=True, text=True).stdout
        panes.append({'left': int(l), 'top': int(t), 'w': int(w), 'h': int(h), 'ansi': txt})
    json.dump({'w': int(win[0]), 'h': int(win[1]), 'panes': panes}, open(out, 'w'))


SGR = re.compile(r'\x1b\[([0-9;:]*)m')
OTHER = re.compile(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-ln-z]')


def cells(ansi, w, h):
    grid = [[(' ', None, None, 0) for _ in range(w)] for _ in range(h)]
    for y, line in enumerate(ansi.split('\n')[:h]):
        line = OTHER.sub('', line)
        fg = bg = None
        bold = dim = inv = False
        x = 0
        pos = 0
        for m in list(SGR.finditer(line)) + [None]:
            end = m.start() if m else len(line)
            for ch in line[pos:end]:
                if x >= w:
                    break
                wide = unicodedata.east_asian_width(ch) in 'WF'
                f, b = (bg, fg) if inv else (fg, bg)
                grid[y][x] = (ch, f, b, (1 if bold else 0) | (2 if dim else 0) | (4 if wide else 0))
                x += 2 if wide else 1
            if not m:
                break
            pos = m.end()
            ps = [p for p in re.split('[;:]', m.group(1))] or ['0']
            i = 0
            while i < len(ps):
                p = int(ps[i] or 0)
                if p == 0:
                    fg = bg = None; bold = dim = inv = False
                elif p == 1: bold = True
                elif p == 2: dim = True
                elif p == 22: bold = dim = False
                elif p == 7: inv = True
                elif p == 27: inv = False
                elif p in (38, 48):
                    if ps[i + 1] == '5':
                        c = from256(int(ps[i + 2])); i += 2
                    else:
                        c = tuple(int(v) for v in ps[i + 2:i + 5]); i += 4  # 24-bit: keep it (delta)
                    if p == 38: fg = c
                    else: bg = c
                elif p == 39: fg = None
                elif p == 49: bg = None
                elif 30 <= p <= 37: fg = snap_gm(xterm(p - 30))
                elif 90 <= p <= 97: fg = snap_gm(xterm(p - 90 + 8))
                elif 40 <= p <= 47: bg = snap_gm(xterm(p - 40))
                elif 100 <= p <= 107: bg = snap_gm(xterm(p - 100 + 8))
                i += 1
    return grid


def render(src, out, scale=1.0):
    from PIL import Image, ImageDraw, ImageFont
    from fontTools.ttLib import TTFont
    size = int(15 * scale)
    paths = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
             '/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    import os
    extra = [p for p in ['/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf',
                         '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf'] if os.path.exists(p)]
    fonts = [(ImageFont.truetype(p, size), TTFont(p, lazy=True).getBestCmap()) for p in paths + extra if os.path.exists(p)]
    regular, bold = fonts[0][0], fonts[1][0]
    cw = round(regular.getlength('M'))
    chh = round(size * 1.32)
    data = json.load(open(src))
    W, H = data['w'], data['h']
    pad = int(14 * scale)
    img = Image.new('RGB', (W * cw + 2 * pad, H * chh + 2 * pad), rgb(BG))
    d = ImageDraw.Draw(img)
    border = rgb(GM['bg5'])
    for p in data['panes']:
        g = cells(p['ansi'], p['w'], p['h'])
        for y, row in enumerate(g):
            for x, (ch, f, b, flags) in enumerate(row):
                px, py = pad + (p['left'] + x) * cw, pad + (p['top'] + y) * chh
                if b:
                    d.rectangle([px, py, px + cw * (2 if flags & 4 else 1) - 1, py + chh - 1], fill=b)
                if ch == ' ':
                    continue
                col = f or rgb(FG)
                if flags & 2:
                    col = tuple(int(c * 0.62 + v * 0.38) for c, v in zip(col, rgb(BG)))
                cp = ord(ch)
                font = bold if flags & 1 else regular
                if cp not in fonts[0][1]:
                    font = next((fo for fo, cmap in fonts if cp in cmap), None)
                    if font is None:
                        continue  # a Nerd Font icon: no font here has it
                d.text((px, py + (chh - size) // 2 - 1), ch, font=font, fill=col)
        # tmux pane borders: a line right of / below every pane that isn't at the edge
        if p['left'] + p['w'] < W:
            x = pad + (p['left'] + p['w']) * cw + cw // 2
            d.line([x, pad + p['top'] * chh, x, pad + (p['top'] + p['h']) * chh], fill=border, width=1)
        if p['top'] + p['h'] < H:
            y = pad + (p['top'] + p['h']) * chh + chh // 2
            d.line([pad + p['left'] * cw, y, pad + (p['left'] + p['w']) * cw, y], fill=border, width=1)
    img.save(out)


if __name__ == '__main__':
    if sys.argv[1] == 'snap':
        snap(*sys.argv[2:5])
    else:
        render(sys.argv[2], sys.argv[3], float(sys.argv[5]) if len(sys.argv) > 5 else 1.0)
