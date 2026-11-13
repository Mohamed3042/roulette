# Converts the third-party ".44 Magnum classic revolver" FBX (CC BY 4.0, see CREDITS.md) into the app's revolver:
# assets/models/revolver.glb (Draco, one node per moving part) + phone-sized maps.
#   blender -b --factory-startup --python tools/blender/import_sw629.py -- "<source folder>" [<out dir>] [--tex 2048] [--no-bake] [--no-maps]
# --no-bake keeps the baked wear map (5 min on a GPU); --no-maps keeps the normal/detail maps. The geometry and UVs are
# deterministic, so a partial run stays consistent with maps from an earlier full run.
# <source folder> holds the .fbx and the texture folder from the original download (never committed).
# Source model: metres, -X toward the muzzle, +Z up, +Y = the gun's right side.
# Output (Blender before glTF Y-up export): +X right, +Y toward the muzzle, +Z up; origin = trigger pivot.
# The app (js/revolver.js) fits that frame into its own (FIT) so the hand, the sights and the anchors line up.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.interpolate import poly_3d_calc
from mathutils.bvhtree import BVHTree

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def _opt(name, default=None):
    if name in ARGV:
        i = ARGV.index(name); v = ARGV[i + 1]; del ARGV[i:i + 2]; return v
    return default
