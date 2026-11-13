# Builds the Decide-mode revolver from scratch and exports assets/models/revolver.glb + its WebP textures.
#   blender -b --factory-startup --python tools/blender/build_revolver.py -- <out dir> [--no-bake] [--blend <file>] [--tex 2048]
# Modelled in millimetres (Blender: +X right, +Y toward the muzzle, +Z up), scaled to metres before baking/export.
# Medium-frame 6-shot double-action service revolver, 4 in barrel, .38 Special class. No real markings.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def _opt(name, default=None):
    if name in ARGV:
        i = ARGV.index(name); v = ARGV[i + 1]; del ARGV[i:i + 2]; return v
    return default
BLEND = _opt('--blend'); TEX = int(_opt('--tex', '2048'))
NOBAKE = '--no-bake' in ARGV
if NOBAKE: ARGV.remove('--no-bake')
OUT = os.path.abspath(ARGV[0] if ARGV else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models'))
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- dimensions (mm)
BORE_Z = 46.0
CH_R, CYL_R, CYL_LEN = 11.6, 18.3, 39.6
CYL_Z = BORE_Z - CH_R              # 34.4
CYL_Y0 = -6.0                      # cylinder rear face
CYL_Y1 = CYL_Y0 + CYL_LEN          # 33.6 front face
BAR_Y0 = CYL_Y1 + 0.15             # barrel rear face (cylinder gap)
MUZ_Y = BAR_Y0 + 101.6             # 4 in barrel
FW = 21.0                          # frame width
TOP_Z = 58.6                       # top strap / sight line
HINGE = (-6.0, 11.0)               # crane hinge axis (x, z)
OPEN_ANGLE = 1.6                   # crane swing (rad) that puts the cylinder fully out to the left
CRANE_R = 26.6                     # crane arm outline radius about the hinge
CRANE_Y = (33.85, 39.75)
HAMMER_PIV = (-22.0, 31.0)         # (y, z)
TRIG_PIV = (-3.0, 13.0)
REAR_Y = -10.0                     # rear end of the sight groove (rear notch)
FRONT_Y = 129.0                    # top of the half-moon front blade
CHAMBER_R, RIM_R = 4.83, 5.75

SCALE = 0.001

# ---------------------------------------------------------------- scene utils
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
COL = SC.collection

def link(ob):
    COL.objects.link(ob); return ob

def new_obj(name, me):
    return link(bpy.data.objects.new(name, me))

def bm_to_obj(name, bm):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return new_obj(name, me)

def fix_normals(me, flip=False):
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if flip: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()

def fillet(pts, r=1.0, step=12.0):
    """pts: [(a, b[, radius])] closed loop -> list of (a, b) with arcs at corners."""
    out = []; N = len(pts)
    for i in range(N):
        p = pts[i]; rad = p[2] if len(p) > 2 else r
        P = Vector(p[:2]); A = Vector(pts[i - 1][:2]); B = Vector(pts[(i + 1) % N][:2])
        if rad <= 0: out.append((P.x, P.y)); continue
        u = A - P; lu = u.length; v = B - P; lv = v.length
        if lu < 1e-6 or lv < 1e-6: out.append((P.x, P.y)); continue
        u.normalize(); v.normalize()
        th = math.acos(max(-1.0, min(1.0, u.dot(v))))
        if th < 1e-3 or th > math.pi - 1e-3: out.append((P.x, P.y)); continue
        t = rad / math.tan(th / 2); tmax = 0.49 * min(lu, lv)
        if t > tmax: t = tmax; rad = t * math.tan(th / 2)
        T1 = P + u * t; T2 = P + v * t
        C = P + (u + v).normalized() * (rad / math.sin(th / 2))
        a1 = math.atan2(T1.y - C.y, T1.x - C.x); a2 = math.atan2(T2.y - C.y, T2.x - C.x)
        d = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        n = max(2, int(math.ceil(abs(d) / math.radians(step))) + (1 if rad > 3 else 0))
        for k in range(n + 1):
            a = a1 + d * k / n; out.append((C.x + math.cos(a) * rad, C.y + math.sin(a) * rad))
    return out

def circle(cx, cy, r, n=48, a0=0.0):
    return [(cx + math.cos(a0 + 2 * math.pi * k / n) * r, cy + math.sin(a0 + 2 * math.pi * k / n) * r) for k in range(n)]

# plane: 'side' = outline in (y, z), extruded along x;  'front' = outline in (x, z), extruded along y;  'top' = (x, y) along z
PLANES = {
    'side': (Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))), False),
    'front': (Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))), True),
    'top': (Matrix.Identity(4), False),
}

def extrude(name, loops, width, bevel=0.0, res=3, plane='side', center=0.0):
    """Extrude closed 2D loops (first = outline, rest = holes) to `width`, edges rounded by `bevel`."""
    cu = bpy.data.curves.new(name + '_cu', 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    bevel = min(bevel, width / 2 - 1e-3)
    cu.extrude = max(width / 2 - bevel, 1e-4); cu.bevel_depth = bevel; cu.bevel_resolution = res; cu.offset = -bevel
    for loop in loops:
        sp = cu.splines.new('POLY'); sp.points.add(len(loop) - 1)
        for i, p in enumerate(loop): sp.points[i].co = (p[0], p[1], 0, 1)
        sp.use_cyclic_u = True
    tmp = link(bpy.data.objects.new(name + '_tmp', cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    M, flip = PLANES[plane]
    T = Matrix.Translation({'side': (center, 0, 0), 'front': (0, center, 0), 'top': (0, 0, center)}[plane])
    me.transform(T @ M)
    fix_normals(me)
    me.name = name
    return new_obj(name, me)

def lathe(name, prof, seg=64, closed=False, axis_c=(0.0, 0.0), axis='Y', a0=0.0):
    """Revolve [(r, t)] about an axis parallel to Y (centre axis_c = (x, z)) or Z (axis_c = (x, y))."""
    bm = bmesh.new(); rings = []
    for (r, t) in prof:
        ring = []
        if r < 1e-6:
            ring = [bm.verts.new(_lp(0, 0, t, axis_c, axis))]
        else:
            for i in range(seg):
                a = a0 + 2 * math.pi * i / seg
                ring.append(bm.verts.new(_lp(r, a, t, axis_c, axis)))
        rings.append(ring)
    n = len(rings) if closed else len(rings) - 1
    for k in range(n):
        A = rings[k]; B = rings[(k + 1) % len(rings)]
        if len(A) == 1 and len(B) == 1: continue
        for i in range(seg):
            j = (i + 1) % seg
            if len(A) == 1: bm.faces.new((A[0], B[i], B[j]))
            elif len(B) == 1: bm.faces.new((A[i], A[j], B[0]))
            else: bm.faces.new((A[i], A[j], B[j], B[i]))
    if not closed:
        for ring in (rings[0], rings[-1]):
            if len(ring) > 2: bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_to_obj(name, bm)

def _lp(r, a, t, c, axis):
    if axis == 'Y': return Vector((c[0] + math.sin(a) * r, t, c[1] + math.cos(a) * r))
    if axis == 'X': return Vector((t, c[0] + math.sin(a) * r, c[1] + math.cos(a) * r))
    return Vector((c[0] + math.sin(a) * r, c[1] + math.cos(a) * r, t))

def box(name, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    return bm_to_obj(name, bm)

def join(objs, name=None):
    objs = [o for o in objs if o]
    base = objs[0]
    if name: print('INFO join', name, [(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons)) for o in objs])
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs, object=base):
            bpy.ops.object.join()
    if name: base.name = name; base.data.name = name
    return base

def cutter(*objs):
    o = join(list(objs)); o.hide_render = True; o.display_type = 'WIRE'; o.name = 'CUT_' + o.name
    return o

def boolean(ob, cut, op='DIFFERENCE'):
    m = ob.modifiers.new('bool', 'BOOLEAN'); m.operation = op; m.solver = 'EXACT'; m.object = cut; m.use_self = True
    apply_mods(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=0.02, edges=bm.edges[:])
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-4], context='FACES')
    bm.to_mesh(ob.data); bm.free()

