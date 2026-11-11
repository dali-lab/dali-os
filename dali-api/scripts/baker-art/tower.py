import math, random, sys
random.seed(21)
W, H = 1144, 520
AX = 955  # tower axis: the corner line between the two visible faces


def X(p): return p * W / 100
def Y(p): return p * H / 100


o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>'
     '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FB8E2"/>'
     '<stop offset="0.75" stop-color="#DDE8EE"/><stop offset="1" stop-color="#F3E9D6"/></linearGradient>'
     '<linearGradient id="lean" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9AB6CE" stop-opacity="0.2"/>'
     '<stop offset="0.5" stop-color="#9AB6CE" stop-opacity="0"/><stop offset="1" stop-color="#EEF0EC" stop-opacity="0.85"/></linearGradient>'
     '<linearGradient id="dome" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#55524C"/>'
     '<stop offset="0.45" stop-color="#2F2D2C"/><stop offset="1" stop-color="#2F2D2C"/></linearGradient>'
     '<radialGradient id="warm" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#E2E6E4" stop-opacity="0.7"/><stop offset="1" stop-color="#E2E6E4" stop-opacity="0"/></radialGradient>'
     '<linearGradient id="drumroof" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2E2622"/><stop offset="0.5" stop-color="#4A3E38"/><stop offset="1" stop-color="#2E2622"/></linearGradient>'
     '<linearGradient id="drumwall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3A2620"/><stop offset="0.5" stop-color="#5E3E30"/><stop offset="1" stop-color="#3A2620"/></linearGradient>'
     '<linearGradient id="dome2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#55524C"/>'
     '<stop offset="1" stop-color="#2F2D2C"/></linearGradient>'
     '<radialGradient id="sun" cx="0.15" cy="0.55" r="0.6"><stop offset="0" stop-color="#FFD98A" stop-opacity="0.45"/><stop offset="1" stop-color="#FFD98A" stop-opacity="0"/></radialGradient></defs>',
     f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']


def bev(x, y, w, h, f, l, d, b=3):
    o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{d}"/>'
             f'<polygon points="{x:.1f},{y:.1f} {x+w:.1f},{y:.1f} {x+w-b:.1f},{y+b:.1f} {x+b:.1f},{y+b:.1f} {x+b:.1f},{y+h-b:.1f} {x:.1f},{y+h:.1f}" fill="{l}"/>'
             f'<rect x="{x+b:.1f}" y="{y+b:.1f}" width="{w-2*b:.1f}" height="{h-2*b:.1f}" fill="{f}"/>')


def poly(pts, fill):
    o.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="{fill}"/>')


def rect(x, y, w, h, fill):
    o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{fill}"/>')


o.append('<g id="clouds">')
for (cx0, cy0, cells) in [(700, 70, [(1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 1)]), (822, 112, [(1, 0), (0, 1), (1, 1), (2, 1)])]:
    for (ccx, ccy) in cells:
        bev(cx0 + ccx * 14, cy0 + ccy * 14, 14, 14, '#F4F8FB', '#FFFFFD', '#DCE6EE', 2)
o.append('</g>')


def interp(pts, x):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