TEX = int(_opt('--tex', '2048'))
NOBAKE = '--no-bake' in ARGV
if NOBAKE: ARGV.remove('--no-bake')
NOMAPS = '--no-maps' in ARGV        # keep the already written source-derived maps (normal, detail)
if NOMAPS: ARGV.remove('--no-maps')
SRC = os.path.abspath(ARGV[0])
OUT = os.path.abspath(ARGV[1] if len(ARGV) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models'))
os.makedirs(OUT, exist_ok=True)

def find(root, pred):
    for d, _, fs in os.walk(root):
        for f in fs:
            if pred(f): return os.path.join(d, f)
    raise SystemExit('missing source file in ' + root)
FBX = find(SRC, lambda f: f.lower().endswith('.fbx'))
T_BASE = find(SRC, lambda f: f.startswith('Revolver_Base_color'))
T_NRM = find(SRC, lambda f: f.startswith('Revolver_Normal_OpenGL'))
T_RGH = find(SRC, lambda f: f.startswith('Revolver_Roughness'))
T_MET = find(SRC, lambda f: f.startswith('Revolver_Metallic'))

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
COL = SC.collection
bpy.ops.import_scene.fbx(filepath=FBX)

src = bpy.data.objects['Revolver']
arm = bpy.data.objects['Armature Revolver']
src.modifiers.clear()
if arm.animation_data: arm.animation_data.action = None
src.parent = None
src.matrix_world = Matrix.Identity(4)
for ob in list(bpy.data.objects):
    if ob is not src: bpy.data.objects.remove(ob)
SME = src.data
bullets_ref = None

# ---------------------------------------------------------------- reference points (source frame, from the rig)
TRIG_PIV = Vector((-0.0757, 0.0, 0.0871))
HAM_PIV = Vector((-0.0474, 0.0, 0.0993))
HINGE = Vector((-0.1316, -0.0045, 0.0871))      # crane swing axis, parallel to the bore
CYL_AX = Vector((-0.0666, 0.0, 0.1154))         # cylinder axis (y, z); x set from the mesh below

def tm(p):
    """source point -> output frame (origin = trigger pivot)."""
    return Vector((p.y, -(p.x - TRIG_PIV.x), p.z - TRIG_PIV.z))
TM = Matrix(((0, 1, 0, 0), (-1, 0, 0, TRIG_PIV.x), (0, 0, 1, -TRIG_PIV.z), (0, 0, 0, 1)))

# ---------------------------------------------------------------- split the mesh into the moving parts
gname = {g.index: g.name for g in src.vertex_groups}
def vgroup(i):
    gs = SME.vertices[i].groups
    return gname[max(gs, key=lambda g: g.weight).group] if len(gs) else 'Root Revolver'
bm = bmesh.new(); bm.from_mesh(SME); bm.verts.ensure_lookup_table()
seen = set(); parts = []
for v in bm.verts:
    if v.index in seen: continue
    comp = []; stack = [v]
    while stack:
        x = stack.pop()
        if x.index in seen: continue
        seen.add(x.index); comp.append(x.index)
        for e in x.link_edges: stack.append(e.other_vert(x))
    cnt = {}
    for i in comp: cnt[vgroup(i)] = cnt.get(vgroup(i), 0) + 1
    g = max(cnt, key=cnt.get)
    zs = [SME.vertices[i].co.z for i in comp]; xs = [SME.vertices[i].co.x for i in comp]
    parts.append({'verts': set(comp), 'group': g, 'zmin': min(zs), 'zmax': max(zs), 'xmin': min(xs), 'xmax': max(xs)})
bm.free()
NODE_OF_GROUP = {'Root Revolver': 'Frame', 'Ejector Button Revolver': 'Frame', 'Hammer Revovler': 'Hammer', 'Trigger Revovler': 'Trigger',
                 'Ejector Revolver': 'Crane', 'Cylinder Revolver': 'Cylinder', 'Ejector Rod Revolver': 'Cylinder'}
node_verts = {}
for p in parts:
    node = NODE_OF_GROUP[p['group']]
    if node == 'Frame' and p['zmax'] < 0.112 and p['zmin'] < 0.01: node = 'Grip'   # the wrap-around grip below the frame
    node_verts.setdefault(node, set()).update(p['verts'])
print('INFO parts', {k: len(v) for k, v in node_verts.items()})

# measurements from the mesh
co = lambda i: SME.vertices[i].co
cyl_x_rear = max(co(i).x for i in node_verts['Cylinder'] if math.hypot(co(i).y, co(i).z - CYL_AX.z) > 0.017)  # rear face (outer ring)
cyl_x_front = min(co(i).x for i in node_verts['Cylinder'] if math.hypot(co(i).y, co(i).z - CYL_AX.z) > 0.017)
frame_ids = node_verts['Frame']
muzzle_x = min(co(i).x for i in frame_ids)
# chamber circle: measured from the source's six loaded rounds (centres 14.1 mm off the axis, one at 12 o'clock);
# the top chamber lines up with the bore
CH_R = 0.0141
bore_z = CYL_AX.z + CH_R
print('INFO cyl rear/front x', cyl_x_rear, cyl_x_front, 'muzzle x', muzzle_x, 'bore z', bore_z, 'CH_R', CH_R)
# rear sight: lowest point of the notch in the rear blade (|y| small, highest part near the frame's rear)
top_parts = [p for p in parts if NODE_OF_GROUP[p['group']] == 'Frame' and p['zmin'] > 0.14 and p['xmax'] > -0.07]
rs_ids = set().union(*[p['verts'] for p in top_parts]) if top_parts else set()
rs_pts = [co(i) for i in rs_ids]
rs_center = [p for p in rs_pts if abs(p.y) < 0.0009]
rear_z = max(p.z for p in rs_center) if rs_center else max(p.z for p in rs_pts)
rear_x = sum(p.x for p in rs_pts) / len(rs_pts)
fs_parts = [p for p in parts if NODE_OF_GROUP[p['group']] == 'Frame' and p['xmin'] < -0.25 and p['zmin'] > 0.14]
fs_pts = [co(i) for p in fs_parts for i in p['verts']]
top = max(fs_pts, key=lambda p: p.z)
front_z, front_x = top.z, top.x
print('INFO rear sight x,z', rear_x, rear_z, 'front sight x,z', front_x, front_z, 'top parts', len(top_parts))

# ---------------------------------------------------------------- brand marks: cleaned out of the source textures
# Regions on the surface (source frame): centre (x, z), half extents (x, z), side the ray comes from (+1 = right, -1 = left).
MARKS = [
    ((-0.0516, 0.0950), (0.0105, 0.0105), -1),    # maker's medallion, left side plate
    ((-0.1130, 0.0889), (0.0150, 0.0065), +1),    # roll mark under the cylinder, right side
    ((-0.1970, 0.1292), (0.0290, 0.0045), +1),    # model name on the barrel, right side
]
bvh_src = BVHTree.FromObject(src, bpy.context.evaluated_depsgraph_get())
uv_src = SME.uv_layers.active.data

def mark_uvs():
    """Per mark: UVs of the surface under it, and UVs of a 3 mm ring of plain surface around it."""
    out = []
    for (cx, cz), (hx, hz), side in MARKS:
        inner, ring = [], []
        R = 0.003
        for x in np.arange(cx - hx - R, cx + hx + R, 0.0002):
            for z in np.arange(cz - hz - R, cz + hz + R, 0.0002):
                o = Vector((x, side * 0.1, z)); d = Vector((0, -side, 0))
                loc, nrm, fi, dist = bvh_src.ray_cast(o, d, 0.2)
                if fi is None: continue
                poly = SME.polygons[fi]
                w = poly_3d_calc([SME.vertices[vi].co for vi in poly.vertices], loc)
                uv = sum((uv_src[li].uv * wi for li, wi in zip(poly.loop_indices, w)), Vector((0, 0)))
                (inner if abs(x - cx) <= hx and abs(z - cz) <= hz else ring).append((uv.x, uv.y))
        print('INFO mark hits', len(inner), 'ring', len(ring))
        out.append((inner, ring))
    return out

# ---------------------------------------------------------------- image helpers
def load_px(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[..., :3]

def down2(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])

def resize_to(a, n):
    while a.shape[0] > n: a = down2(a)
    return a

def box_blur(a, r):
    """separable box blur with edge clamping, a: HxW or HxWxC"""
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if k == axis else (0, 0) for k in range(a.ndim)], mode='edge'), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a

