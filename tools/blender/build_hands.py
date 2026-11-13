# Builds the first-person hands: new UVs on the original rigged meshes plus every skin map, baked from
# procedural anatomy evaluated in 3D around the rig (creases at the joints, nails, tendons, veins, palm lines).
#
#   blender -b --factory-startup --python tools/blender/build_hands.py -- --src <hands-data.js or dir> [--out assets/models] [--work <dir>] [--res 2048]
#   (--res 512 for a quick look)
#
# --src is the original rigged hands: the base64 module `js/hands-data.js` from commit 446e0f1
# (`git show 446e0f1:js/hands-data.js > %TEMP%/hands-data.js`), or a folder holding left.glb and right.glb.
# Writes (into --out):
#   (into --work, default %TEMP%/roulette-hands-work) hand_left.raw.glb, hand_right.raw.glb: same nodes, skin and bind
#   matrices as the source, mesh re-split along the new UV seams. Compress them with Draco (docs/HANDS-REAL.md) into
#   assets/models/hand_left.glb and hand_right.glb.
#   hand_albedo.webp   2048 sRGB, the "medium" skin; other tones are graded in js/hands.js with the pigment mask
#   hand_nx/ny.webp    2048 grey, macro relief as surface slope along u and v (creases, knuckles, tendons, veins, nail folds)
#   hand_orm.webp      1024 RGB: R occlusion, G roughness, B pigment weight (palm and nails take less tone)
#   hand_glove_st.webp 1024 grey, glove stitch mask
#   hand_glove_nx/ny   1024 grey, glove relief as slopes (seams, stitching, leather creases at the joints)
#   hand_pores.webp    512 grey tile, skin micro relief (furrow network, pores)
#   hand_leather.webp  512 grey tile, pebbled leather grain
# Both hands share one UV atlas, so one set of maps serves the pair. The bake is deterministic (fixed seeds).
import bpy, sys, os, re, json, struct, math, base64, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
SRC = os.path.abspath(arg('--src', 'js/hands-data.js'))
OUT = os.path.abspath(arg('--out', 'assets/models'))
RES = int(arg('--res', '2048'))
ORM_RES = RES // 2
import tempfile
WORK = os.path.abspath(arg('--work', os.path.join(tempfile.gettempdir(), 'roulette-hands-work')))
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
def log(*a): print('[hands %5.1fs]' % (time.time() - T0), *a, flush=True)

# ================================================================= GLB IO
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def parse_glb(b):
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bo = 20 + jl; bl = struct.unpack('<I', b[bo:bo + 4])[0]
    bin_ = b[bo + 8:bo + 8 + bl]
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        n = NC[a['type']]; off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(bin_, CT[a['componentType']], a['count'] * n, off).reshape(a['count'], n).copy()
    return j, acc

def read_sources():
    if SRC.endswith('.js'):
        s = open(SRC, encoding='utf8').read()
        return {k: base64.b64decode(re.search(r'export const %s = "([^"]+)"' % k.upper(), s).group(1)) for k in ('left', 'right')}
    return {k: open(os.path.join(SRC, k + '.glb'), 'rb').read() for k in ('left', 'right')}

def write_glb(path, j0, acc0, V):
    """Same nodes, skin and inverse bind matrices as the source; new mesh data."""
    j = {k: j0[k] for k in ('asset', 'scene', 'scenes', 'nodes', 'skins')}
    j['asset'] = {'version': '2.0', 'generator': 'roulette tools/blender/build_hands.py'}
    blobs, views, accs = [], [], []
    def add(arr, ctype, typ, target=None, minmax=False):
        data = np.ascontiguousarray(arr).tobytes(); off = sum(len(x) for x in blobs)
        pad = (-len(data)) % 4; blobs.append(data + b'\0' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: v['target'] = target
        views.append(v)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    ib = j0['skins'][0]['inverseBindMatrices']
    ibm = acc0(ib).astype(np.float32)
    attrs = {
        'POSITION': add(V['pos'].astype(np.float32), 5126, 'VEC3', 34962, True),
        'NORMAL': add(V['nrm'].astype(np.float32), 5126, 'VEC3', 34962),
        'TEXCOORD_0': add(V['uv'].astype(np.float32), 5126, 'VEC2', 34962),
        'JOINTS_0': add(V['joints'].astype(np.uint8), 5121, 'VEC4', 34962),
        'WEIGHTS_0': add(V['weights'].astype(np.float32), 5126, 'VEC4', 34962),
    }
    idx = add(V['idx'].astype(np.uint16 if V['pos'].shape[0] < 65536 else np.uint32).ravel()[:, None], 5123 if V['pos'].shape[0] < 65536 else 5125, 'SCALAR', 34963)
    skins = json.loads(json.dumps(j['skins'])); skins[0]['inverseBindMatrices'] = add(ibm, 5126, 'MAT4')
    j['skins'] = skins
    j['materials'] = [{'name': 'skin', 'doubleSided': True, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.55}}]
    j['meshes'] = [{'name': j0['meshes'][0]['name'], 'primitives': [{'attributes': attrs, 'indices': idx, 'material': 0}], 'extras': {'uvMeters': V['uvMeters']}}]
    j['accessors'] = accs; j['bufferViews'] = views
    binb = b''.join(blobs); j['buffers'] = [{'byteLength': len(binb)}]
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)

# ================================================================= LOAD + TRIM
def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

FING = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']
LONG = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
THUMB = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip']