# palettes: (face, light bevel, dark bevel)
WHITE = ('#E9E6DF', '#FFFFFF', '#C9C4B8')
HOPKINS = ('#9A9C9E', '#B2B4B6', '#7E8083')
BRICK = ('#5B3B31', '#6F4B3F', '#47291F')
BRICK2 = ('#8C4A38', '#A05A46', '#6E382A')
GREYB = ('#B9BEC4', '#D2D6DA', '#9AA0A7')
ROOF = ('#4A4F57', '#5E646D', '#363A40')
MANSARD = ('#3A3D42', '#4A4D52', '#2B2E32')
PLANT = ('#51443D', '#62544B', '#3A3833')
STACK = ('#754D3E', '#8A5D4C', '#5C3A2E')
ROW_ROOF = ('#3A291E', '#4A382A', '#2A1D15')
CHIMNEY = ('#7A4A3A', '#8E5C4A', '#5E382B')
TOWER_WHITE = ('#E6EAEC', '#F4F7F8', '#B8C0C5')
TOWER_SHADE = ('#B4BCC1', '#C4CBD0', '#98A1A7')
SHADE_WHITE = '#B4BCC1'
CONIF = ('#2A3A24', '#34462C', '#1E2A1A')
CONIF2 = ('#2F3D2A', '#3A4A34', '#222E1E')
FOREST = [('#3F4434', '#4A5040', '#32362A'), ('#4A5238', '#575F44', '#3A412C')]
HAZE = ('#5E6A5A', '#6A766A', '#505A4E')
LAWN_SH, LAWN_SUN, LAWN_LIT = '#4C7A3C', '#A8C25A', '#C0D470'
FG_LAWN, FG_SHADE = '#4C7A3C', '#5A7A34'
GREEN_HERO = '#78B552'
FAR = [('#4F6150', '#5B6D5C', '#425242'), ('#58694F', '#647659', '#4A5A42'), ('#46584C', '#526458', '#3A4A40')]
FAR2 = [('#8A9468', '#97A176', '#7A8458'), ('#929C70', '#9FA97E', '#828C60'), ('#7F8C66', '#8C9974', '#6E7B56')]
MUTED = ('#9A7A4A', '#A88858', '#7E6238')
SP = {
    'orange': [('#F7A64A', '#FBC27E', '#E08A2C'), ('#E8862A', '#F2A55A', '#C66B18'), ('#C2611A', '#D27A34', '#9E4C12')],
    'gold': [('#F9CF5E', '#FCE08F', '#E5B73E'), ('#F2B53B', '#F7CD6E', '#D4972A'), ('#CF9324', '#DDAA45', '#A9741A')],
    'amber': [('#D9962E', '#E8B056', '#B8741F'), ('#B8741F', '#CC8D3A', '#9E6426'), ('#8A5A24', '#9E6E36', '#55371D')],
    'red': [('#C04A20', '#D2623A', '#A02A20'), ('#A83A20', '#BC5232', '#8A2418'), ('#7E2418', '#92382A', '#5E1A12')],
    'sun': [('#E0A82A', '#EEC060', '#C48A1E'), ('#C48A1E', '#D49E3A', '#A87414'), ('#A87414', '#BC8828', '#8A5C0E')],
    'rust': [('#D8783A', '#E69258', '#C66A2E'), ('#C66A2E', '#D8803F', '#A04E22'), ('#A04E22', '#B46036', '#7E3A16')],
    'rco': [('#D9822B', '#E69A48', '#C06A1C'), ('#B8452A', '#CC5E40', '#9A3418'), ('#9A3418', '#AE4A2C', '#702410')],
    'canopy_o': [('#D07A2A', '#E0944A', '#B0601C'), ('#B8631F', '#CC7A38', '#9A4E14'), ('#7A4A1C', '#8E5E2E', '#5E3410')],
    'canopy_g': [('#D9A040', '#E8B858', '#C08A28'), ('#C98A2A', '#DAA044', '#A87020'), ('#B8862C', '#C99A3C', '#8E6620')],
    'sunor': [('#E39A2A', '#EFB04A', '#C8741E'), ('#C8741E', '#DA8A38', '#A85C14'), ('#8E4E14', '#A26226', '#6E3A0C')],
    'sunyel': [('#F0C040', '#F8D468', '#E6A826'), ('#E6A826', '#F0BC48', '#C48A1A'), ('#A8760E', '#BC8A22', '#86580A')],
    'rust2': [('#B85A2A', '#CC7240', '#A04A22'), ('#A04A22', '#B66030', '#843A18'), ('#843A18', '#984C26', '#5E2A10')],
    'orange2': [('#E08A3A', '#EEA458', '#D07A2A'), ('#D07A2A', '#E0944A', '#B0601C'), ('#B0601C', '#C4782E', '#7E4010')],
    'gold2': [('#DCAA3A', '#EAC060', '#C8962E'), ('#C8962E', '#DAAE48', '#A87A20'), ('#A87A20', '#BC9030', '#7E5A12')],
    'yel': [('#E4BC3C', '#F0D060', '#D4A62A'), ('#D4A62A', '#E4BC44', '#B08818'), ('#B08818', '#C49E28', '#8A6A10')],
    'lime': [('#D6C44A', '#E4D468', '#C9B03A'), ('#C9B03A', '#D8C456', '#A8922A'), ('#A8922A', '#BCA63A', '#7E6E18')],
    'teal': [('#3E6446', '#4C7656', '#2C4A34'), ('#34563D', '#3E6446', '#26402D'), ('#2C4A34', '#34563D', '#1E3425')],
    'green': [('#9CC25A', '#B5D47E', '#82A843'), ('#7FA84A', '#98BE66', '#678C37'), ('#5E8636', '#729A48', '#476A27')],
}


def bldg(x, y, w, h, pal, win=None, roof=None, wx=14, wy=13):
    if roof:
        bev(x - 3, y - 9, w + 6, 11, *roof, 2)
        rect(x - 3, y - 9, w + 6, 1, '#F2F2EE')
        rect(x - 3, y + 1, w + 6, 1.2, '#26282C')
    bev(x, y, w, h, *pal, 3)
    if not roof:
        rect(x, y, w, 1, '#F2F2EE')
    if win:
        for xx in range(int(x + 7), int(x + w - 8), wx):
            for yy in range(int(y + 7), int(y + h - 6), wy):
                rect(xx, yy, 5, 6, win)


def cap(h):
    return h[:-1] + '0123456789ABCDEF'[(int(h[-1], 16) + 1) % 16]


def tree(cx, cy, r, sp, s=12, trunk=True, seed=0.0, rim=True, shadow=True, b=None):
    if shadow:
        o.append(f'<ellipse cx="{cx-r*0.6:.1f}" cy="{cy+r*0.95:.1f}" rx="{r*1.2:.1f}" ry="{r*0.27:.1f}" '
                 f'fill="rgb(25 35 60 / 40%)" transform="rotate(-12 {cx:.1f} {cy+r*0.9:.1f})"/>')
    if trunk and r < 40:
        rect(cx - 2, cy + r * 0.4, 4, r * 0.55, '#5A3A30')
    cells = {}
    for gx in range(int(cx - r * 1.2), int(cx + r * 1.2), s):
        for gy in range(int(cy - r * 1.2), int(cy + r * 1.2), s):
            dx = gx + s / 2 - cx
            dy = (gy + s / 2 - cy) * 1.15
            a = math.atan2(dy, dx)
            rr = r * (1 + 0.13 * math.sin(3 * a + seed) + 0.07 * math.sin(5 * a + 2 * seed))
            if dx * dx + dy * dy < rr * rr:
                cells[(gx, gy)] = ((dy - dx) / (2 * r), (gy + s / 2 - cy) / r > 0.45)
    bw = b if b else (2 if s <= 10 else 3)
    for (gx, gy), (t, under) in cells.items():
        if rim and ((gx + s, gy) not in cells or (gx, gy + s) not in cells):
            f, l, d = SP[sp][2]
            bev(gx, gy, s, s, d, f, d, bw)
            continue
        gold = sp in ('canopy_g', 'gold', 'gold2')
        idx = 2 if under else 0 if t < -0.15 else 1 if gold else 2 if t > 0.3 else 1
        f, l, d = SP[sp][idx]
        if idx == 0 and sp != 'teal' and (gx, gy - s) not in cells:
            f, l, d = cap(f), cap(l), cap(d)
        bev(gx, gy, s, s, f, l, d, bw)