def tidy(ob, angle=0.4):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(angle), use_dissolve_boundaries=False, verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(ob.data); bm.free()

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; me.name = ob.name
    if old.users == 0: bpy.data.meshes.remove(old)

def bevel(ob, width, seg=2, angle=40.0):
    n0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = seg
    m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle); m.miter_outer = 'MITER_ARC'
    m.use_clamp_overlap = True
    apply_mods(ob)
    print('INFO bevel', ob.name, n0, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons))

def set_mat(ob, mat):
    ob.data.materials.clear(); ob.data.materials.append(mat)

def shade(ob, angle=33.0):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    a = math.radians(angle)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle(0.0) > a) and len(e.link_faces) == 2
    bm.to_mesh(ob.data); bm.free()
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True; m.weight = 50; m.mode = 'FACE_AREA'
    apply_mods(ob)

def poly_clip(poly, inside, intersect):
    """Sutherland-Hodgman for one half-plane."""
    out = []
    for i in range(len(poly)):
        P = poly[i]; Q = poly[(i + 1) % len(poly)]
        ip, iq = inside(P), inside(Q)
        if ip: out.append(P)
        if ip != iq: out.append(intersect(P, Q))
    return out

def clip_box(poly, x0, x1, y0, y1):
    def lerp(P, Q, t): return (P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t)
    for axis, val, keep_lo in ((0, x0, False), (0, x1, True), (1, y0, False), (1, y1, True)):
        ins = (lambda P, a=axis, v=val, k=keep_lo: P[a] <= v if k else P[a] >= v)
        def isect(P, Q, a=axis, v=val): return lerp(P, Q, (v - P[a]) / (Q[a] - P[a]))
        poly = poly_clip(poly, ins, isect)
    return poly

# ---------------------------------------------------------------- materials (placeholders; the app builds its own by name)
def pmat(name, col, metal=1.0, rough=0.35):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m
M_STEEL = pmat('steel', (0.05, 0.055, 0.065), 1, 0.3)
M_CASE = pmat('steel_case', (0.06, 0.06, 0.07), 1, 0.3)
M_GRIP = pmat('grip', (0.25, 0.12, 0.05), 0, 0.4)
M_BRASS = pmat('brass', (0.8, 0.6, 0.3), 1, 0.3)
M_HEAD = pmat('brass_head', (0.8, 0.6, 0.3), 1, 0.3)
M_LEAD = pmat('lead', (0.35, 0.35, 0.36), 0.6, 0.6)
M_PRIMER = pmat('primer', (0.75, 0.72, 0.68), 1, 0.35)

# ================================================================= FRAME
MF_FRONT = [(47.0, TOP_Z, 1.2), (47.0, 38.2, 0.8), (41.2, 38.2, 2.0), (40.2, 32.0, 6), (38.6, 17.0, 8), (34.0, 9.5, 3.0)]
MF_OUT = MF_FRONT + [(-13.0, 9.5, 3.0)]
MF_REST = [(-19.0, 4.0, 3.0), (-40.0, 15.0, 4.0), (-47.0, 23.0, 5.0), (-49.0, 31.0, 8.0), (-44.5, 40.0, 8.0), (-36.0, 45.5, 6.0), (-28.0, 47.5, 8.0), (-18.0, 52.0, 8.0), (-12.5, 56.5, 3.0)]