HANDS = {}
for side, b in read_sources().items():
    j, acc = parse_glb(b)
    at = j['meshes'][0]['primitives'][0]['attributes']
    H = dict(side=side, j=j, acc=acc, pos=acc(at['POSITION']).astype(np.float64), nrm=acc(at['NORMAL']).astype(np.float64),
             joints=acc(at['JOINTS_0']), weights=acc(at['WEIGHTS_0']), idx=acc(j['meshes'][0]['primitives'][0]['indices']).reshape(-1, 3))
    nodes = {n['name']: n for n in j['nodes']}
    H['J'] = {k: np.array(n.get('translation', [0, 0, 0]), float) for k, n in nodes.items()}
    H['R'] = {k: quat_mat(n.get('rotation', [0, 0, 0, 1])) for k, n in nodes.items()}
    # The app keeps triangles with a vertex within 2 cm of the wrist (up the arm); drop the rest here so they take no texels.
    cut = H['J']['wrist'][1] + 0.025
    y = H['pos'][:, 1]; f = H['idx']; keep = (y[f] <= cut).any(1); f = f[keep]
    used = np.unique(f); remap = -np.ones(len(y), np.int64); remap[used] = np.arange(len(used))
    for k in ('pos', 'nrm', 'joints', 'weights'): H[k] = H[k][used]
    H['idx'] = remap[f]
    H['nrm'] /= np.linalg.norm(H['nrm'], axis=1, keepdims=True)
    HANDS[side] = H
    log(side, 'verts', len(H['pos']), 'tris', len(H['idx']))

# ================================================================= UV ATLAS (both hands, one texel density)
bpy.ops.wm.read_factory_settings(use_empty=True)
objs = []
for side, H in HANDS.items():
    me = bpy.data.meshes.new(side); me.from_pydata([tuple(v) for v in H['pos']], [], [tuple(t) for t in H['idx']]); me.update()
    ob = bpy.data.objects.new(side, me); bpy.context.scene.collection.objects.link(ob); objs.append(ob)
for ob in objs: ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=0.0045, shape_method='CONCAVE', scale=True)
bpy.ops.object.mode_set(mode='OBJECT')

for ob in objs:
    H = HANDS[ob.name]; me = ob.data
    luv = np.zeros(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', luv); luv = luv.reshape(-1, 3, 2)
    assert len(me.polygons) == len(H['idx'])
    lv = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv); lv = lv.reshape(-1, 3)
    assert (lv == H['idx']).all()
    uvg = luv.copy(); uvg[..., 1] = 1 - uvg[..., 1]   # glTF: v down
    # split vertices along seams: one vertex per (source vertex, uv)
    key = np.concatenate([lv.reshape(-1, 1).astype(np.float64), np.round(uvg.reshape(-1, 2) * 1e6)], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    src = uniq[:, 0].astype(np.int64)
    nv = len(uniq); uv = np.zeros((nv, 2)); uv[inv] = uvg.reshape(-1, 2)
    H['V'] = dict(pos=H['pos'][src], nrm=H['nrm'][src], joints=H['joints'][src], weights=H['weights'][src], uv=uv, idx=inv.reshape(-1, 3))
    H['tri_uv'] = uvg; H['tri_p'] = H['pos'][H['idx']]; H['tri_n'] = H['nrm'][H['idx']]; H['src_idx'] = H['idx']
    log(ob.name, 'split verts', nv)

# texel density: metres per uv unit (the same for both hands after averaging)
ks = []
for H in HANDS.values():
    p = H['tri_p']; u = H['tri_uv']
    a3 = np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1) / 2
    a2 = np.abs(np.cross(u[:, 1] - u[:, 0], u[:, 2] - u[:, 0])) / 2
    ok = a2 > 1e-12; ks.append(np.sqrt(a3[ok].sum() / a2[ok].sum()))
UVM = float(np.mean(ks)); log('metres per uv unit', ks, 'texel mm', UVM / RES * 1000)
for H in HANDS.values(): H['V']['uvMeters'] = UVM

# ================================================================= PER-VERTEX OCCLUSION (bind pose, ray cast)
def vertex_ao(H, rays=96, maxd=0.035):
    bvh = BVHTree.FromPolygons([Vector(v) for v in H['pos']], [tuple(t) for t in H['idx']])
    rng = np.random.default_rng(7)
    u1 = rng.random(rays); u2 = rng.random(rays)
    r = np.sqrt(u1); ph = 2 * np.pi * u2
    loc = np.stack([r * np.cos(ph), r * np.sin(ph), np.sqrt(1 - u1)], 1)   # cosine-weighted, +z up
    out = np.zeros(len(H['pos']))
    for i, (p, n) in enumerate(zip(H['pos'], H['nrm'])):
        a = np.array([1, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1, 0])
        t = np.cross(n, a); t /= np.linalg.norm(t); bt = np.cross(n, t)
        dirs = loc[:, :1] * t + loc[:, 1:2] * bt + loc[:, 2:] * n
        o = Vector(p + n * 0.0004); occ = 0.0
        for d in dirs:
            hit = bvh.ray_cast(o, Vector(d), maxd)
            if hit[0] is not None: occ += (1 - hit[3] / maxd) ** 0.5
        out[i] = 1 - occ / rays
    return out
for H in HANDS.values():
    H['vao'] = vertex_ao(H, rays=24 if RES < 1024 else 96)
    log(H['side'], 'vertex AO mean', H['vao'].mean())

# ================================================================= RASTER (texel -> triangle, barycentrics; padded by extrapolation)
def raster(N, pad):
    tri = -np.ones((N, N), np.int32); obj = -np.ones((N, N), np.int8)
    best = np.full((N, N), 1e9, np.float32); bary = np.zeros((N, N, 3), np.float32)
    for oi, H in enumerate(HANDS.values()):
        U = H['tri_uv'] * N - 0.5    # pixel-centre coordinates
        for ti, t in enumerate(U):
            x0 = int(max(0, np.floor(t[:, 0].min()) - pad)); x1 = int(min(N - 1, np.ceil(t[:, 0].max()) + pad))
            y0 = int(max(0, np.floor(t[:, 1].min()) - pad)); y1 = int(min(N - 1, np.ceil(t[:, 1].max()) + pad))
            if x1 < x0 or y1 < y0: continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            (ax, ay), (bx, by), (cx, cy) = t
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12: continue
            l0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            l2 = 1 - l0 - l1
            # distance outside the triangle in pixels (<= 0 inside)
            h = np.array([abs(den) / max(1e-9, math.hypot(bx - cx, by - cy)), abs(den) / max(1e-9, math.hypot(ax - cx, ay - cy)), abs(den) / max(1e-9, math.hypot(ax - bx, ay - by))])
            o = np.maximum(np.maximum(-l0 * h[0], -l1 * h[1]), -l2 * h[2])
            sub = best[y0:y1 + 1, x0:x1 + 1]
            m = (o < sub) & (o <= pad)
            if not m.any(): continue
            sub[m] = o[m]
            tri[y0:y1 + 1, x0:x1 + 1][m] = ti; obj[y0:y1 + 1, x0:x1 + 1][m] = oi
            bb = bary[y0:y1 + 1, x0:x1 + 1]
            bb[..., 0][m] = l0[m]; bb[..., 1][m] = l1[m]; bb[..., 2][m] = l2[m]
    # keep extrapolation modest: clamp barycentrics a little outside the triangle
    np.clip(bary, -1.5, 2.5, out=bary)
    return tri, obj, bary, best