def save_webp(name, arr, quality=86):
    """arr: HxWx3 float 0..1 (row 0 = bottom, Blender convention)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(px.ravel())
    s = SC.render.image_settings
    s.file_format = 'WEBP'; s.quality = quality; s.color_mode = 'RGB'
    try: s.color_management = 'OVERRIDE'; s.view_settings.view_transform = 'Standard'
    except Exception: pass
    SC.view_settings.view_transform = 'Standard'
    path = os.path.join(OUT, name + '.webp')
    img.save_render(path, scene=SC)
    print('SIZE', name, os.path.getsize(path))
    return img

def make_source_maps():
    marks = mark_uvs()
    base = load_px(T_BASE); H, W = base.shape[:2]
    lum = (base * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    del base
    detail = np.concatenate([load_px(T_RGH)[..., :1], load_px(T_MET)[..., :1], lum], -1)
    nrm = load_px(T_NRM)
    flat = np.array([0.5, 0.5, 1.0], np.float32)
    def tex_idx(uvs):
        a = np.array(uvs, np.float32)
        return (np.clip((a[:, 1] * H).astype(int), 0, H - 1), np.clip((a[:, 0] * W).astype(int), 0, W - 1))
    for inner, ring in marks:
        if not inner or not ring: continue
        m = np.zeros((H, W), np.float32)
        ys, xs = tex_idx(inner)
        for dy in range(-3, 4):
            for dx in range(-3, 4): m[np.clip(ys + dy, 0, H - 1), np.clip(xs + dx, 0, W - 1)] = 1
        m = np.clip(box_blur(m, 4) * 2.0, 0, 1)[..., None]
        val = np.median(detail[tex_idx(ring)], axis=0)        # the plain steel right around the mark
        detail = detail * (1 - m) + val * m
        nrm = nrm * (1 - m) + flat * m
        print('INFO mark fill', val)
    save_webp('revolver_detail', resize_to(detail, TEX), 88)
    del detail
    save_webp('revolver_normal', resize_to(nrm, TEX), 90)

# ---------------------------------------------------------------- materials (placeholders; the app builds its own by name)
def pmat(name, col, metal=1.0, rough=0.35):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m
M_STEEL = pmat('steel', (0.05, 0.055, 0.065), 1, 0.3)
M_CASE = pmat('steel_case', (0.06, 0.06, 0.07), 1, 0.3)
M_GRIP = pmat('grip', (0.25, 0.12, 0.05), 0, 0.4)
M_MEDAL = pmat('medallion', (0.8, 0.65, 0.35), 1, 0.3)
M_BRASS = pmat('brass', (0.8, 0.6, 0.3), 1, 0.3)
M_HEAD = pmat('brass_head', (0.8, 0.6, 0.3), 1, 0.3)
M_LEAD = pmat('lead', (0.35, 0.35, 0.36), 0.6, 0.6)
M_PRIMER = pmat('primer', (0.75, 0.72, 0.68), 1, 0.35)

# ---------------------------------------------------------------- scene utils
def link(ob):
    COL.objects.link(ob); return ob

def empty(name, loc, parent=None):
    e = link(bpy.data.objects.new(name, None)); e.empty_display_size = 0.003; e.location = loc
    if parent: e.parent = parent
    return e

def part_object(name, ids, mat, angle=32):
    b = bmesh.new(); b.from_mesh(SME); b.verts.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[v for v in b.verts if v.index not in ids], context='VERTS')
    bmesh.ops.transform(b, matrix=TM, verts=b.verts)
    bmesh.ops.remove_doubles(b, verts=b.verts, dist=2e-6)   # keep the source winding: the parts are not all closed shells
    me = bpy.data.meshes.new(name); b.to_mesh(me); b.free()
    me.materials.clear(); me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    shade(ob, angle)
    return ob

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; me.name = ob.name
    if old.users == 0: bpy.data.meshes.remove(old)

def shade(ob, angle=33.0):
    b = bmesh.new(); b.from_mesh(ob.data)
    a = math.radians(angle)
    for f in b.faces: f.smooth = True
    for e in b.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > a) and len(e.link_faces) == 2
    b.to_mesh(ob.data); b.free()
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True; m.weight = 50; m.mode = 'FACE_AREA'
    apply_mods(ob)

def set_origin(ob, origin):
    ob.data.transform(Matrix.Translation(-Vector(origin))); ob.location = Vector(origin)

def lathe(name, prof, seg=48, closed=False):
    """Revolve [(r, t)] about +Y (t = position along Y). Returns an object."""
    b = bmesh.new(); rings = []
    for (r, t) in prof:
        if r < 1e-9: rings.append([b.verts.new((0, t, 0))])
        else: rings.append([b.verts.new((math.sin(2 * math.pi * i / seg) * r, t, math.cos(2 * math.pi * i / seg) * r)) for i in range(seg)])
    n = len(rings) if closed else len(rings) - 1
    for k in range(n):
        A = rings[k]; B = rings[(k + 1) % len(rings)]
        if len(A) == 1 and len(B) == 1: continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(A) == 1: b.faces.new((A[0], B[i], B[j]))
            elif len(B) == 1: b.faces.new((A[i], A[j], B[0]))
            else: b.faces.new((A[i], A[j], B[j], B[i]))
    if not closed:
        for rg in (rings[0], rings[-1]):
            if len(rg) > 2: b.faces.new(rg)
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    me = bpy.data.meshes.new(name); b.to_mesh(me); b.free()
    return link(bpy.data.objects.new(name, me))

def join(objs, name):
    base = objs[0]
    with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs, object=base):
        bpy.ops.object.join()
    base.name = name; base.data.name = name
    return base

# ---------------------------------------------------------------- cartridges (.44 Magnum class, generic, built here)
MM = 0.001
RIM_R, CASE_R, CASE_L, BUL_R, OAL, PRIM_R = 6.5, 5.78, 32.6, 5.45, 40.2, 2.68
HS_R = 6.6       # headstamp UV radius (the app's canvas maps 2 * HS_R mm across)
def build_cartridge_mesh():
    """Origin at the head centre (the case head plane), case pointing +Y."""
    s = MM
    side = lathe('case', [(PRIM_R * s, 0.0), (PRIM_R * s, 0.25 * s), (RIM_R * 0.93 * s, 0.0), (RIM_R * s, 0.15 * s), (RIM_R * s, 1.25 * s),
                          (RIM_R * 0.97 * s, 1.45 * s), (CASE_R * s, 1.5 * s), (CASE_R * 0.995 * s, (CASE_L - 0.6) * s), (CASE_R * 0.985 * s, CASE_L * s),
                          (BUL_R * 0.98 * s, CASE_L * s), (BUL_R * 0.98 * s, 2.2 * s), (PRIM_R * s, 2.2 * s)], seg=40, closed=True)
    b = bmesh.new(); uvl = b.loops.layers.uv.new('UVMap')
    R0, R1, N = PRIM_R * s, RIM_R * 0.93 * s, 40
    r0 = [b.verts.new((math.sin(2 * math.pi * i / N) * R0, -0.000001, math.cos(2 * math.pi * i / N) * R0)) for i in range(N)]
    r1 = [b.verts.new((math.sin(2 * math.pi * i / N) * R1, -0.000001, math.cos(2 * math.pi * i / N) * R1)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N; b.faces.new((r0[i], r1[i], r1[j], r0[j]))
    b.normal_update()
    for f in b.faces:
        if f.normal.y > 0: f.normal_flip()
        for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.x / (2 * HS_R * s), 0.5 + lp.vert.co.z / (2 * HS_R * s))
    me = bpy.data.meshes.new('head'); b.to_mesh(me); b.free(); head = link(bpy.data.objects.new('head', me))
    # semi-wadcutter lead bullet
    bullet = lathe('bullet', [(0, (CASE_L - 1.0) * s), (BUL_R * s, (CASE_L - 1.0) * s), (BUL_R * s, (CASE_L + 2.4) * s), (BUL_R * 0.86 * s, (CASE_L + 2.6) * s),
                              (BUL_R * 0.80 * s, (CASE_L + 4.2) * s), (BUL_R * 0.66 * s, (CASE_L + 6.0) * s), (BUL_R * 0.52 * s, (OAL - 0.4) * s), (0, OAL * s)], seg=32)
    for o, mat in ((side, M_BRASS), (head, M_HEAD), (bullet, M_LEAD)): o.data.materials.append(mat)
    for o in (side, bullet):
        me = o.data; uv = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (math.atan2(v.x, v.z) / (2 * math.pi) + 0.5, v.y / 0.040)
    c = join([side, head, bullet], 'CartridgeMesh')
    shade(c, 40)
    return c.data

def build_primer_mesh():
    s = MM; R = PRIM_R - 0.08
    prof = [(0, 0.08 * s)] + [(r * s, 0.08 * s) for r in (0.35, 0.7, 1.05, 1.4, 1.8, 2.15)] + [(2.4 * s, 0.1 * s), (2.55 * s, 0.2 * s), (R * s, 0.42 * s), (R * s, 0.9 * s), (0, 0.9 * s)]
    o = lathe('primer', prof, seg=32)
    me = o.data; uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (0.5 + v.x / (2 * PRIM_R * s), 0.5 + v.z / (2 * PRIM_R * s))
    me.materials.append(M_PRIMER); shade(o, 50)
    me = o.data; bpy.data.objects.remove(o)
    return me

# ---------------------------------------------------------------- grip: planar UVs + walnut maps (wood, checkered field, medallion)
GRIP_UV = 0.12          # metres covered by the planar UV square (side projection, output frame y/z)
def grip_uv(ob):
    me = ob.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    y0 = (min(ys) + max(ys)) / 2 - GRIP_UV / 2; z0 = (min(zs) + max(zs)) / 2 - GRIP_UV / 2
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((v.y - y0) / GRIP_UV, (v.z - z0) / GRIP_UV)
    return y0, z0

def fft_noise(n, fx, fy, seed, power=1.0):
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n))
    ky = np.fft.fftfreq(n)[:, None] * n; kx = np.fft.fftfreq(n)[None, :] * n
    filt = np.exp(-0.5 * ((kx / fx) ** 2 + (ky / fy) ** 2)) ** power
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    out -= out.mean(); out /= (out.std() + 1e-9)
    return out

def make_grip_tex(ob, y0, z0, n=1024):
    """Rasterise the side-facing faces into the UV square, inset them into a checkered field around a medallion."""
    me = ob.data; mm = GRIP_UV * 1000 / n
    side = np.zeros((n, n), bool)
    for poly in me.polygons:
        if abs(poly.normal.x) < 0.55: continue
        pts = [me.vertices[i].co for i in poly.vertices]
        P = np.array([((p.y - y0) / GRIP_UV * n, (p.z - z0) / GRIP_UV * n) for p in pts])
        for k in range(1, len(P) - 1):
            tri = P[[0, k, k + 1]]
            x0, x1 = int(max(0, tri[:, 0].min())), int(min(n - 1, tri[:, 0].max() + 1))
            ya, yb = int(max(0, tri[:, 1].min())), int(min(n - 1, tri[:, 1].max() + 1))
            if x1 < x0 or yb < ya: continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = tri
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-9: continue
            l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / d
            l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / d
            inside = (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
            side[ya:yb + 1, x0:x1 + 1] |= inside
    # inset distance (mm) by repeated erosion (alternating cross / square ~ octagonal metric)
    dist = np.zeros((n, n), np.float32); cur = side.copy(); k = 0
    while cur.any() and k < 400:
        dist += cur * mm
        e = cur.copy()
        e[1:, :] &= cur[:-1, :]; e[:-1, :] &= cur[1:, :]; e[:, 1:] &= cur[:, :-1]; e[:, :-1] &= cur[:, 1:]
        if k % 2:
            e[1:, 1:] &= cur[:-1, :-1]; e[:-1, :-1] &= cur[1:, 1:]; e[1:, :-1] &= cur[:-1, 1:]; e[:-1, 1:] &= cur[1:, :-1]
        cur = e; k += 1
    dist = box_blur(dist, 2)
    # grip axis: principal direction of the side panel
    Ys, Xs = np.nonzero(side)
    c = np.array([Xs.mean(), Ys.mean()]); cov = np.cov(np.stack([Xs - c[0], Ys - c[1]]))
    w, V = np.linalg.eigh(cov); ax = V[:, np.argmax(w)]
    if ax[1] > 0: ax = -ax                                    # points down the grip
    nx = np.array([ax[1], -ax[0]])
    X, Y = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    s_ax = ((X - c[0]) * ax[0] + (Y - c[1]) * ax[1]) * mm      # mm along the grip (down)
    s_nx = ((X - c[0]) * nx[0] + (Y - c[1]) * nx[1]) * mm
    top = s_ax[side].min(); bot = s_ax[side].max()
    # medallion: upper third of the panel, centred across it
    mrow = side & (np.abs(s_ax - (top + (bot - top) * 0.30)) < mm)
    mc_n = s_nx[mrow].mean() if mrow.any() else 0.0
    mc_a = top + (bot - top) * 0.30
    med = np.hypot(s_ax - mc_a, s_nx - mc_n)
    MED_R = 3.9
    field = (dist > 5.0) & (s_ax > top + 14.0) & (s_ax < bot - 7.0) & (med > MED_R + 2.6)
    soft = np.clip((dist - 5.0) / 0.3, 0, 1) * np.clip((s_ax - top - 14.0) / 0.3, 0, 1) * np.clip((bot - 7.0 - s_ax) / 0.3, 0, 1) * np.clip((med - MED_R - 2.6) / 0.25, 0, 1)
    soft *= side
    border = (np.exp(-((dist - 4.6) / 0.16) ** 2) * (s_ax > top + 13.6) * (s_ax < bot - 6.6)
              + np.exp(-((med - MED_R - 2.2) / 0.16) ** 2) * (dist > 4.6)) * side
    pitch = 1.05; ang = math.radians(34)
    l1 = (s_ax * math.sin(ang) + s_nx * math.cos(ang)) / pitch
    l2 = (s_ax * math.sin(ang) - s_nx * math.cos(ang)) / pitch
    tri_ = lambda x: np.abs(x - np.floor(x) - 0.5) * 2
    hpyr = np.minimum(tri_(l1), tri_(l2))
    wearc = np.clip((dist - 9.0) / 10.0, 0, 1) * (0.45 + 0.25 * np.clip(fft_noise(n, 6, 6, 26) * 0.5 + 0.5, 0, 1))
    hp = np.minimum(hpyr, 1.0 - wearc)
    height = soft * (hp * 0.4 - 0.4) - border * 0.25
    gy, gx = np.gradient(height, mm)
    nrm = np.dstack([-gx, -gy, np.ones_like(gx)]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    save_webp('revolver_grip_n', nrm * 0.5 + 0.5, 90)
    warp = fft_noise(n, 2.5, 2.5, 21) * 1.0 + fft_noise(n, 9, 9, 22) * 0.25
    gr = np.sin(s_nx * 1.6 + warp * 3.2 + s_ax * 0.02) * 0.5 + 0.5
    gr = 0.5 + (gr - 0.5) * (0.55 + 0.45 * np.clip(fft_noise(n, 4, 4, 25) * 0.5 + 0.5, 0, 1))
    fine = fft_noise(n, 4, 160, 23)
    pores = np.interp(s_nx.ravel(), np.linspace(-70, 70, n), fine[n // 2]).reshape(n, n)
    grain = np.clip(gr ** 1.6 * 0.7 + (pores * 0.15 + 0.15), 0, 1)
    figure = 0.5 + 0.1 * fft_noise(n, 3, 9, 24) + 0.05 * fft_noise(n, 14, 30, 27)
    save_webp('revolver_grip_m', np.dstack([grain, soft, figure]), 88)
    # medallion centre back in the output frame (y, z)
    py = c[0] + (ax[0] * mc_a + nx[0] * mc_n) / mm; pz = c[1] + (ax[1] * mc_a + nx[1] * mc_n) / mm
    return y0 + py / n * GRIP_UV, z0 + pz / n * GRIP_UV, MED_R * MM

def build_medallions(grip, my, mz, r):
    bvh = BVHTree.FromObject(grip, bpy.context.evaluated_depsgraph_get())
    out = []
    for sx in (-1, 1):
        loc, nrm, fi, d = bvh.ray_cast(Vector((sx * 0.06, my, mz)), Vector((-sx, 0, 0)), 0.1)
        if loc is None: print('WARN medallion miss', sx); continue
        o = lathe('medal', [(0, 0.0), (r, 0.0), (r, 0.00025), (r * 0.9, 0.00045), (r * 0.72, 0.0005), (0, 0.00055)], seg=40)
        # lathe axis +Y -> surface normal, sunk 0.15 mm into the wood
        q = Vector((0, 1, 0)).rotation_difference(nrm)
        o.data.transform(q.to_matrix().to_4x4()); o.data.transform(Matrix.Translation(loc - nrm * 0.00015))
        o.data.materials.append(M_MEDAL); shade(o, 50)
        out.append(o)
    return out

# ---------------------------------------------------------------- assembly
def assemble():
    root = empty('Revolver', (0, 0, 0))
    frame = part_object('Frame', node_verts['Frame'], M_STEEL); frame.parent = root
    grip = part_object('Grip', node_verts['Grip'], M_GRIP, 180)   # wood is all rounded: smooth normals, no faceted ridges
    y0, z0 = grip_uv(grip)
    my, mz, mr = make_grip_tex(grip, y0, z0)
    meds = build_medallions(grip, my, mz, mr)
    for m in meds:
        m.data.uv_layers.new(name='UVMap')
    grip = join([grip] + meds, 'Grip') if meds else grip
    grip.parent = root
    hammer = part_object('Hammer', node_verts['Hammer'], M_CASE); set_origin(hammer, tm(HAM_PIV)); hammer.parent = root
    trigger = part_object('Trigger', node_verts['Trigger'], M_CASE); set_origin(trigger, tm(TRIG_PIV)); trigger.parent = root
    hinge = tm(Vector((cyl_x_rear, HINGE.y, HINGE.z)))
    cyl_o = tm(Vector((cyl_x_rear, CYL_AX.y, CYL_AX.z)))
    crane = part_object('Crane', node_verts['Crane'], M_STEEL); set_origin(crane, hinge); crane.parent = root
    cyl = part_object('Cylinder', node_verts['Cylinder'], M_STEEL); set_origin(cyl, cyl_o); cyl.parent = crane
    cyl.location = cyl_o - hinge
    cme = build_cartridge_mesh(); pme = build_primer_mesh()
    head_y = -0.001 + 0.0   # case head plane sits 1 mm behind the cylinder's rear face (as in the source)
    for k in range(6):
        a = k * math.pi / 3
        c = link(bpy.data.objects.new('Cartridge%d' % k, cme)); c.parent = cyl
        c.location = (math.sin(a) * CH_R, head_y, math.cos(a) * CH_R)
        c.rotation_euler = (0, a, 0)
        p = link(bpy.data.objects.new('Primer%d' % k, pme)); p.parent = c
    for ob in list(bpy.data.objects):
        if ob.name.startswith('CartridgeMesh'): bpy.data.objects.remove(ob)
    empty('Muzzle', tm(Vector((muzzle_x, 0, bore_z))), root)
    empty('Gap', tm(Vector((cyl_x_front - 0.00015, 0, bore_z))), root)
    empty('RearSight', tm(Vector((rear_x, 0, rear_z))), root)
    empty('FrontSight', tm(Vector((front_x, 0, front_z))), root)
    bpy.data.objects.remove(src)
    for me in list(bpy.data.meshes):
        if me.users == 0: bpy.data.meshes.remove(me)
    bpy.context.view_layer.update()
    print('INFO anchors', {n: tuple(round(v, 5) for v in bpy.data.objects[n].matrix_world.translation) for n in ('Muzzle', 'Gap', 'RearSight', 'FrontSight', 'Hammer', 'Trigger', 'Crane')})
    print('INFO cylinder world', tuple(round(v, 5) for v in (cyl_o)), 'CH_R', CH_R, 'CYL_R', max(math.hypot(v.co.x, v.co.z) for v in cyl.data.vertices))

# chamber phase check: one chamber must sit at 12 o'clock with the cylinder at rest
def chamber_phase():
    pts = [co(i) for i in node_verts['Cylinder'] if co(i).x > cyl_x_rear - 0.0004]
    hist = np.zeros(60)
    for p in pts:
        r = math.hypot(p.y - CYL_AX.y, p.z - CYL_AX.z)
        if abs(r - CH_R) < 0.0015:
            hist[int((math.degrees(math.atan2(p.y, p.z - CYL_AX.z)) % 60) // 1)] += 1
    print('INFO chamber phase hist (deg mod 60)', hist.astype(int).tolist())

# ---------------------------------------------------------------- wear bake (ao / cavity / convex edge on the source UVs)
STEEL_OBJS = ['Frame', 'Hammer', 'Trigger', 'Crane', 'Cylinder']
def bake_wear():
    SC.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for dev in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = dev; prefs.get_devices()
                for d in prefs.devices: d.use = True
                SC.cycles.device = 'GPU'; break
            except Exception: continue
    except Exception as e:
        print('GPU setup failed', e)
    print('INFO bake device', SC.cycles.device)
    SC.cycles.samples = 64
    img = bpy.data.images.new('wear', TEX, TEX, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    saved = {}
    for mat in (M_STEEL, M_CASE):
        nt = mat.node_tree; N = nt.nodes; L = nt.links
        out = N.get('Material Output'); saved[mat.name] = out.inputs['Surface'].links[0].from_socket
        geo = N.new('ShaderNodeNewGeometry'); bev = N.new('ShaderNodeBevel'); bev.inputs['Radius'].default_value = 0.0006; bev.samples = 16
        dot = N.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
        L.new(geo.outputs['Normal'], dot.inputs[0]); L.new(bev.outputs['Normal'], dot.inputs[1])
        edge = N.new('ShaderNodeMath'); edge.operation = 'SUBTRACT'; edge.inputs[0].default_value = 1.0; L.new(dot.outputs['Value'], edge.inputs[1])
        edgek = N.new('ShaderNodeMath'); edgek.operation = 'MULTIPLY'; edgek.inputs[1].default_value = 6.0; edgek.use_clamp = True; L.new(edge.outputs[0], edgek.inputs[0])
        aos = N.new('ShaderNodeAmbientOcclusion'); aos.inputs['Distance'].default_value = 0.0018; aos.samples = 16
        aol = N.new('ShaderNodeAmbientOcclusion'); aol.inputs['Distance'].default_value = 0.014; aol.samples = 16
        conv = N.new('ShaderNodeMapRange'); conv.inputs['From Min'].default_value = 0.55; conv.inputs['From Max'].default_value = 0.95
        L.new(aos.outputs['AO'], conv.inputs['Value'])
        em = N.new('ShaderNodeMath'); em.operation = 'MULTIPLY'; em.use_clamp = True
        L.new(edgek.outputs[0], em.inputs[0]); L.new(conv.outputs['Result'], em.inputs[1])
        cav = N.new('ShaderNodeMath'); cav.operation = 'SUBTRACT'; cav.inputs[0].default_value = 1.0; L.new(aos.outputs['AO'], cav.inputs[1])
        aoi = N.new('ShaderNodeAmbientOcclusion'); aoi.inside = True; aoi.inputs['Distance'].default_value = 0.0011; aoi.samples = 16
        cvx = N.new('ShaderNodeMapRange'); cvx.inputs['From Min'].default_value = 0.97; cvx.inputs['From Max'].default_value = 0.55
        L.new(aoi.outputs['AO'], cvx.inputs['Value'])
        emax = N.new('ShaderNodeMath'); emax.operation = 'MAXIMUM'; emax.use_clamp = True
        L.new(cvx.outputs['Result'], emax.inputs[0]); L.new(em.outputs[0], emax.inputs[1])
        comb = N.new('ShaderNodeCombineColor')
        L.new(aol.outputs['AO'], comb.inputs[0]); L.new(cav.outputs[0], comb.inputs[1]); L.new(emax.outputs[0], comb.inputs[2])
        emis = N.new('ShaderNodeEmission'); L.new(comb.outputs['Color'], emis.inputs['Color'])
        L.new(emis.outputs['Emission'], out.inputs['Surface'])
        tn = N.new('ShaderNodeTexImage'); tn.image = img; N.active = tn
    objs = [bpy.data.objects[n] for n in STEEL_OBJS]
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
    px = np.array(img.pixels[:], np.float32).reshape(TEX, TEX, 4)[..., :3]
    save_webp('revolver_wear', px, 88)
    for mat in (M_STEEL, M_CASE):
        nt = mat.node_tree; out = nt.nodes.get('Material Output')
        nt.links.new(saved[mat.name], out.inputs['Surface'])

def export():
    for o in bpy.data.objects: o.select_set(True)
    path = os.path.join(OUT, 'revolver.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_image_format='NONE',
                              export_animations=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
                              export_extras=False, export_cameras=False, export_lights=False)
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            n = sum(len(p.vertices) - 2 for p in o.data.polygons); tris += n
            print('TRI', o.name, n)
    print('TRI total', tris)
    print('SIZE glb', os.path.getsize(path))

chamber_phase()
if not NOMAPS: make_source_maps()
assemble()
if not NOBAKE: bake_wear()
export()
print('INFO done')