def build_frame():
    parts = []
    # main frame slab with the cylinder window; its rear follows the backstrap arc so frame and grip read as one curve
    MF = MF_OUT + MF_REST + [(REAR_Y, TOP_Z, 0.6)]
    WIN = [(-6.25, 14.8, 1.0), (35.0, 14.8, 1.0), (35.0, 54.0, 1.0), (-6.25, 54.0, 1.0)]
    main = extrude('mainframe', [fillet(MF), fillet(WIN)], FW, bevel=2.2, res=4)
    # grip frame (backstrap, front strap with a slight swell, rounded flared butt), narrower
    GF = [(-13.0, 9.0, 2), (-19.5, 0.5, 6), (-27.8, -31.0, 30), (-44.5, -80.5, 10), (-83.0, -82.0, 14), (-73.0, -45.0, 22),
          (-61.0, -6.0, 15), (-53.0, 22.0, 18), (-49.0, 35.0, 10), (-43.0, 42.5, 7), (-36.0, 45.0, 5), (-28.0, 36.0, 2), (-17.0, 14.0, 2)]
    gripf = extrude('gripframe', [fillet(shorten(GF))], 13.0, bevel=3.4, res=5)
    # trigger guard
    GO = [(27.0, 13.5, 1), (28.4, -3.0, 18), (15.0, -21.8, 20), (-6.0, -20.6, 18), (-17.6, -5.0, 8), (-18.0, 13.5, 1)]
    GI = [(22.9, 9.62, 0.5), (24.0, -2.3, 13), (12.8, -17.3, 15), (-5.0, -16.3, 13), (-13.1, -4.0, 5), (-13.1, 9.62, 0.5)]
    guard = extrude('guard', [fillet(GO), fillet(GI)], 6.6, bevel=2.1, res=4)
    # recoil shield boss around the cylinder axis
    shield = lathe('shield', [(0, -6.25), (15.2, -6.25), (15.8, -6.9), (16.0, -8.0), (15.6, -9.6), (14.4, -11.6), (12.6, -13.8), (10.6, -15.5), (0, -15.5)], seg=96, axis_c=(0, CYL_Z))
    parts += [main, gripf, guard, shield]
    frame = join(parts, 'Frame_body')
    # cuts: sight groove, hammer slot, trigger slot, crane pocket, firing-pin + centre-pin holes, side-plate seam
    cuts = []
    cuts.append(box('groove', -1.5, 1.5, REAR_Y - 0.01, 48.0, TOP_Z - 1.6, TOP_Z + 3))
    cuts.append(box('hslot', -4.45, 4.45, -47.0, REAR_Y, 24.0, 70.0))
    cuts.append(box('tslot', -4.1, 4.1, -8.0, 4.5, 8.2, 17.0))
    cuts.append(extrude('pocket', [swept_hull(0.25, OPEN_ANGLE + 0.1)], CRANE_Y[1] - CRANE_Y[0] + 0.5, plane='front', center=(CRANE_Y[0] + CRANE_Y[1]) / 2))
    cuts.append(lathe('fpin', [(0, -12.0), (1.15, -12.0), (1.15, -5.0), (0, -5.0)], seg=24, axis_c=(0, BORE_Z)))
    cuts.append(lathe('cpin', [(0, -8.5), (1.9, -8.5), (1.9, -5.0), (0, -5.0)], seg=24, axis_c=(0, CYL_Z)))
    # side plate seam on the right side
    SP = fillet([(-15.5, 46.0, 3), (-34.0, 46.5, 4), (-39.0, 40.0, 3), (-39.5, 18.0, 3), (-34.0, 14.0, 3), (-15.0, 10.6, 3), (-13.6, 26.0, 3)], step=15)
    cu = bpy.data.curves.new('seam', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.2; cu.bevel_resolution = 1
    sp = cu.splines.new('POLY'); sp.points.add(len(SP) - 1)
    for i, (y, z) in enumerate(SP): sp.points[i].co = (FW / 2, y, z, 1)
    sp.use_cyclic_u = True
    so = link(bpy.data.objects.new('seam', cu)); dg = bpy.context.evaluated_depsgraph_get()
    sme = bpy.data.meshes.new_from_object(so.evaluated_get(dg)); bpy.data.objects.remove(so)
    cuts.append(new_obj('seam', sme))
    boolean(frame, cutter(*cuts))
    bevel(frame, 0.35, 1, 45)
    set_mat(frame, M_STEEL)

    # latch (thumbpiece) on the left, with serrations
    LP = [(-28.5, 30.8, 2.0), (-16.5, 31.5, 3.0), (-16.5, 37.0, 2.5), (-28.5, 37.6, 2.0)]
    latch = extrude('latch', [fillet(LP)], 3.4, bevel=1.0, res=3, center=-FW / 2 - 0.9)
    gr = [box('lg%d' % i, -FW / 2 - 3.0, -FW / 2 - 2.25, y - 0.22, y + 0.22, 29.0, 39.0) for i, y in enumerate(np.arange(-27.0, -19.5, 0.95))]
    boolean(latch, cutter(*gr))
    set_mat(latch, M_STEEL)

    # barrel: forcing cone stub, shank, taper, crowned muzzle, bore
    B = [(7.0, BAR_Y0), (7.0, 35.6), (8.8, 35.6), (8.8, 47.2), (7.48, MUZ_Y - 1.0), (7.42, MUZ_Y - 0.45), (7.05, MUZ_Y), (6.1, MUZ_Y), (5.0, MUZ_Y - 0.55),
         (4.5, MUZ_Y - 0.8), (4.5, 36.2), (5.5, BAR_Y0)]
    barrel = lathe('barrel', B, seg=72, closed=True, axis_c=(0, BORE_Z))
    # rifling: six shallow grooves near the muzzle (visible down the bore)
    rif = []
    for k in range(6):
        a = k * math.pi / 3
        g = box('rf%d' % k, -0.75, 0.75, 37.0, MUZ_Y - 0.6, BORE_Z + 4.3, BORE_Z + 4.75)
        g.rotation_euler = (0, a, 0)
        g.location = (0, 0, 0)
        # rotate about the bore axis
        mtx = Matrix.Translation((0, 0, BORE_Z)) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Translation((0, 0, -BORE_Z))
        g.data.transform(mtx); g.rotation_euler = (0, 0, 0)
        rif.append(g)
    boolean(barrel, cutter(*rif))
    bevel(barrel, 0.25, 2, 40)
    set_mat(barrel, M_STEEL)

    # front sight: ramp base + pinned half-moon blade
    base = extrude('fsbase', [fillet([(117.5, 52.4, 0), (120.5, 54.4, 3), (MUZ_Y - 1.2, 54.6, 1.0), (MUZ_Y - 1.2, 52.0, 0), (117.5, 51.8, 0)])], 4.6, bevel=0.9, res=3)
    blade = extrude('fsblade', [fillet([(121.6, 53.2, 0), (123.0, 55.8, 4), (FRONT_Y, TOP_Z, 3.5), (132.6, 57.2, 2.5), (MUZ_Y - 1.6, 53.8, 0.8), (MUZ_Y - 1.6, 53.0, 0)])], 2.6, bevel=0.35, res=2)
    pin = lathe('fspin', [(0, -1.45), (0.65, -1.45), (0.7, -1.35), (0.7, 1.35), (0.65, 1.45), (0, 1.45)], seg=16, axis='X', axis_c=(126.6, 55.6))
    for o in (base, blade, pin): set_mat(o, M_STEEL)

    # ejector-rod lug under the barrel (with the socket for the rod tip)
    LUG = [(75.8, 40.0, 0), (76.0, 33.2, 2.0), (78.0, 30.6, 2.0), (85.5, 31.8, 3.0), (90.0, 38.5, 4), (92.0, 40.5, 0)]
    lug = extrude('lug', [fillet(LUG)], 7.4, bevel=1.6, res=3)
    sock = lathe('sock', [(0, 74.0), (1.6, 74.0), (1.6, 79.5), (0, 80.5)], seg=24, axis_c=(0, CYL_Z))
    boolean(lug, cutter(sock))
    set_mat(lug, M_STEEL)

    # side-plate screws (right) + grip screw/escutcheons
    screws = []
    for i, (y, z) in enumerate([(-19.0, 42.5), (-36.0, 41.0), (-35.5, 18.5), (-18.0, 14.2)]):
        screws.append(screw('scr%d' % i, (FW / 2 - 0.15, y, z), +1, 2.3, 0.55, slot_angle=0.5 + i * 0.7))
    for o in screws: set_mat(o, M_STEEL)
    frame = join([frame, latch, barrel, base, blade, pin, lug] + screws, 'Frame')
    shade(frame)
    return frame

def screw(name, pos, side, r, h, slot_angle=0.0, slot=True):
    """Domed slotted screw head on a face whose normal is side*X."""
    prof = [(0, 0.0), (r, 0.0), (r, h * 0.35), (r * 0.8, h * 0.85), (r * 0.45, h), (0, h * 1.02)]
    o = lathe(name, prof, seg=32, axis='X', axis_c=(0, 0))
    if slot:
        s = box(name + '_s', -0.2, h * 2, -0.28, 0.28, -r * 1.5, r * 1.5)
        s.data.transform(Matrix.Translation((h * 0.55, 0, 0)))
        boolean(o, cutter(s))
    mtx = Matrix.Translation(pos) @ Matrix.Rotation(slot_angle, 4, 'X')
    if side < 0: mtx = mtx @ Matrix.Scale(-1, 4, (1, 0, 0))
    o.data.transform(mtx)
    if side < 0: fix_normals(o.data, flip=False)
    return o

# ================================================================= GRIP PANELS
GRIP_K, GRIP_RAKE = 0.86, 22.0 / 70.5     # grip length factor below the frame, rake (dy/dz along the front strap)

def shorten(pts):
    out = []
    for p in pts:
        y, z = p[0], p[1]
        if z < 10.0:
            z2 = 10.0 + (z - 10.0) * GRIP_K; y = y + (z2 - z) * GRIP_RAKE; z = z2
        out.append((y, z) + tuple(p[2:]))
    return out

PANEL = [(-21.5, 4.6, 2.5), (-21.6, -1.2, 5), (-29.6, -31.0, 28), (-46.6, -77.8, 8), (-80.0, -79.2, 12), (-70.6, -45.0, 20),
         (-58.8, -6.0, 15), (-52.0, 16.5, 6), (-46.5, 20.5, 2.5), (-39.6, 14.7, 2), (-30.0, 9.6, 6)]
GRIP_IN, GRIP_LIP = 6.5, 2.4
PANEL = shorten(PANEL)
GRIP_SCREW = shorten([(-50.0, -30.0)])[0]

def panel_height(d):
    """Grip panel thickness (mm above the frame tang) at distance d inside the outline: rounded lip, then a low dome."""
    re_ = 2.6
    e = np.where(d < re_, np.sqrt(np.clip(1 - (1 - np.clip(d, 0, re_) / re_) ** 2, 0, 1)), 1.0)
    t = np.clip(d / 16.0, 0, 1); dome = t * t * (3 - 2 * t)
    return 2.0 + 3.4 * e + 2.8 * dome

P_BEV, P_HALF, P_DOME = 3.2, 4.2, 2.4
SWELL = shorten([(-57.0, -36.0)])[0]

def panel_dome(d, y=None, z=None):
    t = np.clip(d / 16.0, 0, 1); h = P_DOME * t * t * (3 - 2 * t)
    if y is not None:   # palm swell low on the backstrap side
        h = h + 1.1 * np.clip(d / 8.0, 0, 1) * np.exp(-(((y - SWELL[0]) / 13.0) ** 2 + ((z - SWELL[1]) / 18.0) ** 2))
    return h

def panel_surface_x(y, z):
    d = max(0.0, float(-poly_sdf(np.array([y]), np.array([z]), fillet(PANEL, step=15))[0]) - P_BEV)
    return GRIP_IN + P_HALF + float(panel_dome(np.array(d), np.array(y), np.array(z)))

def build_panel(name, side, grid=2.0):
    outline = fillet(PANEL, step=15)
    BEV, HALF = P_BEV, P_HALF
    o = extrude(name, [outline], 2 * HALF, bevel=BEV, res=4, center=GRIP_IN)
    bm = bmesh.new(); bm.from_mesh(o.data)
    xmax = max(v.co.x for v in bm.verts)
    flat = [e for e in bm.edges if len(e.link_faces) == 2 and all(f.normal.x > 0.999 for f in e.link_faces)]
    bmesh.ops.dissolve_edges(bm, edges=flat, use_verts=True)
    # drop the hidden inner half (inside the grip frame)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.x < GRIP_IN - 2.5 for v in f.verts)], context='FACES')
    cap = max((f for f in bm.faces if f.normal.x > 0.999), key=lambda f: f.calc_area())
    capv = set(cap.verts)
    geom = [cap] + list(cap.edges) + list(cap.verts)
    ys = [v.co.y for v in capv]; zs = [v.co.z for v in capv]
    for y in np.arange(min(ys) + grid / 2, max(ys), grid):
        r = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=(0, y, 0), plane_no=(0, 1, 0))
        geom = list(set(geom) | set(r['geom']))
    for z in np.arange(min(zs) + grid / 2, max(zs), grid):
        r = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=(0, 0, z), plane_no=(0, 0, 1))
        geom = list(set(geom) | set(r['geom']))
    capf = [f for f in geom if isinstance(f, bmesh.types.BMFace) and f.is_valid and f.normal.x > 0.999]
    bmesh.ops.triangulate(bm, faces=capf, quad_method='BEAUTY', ngon_method='BEAUTY')
    vs = [v for v in bm.verts if abs(v.co.x - xmax) < 1e-3]
    vy = np.array([v.co.y for v in vs]); vz = np.array([v.co.z for v in vs])
    d = np.clip(-poly_sdf(vy, vz, outline) - BEV, 0, None)
    dome = panel_dome(d, vy, vz)
    for v, h in zip(vs, dome): v.co.x += float(h)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # planar UV over a 100 mm square (even checkering diamonds)
    uvl = bm.loops.layers.uv.new('UVMap') if not bm.loops.layers.uv else bm.loops.layers.uv[0]
    for fc in bm.faces:
        for lp in fc.loops:
            lp[uvl].uv = ((lp.vert.co.y + 95.0) / 100.0, (lp.vert.co.z + 85.0) / 100.0)
    bm.to_mesh(o.data); bm.free()
    if side < 0:
        o.data.transform(Matrix.Scale(-1, 4, (1, 0, 0))); o.data.flip_normals()
    set_mat(o, M_GRIP)
    return o