# ================================================================= NOISE
def hash3(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xffff).astype(np.float32) / 65535.0

def vnoise3(p, freq, seed):
    q = p * freq; i = np.floor(q).astype(np.int64); f = (q - i).astype(np.float32); s = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (s[:, 0] if dx else 1 - s[:, 0]) * (s[:, 1] if dy else 1 - s[:, 1]) * (s[:, 2] if dz else 1 - s[:, 2])
                out = out + w * hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out * 2 - 1

def fbm3(p, freq, seed, oct=4, gain=0.5):
    a, t, n = 1.0, 0.0, 0.0
    for o in range(oct):
        t = t + a * vnoise3(p, freq * 2 ** o, seed + o); n += a; a *= gain
    return t / n

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def gauss(d, w): return np.exp(-(d / w) ** 2)

def seg_dist2d(P, A, B):
    """distance from 2D points P (n,2) to segment A-B; also the param t."""
    ab = B - A; L2 = max(1e-12, ab @ ab); t = np.clip(((P - A) @ ab) / L2, 0, 1)
    d = P - (A + t[:, None] * ab); return np.sqrt((d * d).sum(1)), t

def poly_dist(P, pts):
    best = np.full(len(P), 1e9); along = np.zeros(len(P)); acc = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        d, t = seg_dist2d(P, a, b); m = d < best; best[m] = d[m]; along[m] = acc + t[m] * np.linalg.norm(b - a); acc += np.linalg.norm(b - a)
    return best, along, acc

def catmull(pts, n=12):
    pts = np.asarray(pts, float); out = []
    P = np.vstack([pts[0], pts, pts[-1]])
    for i in range(1, len(P) - 2):
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * P[i]) + (-P[i - 1] + P[i + 1]) * t + (2 * P[i - 1] - 5 * P[i] + 4 * P[i + 1] - P[i + 2]) * t2 + (-P[i - 1] + 3 * P[i] - 3 * P[i + 1] + P[i + 2]) * t3))
    out.append(pts[-1]); return np.array(out)

# ================================================================= RIG GEOMETRY PER HAND
def rig(H):
    J, R = H['J'], H['R']
    chains = {}
    for f in FING + ['thumb']:
        segs = THUMB if f == 'thumb' else LONG
        P = [J[f'{f}-{s}'] for s in segs]; F = [R[f'{f}-{s}'] for s in segs]
        L = [np.linalg.norm(P[i + 1] - P[i]) for i in range(len(P) - 1)]
        chains[f] = dict(P=P, F=F, L=L, cum=np.concatenate([[0], np.cumsum(L)]))
    mid = chains['middle-finger']; idx = chains['index-finger']; pk = chains['pinky-finger']
    wrist = J['wrist']
    e_h = mid['P'][1] - mid['P'][0]; e_h /= np.linalg.norm(e_h)
    d_h = mid['F'][0][:, 1] - e_h * (mid['F'][0][:, 1] @ e_h); d_h /= np.linalg.norm(d_h)
    s_h = pk['P'][1] - idx['P'][1]; s_h -= e_h * (s_h @ e_h) + d_h * (s_h @ d_h); s_h /= np.linalg.norm(s_h)
    o = mid['P'][0]
    width = (pk['P'][1] - idx['P'][1]) @ s_h; length = (mid['P'][1] - o) @ e_h
    x0 = (idx['P'][1] - o) @ s_h
    return dict(chains=chains, e=e_h, d=d_h, s=s_h, o=o, width=width, length=length, x0=x0, wrist=wrist)

for H in HANDS.values():
    H['rig'] = rig(H); r = H['rig']
    # mean finger radius per segment, for nail widths and ridge sizes
    rad = {}
    for f, c in r['chains'].items():
        rr = []
        for k in range(len(c['L'])):
            a, b = c['P'][k], c['P'][k + 1]; e = (b - a) / c['L'][k]
            t = ((H['pos'] - a) @ e) / c['L'][k]; d = np.linalg.norm(H['pos'] - a - np.outer(t * c['L'][k], e), axis=1)
            m = (t > 0.3) & (t < 0.7) & (d < 0.02); rr.append(float(np.median(d[m])) if m.any() else 0.008)
        rad[f] = rr
    r['rad'] = rad
    log(H['side'], 'palm width %.4f length %.4f' % (r['width'], r['length']), {f: [round(x * 1000, 1) for x in v] for f, v in rad.items()})

# ================================================================= ANATOMY FIELDS
VEIN_SEED = 11
def make_veins(seed):
    """Dorsal venous network in palm coords (x across 0=index..1=pinky, y along 0=meta base..1=knuckles)."""
    rng = np.random.default_rng(seed)
    lines = []
    # inter-metacarpal veins from the knuckle valleys, converging into an arch and on to the wrist
    starts = [0.17, 0.5, 0.83]
    arch_y = 0.42
    for i, x in enumerate(starts):
        pts = [(x + rng.normal(0, .02), 1.02), (x + rng.normal(0, .04), 0.8), (x * 0.85 + 0.08 + rng.normal(0, .04), 0.6), (0.15 + 0.7 * (i / 2) + rng.normal(0, .03), arch_y)]
        lines.append((catmull(pts), 1.0 - 0.15 * i))
    arch = catmull([(-0.15, 0.25), (0.1, arch_y - 0.02), (0.45, arch_y + 0.03), (0.8, arch_y - 0.01), (1.08, 0.3)])
    lines.append((arch, 0.75))
    lines.append((catmull([(-0.15, 0.25), (-0.12, 0.0), (-0.05, -0.35), (0.0, -0.8)]), 1.25))     # cephalic, radial side
    lines.append((catmull([(1.08, 0.3), (1.0, 0.0), (0.92, -0.4), (0.9, -0.8)]), 1.15))           # basilic, ulnar side
    lines.append((catmull([(0.45, arch_y + 0.03), (0.42, 0.2), (0.5, -0.1), (0.46, -0.5)]), 0.8))  # small median vein
    # thumb branch
    lines.append((catmull([(-0.45, 0.85), (-0.35, 0.55), (-0.2, 0.3), (-0.15, 0.25)]), 0.9))
    return lines