def conifer(cx, base, h, w):
    for k, y in enumerate(range(int(base - h), int(base), 8)):
        ww = w * (k + 1) / (h / 8)
        for gx in range(int(cx - ww / 2), int(cx + ww / 2), 8):
            bev(gx, y, 8, 8, *CONIF, 1)


# ---- distant ridges and the forest ----
SKY = [(0, 40.8), (26, 40.8), (27.5, 40.3), (29, 39.9), (30, 39.8), (31.5, 39.9), (33, 40.4), (35, 41.8), (37, 42.0),
       (39, 41.0), (42, 40.4), (45, 41.4), (48, 42.5), (50, 43.2), (54, 45.2), (57, 46.2), (62, 46.6), (70, 46.2), (76, 45.2), (82, 44.6), (88, 44.0), (92, 42.4), (100, 42.0)]


def smooth(pts, x):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            t = (1 - math.cos(math.pi * (x - x0) / (x1 - x0))) / 2
            return y0 + (y1 - y0) * t
    return pts[-1][1]


def ridge(col, pts, x0, x1):
    top = [(X(p / 4), Y(smooth(pts, p / 4))) for p in range(int(x0 * 4), int(x1 * 4) + 1)]
    poly([(X(x0), Y(48))] + top + [(X(x1), Y(48))], col)


ridge('#7F90A3', [(46, 43.4), (52, 42.8), (58, 43.3), (61.5, 43.3), (65.0, 42.0), (66.4, 41.2), (67.8, 42.0), (70.5, 43.4), (74, 43.6), (78, 43.0), (84, 42.6), (90, 41.6), (96, 41.0), (100, 40.9)], 46, 92)
ridge('#8D9CAD', [(46, 44.6), (54, 44.0), (60, 44.4), (66, 44.1), (72, 44.6), (80, 44.0), (88, 43.4), (94, 42.4), (100, 42.0)], 46, 92)