def grip_peak(bmobj):
    xs = [abs(v.co.x) for v in bmobj.data.vertices]; return max(xs)

# ================================================================= HAMMER / TRIGGER
def build_hammer():
    HP = [(-10.6, 37.5, 1.0), (-10.6, 49.0, 1.5), (-12.0, 52.6, 3), (-16.5, 54.4, 8), (-24.0, 55.8, 10), (-31.0, 56.6, 8), (-37.0, 56.3, 6), (-41.0, 55.0, 3),
          (-43.0, 53.4, 2.5), (-41.2, 52.0, 4), (-36.0, 51.0, 5), (-31.5, 49.8, 5), (-29.4, 47.2, 5), (-28.4, 42.0, 5), (-28.3, 31.0, 4), (-26.0, 26.4, 3), (-20.5, 25.6, 3), (-16.2, 28.8, 3), (-12.6, 33.5, 2)]
    SP = [(-16.5, 54.1, 6), (-24.0, 56.0, 10), (-31.0, 57.0, 8), (-37.0, 56.8, 6), (-41.4, 55.4, 3), (-43.6, 53.4, 2.5), (-41.4, 51.6, 4), (-36.0, 50.6, 5), (-30.0, 50.0, 4), (-24.0, 51.4, 4)]
    spur = extrude('spur', [fillet(SP)], 9.2, bevel=1.6, res=3)
    h = extrude('hammer', [fillet(HP)], 7.4, bevel=0.75, res=3)
    h = join([h, spur])
    # spur checkering: two families of diagonal grooves across the top of the spur
    cuts = []
    k = 0
    for sgn in (1, -1):
        for i in range(-9, 10):
            g = box('hg%d' % k, -0.21, 0.21, -9.0, 9.0, -2.0, 1.0); k += 1
            mtx = Matrix.Translation((0, -33.0 + i * 1.15 * 1.4142, 0)) @ Matrix.Rotation(sgn * math.pi / 4, 4, 'Z')
            g.data.transform(mtx)
            # follow the spur's top line (z on the spur top at this y) minus the groove depth
            for v in g.data.vertices:
                y = v.co.y; ztop = np.interp(-y, [16.5, 24.0, 31.0, 37.0, 41.4, 43.6], [54.1, 56.0, 57.0, 56.8, 55.4, 53.4])
                v.co.z = (ztop + 0.45 + 3.0) if v.co.z > 0 else (ztop - 0.42)
            cuts.append(g)
    # keep the grooves on the spur only (y in [-48, -33])
    grooves = cutter(*cuts)
    keep = box('hkeep', -6, 6, -41.0, -23.0, 40, 70)
    m = grooves.modifiers.new('b', 'BOOLEAN'); m.operation = 'INTERSECT'; m.solver = 'EXACT'; m.object = keep
    apply_mods(grooves); bpy.data.objects.remove(keep)
    boolean(h, grooves)
    # firing pin on the face
    fp = lathe('fpin', [(0, -10.5), (1.0, -10.5), (0.95, -8.6), (0.55, -7.7), (0, -7.6)], seg=20, axis_c=(0, BORE_Z))
    piv = lathe('hpiv', [(0, -4.2), (2.2, -4.2), (2.2, 4.2), (0, 4.2)], seg=24, axis='X', axis_c=HAMMER_PIV)
    h = join([h, fp, piv], 'Hammer')
    bevel(h, 0.12, 1, 50)
    set_mat(h, M_CASE); shade(h)
    return h