VEINS = make_veins(VEIN_SEED)

def fields(H, P, N):
    """P, N: (n,3) bind-pose points and normals. Returns a dict of per-point arrays."""
    r = H['rig']; ch = r['chains']; n = len(P)
    # --- nearest bone segment
    segs = []
    for f, c in ch.items():
        for k in range(len(c['L'])): segs.append((f, k))
    D = np.empty((n, len(segs)), np.float32); T = np.empty((n, len(segs)), np.float32)
    for si, (f, k) in enumerate(segs):
        c = ch[f]; a = c['P'][k]; b = c['P'][k + 1]; e = (b - a) / c['L'][k]
        t = ((P - a) @ e) / c['L'][k]; tc = np.clip(t, 0, 1)
        d = np.linalg.norm(P - a - (tc * c['L'][k])[:, None] * e, axis=1)
        # metacarpals are thick: compare surfaces, not axes
        if k == 0: d = d - (0.006 if f != 'thumb' else 0.002)
        D[:, si] = d; T[:, si] = t
    near = np.argmin(D, 1)
    out = {k: np.zeros(n, np.float32) for k in ('h', 'hg', 'red', 'dark', 'vent', 'nail', 'lunula', 'free', 'band', 'vein', 'crease', 'rough_add', 'stitch', 'gwear', 'pad', 'knuckle', 'side')}
    # --- palm coordinates (whole hand)
    rel = P - r['o']
    X = (rel @ r['s'] - r['x0']) / r['width']; Y = (rel @ r['e']) / r['length']
    up_h = N @ r['d']
    Xm = X * r['width']; Ym = Y * r['length']   # metres
    noise_lo = fbm3(P, 90, 3, 3)
    # --- finger coordinates
    is_f = np.zeros(n, bool)
    for si, (f, k) in enumerate(segs):
        m = near == si
        if not m.any(): continue
        c = ch[f]; a = c['P'][k]; F = c['F'][k]; L = c['L'][k]
        e = (c['P'][k + 1] - a) / L; dors = F[:, 1] - e * (F[:, 1] @ e); dors /= np.linalg.norm(dors); lat = np.cross(e, dors)
        if H['side'] == 'left': lat = -lat     # +lat = toward the thumb side on both hands... (sign only used for asymmetric bits)
        p = P[m]; t = T[m, si]
        rv = p - a - np.outer(t * L, e)
        cu = rv @ dors; cs = rv @ lat; rho = np.sqrt(cu * cu + cs * cs) + 1e-9
        cos_t = cu / rho; theta = np.arctan2(cs, cu)
        z = c['cum'][k] + t * L                     # arc length from the metacarpal base
        nn = N[m]; ndors = nn @ dors
        if k == 0:
            continue                                   # palm and back of the hand: handled below
        is_f[np.where(m)[0]] = True
        idx_m = np.where(m)[0]
        rad = r['rad'][f][min(k, len(r['rad'][f]) - 1)]
        dorsal = smooth(-0.1, 0.5, cos_t); ventral = smooth(0.15, -0.55, cos_t)
        side_w = gauss(np.abs(np.abs(theta) - np.pi / 2), 0.55)
        h = np.zeros(len(p)); red = np.zeros(len(p)); dark = np.zeros(len(p)); crease = np.zeros(len(p)); rough = np.zeros(len(p))
        hg = np.zeros(len(p)); stitch = np.zeros(len(p)); gwear = np.zeros(len(p)); knuck = np.zeros(len(p))
        jn = c['cum']    # joint arc positions: [meta base, MCP, PIP, DIP, tip] (thumb: [CMC, MCP, IP, tip])
        thumb = f == 'thumb'
        joints = [(1, 'mcp'), (2, 'pip' if not thumb else 'ip')] + ([(3, 'dip')] if not thumb else [])
        for ji, name in joints:
            zr = (z - jn[ji]) * 1000     # mm from the joint
            big = name in ('pip', 'mcp') if not thumb else name in ('ip', 'mcp')
            # palm side: deep flexion creases
            if name == 'mcp' and not thumb:
                # the palmar digital crease sits where the finger leaves the palm, well past the joint
                zc = 0.40 * c['L'][1] * 1000
                cl = gauss(zr - zc + 0.6 * (np.abs(theta) - np.pi) ** 2, 0.33) + 0.7 * gauss(zr - zc - 1.9 + 0.5 * (np.abs(theta) - np.pi) ** 2, 0.28)
            elif name == 'mcp':
                cl = gauss(zr + 1.0, 0.35) + 0.8 * gauss(zr - 1.6, 0.3)
            elif big:
                cl = gauss(zr + 0.9 + 0.4 * np.sin(theta * 2), 0.32) + 0.85 * gauss(zr - 1.3 + 0.3 * np.sin(theta * 2 + 1), 0.3)
            else:
                cl = gauss(zr - 0.3 + 0.3 * np.sin(theta * 2), 0.32) + 0.3 * gauss(zr - 2.0, 0.25)
            vmask = smooth(1.85, 2.45, np.abs(theta))
            h -= 0.00028 * cl * vmask; crease += cl * vmask
            # glove: leather folds across the palm side
            hg -= 0.0003 * gauss(zr + 0.5, 0.9) * vmask
            # back: knuckle wrinkles (curved sets of fine lines) and the joint pad
            if name == 'mcp':
                if thumb: kc = 1.0
                else: kc = 1.0
                pad_ = gauss(zr - 0.5, 6.0 * kc) * gauss(theta, 0.9)
                knuck += pad_; h += 0.0006 * pad_ * (1 if not thumb else 0.5)
                red += 0.6 * gauss(zr + 1.0, 5.0) * gauss(theta, 0.8)
                wr = sum(gauss(zr - d0 - 2.2 * theta ** 2, 0.22) * a0 for d0, a0 in ((-3.0, .5), (-1.4, .8), (0.2, 1), (1.8, .7), (3.3, .4)))
                wmask = gauss(theta, 0.8) * gauss(zr, 6.0)
                h -= 0.0001 * wr * wmask; crease += 0.6 * wr * wmask
                hg -= 0.00025 * (gauss(zr + 2.0 - 2 * theta ** 2, 0.8) + gauss(zr - 2.5 - 2 * theta ** 2, 0.9)) * gauss(theta, 0.9)
            else:
                size = 1.0 if big else 0.62
                offs = (-4.2, -3.0, -1.9, -0.8, 0.3, 1.4, 2.5, 3.5) if big else (-2.4, -1.4, -0.4, 0.6, 1.6)
                amp = (.35, .6, .9, 1, 1, .85, .6, .3) if big else (.4, .8, 1, .8, .4)
                curv = 1.6 if big else 1.2
                wr = 0
                for d0, a0 in zip(offs, amp):
                    jit = 0.25 * np.sin(theta * 3.1 + d0 * 1.7)
                    wr = wr + a0 * gauss(zr - d0 * size - curv * theta ** 2 * np.sign(-d0 + 0.5) * 0.6 - jit, 0.17 + 0.05 * size)
                wmask = gauss(theta, 0.95 * size + 0.15) * gauss(zr - 0.5, 4.6 * size)
                h -= 0.00016 * wr * wmask; crease += 0.9 * wr * wmask
                padk = gauss(zr - 0.8, 4.2 * size) * gauss(theta, 0.75)
                h += 0.00035 * padk * size; knuck += padk * size
                red += (0.85 if big else 0.55) * gauss(zr - 0.5, 4.8 * size) * gauss(theta, 0.85)
                dark += 0.35 * wr * wmask
                hg -= 0.0002 * (sum(gauss(zr - d0 - 1.0 * theta ** 2, 0.7) for d0 in ((-2.5, 0.0, 2.6) if big else (-1, 1.2)))) * gauss(theta, 1.0)
        # finger sides: slightly redder, the occluded strip darker
        red += 0.35 * side_w
        # fingertips: redder pads, a fingerprint whorl
        if k == len(c['L']) - 1:
            zt = (z - jn[-2]) * 1000; Ld = c['L'][-1] * 1000
            tip = smooth(0.35 * Ld, 0.9 * Ld, zt)
            red += 0.7 * tip * (0.5 + 0.5 * ventral)
            padz = zt - 0.55 * Ld
            rr = np.sqrt((padz / 1.3) ** 2 + ((np.abs(theta) - np.pi) * rad * 1000) ** 2)
            pad_m = smooth(1.2, 2.6, np.abs(theta)) * gauss(padz, 0.45 * Ld)
            h += 0.000012 * np.sin(rr / 0.48 * 2 * np.pi) * pad_m
            out['pad'][idx_m] = pad_m
            # ---- nail
            if True:
                w = {'thumb': 0.82, 'pinky-finger': 0.74}.get(f, 0.78) * rad * 1000
                z0 = (0.42 if not thumb else 0.40) * Ld; z1 = Ld * 1.0 + 0.6
                u = cs * 1000 / w; v = (zt - z0) / (z1 - z0)
                up_ok = smooth(0.0, 0.25, cos_t) * smooth(0.15, 0.45, ndors)
                # inside: |u|<1, v>0.12u^2, v<1 ; the cuticle arc bows toward the knuckle
                edge_side = 1 - np.abs(u); edge_prox = v - 0.16 * u * u
                ins = smooth(-0.05, 0.08, edge_side) * smooth(-0.02, 0.05, edge_prox) * smooth(1.08, 1.0, v) * up_ok
                nail = ins
                # relief: plate proud of the skin, grooves at the folds, a soft proximal fold
                dist_edge = np.minimum(edge_side * w, edge_prox * (z1 - z0))     # mm to the boundary (inside > 0)
                groove = gauss(dist_edge, 0.22) * up_ok * smooth(1.1, 0.95, v)
                h += 0.00010 * nail - 0.00016 * groove
                fold = gauss(dist_edge + 0.6, 0.45) * (edge_prox < 0.05) * up_ok
                h += 0.00007 * fold
                h += 0.000006 * np.sin(u * 23 + np.sin(u * 7) * 0.5) * nail                    # faint longitudinal ridges
                out['nail'][idx_m] = nail
                lun = smooth(0.24, 0.10, edge_prox) * smooth(0.95, 0.6, np.abs(u)) * nail
                out['lunula'][idx_m] = lun
                free = smooth(0.84, 0.93, v) * nail
                out['free'][idx_m] = free
                out['band'][idx_m] = gauss(v - 0.83, 0.03) * nail
                dark += 0.6 * groove
                rough -= 0.0 * nail
                # glove: no nails, just the finger
            # glove: the seam runs over the finger end
        # glove side seams (fourchettes) along both sides of each finger, stitched
        if not (k == 0):
            seam_d = np.abs(np.abs(theta) - np.pi / 2) * rad * 1000        # mm from the side line
            zz = z * 1000
            st = 0.5 + 0.5 * np.cos(zz / 2.2 * 2 * np.pi)
            welt = gauss(seam_d, 0.55)
            hg += 0.00030 * welt - 0.00018 * gauss(seam_d - 0.9, 0.3) - 0.00018 * gauss(seam_d + 0.9, 0.3)
            stl = gauss(seam_d - 1.4, 0.28) * smooth(0.55, 0.9, st)
            hg += 0.00012 * stl; stitch[:] = np.maximum(stitch, stl)
        gwear += knuck
        out['h'][idx_m] += h; out['red'][idx_m] += red; out['dark'][idx_m] += dark; out['crease'][idx_m] += crease
        out['hg'][idx_m] += hg; out['stitch'][idx_m] = np.maximum(out['stitch'][idx_m], stitch); out['gwear'][idx_m] += gwear
        out['vent'][idx_m] = ventral; out['knuckle'][idx_m] += knuck; out['side'][idx_m] = side_w
    # --- palm and back of the hand (and the wrist stub)
    pm = ~is_f
    if pm.any():
        x = X[pm]; y = Y[pm]; xm = Xm[pm]; ym = Ym[pm]; un = up_h[pm]
        vent = smooth(0.1, -0.45, un); dors = smooth(-0.1, 0.45, un)
        out['vent'][pm] = vent
        q = np.stack([x, y], 1)
        h = np.zeros(len(x)); dark = np.zeros(len(x)); red = np.zeros(len(x)); crease = np.zeros(len(x)); vein = np.zeros(len(x))
        hg = np.zeros(len(x)); stitch = np.zeros(len(x)); gwear = np.zeros(len(x))
        # palm creases, as curves in palm coordinates; depth and width in metres
        sc = np.array([r['width'], r['length']])
        def crease_line(pts, depth, width, fade=(0.0, 1.0), seed=0):
            c = catmull(pts, 16) * sc
            d, al, tot = poly_dist(q * sc, c)
            u = al / tot
            k = smooth(fade[0] - 0.08, fade[0] + 0.08, u) * smooth(fade[1] + 0.08, fade[1] - 0.08, u)
            wob = 1 + 0.25 * vnoise3(P[pm], 300, 40 + seed)
            return gauss(d, width * wob) * k * (0.75 + 0.25 * vnoise3(P[pm], 160, 50 + seed))
        heart = crease_line([(1.08, 0.80), (0.8, 0.84), (0.55, 0.86), (0.33, 0.93), (0.22, 1.02)], 1, 0.0005, seed=1)
        head = crease_line([(-0.06, 0.70), (0.15, 0.66), (0.4, 0.6), (0.62, 0.53), (0.72, 0.50)], 1, 0.00045, seed=2)
        life = crease_line([(-0.04, 0.72), (0.04, 0.6), (0.08, 0.42), (0.13, 0.22), (0.2, 0.05), (0.28, -0.05)], 1, 0.00048, seed=3)
        fate = crease_line([(0.48, 0.05), (0.47, 0.3), (0.45, 0.55)], 1, 0.0003, seed=4) * 0.5
        wrist1 = crease_line([(-0.25, -0.12), (0.2, -0.10), (0.6, -0.11), (1.1, -0.13)], 1, 0.0005, seed=5)
        wrist2 = crease_line([(-0.25, -0.24), (0.3, -0.21), (0.8, -0.22), (1.1, -0.24)], 1, 0.00035, seed=6) * 0.7
        pc = (heart + head + life + fate + wrist1 + wrist2)
        # fine palm lines: many short shallow creases from directional noise
        fine = np.clip(1 - np.abs(fbm3(P[pm] * np.array([1, 1, 1]), 260, 9, 3)) * 7, 0, 1) ** 3
        h -= vent * (0.00032 * np.clip(pc, 0, 1.3) + 0.00004 * fine); crease += vent * (pc + 0.3 * fine)
        dark += vent * 0.4 * np.clip(pc, 0, 1)
        # thenar / hypothenar pads: pinker
        then = gauss(np.hypot((x + 0.05) / 0.25, (y - 0.25) / 0.35), 1.0)
        hypo = gauss(np.hypot((x - 0.95) / 0.2, (y - 0.4) / 0.4), 1.0)
        red += vent * (0.45 * then + 0.35 * hypo + 0.25 * gauss(y - 0.95, 0.12))
        # back: extensor tendons fanning from the wrist to each knuckle, stronger near the knuckles
        for fi, f in enumerate(FING):
            kn = ch[f]['P'][1] - r['o']; kx = (kn @ r['s'] - r['x0']) / r['width']; ky = (kn @ r['e']) / r['length']
            A = np.array([0.42 + 0.06 * (fi - 1.5), -0.25]) * sc; B = np.array([kx, ky]) * sc
            d, t = seg_dist2d(q * sc, A, B)
            vis = smooth(0.25, 0.8, t) * smooth(1.02, 0.9, t) * (1.0 if fi < 3 else 0.6)
            prof = np.clip(1 - (d / 0.0034) ** 2, 0, 1) ** 2
            h += dors * 0.0005 * prof * vis
        # back: knuckle valleys
        # veins (slightly raised, a cool tint)
        for line, s in VEINS:
            c = line * sc; d, al, tot = poly_dist(q * sc, c)
            wv = 0.0024 * s * (1 + 0.15 * vnoise3(P[pm], 200, 77))
            prof = np.clip(1 - (d / wv) ** 2, 0, 1) ** 2
            h += dors * 0.0004 * s * prof * (0.75 + 0.25 * vnoise3(P[pm], 120, 78))
            vein = np.maximum(vein, dors * smooth(1.0, 0.3, d / wv) * min(1, s))
        # back of the hand: faint diamond creases
        h -= dors * 0.00002 * np.clip(1 - np.abs(vnoise3(P[pm], 420, 21)) * 6, 0, 1)
        # glove: the three stitched "points" on the back, a seam round the thumb, a hem at the wrist
        for xp in (0.33, 0.62, 0.86):
            for off in (-0.0007, 0.0007):
                A = np.array([xp, 0.95]) * sc + [off, 0]; B = np.array([xp - 0.04, 0.38]) * sc + [off, 0]
                d, t = seg_dist2d(q * sc, A, B)
                stl = gauss(d, 0.00028) * smooth(0.55, 0.9, 0.5 + 0.5 * np.cos(t * np.linalg.norm(B - A) / 0.0022 * 2 * np.pi)) * smooth(0.0, 0.05, t) * smooth(1.0, 0.95, t)
                hg += dors * 0.00012 * stl; stitch = np.maximum(stitch, dors * stl)
            A = np.array([xp, 0.95]) * sc; B = np.array([xp - 0.04, 0.38]) * sc
            d, t = seg_dist2d(q * sc, A, B)
            hg -= dors * 0.00014 * gauss(d, 0.00035) * smooth(0.0, 0.05, t)
        hem = gauss(ym + 0.17 * r['length'], 0.0007)
        hg += 0.00025 * hem
        hsti = gauss(ym + 0.17 * r['length'] - 0.0018, 0.00028) * smooth(0.5, 0.9, 0.5 + 0.5 * np.cos(np.arctan2(un, (P[pm] - r['o']) @ r['s']) * 70))
        hg += 0.0001 * hsti; stitch = np.maximum(stitch, hsti)
        hg -= vent * 0.00028 * np.clip(heart + head + life, 0, 1) * 0.6
        gwear += 0.6 * dors * smooth(0.6, 0.95, y)
        out['h'][pm] += h; out['dark'][pm] += dark; out['red'][pm] += red; out['crease'][pm] += crease; out['vein'][pm] = vein
        out['hg'][pm] += hg; out['stitch'][pm] = np.maximum(out['stitch'][pm], stitch); out['gwear'][pm] += gwear
    # thumb: the palm-side creases of its base belong to the thumb chain; the life line runs past it on the palm
    out['noise_lo'] = noise_lo
    out['noise_hi'] = fbm3(P, 700, 5, 3)
    out['mottle'] = fbm3(P, 260, 8, 3)
    out['spots'] = np.clip((vnoise3(P, 900, 13) - 0.86) * 9, 0, 1)
    out['speck'] = vnoise3(P, 1700, 17) * 0.6 + vnoise3(P, 3200, 19) * 0.4
    return out