FOREST_BASE = Y(57)
rect(0, Y(51), W, H - Y(51), LAWN_SH)
HG = [('#4E8F4A', '#5E9F58', '#3F7A3C'), ('#3C7A3E', '#4A8A4C', '#2F6632')]
HP = [('#E0862E', '#EE9F52', '#C06A1E'), ('#EBB43A', '#F4CB62', '#C99722'), ('#CF5A2C', '#E07A50', '#AC4420')]
def forest_col(i, y, top):
    v = math.sin(i / 47 + y / 23) * math.sin(i / 29 - y / 13) + 0.35 * math.sin(i / 11 + y / 7)
    if v > 0.34:
        return HP[int(i / 53 + y / 31) % 3]
    return HG[1] if (i // 10 + y // 10) % 3 == 0 else HG[0]


s_ = 8
for i in range(0, W, s_):
    top = Y(smooth(SKY, (i + 4) / W * 100))
    top = top - top % 2
    y = top - top % s_
    if y < top:
        f, l, d = forest_col(i, y, y)
        bev(i, top, s_, y + s_ - top, f, l, d, 1)
        y += s_
    top = y
    while y < FOREST_BASE:
        f, l, d = forest_col(i, y, top)
        bev(i, y, s_, s_, f, l, d, 1)
        y += s_

rect(0, Y(56), W, Y(6.5), '#5C9A4C')
for (xp, yp, r, sp) in [(72.4, 58, 15, 'orange')]:
    tree(X(xp), Y(yp), r, sp, 10, trunk=False, seed=xp, shadow=False, rim=False, b=2)

# smokestack and the heating plant at its base
PLANT = ('#6E6A66', '#807C78', '#4F4A46')
bev(164.3, Y(43), 13.7, Y(57) - Y(43), *STACK, 2)
rect(164.3, Y(43) + 5, 1, Y(57) - Y(43) - 5, '#B0654A')
rect(163, Y(43), 16, 5, '#3A2C26')
for (x, y, w, h) in [(137, 280, 36, 32), (176, 284, 52, 28)]:
    bev(x, y, w, h, *PLANT, 2)
bev(X(14), Y(56), X(2), Y(4), '#7A4636', '#8E5644', '#5E3326', 2)
bev(X(16.5), Y(54), X(2.5), Y(4), '#8A8E92', '#A2A6AA', '#6E7276', 2)
bev(X(17), Y(55), X(3), Y(2), '#E4E4E0', '#FFFFFF', '#C4C4C0', 2)

# ---- town band ----
bldg(X(22), Y(57.5), X(6), Y(61) - Y(57.5), WHITE, '#6A7480', ('#C9CCCF', '#DDE0E2', '#A6A9AC'))
bldg(X(36), Y(53.5), X(5), Y(7.5), WHITE, '#6A7480', None)
bev(X(30.5), Y(57), X(4), Y(5), '#2E2C2A', '#3A3836', '#201E1C', 2)
for k in range(5):
    ax = X(30.5) + 3 + k * (X(4) - 10) / 5
    o.append(f'<path d="M{ax:.1f} {Y(61.6):.1f} V{Y(59.3):.1f} a4.5 4.5 0 0 1 9 0 V{Y(61.6):.1f}" fill="none" stroke="#BFBFBF" stroke-width="1.6"/>')
for k in range(5):  # Hopkins Center silos
    sx = X(30) + k * X(0.8)
    rect(sx, Y(53), X(0.8), Y(4), '#6B5F58')
    rect(sx, Y(53), X(0.4), Y(4), '#8F8178')
    o.append(f'<ellipse cx="{sx+X(0.4):.1f}" cy="{Y(53):.1f}" rx="{X(0.4):.1f}" ry="4" fill="#8F8178"/>')
bldg(X(40), Y(55.5), X(10), Y(5.5), BRICK, '#F3E9D6', None, 11, 9)  # Hanover Inn
bev(X(40) - 3, Y(54), X(10) + 6, Y(1.5), '#2A2A2E', '#3A3A3E', '#1E1E22', 2)
for dx in range(int(X(40)) + 5, int(X(50)) - 4, 11):
    rect(dx, Y(54.2), 5, 7, '#F3F1EA')
RD, RL = ('#6A6E72', '#7C8084', '#52565A'), ('#D0D2D4', '#E4E6E8', '#A8AAAC')
bldg(X(56.7), Y(55.5), X(5.3), Y(3.5), ('#B8BCC0', '#CDD0D3', '#9A9EA2'), '#6A7480', ('#8A8E92', '#9EA2A6', '#6E7276'), 10, 9)
bldg(X(60.5), Y(57.5), X(8.5), Y(5), ('#8E9196', '#A2A5AA', '#74777C'), '#6A7480', ('#6F7378', '#80858A', '#5A5E62'), 12, 9)
bldg(X(51), Y(56.5), 52, Y(61) - Y(56.5), ('#B8BCC0', '#CDD0D3', '#9A9EA2'), '#6A7480', ('#8A8E92', '#9EA2A6', '#6E7276'), 12, 11)
bev(X(74.4), Y(58.4), X(1.8), Y(2.6), *WHITE, 1)
poly([(X(74.1), Y(58.5)), (X(75.3), Y(57.3)), (X(76.5), Y(58.5))], '#8A8C8E')
BASE = '#B2A99A'
for (bx, bw, bb) in [(X(22), X(6), Y(61)), (X(36), X(5), Y(61)), (X(51), 52, Y(61)), (X(56.7), X(5.3), Y(59)), (X(60.5), X(8.5), Y(62.5)), (X(74.4), X(1.8), Y(61))]:
    rect(bx, bb - 2, bw, 2, BASE)
# white gabled building with a pediment
bev(X(15.5), Y(61.5), X(4), Y(4.5), *WHITE, 2)
poly([(X(15.1), Y(61.6)), (X(17.5), Y(58.5)), (X(19.9), Y(61.6))], '#C9C4B8')
for xx in range(int(X(16.2)), int(X(19)), 9):
    rect(xx, Y(62.6), 4, 9, '#6A7480')
rect(X(15.5), Y(66) - 2, X(4), 2, BASE)

# ---- the Green ----
FL, FR, BL, BR = (X(31), Y(66.4)), (X(60), Y(65.5)), (X(23), Y(82)), (X(77), Y(82))


def gp(e, n):
    top = (FR[0] + (FL[0] - FR[0]) * e, FR[1] + (FL[1] - FR[1]) * e)
    bot = (BR[0] + (BL[0] - BR[0]) * e, BR[1] + (BL[1] - BR[1]) * e)
    return top[0] + (bot[0] - top[0]) * n, top[1] + (bot[1] - top[1]) * n


poly([gp(0, 0), gp(1, 0), gp(1, 1), gp(0, 1)], GREEN_HERO)
PRI, SEC = '#EDE3C6', '#A9CF8E'


def gpath(a, b, col):
    (x1, y1), (x2, y2) = gp(*a), gp(*b)
    w1, w2 = 1.2 + a[1] * 3.0, 1.2 + b[1] * 3.0
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    poly([(x1 + nx * w1, y1 + ny * w1), (x2 + nx * w2, y2 + ny * w2), (x2 - nx * w2, y2 - ny * w2), (x1 - nx * w1, y1 - ny * w1)], col)


HUB = (0.53, 0.54)
for a, b in [((0, 0.83), (1, 0.86)), ((0.95, 0.07), (0.95, 0.99))]:
    gpath(a, b, SEC)
for a, b in [((0, 1), HUB), (HUB, (1, 0.06)), ((0.07, 0.02), HUB), (HUB, (0.97, 0.99)), ((0, 0.53), (1, 0.55))]:
    gpath(a, b, PRI)
hx, hy = gp(*HUB)
o.append(f'<ellipse cx="{hx:.1f}" cy="{hy:.1f}" rx="15" ry="6" fill="{PRI}"/>')

# Wheelock Street with parked cars
poly([(X(31), Y(64.8)), (X(60), Y(63.9)), (X(60), Y(65.4)), (X(31), Y(66.3))], '#5A5F63')
random.seed(4)
cx_ = X(31.5)
while cx_ < X(49):
    yc = Y(64.9) + (cx_ - X(31)) / X(19) * (Y(64.4) - Y(64.9))
    col = random.choice((('#D8D8D8', '#EAEAEA', '#B0B0B0'), ('#3A3A3A', '#4A4A4A', '#2A2A2A'), ('#9AA4AE', '#B0BAC4', '#7A848E')))
    bev(cx_, yc, 5, 4, *col, 1)
    bev(cx_ + 5, yc, 5, 4, *col, 1)
    cx_ += random.choice((16, 19, 24, 31))

# the left lawn: two clean paths
o.append(f'<path d="M{X(8)} {Y(76.5)} Q{X(14)} {Y(82)} {X(25)} {Y(78.5)}" fill="none" stroke="{PRI}" stroke-width="8"/>')
o.append(f'<path d="M{X(8)} {Y(76.5)} Q{X(5)} {Y(88)} {X(1)} {Y(100)}" fill="none" stroke="{PRI}" stroke-width="7"/>')

# Dartmouth Row: a tall gabled building, a hip-roofed one, cupola, chimneys
RD_, RL_ = '#4A3E38', '#6A5A50'
ROW_ROOF_PTS = [(0, 348), (14, 319), (60, 312), (91, 338)]


def roof_y(x):
    return interp(ROW_ROOF_PTS, x)


poly([(0, 348), (91, 338), (91, 393), (0, 393)], WHITE[0])
poly(ROW_ROOF_PTS, RD_)
poly([(14, 319), (60, 312), (72, 328), (26, 334)], RL_)
o.append('<polyline points="0,348 14,319 60,312 91,338" fill="none" stroke="#D8D2C6" stroke-width="1"/>')
poly([(43, 343), (54.5, 330), (66, 343)], '#F2F2EE')
o.append('<polyline points="43,343 54.5,330 66,343" fill="none" stroke="#C9C4B8" stroke-width="1.5"/>')
poly([(93, 341), (133, 337), (133, 393), (93, 396)], WHITE[0])
poly([(91, 340), (104, 319), (122, 318), (135, 336)], RD_)
poly([(104, 319), (122, 318), (126, 326), (108, 328)], RL_)
for wy in (351, 366, 381):
    for xx in range(7, 84, 9):
        rect(xx, wy + 5 - xx * 0.05, 4, 8, '#2F3A30')
    for xx in range(98, 130, 9):
        rect(xx, wy + 2, 4, 8, '#2F3A30')
rect(0, 391, 91, 2, BASE)
rect(93, 391, 40, 2, BASE)
for cxx in (6, 51, 69, 109):
    bev(cxx, interp(ROW_ROOF_PTS + [(133, 336)], cxx) - 9, 6, 11, '#8A4A35', '#9E5C46', '#6A3626', 1)
bev(2, 307, 25, 15, '#F2F2EE', '#FFFFFF', '#D8D8D2', 1)
bev(6, 296, 16, 11, '#F2F2EE', '#FFFFFF', '#D8D8D2', 1)
poly([(5, 296), (14, 287), (23, 296)], '#3A3330')

# Rollins tower
bev(0, 400, 34, 47, '#8A5444', '#9E6654', '#6A3C30', 2)
rect(18, 402, 14, 43, '#6A3C30')
poly([(0, 400), (17, 372), (36, 400)], '#7E4A3A')
poly([(0, 400), (17, 372), (17, 400)], '#9A5E48')
for ax in (4, 14, 24):
    o.append(f'<path d="M{ax} 426 V412 a4 4 0 0 1 8 0 V426 Z" fill="#2B2F36"/>')

# ---- trees ----


TREES = [  # (x%, y%, radius px, species, block size)
    (28, 70, 22, 'orange', 12), (37, 69.2, 20, 'gold', 12), (51, 69.4, 20, 'red', 12), (63, 68.8, 22, 'red', 12),
    (71, 74, 24, 'green', 12), (73, 80, 24, 'gold', 12),
    (8, 82.5, 24, 'gold', 12), (17, 86, 22, 'red', 12),
    (6, 93, 62, 'orange', 16), (19, 95, 48, 'gold', 16), (50, 94, 50, 'red', 16), (60, 93, 64, 'gold', 16),
    (69, 95, 46, 'orange', 16),
]
for (xp, yp, r, sp, s) in sorted(TREES, key=lambda t: t[1]):
    tree(X(xp), Y(yp), r, sp, s, seed=xp, rim=False, b=3)
bev(X(90.8), Y(67.3), X(2.6), Y(2.4), '#4A5560', '#5E6A76', '#38424C', 2)
poly([(X(90.8), Y(67.3)), (X(93.4), Y(67.3)), (X(93.4) - 6, Y(66.2)), (X(90.8) + 6, Y(66.2))], '#5E6A76')


def flagpole(x, kind):
    top, bot = Y(57), Y(66)
    o.append(f'<ellipse cx="{x+1}" cy="{bot}" rx="3" ry="1" fill="rgb(20 30 10 / 30%)"/>')
    rect(x, top, 1.6, bot - top, '#D8D8D8')
    fx, fy = x + 1.6, top + 1
    if kind == 'usa':
        for i in range(5):
            rect(fx, fy + i * 1.6, 14, 1.6, '#C8102E' if i % 2 == 0 else '#FFFFFF')
        rect(fx, fy, 6, 4.8, '#0A3161')
    else:
        rect(fx, fy, 14, 8, '#00693E')
        rect(fx + 6, fy + 2, 2, 4, '#FFFFFF')


flagpole(X(56.5), 'usa')
flagpole(X(57.9), 'dartmouth')

# Webster Hall, painted after the trees so no canopy hides it
BRICK_W = '#6A3A2A'
rect(X(26.5), Y(81.5), X(16.5), H - Y(81.5), BRICK_W)
rect(X(26.5), Y(81.5), 2, H - Y(81.5), '#A0705A')
rect(X(43) - 2, Y(81.5), 2, H - Y(81.5), '#A0705A')
rect(X(30), Y(78.5), X(10), Y(5), BRICK_W)
poly([(X(33.5), Y(72.5)), (X(35), Y(72.5)), (X(35), Y(78.5)), (X(30.5), Y(78.5))], '#5C3528')
poly([(X(35), Y(72.5)), (X(36.5), Y(72.5)), (X(39.5), Y(78.5)), (X(35), Y(78.5))], '#85503C')
o.append(f'<polyline points="{X(30.5):.1f},{Y(78.5):.1f} {X(33.5):.1f},{Y(72.5):.1f} {X(36.5):.1f},{Y(72.5):.1f} {X(39.5):.1f},{Y(78.5):.1f}" fill="none" stroke="#E8E2D7" stroke-width="1.2"/>')
bev(X(31.8), Y(73.5), 6, 9, '#4A3028', '#5E4034', '#38221C', 1)
bev(X(34.5), Y(76), 6, 9, '#4A3028', '#5E4034', '#38221C', 1)
for tl, tr, bl, br, ty, by in ((27.3, 32.2, 26.5, 33.0, 76.5, 82.0), (38.3, 42.2, 37.5, 43.0, 76.0, 81.5)):
    pts = [(X(tl), Y(ty)), (X(tr), Y(ty)), (X(br), Y(by)), (X(bl), Y(by))]
    poly(pts, '#E6EAED')
    cxm, cym = (X(tl) + X(tr) + X(bl) + X(br)) / 4, (Y(ty) + Y(by)) / 2
    for (px_, py_) in pts:
        o.append(f'<line x1="{px_:.1f}" y1="{py_:.1f}" x2="{(px_ + cxm) / 2:.1f}" y2="{(py_ + cym) / 2:.1f}" stroke="#CFD5D9" stroke-width="1"/>')
    o.append(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" stroke="#9AA3A8" stroke-width="1.8"/>')
    rect(X(bl), Y(by - 0.5), X(br - bl), Y(1.5), '#3A2A24')
poly([(X(30), Y(83.5)), (X(35), Y(79.3)), (X(40), Y(83.5))], '#5A3428')
o.append(f'<polyline points="{X(30):.1f},{Y(83.5):.1f} {X(35):.1f},{Y(79.3):.1f} {X(40):.1f},{Y(83.5):.1f}" fill="none" stroke="#D8D0C5" stroke-width="2"/>')
o.append(f'<path d="M{X(35)-6:.1f} {Y(83.2):.1f} A6 3.4 0 0 1 {X(35)+6:.1f} {Y(83.2):.1f} Z" fill="#D8D0C4"/>')
rect(X(26.5), Y(83), X(16.5), Y(1), '#B9B2A8')
for px_ in (28, 30, 40, 42):
    rect(X(px_) - 4, Y(84), 8, Y(11), '#8A6A5A')
rect(X(41.5), Y(93), 6, 10, '#F4F4F0')
# brick half-cylinder drum projecting toward the camera
AXL, AXR = X(31), X(39.4)
ACX = (AXL + AXR) / 2
ARX = (AXR - AXL) / 2
rect(AXL, Y(92), AXR - AXL, H - Y(92), 'url(#drumwall)')
for by in (93, 96, 99):
    o.append(f'<path d="M{AXL:.1f} {Y(by):.1f} A{ARX:.1f} 8 0 0 0 {AXR:.1f} {Y(by):.1f}" fill="none" stroke="#6E4A3A" stroke-width="2.5"/>')
o.append(f'<path d="M{AXL:.1f} {Y(92):.1f} L{ACX:.1f} {Y(87):.1f} L{AXR:.1f} {Y(92):.1f} Q{ACX:.1f} {Y(94.6):.1f} {AXL:.1f} {Y(92):.1f} Z" fill="#2A2522"/>')
for k in range(7):
    t = k / 6
    bx = AXL + (AXR - AXL) * t
    by_ = Y(92) + 4 * math.sin(math.pi * t)
    o.append(f'<line x1="{ACX:.1f}" y1="{Y(87):.1f}" x2="{bx:.1f}" y2="{by_:.1f}" stroke="#3E3630" stroke-width="1"/>')

WIN = '#3A2820'
for wx in (X(26.9) + 2, X(28) + 8, X(41) - 4):
    rect(wx, Y(85.8), 7, Y(5.4), WIN)
for wx in (X(33.2), X(35.2) - 3, X(37.2)):
    rect(wx, Y(84.4), 6, Y(2.2), WIN)
for wx in (ACX - 26, ACX + 20):
    rect(wx, Y(95.6), 6, 9, WIN)
o.append(f'<path d="M{AXL:.1f} {Y(92):.1f} L{ACX:.1f} {Y(87):.1f} L{AXR:.1f} {Y(92):.1f}" fill="none" stroke="#7C5848" stroke-width="1.8"/>')
o.append(f'<path d="M{AXL:.1f} {Y(92):.1f} Q{ACX:.1f} {Y(94.6):.1f} {AXR:.1f} {Y(92):.1f}" fill="none" stroke="#7C5848" stroke-width="1.8"/>')

# ---- Baker tower ----


def urn(x, base, h=12):
    o.append(f'<path d="M{x-3} {base} L{x-3} {base-3} Q{x-5} {base-6} {x-2} {base-h*0.6} L{x-1.5} {base-h*0.8} L{x-3} {base-h*0.8} L{x-3} {base-h} '
             f'L{x+3} {base-h} L{x+3} {base-h*0.8} L{x+1.5} {base-h*0.8} L{x+2} {base-h*0.6} Q{x+5} {base-6} {x+3} {base-3} L{x+3} {base} Z" fill="{TOWER_WHITE[1]}"/>')


poly([(1055, 520), (1058, 452), (1144, 442), (1144, 520)], '#3E4A4A')
for yy in range(484, 520, 6):
    for xx in range(1087 - (7 if (yy // 6) % 2 else 0), 1144, 14):
        x0, x1 = max(1087, xx), min(1144, xx + 14)
        bev(x0, yy, x1 - x0, 6, '#9C4A36', '#B05A44', '#7E3828', 1)
rect(1087, 484, 57, 3, '#E6EAEC')
rect(1087, 487, 57, 1, '#B8C0C5')
for wx in (1093, 1112, 1131):
    rect(wx, 494, 12, 17, '#F4F7F8')
    rect(wx + 2, 496, 8, 13, '#2B2F34')
    rect(wx + 5, 496, 2, 13, '#F4F7F8')
    rect(wx, 511, 12, 2, '#E6EAEC')
poly([(1058, 452), (1144, 442), (1144, 448), (1060, 458)], '#4E5C5C')
for cxx, cw in ((1088, 8), (1099, 7)):
    bev(cxx, 452, cw, 26, *CHIMNEY, 1)


def white_block(x0, x1, y0, y1, flip=False):
    left, right = (TOWER_SHADE, TOWER_WHITE) if flip else (TOWER_WHITE, TOWER_SHADE)
    bev(x0, y0, AX - x0, y1 - y0, *left, 2)
    bev(AX, y0, x1 - AX, y1 - y0, *right, 2)


# brick stage, quoins, windows
for yy in range(468, 520, 6):
    for xx in range(866 - (5 if (yy // 6) % 2 else 0), 1062, 14):
        x0, x1 = max(866, xx), min(1062, xx + 14)
        bev(x0, yy, x1 - x0, 6, '#9C4A36', '#B05A44', '#7E3828', 1)
rect(AX, 468, 107, 52, 'rgb(40 15 10 / 28%)')
for qy in range(470, 520, 8):
    for qx, qw in ((866, 9), (AX - 5, 10), (1053, 9)):
        bev(qx, qy, qw if (qy // 8) % 2 else qw - 3, 7, *TOWER_WHITE, 1)
for wx in (896, 1010):
    rect(wx, 500, 22, 22, TOWER_WHITE[0])
    rect(wx + 3, 501, 16, 19, '#2B2F34')
    rect(wx + 10, 501, 2, 19, TOWER_WHITE[0])
    rect(wx + 3, 508, 16, 2, TOWER_WHITE[0])

# lower band and the chevron roof skirt with urns
APX, APY = 949.5, 499
LX, LY, RX, RY = 846, 463, 1075, 478
poly([(LX, 448), (RX, 450), (RX, RY), (APX, APY), (LX, LY)], '#2F3530')
white_block(888, 1030, 433, 458, True)
for ry in (439, 444, 449, 454):
    rect(890, ry, 138, 1, '#C9CCD0')
poly([(LX, LY), (APX, APY), (APX, APY + 7), (LX, LY + 7)], '#EDEBE6')
poly([(APX, APY), (RX, RY), (RX, RY + 7), (APX, APY + 7)], '#EDEBE6')
o.append(f'<polyline points="{LX},{LY-6} {APX},{APY-6} {RX},{RY-6}" fill="none" stroke="#EDEBE6" stroke-width="1.6"/>')
for (x0, y0, x1, y1) in ((LX, LY, APX, APY), (APX, APY, RX, RY)):
    for k in range(4):
        t = k / 3 if x0 < 900 else (k + 1) / 4
        ux, uy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 6
        o.append(f'<rect x="{ux-0.6:.1f}" y="{uy:.1f}" width="1.2" height="6" fill="#EDEBE6"/>')
        urn(ux, uy, 11)

# clock stage with capitals on the pilasters
white_block(893, 1024, 359, 433, True)
rect(889, 359, 139, 4, TOWER_WHITE[1])
for px in (893, AX - 4, 1016):
    bev(px, 372, 8, 61, TOWER_WHITE[1], '#FFFFFF', TOWER_WHITE[2], 1)
    bev(px - 3, 364, 14, 8, TOWER_WHITE[0], TOWER_WHITE[1], TOWER_WHITE[2], 1)
bev(888, 426, 142, 7, TOWER_WHITE[1], '#FFFFFF', TOWER_WHITE[2], 1)
HH, MM = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (4, 10)
ha, ma = math.radians((HH + MM / 60) * 30), math.radians(MM * 6)


def clock(cx, cy, r, sx):
    o.append(f'<g transform="translate({cx} {cy}) scale({sx} 1)"><circle r="{r}" fill="#F4EFE4" stroke="#2B2F35" stroke-width="3"/><circle r="{r-5.5}" fill="none" stroke="#2B2F35" stroke-width="0.8"/>')
    for k in range(12):
        a = math.radians(k * 30)
        w = 3.2 if k % 3 == 0 else 2.2
        o.append(f'<line x1="{(r-8)*math.sin(a):.1f}" y1="{-(r-8)*math.cos(a):.1f}" x2="{(r-3.5)*math.sin(a):.1f}" y2="{-(r-3.5)*math.cos(a):.1f}" stroke="#2B2F35" stroke-width="{w}"/>')
    o.append(f'<line x1="0" y1="0" x2="{r*0.5*math.sin(ha):.1f}" y2="{-r*0.5*math.cos(ha):.1f}" stroke="#2B2F35" stroke-width="3" stroke-linecap="round"/>'
             f'<line x1="0" y1="0" x2="{r*0.78*math.sin(ma):.1f}" y2="{-r*0.78*math.cos(ma):.1f}" stroke="#2B2F35" stroke-width="2" stroke-linecap="round"/></g>')


clock(919, 398, 19, 0.66)
clock(990, 402, 19, 0.95)

# balustrade platform with urn finials
rect(894, 343, 138, 12, '#C9CDD3')
rect(941, 343, 81, 12, '#DCE0E5')
rect(AX, 343, 77, 12, '#C4C9CF')
rect(AX, 343, 67, 12, '#C4C9CF')
white_block(884, 1033, 353, 361)
white_block(894, 1032, 338, 343)
for bx in range(898, 1030, 6):
    rect(bx, 343, 3.5, 12, TOWER_WHITE[1])
    rect(bx, 347, 3.5, 3, TOWER_SHADE[0])
bev(949, 338, 7, 23, *TOWER_WHITE, 1)
for ux in (896, 910, 950, 1008, 1027):
    urn(ux, 340, 13)

# window block and belfry with tall arches, columns between
white_block(921, 998, 307, 338)
for wx in (922, 976):
    rect(wx, 324, 10, 11, '#F4F7F8')
    rect(wx + 1.5, 325.5, 7, 8, '#4A5058')
white_block(921, 998, 245, 307)
for ax in (925, 949, 975):
    o.append(f'<path d="M{ax} 304 V256 a7 7 0 0 1 14 0 V304 Z" fill="#2B2F36"/>')
for cxl in (941, 965):
    bev(cxl, 250, 7, 54, TOWER_WHITE[1], '#FFFFFF', TOWER_WHITE[2], 1)
for ux in (915, 955, 999):
    urn(ux, 309, 9)
white_block(912, 1003, 239, 245)
for fx in (921, 998):
    urn(fx, 240, 12)

# lower dome with flared lip, lantern, upper dome, spire, weathervane
o.append('<path d="M911 240 C919 240 917 236 919 232 C922 222 934 216 944 210 C950 207 954 205 957 205 C960 205 964 207 970 210 C980 216 992 222 995 232 C997 236 995 240 1003 240 Z" fill="url(#dome)"/>')
rect(930, 205, 54, 3, TOWER_WHITE[0])
LF, LS = '#ECEBE6', '#D4D2CC'
poly([(930, 205), (943, 205), (943, 180), (930, 183)], LF)
poly([(943, 205), (969, 205), (969, 180), (943, 180)], LF)
poly([(969, 205), (982, 205), (982, 183), (969, 180)], LS)
rect(943, 180, 0.8, 25, LS)
rect(968.5, 180, 0.8, 25, LS)
rect(928, 177, 56, 4, TOWER_WHITE[0])
for (px, rx) in ((936.5, 4.9), (956, 9.5), (975.5, 4.9)):
    o.append(f'<g transform="translate({px} 193) scale({rx/9.5} 1)"><circle r="9.5" fill="#D9CFB4" stroke="#5A4E40" stroke-width="1.2"/>')
    for k in range(8):
        a = math.radians(k * 45)
        o.append(f'<line x1="{3*math.sin(a):.1f}" y1="{-3*math.cos(a):.1f}" x2="{8.5*math.sin(a):.1f}" y2="{-8.5*math.cos(a):.1f}" stroke="#5A4E40" stroke-width="0.5" opacity="0.5"/>')
    o.append('</g>')
o.append('<path d="M937.8 177 L937.8 172 C937.8 160 949 155 953 148 L954 143 L960.5 143 L961.5 148 C965 155 978 160 978 172 L978 177 Z" fill="#2F2D2C"/>')
o.append('<path d="M937.8 177 L937.8 172 C937.8 162 946 156 951 150 C946 158 944 164 944 177 Z" fill="#55524C"/>')
bev(947.5, 138, 16, 13, '#4A4740', '#5E5B52', '#38362F', 1)
rect(950.5, 141, 4.5, 7, '#38362F')
rect(956, 141, 4.5, 7, '#38362F')
poly([(953, 73), (957, 73), (960.7, 135), (949.3, 135)], '#4A4740')
poly([(953, 73), (954, 73), (950.4, 135), (949.3, 135)], '#5E5B52')
bev(950.5, 62, 9, 11, '#4A4740', '#5E5B52', '#38362F', 1)
rect(954.2, 49, 1.7, 14, '#4A4740')
o.append('<circle cx="955" cy="43" r="6.5" fill="#4A4740"/><circle cx="953" cy="41" r="2" fill="#5E5B52"/>')
o.append('<rect x="954.2" y="12" width="1.6" height="26" fill="#2B2F35"/><rect x="943" y="22" width="24" height="1.4" fill="#2B2F35"/>'
         '<line x1="950" y1="19" x2="960" y2="25.5" stroke="#2B2F35" stroke-width="1.2"/>'
         '<rect x="944" y="29.4" width="22" height="1.3" fill="#2B2F35"/><polygon points="966,27.5 971,30 966,32.5" fill="#2B2F35"/>'
         '<polygon points="944,27 950,30 944,33" fill="#2B2F35"/>'
         '<text x="938" y="25" font-size="5" font-family="sans-serif" fill="#2B2F35">E</text>'
         '<text x="968" y="25" font-size="5" font-family="sans-serif" fill="#2B2F35">W</text>'
         '<text x="961" y="28" font-size="4" font-family="sans-serif" fill="#2B2F35">N</text>'
         '<text x="945" y="18" font-size="4" font-family="sans-serif" fill="#2B2F35">S</text>')
o.append('</svg>')
open(sys.argv[3] if len(sys.argv) > 3 else 'tower.svg', 'w').write(''.join(o))
print('ok')