def build_trigger():
    TP = [(3.2, 12.0, 1.5), (1.4, 4.5, 8), (0.0, 0.0, 9), (-0.5, -6.0, 9), (0.4, -11.0, 5), (1.5, -13.8, 1.6), (0.2, -15.9, 1.5), (-2.3, -15.3, 3),
          (-4.0, -10.5, 8), (-5.0, -3.0, 10), (-5.6, 5.0, 10), (-6.6, 12.5, 3), (-7.4, 17.0, 2), (-1.0, 17.6, 2)]
    t = extrude('trigger', [fillet(TP)], 7.8, bevel=1.5, res=3)
    piv = lathe('tpiv', [(0, -4.2), (1.8, -4.2), (1.8, 4.2), (0, 4.2)], seg=20, axis='X', axis_c=TRIG_PIV)
    t = join([t, piv], 'Trigger')
    set_mat(t, M_CASE); shade(t)
    return t

# ================================================================= CRANE + CYLINDER
def crane_hull(grow=0.0):
    """Front-view outline (x, z) of the yoke arm: two discs (hinge, cylinder axis) and the band between them."""
    pts = circle(HINGE[0], HINGE[1], 5.0 + grow, 48) + circle(0.0, CYL_Z, 5.6 + grow, 48)
    pts = sorted(set(pts))
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def swept_hull(grow, theta):
    """2D region (x, z) swept by the yoke outline turning 0..theta about the hinge: the frame's yoke cut."""
    hull = np.array(crane_hull(grow)); H = np.array(HINGE)
    def inside(P):
        ok = np.ones(len(P), bool)
        for i in range(len(hull)):
            a = hull[i]; b = hull[(i + 1) % len(hull)]
            ok &= (b[0] - a[0]) * (P[:, 1] - a[1]) - (b[1] - a[1]) * (P[:, 0] - a[0]) >= -1e-9
        return ok
    A = np.array((0.0, CYL_Z)); psi = math.atan2(A[1] - H[1], A[0] - H[0])
    rel = np.linspace(-math.pi, math.pi, 4321)
    r0 = 5.0 + grow + 0.02; rmax = float(np.max(np.hypot(hull[:, 0] - H[0], hull[:, 1] - H[1]))) - 1e-3
    lo, hi = [], []
    for r in np.linspace(r0, rmax, 90):
        P = np.stack([H[0] + r * np.cos(psi + rel), H[1] + r * np.sin(psi + rel)], 1)
        m = inside(P)
        if not m.any(): continue
        lo.append((r, rel[m].min())); hi.append((r, rel[m].max()))
    pol = lambda r, a: (H[0] + r * math.cos(psi + a), H[1] + r * math.sin(psi + a))
    out = [pol(r, a + theta) for (r, a) in hi] + [pol(r, a) for (r, a) in reversed(lo)]
    a0, a1 = lo[0][1], hi[0][1] + theta - 2 * math.pi
    n = 24
    out += [pol(r0, a0 + (a1 - a0) * k / n) for k in range(1, n)]
    return out

def rot2(pts, c, th):
    cs, sn = math.cos(th), math.sin(th)
    return [(c[0] + (x - c[0]) * cs - (z - c[1]) * sn, c[1] + (x - c[0]) * sn + (z - c[1]) * cs) for (x, z) in pts]

def build_crane():
    out = clip_box(crane_hull(), -FW / 2 + 0.15, FW / 2 - 0.15, 9.7, 37.0)
    arm = extrude('crane_arm', [out], CRANE_Y[1] - CRANE_Y[0], bevel=0.7, res=2, plane='front', center=(CRANE_Y[0] + CRANE_Y[1]) / 2)
    # trim the yoke's front face to the frame's curved front-lower contour
    front = fillet(MF_FRONT[1:] + [(34.0, 0.0, 0), (60.0, 0.0, 0), (60.0, 38.2, 0)])
    boolean(arm, cutter(extrude('crane_trim', [front], 40.0)))
    tube = lathe('crane_tube', [(0, -4.0), (3.3, -4.0), (3.3, CRANE_Y[0] + 0.2), (0, CRANE_Y[0] + 0.2)], seg=32, axis_c=(0, CYL_Z))
    hole = lathe('crane_hole', [(0, CRANE_Y[0] - 1), (2.45, CRANE_Y[0] - 1), (2.45, CRANE_Y[1] + 1), (0, CRANE_Y[1] + 1)], seg=32, axis_c=(0, CYL_Z))
    boolean(arm, cutter(hole))
    c = join([arm, tube], 'Crane')
    set_mat(c, M_STEEL); shade(c)
    return c

def star_rho(phi, outer, rim_r):
    """Radius of the extractor-star outline at angle phi (disc minus the six rim circles)."""
    best = outer
    for k in range(6):
        a = k * math.pi / 3
        d = (phi - a + math.pi) % (2 * math.pi) - math.pi
        s = CH_R * math.sin(d)
        if abs(s) < rim_r:
            t = CH_R * math.cos(d) - math.sqrt(rim_r ** 2 - s ** 2)
            if t > 0: best = min(best, t)
    return best

def star_loop(outer, rim_r, n=360, cx=0.0, cz=0.0):
    pts = []
    for i in range(n):
        phi = 2 * math.pi * i / n
        r = star_rho(phi, outer, rim_r)
        pts.append((cx + math.sin(phi) * r, cz + math.cos(phi) * r))
    return pts