# ================================================================= BAKE
def bake(N, pad):
    tri, obj, bary, best = raster(N, pad)
    log('raster', N, 'covered', int((best <= 0).sum()), 'padded', int((tri >= 0).sum()))
    res = {}
    keys = None
    for oi, H in enumerate(HANDS.values()):
        m = obj == oi
        ti = tri[m]; b = bary[m]
        P = (H['tri_p'][ti] * b[..., None]).sum(1)
        Nn = (H['tri_n'][ti] * b[..., None]).sum(1); Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-9
        ao = (H['vao'][H['src_idx'][ti]] * np.clip(b, 0, 1)).sum(1) / np.clip(np.clip(b, 0, 1).sum(1), 1e-6, None)
        CH = 300000; parts = []
        for s in range(0, len(P), CH):
            parts.append(fields(H, P[s:s + CH], Nn[s:s + CH]))
        F = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
        F['ao'] = ao
        if keys is None:
            keys = list(F); res = {k: np.zeros((N, N), np.float32) for k in keys}
        for k in keys: res[k][m] = F[k]
        log('fields', H['side'], len(P))
    res['mask'] = (tri >= 0).astype(np.float32); res['inside'] = (best <= 0.5).astype(np.float32)
    return res

def lin2srgb(c):
    c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)

def save(name, arr, quality=88):
    """arr: (N, N, C) floats 0..1, row 0 = top (glTF v = 0)."""
    h, w = arr.shape[:2]; C = arr.shape[2] if arr.ndim == 3 else 1
    a = arr if arr.ndim == 3 else arr[..., None]
    img = bpy.data.images.new(name, w, h, alpha=C == 4); img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32)
    if C == 1: px[..., :3] = a
    else: px[..., :C] = a
    px = px[::-1]
    img.pixels.foreach_set(np.clip(px, 0, 1).ravel())
    if C == 4: img.alpha_mode = 'STRAIGHT'
    path = os.path.join(OUT, name + '.webp'); img.file_format = 'WEBP'; img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    log('wrote', name, os.path.getsize(path), 'bytes')

def fill_pad(a, mask, iters=24):
    """spread values into empty texels (beyond the extrapolated padding) so mips never pull in black."""
    a = a.copy(); m = mask.astype(bool)
    for _ in range(iters):
        if m.all(): break
        acc = np.zeros_like(a); cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sm = np.roll(m, (dy, dx), (0, 1)); sa = np.roll(a, (dy, dx), (0, 1))
            acc += sa * (sm[..., None] if a.ndim == 3 else sm); cnt += sm
        new = (~m) & (cnt > 0)
        a[new] = (acc[new] / (cnt[new][..., None] if a.ndim == 3 else cnt[new]))
        m = m | new
    return a

F = bake(RES, pad=10)
mask = F['mask']

# ---- relief: the height (m) becomes a surface slope along +u and +v (v down), stored as two grey maps. Slopes are
# taken here in float on the padded (extrapolated) field, so lossy compression only adds tiny direction noise; a lossy
# height map differentiated in the shader showed every compression block.
SMAX = 1.0
def slopes(h, res):
    h = fill_pad(h, mask if res == RES else mh)
    du = 2.0 / res * UVM
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / du; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / du
    return 0.5 + np.clip(gx, -SMAX, SMAX) / (2 * SMAX), 0.5 + np.clip(gy, -SMAX, SMAX) / (2 * SMAX)