def build_cylinder():
    Y0, Y1 = CYL_Y0, CYL_Y1
    body = lathe('cyl', [(3.45, Y0), (17.7, Y0), (18.3, Y0 + 0.6), (18.3, Y1 - 1.5), (16.7, Y1), (3.45, Y1)], seg=108, closed=True, axis_c=(0, CYL_Z))
    cuts = []
    for k in range(6):
        a = k * math.pi / 3
        cx, cz = math.sin(a) * CH_R, CYL_Z + math.cos(a) * CH_R
        cuts.append(lathe('ch%d' % k, [(0, Y0 - 1), (CHAMBER_R, Y0 - 1), (CHAMBER_R, Y1 - 0.9), (CHAMBER_R + 0.45, Y1 + 0.02), (CHAMBER_R + 0.45, Y1 + 1), (0, Y1 + 1)], seg=32, axis_c=(cx, cz), a0=a))
        cuts.append(lathe('cb%d' % k, [(0, Y0 - 1), (RIM_R, Y0 - 1), (RIM_R, Y0 + 1.4), (0, Y0 + 1.4)], seg=36, axis_c=(cx, cz), a0=a))
        # flute between chambers k and k+1: a long capsule, open at the front
        fa = a + math.pi / 6; fr = CYL_R + 1.05
        fx, fz = math.sin(fa) * fr, CYL_Z + math.cos(fa) * fr
        prof = [(0, Y0 + 13.5)] + [(3.75 * math.sin(math.radians(t)), Y0 + 13.5 + 3.75 * (1 - math.cos(math.radians(t)))) for t in range(15, 91, 15)] + [(3.75, Y1 + 2), (0, Y1 + 2)]
        cuts.append(lathe('fl%d' % k, prof, seg=24, axis_c=(fx, fz)))
        # cylinder-stop notch over the chamber, with its lead-in groove (cylinder turns anticlockwise seen from behind)
        n = box('sn%d' % k, -1.8, 1.8, Y0 + 6.0, Y0 + 10.6, CYL_R - 1.15, CYL_R + 3)
        li = box('li%d' % k, -1.0, 6.5, Y0 + 6.8, Y0 + 9.8, CYL_R - 0.35, CYL_R + 3)
        for o in (n, li):
            o.data.transform(Matrix.Translation((0, 0, CYL_Z)) @ Matrix.Rotation(a, 4, 'Y'))
            cuts.append(o)
    pocket = extrude('xpocket', [star_loop(9.25, RIM_R - 0.25, n=144, cz=CYL_Z)], 3.6, plane='front', center=Y0)
    cuts.append(pocket)
    boolean(body, cutter(*cuts))
    bevel(body, 0.22, 1, 40)
    # extractor star, ratchet and centre pin
    star = extrude('xstar', [star_loop(9.0, RIM_R, n=144, cz=CYL_Z), circle(0, CYL_Z, 1.75, 24)], 1.75, bevel=0.22, res=2, plane='front', center=Y0 + 0.75)
    rb = []
    # ratchet teeth: six shallow saw cuts around the centre
    for k in range(6):
        a = k * math.pi / 3 + 0.35
        t = box('rt%d' % k, -0.35, 0.35, Y0 - 1, Y0 - 0.15 + 0.55, -6.6, -2.7)
        t.data.transform(Matrix.Translation((0, 0, CYL_Z)) @ Matrix.Rotation(-a, 4, 'Y'))
        rb.append(t)
    boolean(star, cutter(*rb))
    pinh = lathe('cpin', [(0, Y0 - 0.05), (1.25, Y0 - 0.05), (1.45, Y0 + 0.2), (1.45, Y0 + 3.0), (0, Y0 + 3.0)], seg=20, axis_c=(0, CYL_Z))
    # ejector rod with a knurled head, tip pin into the barrel lug
    rod = lathe('rod', [(0, Y1 - 1.0), (2.3, Y1 - 1.0), (2.3, 67.0), (3.15, 67.4), (3.6, 68.0), (3.6, 73.4), (3.2, 74.3), (1.45, 74.6), (1.45, 75.8), (1.15, 76.1), (0, 76.1)], seg=48, axis_c=(0, CYL_Z))
    kn = []
    for k in range(24):
        a = k * 2 * math.pi / 24
        g = box('kn%d' % k, -0.22, 0.22, 68.3, 73.1, 3.25, 4.5)
        g.data.transform(Matrix.Translation((0, 0, CYL_Z)) @ Matrix.Rotation(a, 4, 'Y'))
        kn.append(g)
    boolean(rod, cutter(*kn))
    c = join([body, star, pinh, rod], 'Cylinder')
    set_mat(c, M_STEEL); shade(c)
    return c

# ================================================================= CARTRIDGES
def build_cartridge_mesh():
    """One .38 Special round, origin at the head centre on the rear face, pointing +Y (local)."""
    side = lathe('case', [(2.35, 0.0), (2.35, 0.25), (4.3, 0.25), (5.25, 0.0), (5.55, 0.12), (5.6, 0.4), (5.6, 1.2), (5.45, 1.4), (4.82, 1.45),
                          (4.79, 28.4), (4.70, 29.1), (4.62, 29.3), (4.4, 29.3), (4.4, 2.0), (2.35, 2.0)], seg=36, closed=True)
    # headstamp face: separate flat annulus with planar UVs
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    R0, R1, N = 2.35, 5.25, 36
    ring0 = [bm.verts.new((math.sin(2 * math.pi * i / N) * R0, -0.001, math.cos(2 * math.pi * i / N) * R0)) for i in range(N)]
    ring1 = [bm.verts.new((math.sin(2 * math.pi * i / N) * R1, -0.001, math.cos(2 * math.pi * i / N) * R1)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N
        f = bm.faces.new((ring0[i], ring1[i], ring1[j], ring0[j]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y > 0: f.normal_flip()
        for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.x / (2 * 5.6), 0.5 + lp.vert.co.z / (2 * 5.6))
    head = bm_to_obj('head', bm)
    bullet = lathe('bullet', [(0, 28.0), (4.52, 28.0), (4.52, 31.6), (4.38, 33.0), (3.95, 34.6), (3.2, 36.1), (2.2, 37.3), (1.0, 38.2), (0, 38.45)], seg=32)
    # lathe UVs for brass side (brushed along the case)
    for o, mat in ((side, M_BRASS), (head, M_HEAD), (bullet, M_LEAD)):
        o.data.materials.append(mat)
    for o in (side, bullet):
        me = o.data; uv = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (math.atan2(v.x, v.z) / (2 * math.pi) + 0.5, v.y / 40.0)
    c = join([side, head, bullet], 'CartridgeMesh')
    shade(c, 40)
    return c.data

def build_primer_mesh():
    # flat face a hair inside the case head (y grows into the case), radial rings so the app can dent it
    prof = [(0, 0.08)] + [(r, 0.08) for r in (0.3, 0.6, 0.9, 1.25, 1.6)] + [(1.95, 0.1), (2.12, 0.2), (2.2, 0.42), (2.2, 0.9), (0, 0.9)]
    o = lathe('primer', prof, seg=32)
    me = o.data; uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (0.5 + v.x / 4.4, 0.5 + v.z / 4.4)
    set_mat(o, M_PRIMER); shade(o, 50)
    me = o.data; bpy.data.objects.remove(o)
    return me

# ================================================================= ASSEMBLY
def empty(name, loc, parent=None):
    e = link(bpy.data.objects.new(name, None)); e.empty_display_size = 3; e.location = loc
    if parent: e.parent = parent
    return e

def set_origin(ob, origin):
    ob.data.transform(Matrix.Translation(-Vector(origin))); ob.location = Vector(origin)

def assemble():
    root = empty('Revolver', (0, 0, 0))
    frame = build_frame(); frame.parent = root
    gl = build_panel('GripL', -1); gr = build_panel('GripR', +1)
    peak = panel_surface_x(*GRIP_SCREW)
    # grip screw (left) + nut (right), with escutcheons
    ex = []
    for side in (-1, 1):
        ex.append(lathe('esc%d' % side, [(0, 0), (3.6, 0), (3.6, 0.5), (3.2, 0.9), (0, 0.9)], seg=40, axis='X', axis_c=(GRIP_SCREW[0], GRIP_SCREW[1])))
        ex[-1].data.transform(Matrix.Translation((peak - 0.6, 0, 0)))
        if side < 0: ex[-1].data.transform(Matrix.Scale(-1, 4, (1, 0, 0))); fix_normals(ex[-1].data)
    gs = screw('gscrew', (-(peak + 0.15), GRIP_SCREW[0], GRIP_SCREW[1]), -1, 2.5, 0.75, slot_angle=0.9)
    nut = screw('gnut', ((peak + 0.15), GRIP_SCREW[0], GRIP_SCREW[1]), +1, 2.5, 0.6, slot=False)
    for o in ex + [gs, nut]: set_mat(o, M_STEEL)
    sc = join(ex + [gs, nut], 'gripscrews'); shade(sc)
    # the escutcheons sit in the panels: cut their seats
    grip = join([gl, gr], 'Grip'); shade(grip, 45); grip.parent = root
    # the screw hardware belongs to the static frame
    frame = join([frame, sc], 'Frame')

    hammer = build_hammer(); set_origin(hammer, (0, HAMMER_PIV[0], HAMMER_PIV[1])); hammer.parent = root
    trigger = build_trigger(); set_origin(trigger, (0, TRIG_PIV[0], TRIG_PIV[1])); trigger.parent = root
    crane = build_crane(); set_origin(crane, (HINGE[0], CYL_Y0, HINGE[1])); crane.parent = root
    cyl = build_cylinder(); set_origin(cyl, (0, CYL_Y0, CYL_Z)); cyl.parent = crane
    cyl.location = Vector((0, CYL_Y0, CYL_Z)) - Vector((HINGE[0], CYL_Y0, HINGE[1]))
    cme = build_cartridge_mesh(); pme = build_primer_mesh()
    for k in range(6):
        a = k * math.pi / 3
        c = link(bpy.data.objects.new('Cartridge%d' % k, cme)); c.parent = cyl
        c.location = (math.sin(a) * CH_R, 0, math.cos(a) * CH_R)
        c.rotation_euler = (0, a, 0)  # headstamp reads upright when this chamber is at 12 o'clock
        p = link(bpy.data.objects.new('Primer%d' % k, pme)); p.parent = c
    for ob in list(bpy.data.objects):
        if ob.name.startswith('CartridgeMesh'): bpy.data.objects.remove(ob)
    empty('Muzzle', (0, MUZ_Y, BORE_Z), root)
    empty('Gap', (0, (CYL_Y1 + BAR_Y0) / 2, BORE_Z), root)
    empty('RearSight', (0, REAR_Y, TOP_Z), root)
    empty('FrontSight', (0, FRONT_Y, TOP_Z), root)
    # remove cutters
    for ob in list(bpy.data.objects):
        if ob.name.startswith('CUT_'): bpy.data.objects.remove(ob)
    for me in list(bpy.data.meshes):
        if me.users == 0: bpy.data.meshes.remove(me)
    return root

def to_metres():
    S = Matrix.Scale(SCALE, 4)
    done = set()
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and ob.data.name not in done:
            ob.data.transform(S); done.add(ob.data.name)
        ob.location = ob.location * SCALE
        if ob.type == 'EMPTY': ob.empty_display_size = 0.003

# ================================================================= TEXTURES
def save_webp(name, arr, quality=86):
    """arr: HxWx3 float 0..1 (row 0 = bottom, Blender convention)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(px.ravel())
    _save(img, os.path.join(OUT, name + '.webp'), quality)
    return img

def _save(img, path, quality):
    s = SC.render.image_settings
    s.file_format = 'WEBP'; s.quality = quality; s.color_mode = 'RGB'
    try: s.color_management = 'OVERRIDE'; s.view_settings.view_transform = 'Standard'
    except Exception: pass
    SC.view_settings.view_transform = 'Standard'
    img.save_render(path, scene=SC)

def fft_noise(n, fx, fy, seed, power=1.0):
    """Tileable filtered noise; fx/fy = gaussian widths in cycles per tile along x (cols) / y (rows)."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n))
    ky = np.fft.fftfreq(n)[:, None] * n; kx = np.fft.fftfreq(n)[None, :] * n
    filt = np.exp(-0.5 * ((kx / fx) ** 2 + (ky / fy) ** 2)) ** power
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    out -= out.mean(); out /= (out.std() + 1e-9)
    return out

def make_scratch_tex(n=1024):
    rng = np.random.default_rng(7)
    acc = np.zeros((n, n), np.float32)
    def splat(x, y, val):
        x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
        for dx, dy, wgt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            np.add.at(acc, ((y0 + dy) % n, (x0 + dx) % n), val * wgt)
    # handling marks: mostly along u (the gun's length), a few at random angles
    for i in range(1500):
        L = rng.uniform(0.008, 0.07) * n * (1.8 if rng.random() < 0.1 else 1)
        ang = rng.normal(0, 0.22) if rng.random() < 0.75 else rng.uniform(0, math.pi)
        x0, y0 = rng.uniform(0, n), rng.uniform(0, n)
        bend = rng.normal(0, 0.15)
        t = np.linspace(0, 1, int(L * 2) + 2)
        a = ang + bend * (t - 0.5)
        xs = x0 + np.cumsum(np.cos(a)) * (L / len(t)); ys = y0 + np.cumsum(np.sin(a)) * (L / len(t))
        inten = rng.uniform(0.1, 1.0) * (rng.random() ** 3 * 0.8 + 0.2)
        fade = np.sin(np.pi * t) ** 0.6
        splat(xs, ys, inten * fade * 0.5)
    r = 1 - np.exp(-acc * 1.6)
    g = fft_noise(n, 2.0, 220.0, 11)                      # streaks along u (brushing)
    g = 0.5 + 0.18 * g + 0.08 * fft_noise(n, 30, 400, 12)
    b = fft_noise(n, 6, 6, 13) * 0.6 + fft_noise(n, 24, 24, 14) * 0.3 + fft_noise(n, 80, 80, 15) * 0.1
    b = 0.5 + 0.22 * b
    save_webp('revolver_scratch', np.dstack([r, g, b]), 88)

def poly_sdf(px, py, poly):
    """Signed distance (mm, negative inside) from points to a closed polygon."""
    P = np.array(poly); A = P; B = np.roll(P, -1, axis=0)
    d = np.full(px.shape, 1e9); inside = np.zeros(px.shape, bool)
    for (ax, ay), (bx, by) in zip(A, B):
        ex, ey = bx - ax, by - ay
        t = np.clip(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
        dx = px - (ax + t * ex); dy = py - (ay + t * ey)
        d = np.minimum(d, np.hypot(dx, dy))
        cond = ((ay > py) != (by > py)) & (px < (bx - ax) * (py - ay) / (by - ay + 1e-12) + ax)
        inside ^= cond
    return np.where(inside, -d, d)

def make_grip_tex(n=1024):
    mm = 100.0 / n
    ys = (np.arange(n) + 0.5) * mm - 95.0; zs = (np.arange(n) + 0.5) * mm - 85.0
    Y, Z = np.meshgrid(ys, zs)            # row 0 = bottom (v=0)
    sd = poly_sdf(Y, Z, fillet(PANEL, step=10))
    # grip axis (front strap direction) and checkering coordinates
    ax = Vector((-22.0, -70.5)).normalized(); nx = Vector((ax.y, -ax.x))
    s_ax = Y * ax.x + Z * ax.y; s_nx = Y * nx.x + Z * nx.y
    pitch = 1.0; ang = math.radians(33)
    l1 = (s_ax * math.sin(ang) + s_nx * math.cos(ang)) / pitch
    l2 = (s_ax * math.sin(ang) - s_nx * math.cos(ang)) / pitch
    tri = lambda x: np.abs(x - np.floor(x) - 0.5) * 2      # 1 at a ridge, 0 in a groove
    hpyr = np.minimum(tri(l1), tri(l2))
    # checkered field: panel inset 3.4 mm, minus a smooth diamond around the screw
    dy, dz = Y - GRIP_SCREW[0], Z - GRIP_SCREW[1]
    da = dy * ax.x + dz * ax.y; dn = dy * nx.x + dz * nx.y
    diamond = np.abs(da) / 15.0 + np.abs(dn) / 9.5
    field = (sd < -3.4) & (diamond > 1.0)
    soft = np.clip((-sd - 3.4) / 0.25, 0, 1) * np.clip((diamond - 1.0) / 0.02, 0, 1)
    # border line groove (a single cut around the field)
    border = np.exp(-((-sd - 3.0) / 0.18) ** 2) + np.exp(-((diamond - 0.97) * 9.5 / 0.18) ** 2) * (sd < -3.0)
    wearc = np.clip((-sd - 9.0) / 10.0, 0, 1) * (0.45 + 0.25 * np.clip(fft_noise(n, 6, 6, 26) * 0.5 + 0.5, 0, 1))
    hp = np.minimum(hpyr, 1.0 - wearc)                      # pyramids worn flat on the high points
    height = soft * (hp * 0.4 - 0.4) - border * 0.25
    gy, gx = np.gradient(height, mm)
    k = 1.0
    nrm = np.dstack([-gx * k, -gy * k, np.ones_like(gx)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    save_webp('revolver_grip_n', nrm * 0.5 + 0.5, 90)
    # wood: grain runs along the grip axis, warped; figure = low-frequency variation
    warp = fft_noise(n, 2.5, 2.5, 21) * 1.0 + fft_noise(n, 9, 9, 22) * 0.25
    gr = np.sin(s_nx * 3.6 + warp * 2.4 + s_ax * 0.03) * 0.5 + 0.5
    gr = 0.5 + (gr - 0.5) * (0.55 + 0.45 * np.clip(fft_noise(n, 4, 4, 25) * 0.5 + 0.5, 0, 1))
    fine = fft_noise(n, 4, 160, 23)
    # rotate the fine pores to the grip axis: approximate by sampling along s_nx
    pores = np.interp(s_nx.ravel(), np.linspace(-60, 60, n), fine[n // 2]).reshape(n, n)
    grain = np.clip(gr ** 1.6 * 0.7 + (pores * 0.15 + 0.15), 0, 1)
    figure = 0.5 + 0.25 * fft_noise(n, 5, 5, 24)
    save_webp('revolver_grip_m', np.dstack([grain, soft, figure]), 88)

# ================================================================= UV + BAKE
STEEL_OBJS = ['Frame', 'Hammer', 'Trigger', 'Crane', 'Cylinder']

def uv_steel():
    objs = [bpy.data.objects[n] for n in STEEL_OBJS]
    for o in bpy.data.objects: o.select_set(False)
    for o in objs:
        o.select_set(True)
        while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    except Exception as e:
        print('pack failed', e)
    bpy.ops.object.mode_set(mode='OBJECT')

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
    SC.cycles.samples = 96
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
        # convex-only edges: edge mask times the (un)occlusion at small scale
        conv = N.new('ShaderNodeMapRange'); conv.inputs['From Min'].default_value = 0.55; conv.inputs['From Max'].default_value = 0.95
        L.new(aos.outputs['AO'], conv.inputs['Value'])
        em = N.new('ShaderNodeMath'); em.operation = 'MULTIPLY'; em.use_clamp = True
        L.new(edgek.outputs[0], em.inputs[0]); L.new(conv.outputs['Result'], em.inputs[1])
        cav = N.new('ShaderNodeMath'); cav.operation = 'SUBTRACT'; cav.inputs[0].default_value = 1.0; L.new(aos.outputs['AO'], cav.inputs[1])
        # convex edges: occlusion measured inside the mesh (rounded edges have the solid close behind them)
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
    # bake with every part in its rest pose (cartridges hidden from the bake rays would be wrong: keep them)
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
    px = np.array(img.pixels[:], np.float32).reshape(TEX, TEX, 4)[..., :3]
    # Bake outputs linear values: store as-is (Non-Color)
    save_webp('revolver_wear', px, 88)
    for mat in (M_STEEL, M_CASE):
        nt = mat.node_tree; out = nt.nodes.get('Material Output')
        nt.links.new(saved[mat.name], out.inputs['Surface'])

# ================================================================= EXPORT
def export():
    for o in bpy.data.objects: o.select_set(True)
    path = os.path.join(OUT, 'revolver.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_animations=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
                              export_extras=False, export_cameras=False, export_lights=False)
    tris = 0; seen = set()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            n = sum(len(p.vertices) - 2 for p in o.data.polygons)
            if o.data.name not in seen: seen.add(o.data.name)
            tris += n
            print('TRI', o.name, n)
    print('TRI total', tris)
    print('SIZE glb', os.path.getsize(path))

root = assemble()
to_metres()
make_scratch_tex(); make_grip_tex()
uv_steel()
if not NOBAKE: bake_wear()
export()
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
print('INFO done')