gx, gy = slopes(F['h'].astype(np.float64), RES)
save('hand_nx', gx, 90); save('hand_ny', gy, 90)

# ---- albedo (linear "medium" skin), stored sRGB
vent = F['vent']; red = np.clip(F['red'], 0, 1.5); dark = np.clip(F['dark'], 0, 1.5)
base_d = np.array([0.33, 0.21, 0.165]); base_v = np.array([0.42, 0.285, 0.225])
col = base_d * (1 - vent[..., None]) + base_v * vent[..., None]
mott = F['mottle'][..., None]; lo = F['noise_lo'][..., None]
col = col * (1 + 0.10 * lo + 0.07 * mott * np.array([1.0, 0.8, 0.7]) + 0.05 * F['speck'][..., None])
col = col * (1 - red[..., None] * np.array([-0.04, 0.2, 0.17]))                  # redness: less green/blue
col = col * (1 - 0.32 * np.clip(dark, 0, 1)[..., None] - 0.38 * np.clip(F['crease'], 0, 1.2)[..., None] * np.array([0.85, 1.0, 1.0]))
vein = F['vein'][..., None]
col = col * (1 - vein * np.array([0.08, 0.0, -0.06]))
col = col * (1 - 0.18 * F['spots'][..., None] * (1 - vent[..., None]) * np.array([0.8, 1, 1.1]))
col = col * (1 - 0.06 * F['side'][..., None] * np.array([0.5, 1, 1]))
nail = F['nail'][..., None]; lun = F['lunula'][..., None]; free = F['free'][..., None]; band = F['band'][..., None]
nail_c = np.array([0.56, 0.33, 0.27]) * (1 + 0.04 * F['noise_hi'][..., None])
nail_c = nail_c * (1 - lun) + np.array([0.64, 0.47, 0.40]) * lun
nail_c = nail_c * (1 - band * np.array([0.05, 0.25, 0.25]))
nail_c = nail_c * (1 - free) + np.array([0.76, 0.69, 0.58]) * free
col = col * (1 - nail) + nail_c * nail
col = col * (0.55 + 0.45 * F['ao'][..., None] ** 0.6)
alb = fill_pad(lin2srgb(col), mask)
save('hand_albedo', alb, 92)

# ---- ORM: occlusion, roughness, pigment weight, glove stitch mask
ao = np.clip(F['ao'] * (1 - 0.35 * np.clip(F['crease'], 0, 1)) * (1 - 0.12 * F['side']), 0, 1)
rough = 0.56 + 0.06 * F['knuckle'].clip(0, 1) + 0.05 * F['crease'].clip(0, 1) - 0.05 * vent - 0.08 * F['pad'] + 0.04 * F['noise_hi']
rough = rough * (1 - F['nail']) + (0.24 + 0.14 * F['free']) * F['nail']
pig = (1 - 0.62 * vent) * (1 - 0.85 * F['nail'])
st = np.clip(F['stitch'], 0, 1)
orm = np.stack([ao, np.clip(rough, 0, 1), np.clip(pig, 0, 1)], -1)
# half resolution
orm = orm.reshape(ORM_RES, 2, ORM_RES, 2, 3).mean((1, 3)); mh = mask.reshape(ORM_RES, 2, ORM_RES, 2).max((1, 3))
save('hand_orm', fill_pad(orm, mh), 90)

# ---- glove relief (leather creases, seams, stitching), half resolution
hg = (F['hg'] + 0.25 * np.clip(F['h'], -0.0006, 0)).reshape(ORM_RES, 2, ORM_RES, 2).mean((1, 3))
gx, gy = slopes(hg.astype(np.float64), ORM_RES)
save('hand_glove_nx', gx, 90); save('hand_glove_ny', gy, 90)
# stitch mask for the glove thread colour (a separate grey map: browsers premultiply alpha, which would wipe the ORM)
save('hand_glove_st', fill_pad(st.reshape(ORM_RES, 2, ORM_RES, 2).max((1, 3)), mh), 88)

# ================================================================= DETAIL TILES (periodic)
def voronoi_tile(S, cells, seed, jitter=0.85):
    rng = np.random.default_rng(seed)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1) + 0.5 + (rng.random((cells, cells, 2)) - 0.5) * jitter) / cells
    ys, xs = (np.mgrid[0:S, 0:S] + 0.5) / S
    gx = np.floor(xs * cells).astype(int); gy = np.floor(ys * cells).astype(int)
    F1 = np.full((S, S), 9.0); F2 = np.full((S, S), 9.0); ID = np.zeros((S, S), int)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx = gx + dx; cy = gy + dy
            p = pts[cx % cells, cy % cells]
            px = p[..., 0] + np.floor_divide(cx, cells); py = p[..., 1] + np.floor_divide(cy, cells)
            d = np.hypot(xs - px, ys - py) * cells
            m1 = d < F1; F2 = np.where(m1, F1, np.minimum(F2, d)); ID = np.where(m1, (cx % cells) * cells + (cy % cells), ID); F1 = np.where(m1, d, F1)
    return F1, F2, ID

def periodic_noise(S, scale, seed):
    rng = np.random.default_rng(seed); w = rng.standard_normal((S, S))
    fx = np.fft.fftfreq(S)[:, None]; fy = np.fft.fftfreq(S)[None, :]
    f = np.hypot(fx, fy) * S
    k = np.exp(-(f / scale) ** 2)
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * k)); return n / (n.std() + 1e-9)

TILE = 512
# skin: a furrow network (plates about 0.6 mm across over a 16 mm tile), pores at some furrow crossings, fine noise
F1, F2, ID = voronoi_tile(TILE, 26, 3)
fur = np.exp(-((F2 - F1) / 0.05) ** 2)
F1b, F2b, _ = voronoi_tile(TILE, 13, 4)
fur2 = np.exp(-((F2b - F1b) / 0.07) ** 2)
rng = np.random.default_rng(5)
pores = np.zeros((TILE, TILE))
ys, xs = np.mgrid[0:TILE, 0:TILE]
for _ in range(420):
    cx, cy = rng.random(2) * TILE; r = rng.uniform(1.6, 2.6)
    dx = (xs - cx + TILE / 2) % TILE - TILE / 2; dy = (ys - cy + TILE / 2) % TILE - TILE / 2
    pores += np.exp(-(dx * dx + dy * dy) / (r * r)) * rng.uniform(0.5, 1)
skin = 0.5 - 0.07 * fur - 0.13 * fur2 - 0.3 * np.clip(pores, 0, 1) + 0.035 * periodic_noise(TILE, 40, 6) + 0.05 * periodic_noise(TILE, 12, 7)
save('hand_pores', np.clip(skin, 0, 1), 100)

# leather: pebbled grain, cells about 0.8 mm over a 20 mm tile, fine pits
L1, L2, LID = voronoi_tile(TILE, 25, 8, 0.95)
cellh = np.random.default_rng(9).random(25 * 25)[LID]
leather = 0.35 + 0.28 * np.clip(1 - (L1 / 0.75) ** 2, 0, 1) ** 0.6 * (0.7 + 0.3 * cellh) - 0.25 * np.exp(-((L2 - L1) / 0.09) ** 2) + 0.04 * periodic_noise(TILE, 70, 10)
save('hand_leather', np.clip(leather, 0, 1), 100)

# ================================================================= MESHES
for side, H in HANDS.items():
    p = os.path.join(WORK, f'hand_{side}.raw.glb'); write_glb(p, H['j'], H['acc'], H['V']); log('wrote', p, os.path.getsize(p))
json.dump({'uvMeters': UVM, 'slopeMax': SMAX, 'tileSkin': 0.016, 'tileLeather': 0.020}, open(os.path.join(WORK, 'hand_maps.json'), 'w'))
log('done')
