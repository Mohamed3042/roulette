# Builds the Range-mode pistol (1911 pattern, .45 class, 5 inch barrel) from scratch and exports
# assets/models/pistol.glb plus its WebP textures (pistol_*.webp).
#
#   blender -b --factory-startup --python tools/blender/build_pistol.py -- <out dir> [--work <dir>] [--fast] [--nobake]
#
# Everything is modelled in millimetres in a "design" frame (y = forward from the slide's rear face,
# z = up from the frame rail line, x = right), then moved so the trigger-finger point is the origin
# and scaled to metres. Blender +Y (muzzle) becomes glTF -Z on export.
import bpy, bmesh, math, sys, os, json
import numpy as np
from mathutils import Vector, Matrix

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGV[0] if ARGV and not ARGV[0].startswith('--') else 'assets/models')
WORK = os.path.abspath(ARGV[ARGV.index('--work') + 1]) if '--work' in ARGV else os.path.join(OUT, '_pistol_work')
FAST = '--fast' in ARGV
NOBAKE = '--nobake' in ARGV
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
COLL = SC.collection

# ================================================================= DIMENSIONS (mm, design frame)
RAKE = math.radians(18.0); SR, CR = math.sin(RAKE), math.cos(RAKE)
SL = 206.0              # slide length
HW = 11.6               # slide half width (23.2 mm)
CROWN0, CROWN_H = 17.0, 9.2   # slide flat sides up to z=17, rounded top to z=26.2
TOP = CROWN0 + CROWN_H
BZ = 12.5               # bore axis height
BF = SL - 127.0         # breech face (chamber mouth of a 5 in barrel ends at the muzzle)
PZ = -1.8               # recoil spring plug axis
TUN0 = 153.0            # slide spring tunnel starts here (lower front)
TUNZ = -10.3            # tunnel bottom
DCZ = -10.0             # frame dust cover / trigger guard top
DC_END = 155.0          # frame dust cover front face
FH = 11.2               # frame half width (22.4 mm)
O = (BF - 2.5, 3.0)     # grip frame origin: front-top of the magazine
TRIG_Y, TRIG_Z = 85.0, -21.5   # trigger-finger point (centre of the pad on the trigger face)
SLIDE_TRAVEL = 32.0
HAMMER_PIV = (7.5, -8.8)
HAMMER_COCK = 0.6       # rad back from the fallen pose
GS_PIV = (2.0, -7.0)
SS_PIV = (96.0, -5.5)
SS_LIFT = -0.16
BARREL_PIV_Y = SL - SLIDE_TRAVEL
TAN8 = math.tan(math.radians(8.0))
MAG_TOP = 9.0
CASE_L, CASE_R, BUL_R, OAL = 22.8, 6.0, 5.74, 32.4


def G(P, Q):
    """Grip frame: P = perpendicular offset (forward +), Q = distance down the raked grip axis."""
    return (O[0] + P * CR - Q * SR, O[1] - P * SR - Q * CR)


def GZ(P, z):
    Q = (O[1] - P * SR - z) / CR
    return G(P, Q)


def zfb(y):
    return -105.0 - (y - 62.0) * TAN8      # frame bottom line, rising 8 deg toward the back


def on_fb(P, dz=0.0):
    a = -CR - SR * TAN8
    rhs = -105.0 - (O[0] + P * CR - 62.0) * TAN8 + dz - (O[1] - P * SR)
    return G(P, rhs / a)


# ================================================================= 2D helpers
def rpoly(spec, seg=5):
    """Polygon from (u, v[, r]) corners; r > 0 rounds that corner with an arc."""
    out = []
    n = len(spec)
    for i in range(n):
        p = Vector(spec[i][:2]); r = spec[i][2] if len(spec[i]) > 2 else 0
        if r <= 0:
            out.append((p.x, p.y)); continue
        a = Vector(spec[i - 1][:2]); b = Vector(spec[(i + 1) % n][:2])
        d1 = (a - p); d2 = (b - p)
        if d1.length < 1e-6 or d2.length < 1e-6:
            out.append((p.x, p.y)); continue
        d1.normalize(); d2.normalize()
        ang = math.acos(max(-1.0, min(1.0, d1.dot(d2))))
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append((p.x, p.y)); continue
        t = r / math.tan(ang / 2)
        t = min(t, (a - p).length * 0.48, (b - p).length * 0.48)
        rr = t * math.tan(ang / 2)
        p1 = p + d1 * t; p2 = p + d2 * t
        c = p + (d1 + d2).normalized() * (rr / math.sin(ang / 2))
        a1 = math.atan2(p1.y - c.y, p1.x - c.x); a2 = math.atan2(p2.y - c.y, p2.x - c.x)
        da = a2 - a1
        while da > math.pi: da -= 2 * math.pi
        while da < -math.pi: da += 2 * math.pi
        k = max(2, int(math.ceil(seg * abs(da) / (math.pi / 2))))
        for j in range(k + 1):
            aa = a1 + da * j / k
            out.append((c.x + rr * math.cos(aa), c.y + rr * math.sin(aa)))
    clean = []
    for q in out:
        if not clean or (Vector(q) - Vector(clean[-1])).length > 1e-4:
            clean.append(q)
    if len(clean) > 2 and (Vector(clean[0]) - Vector(clean[-1])).length < 1e-4:
        clean.pop()
    return clean


def circle(cu, cv, r, n=24, a0=0.0):
    return [(cu + r * math.cos(a0 + 2 * math.pi * i / n), cv + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def rect(u0, v0, u1, v1, r=0.0):
    return rpoly([(u0, v0, r), (u1, v0, r), (u1, v1, r), (u0, v1, r)]) if r > 0 else [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


# ================================================================= mesh helpers
def to3(axis, a, u, v):
    if axis == 'x': return (a, u, v)
    if axis == 'y': return (u, a, v)
    return (u, v, a)


def bm_prism(bm, pts, a0, a1, axis='x', xf=None):
    vb = [bm.verts.new(to3(axis, a0, u, v)) for u, v in pts]
    vt = [bm.verts.new(to3(axis, a1, u, v)) for u, v in pts]
    if xf is not None:
        for v in vb + vt: v.co = xf @ v.co
    n = len(pts)
    bm.faces.new(vb); bm.faces.new(vt[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    return vb + vt


def bm_lathe(bm, prof, seg=32, xf=None):
    """prof: [(r, a)] closed outline around the +Y axis (r = 0 points become poles)."""
    rings = []
    for r, a in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0.0, a, 0.0))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), a, r * math.sin(2 * math.pi * i / seg))) for i in range(seg)])
    if xf is not None:
        for ring in rings:
            for v in ring: v.co = xf @ v.co
    n = len(rings)
    for k in range(n):
        A = rings[k]; B = rings[(k + 1) % n]
        if len(A) == 1 and len(B) == 1: continue
        if len(A) == 1:
            for i in range(seg): bm.faces.new((A[0], B[(i + 1) % seg], B[i]))
        elif len(B) == 1:
            for i in range(seg): bm.faces.new((A[i], A[(i + 1) % seg], B[0]))
        else:
            for i in range(seg): bm.faces.new((A[i], A[(i + 1) % seg], B[(i + 1) % seg], B[i]))


def new_obj(name, bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); COLL.objects.link(ob)
    return ob


def prism_obj(name, pts, a0, a1, axis='x', xf=None):
    bm = bmesh.new(); bm_prism(bm, pts, a0, a1, axis, xf); return new_obj(name, bm)


def cyl_obj(name, axis, cu, cv, r, a0, a1, n=32):
    return prism_obj(name, circle(cu, cv, r, n), a0, a1, axis)


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear(); ob.data = me
    bpy.data.meshes.remove(old)


def kill(ob):
    me = ob.data if ob.type == 'MESH' else None
    bpy.data.objects.remove(ob, do_unlink=True)
    if me is not None and me.users == 0: bpy.data.meshes.remove(me)


def boolean(ob, cutter, op='DIFFERENCE', keep=False):
    m = ob.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.solver = 'EXACT'; m.object = cutter
    m.use_self = True; m.use_hole_tolerant = True
    apply_mods(ob)
    if not keep: kill(cutter)
    return ob


def merge_cutters(name, obs):
    bm = bmesh.new()
    for o in obs:
        bm.from_mesh(o.data); kill(o)
    return new_obj(name, bm)


def bevel(ob, w, seg=3, angle=30, profile=0.5):
    m = ob.modifiers.new('bev', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle); m.profile = profile; m.use_clamp_overlap = True
    m.miter_outer = 'MITER_ARC'; m.harden_normals = False
    apply_mods(ob)
    return ob


def round_edges(ob, pred, offset, seg=5):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    edges = [e for e in bm.edges if pred(e.verts[0].co, e.verts[1].co)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, offset_type='OFFSET', segments=seg, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    bm.to_mesh(ob.data); bm.free()
    return ob


def merge_into(target, others):
    bm = bmesh.new(); bm.from_mesh(target.data)
    for o in others:
        o.data.transform(o.matrix_world); bm.from_mesh(o.data); kill(o)
    bm.to_mesh(target.data); bm.free()
    return target


def finish_normals(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True; m.mode = 'FACE_AREA'; m.weight = 50
    apply_mods(ob)


def text_mesh(name, body, size, depth, center, along, normal, up=(0, 0, 1)):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = body; cu.size = size; cu.extrude = depth / 2
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3; cu.space_character = 1.06
    tmp = bpy.data.objects.new(name + '_t', cu); COLL.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    M = Matrix((along, up, normal)).transposed().to_4x4()
    M.translation = Vector(center)
    me.transform(M)
    ob = bpy.data.objects.new(name, me); COLL.objects.link(ob)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ================================================================= SLIDE
def build_slide():
    side = [(0, 0), (0, 32), (SL, 32), (SL, TUNZ - 1.5), (TUN0, TUNZ - 1.5), (TUN0, 0)]
    slide = prism_obj('Slide', side, -20, 20, 'x')
    xs = []
    n = 28
    for i in range(n + 1):
        t = math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        xs.append((HW * math.copysign(abs(c) ** (2 / 2.6), c), CROWN0 + CROWN_H * abs(s) ** (2 / 2.6)))
    sec = rpoly([(-HW, TUNZ, 4.0), (HW, TUNZ, 4.0)] + [(x, z, 0) for x, z in xs])
    boolean(slide, prism_obj('sec', sec, -5, SL + 5, 'y'), 'INTERSECT')

    cuts = []
    # inside: chamber pocket under the port (open at the bottom), barrel tunnel, bushing seat, plug bore
    cuts.append(prism_obj('pocket', rect(BF, -2.0, BF + 38.0, 20.9), -7.6, 7.6, 'x'))
    cuts.append(cyl_obj('tunnel', 'y', 0, BZ, 7.7, BF + 30, SL + 2))
    cuts.append(cyl_obj('bush', 'y', 0, BZ, 9.75, SL - 6.5, SL + 2, 40))
    cuts.append(cyl_obj('plug', 'y', 0, PZ, 5.7, TUN0 - 2, SL + 2, 32))
    cuts.append(cyl_obj('fp', 'y', 0, BZ, 1.45, -2, 2.0, 20))
    # ejection port (right)
    cuts.append(prism_obj('port', rpoly([(BF + 0.5, 5.5, 1.5), (BF + 35.5, 5.5, 1.0), (BF + 35.5, 20.0, 1.0), (BF + 0.5, 20.0, 1.0)]), 4.0, 16.0, 'x'))
    # rear cocking serrations, both sides (V grooves running out through the bottom)
    for i in range(13):
        yc = 7.0 + i * 2.05
        for sgn in (1, -1):
            tri = [(sgn * (HW - 0.78), yc), (sgn * (HW + 1.4), yc - 1.85), (sgn * (HW + 1.4), yc + 1.85)]
            cuts.append(prism_obj('ser', tri, -3.0, 16.6, 'z'))
    # slide stop notch (left lower edge) – lined up with the stop's lifted tooth at full travel
    cuts.append(cyl_obj('ssn', 'x', SS_NOTCH_Y, -0.5, 3.0, -13.5, -10.3, 28))
    # firing pin stop outline + extractor on the rear face
    for (u0, v0, u1, v1) in [(-4.6, 3.0, 4.6, 3.3), (-4.6, 17.7, 4.6, 18.0), (-4.6, 3.0, -4.3, 18.0), (4.3, 3.0, 4.6, 18.0)]:
        cuts.append(prism_obj('fps', rect(u0, v0, u1, v1), -2.0, 0.35, 'y'))
    # flat top strip for the fine top serration
    cuts.append(prism_obj('rib', rect(23.0, TOP - 0.45, 190.0, TOP + 6), -3.6, 3.6, 'x'))
    boolean(slide, merge_cutters('slidecuts', cuts))
    bevel(slide, 0.42, 3)
    # roll marks (invented, generic), cut after the bevel so their edges stay crisp and cheap
    boolean(slide, merge_cutters('marks', [text_mesh('mk1', 'M45  AUTOMATIC   CAL .45', 2.9, 0.7, (-HW, 126.0, 8.0), (0, -1, 0), (-1, 0, 0)),
                                           text_mesh('mk2', 'MODEL OF 1911 PATTERN', 1.7, 0.6, (HW, 142.0, 2.6), (0, 1, 0), (1, 0, 0))]))

    parts = []
    # fine top serration strip
    bm = bmesh.new(); pts = []; y = 23.2; p = 0.78
    pts.append((23.2, TOP - 0.9))
    while y + p < 189.8:
        pts += [(y, TOP - 0.12), (y + 0.12, TOP - 0.12), (y + p / 2 + 0.06, TOP - 0.42)]
        y += p
    pts += [(y, TOP - 0.12), (189.8, TOP - 0.12), (189.8, TOP - 0.9)]
    bm_prism(bm, pts, -3.55, 3.55, 'x'); parts.append(new_obj('strip', bm))
    # rear sight (square notch)
    rs = prism_obj('rsight', rpoly([(9.0, 23.0), (9.0, 28.6, 0.4), (10.4, 31.4, 0.5), (17.5, 31.4, 0.8), (21.5, 27.2, 1.0), (21.5, 23.0)]), -8.2, 8.2, 'x')
    boolean(rs, prism_obj('notch', rect(-5, 28.6, 30, 40), -1.8, 1.8, 'x'))
    for k in range(4):   # anti-glare grooves on the rear face
        z0 = 26.6 + k * 0.62
        boolean(rs, prism_obj('rg', [(8.6, z0 - 0.22), (9.25, z0), (8.6, z0 + 0.22)], -9, 9, 'x'))
    bevel(rs, 0.3, 2); parts.append(rs)
    fs = prism_obj('fsight', rpoly([(192.5, 24.5), (192.5, 31.4, 0.15), (196.6, 31.4, 0.6), (201.5, 26.2, 1.5), (201.5, 24.5)]), -1.4, 1.4, 'x')
    bevel(fs, 0.18, 2); parts.append(fs)
    # extractor tail on the rear face
    ex = prism_obj('ext', rect(2.4, 18.7, 5.2, 21.3, 0.6), -0.18, 3.0, 'y'); bevel(ex, 0.2, 2); parts.append(ex)
    # firing pin tip
    bm = bmesh.new(); bm_lathe(bm, [(0, -0.05), (1.15, -0.05), (1.15, 2.0), (0, 2.0)], 20, Matrix.Translation((0, 0, BZ))); fp = new_obj('fpin', bm); bevel(fp, 0.15, 2); parts.append(fp)
    # barrel bushing and recoil spring plug
    bm = bmesh.new(); bm_lathe(bm, [(7.38, SL - 6.0), (9.65, SL - 6.0), (9.65, SL + 0.1), (9.3, SL + 0.3), (7.6, SL + 0.3), (7.38, SL + 0.1)], 40, Matrix.Translation((0, 0, BZ)))
    bu = new_obj('bushing', bm); bevel(bu, 0.15, 2); parts.append(bu)
    bm = bmesh.new(); bm_lathe(bm, [(0, SL - 14), (5.6, SL - 14), (5.6, SL + 0.15), (5.2, SL + 0.45), (1.9, SL + 0.45), (1.5, SL + 0.2), (0, SL + 0.15)], 36, Matrix.Translation((0, 0, PZ)))
    pl = new_obj('plug', bm); bevel(pl, 0.15, 2); parts.append(pl)
    merge_into(slide, parts)
    finish_normals(slide)
    return slide


# ================================================================= BARREL
def build_barrel():
    b = cyl_obj('Barrel', 'y', 0, BZ, 7.3, BF + 20, SL + 0.3, 40)
    ch = cyl_obj('ch', 'y', 0, BZ, 8.6, BF, BF + 22, 40)
    boolean(b, ch, 'UNION')
    boolean(b, prism_obj('hood', rect(BF, BZ, BF + 22, 20.6), -7.0, 7.0, 'x'), 'UNION')
    boolean(b, prism_obj('lug', rpoly([(BF + 5, BZ - 6), (BF + 19, BZ - 6), (BF + 17, BZ - 13.0, 2.5), (BF + 7, BZ - 13.0, 2.5)]), -4.3, 4.3, 'x'), 'UNION')
    cuts = [cyl_obj('bore', 'y', 0, BZ, 5.72, BF + 10, SL + 3, 32),
            cyl_obj('chamber', 'y', 0, BZ, 6.06, BF - 1, BF + CASE_L + 0.2, 36),
            prism_obj('ramp', [(BF - 1, BZ - 4.2), (BF + 5.5, BZ - 6.4), (BF + 5.5, BZ - 14), (BF - 1, BZ - 14)], -4.2, 4.2, 'x'),
            cyl_obj('linkpin', 'x', BF + 12, BZ - 9.6, 1.6, -5, 5, 16)]
    boolean(b, merge_cutters('bcuts', cuts))
    bevel(b, 0.35, 3)
    finish_normals(b)
    return b


# ================================================================= FRAME
def frame_outline():
    fb_front = on_fb(2.8); fb_back = on_fb(-50.2)
    return rpoly([
        (-2.5, 0.0, 0.6), (DC_END, 0.0, 0.6), (DC_END, DCZ, 3.0), (121.5, DCZ, 0),
        GZ(2.8, DCZ) + (1.5,), (fb_front[0], fb_front[1], 2.5), (fb_back[0], fb_back[1], 2.5),
        GZ(-50.2, -16.0) + (0,), (2.0, -10.0, 3.0), (-8.6, -6.0, 2.5), (-9.4, -0.4, 1.2)])   # rear tangs either side of the hammer


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n; a = (1 - t) ** 3; b = 3 * t * (1 - t) ** 2; c = 3 * t * t * (1 - t); d = t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def build_frame():
    fr = prism_obj('Frame', frame_outline(), -FH, FH, 'x')
    # round the grip's front strap, back strap and bottom (cast/forged look)
    round_edges(fr, lambda a, b: abs(abs(a.x) - FH) < 1e-3 and abs(abs(b.x) - FH) < 1e-3 and (a.z + b.z) / 2 < DCZ - 1.5
                and not ((a.y + b.y) / 2 < 17.0 and (a.z + b.z) / 2 > -16.5), 3.8, 6)   # stop at the straight back strap, before the tangs
    # trigger guard (narrower than the frame)
    # a 4.5 mm ring: front leaning back a little, big radius into a bottom that rises toward the grip,
    # fillets into the dust cover and the front strap
    def zb(y): return -45.5 + (119.7 - y) * 0.0367
    yb, zz = 64.0, -43.5
    for _ in range(4):
        zz = zb(yb); yb = GZ(2.2, zz)[0]
    gout = rpoly([(GZ(-6.0, DCZ + 1.5)[0], DCZ + 1.5), (131.0, DCZ + 1.5), (131.0, DCZ + 0.4), (124.5, DCZ, 4.0),
                  (119.7, -45.5, 11.0), (yb, zz, 3.0), GZ(2.2, -56.0) + (0,), GZ(-6.0, -56.0) + (0,)], 7)
    guard = prism_obj('guard', gout, -4.6, 4.6, 'x')
    ghole = rpoly([(GZ(-6.0, DCZ + 0.5)[0], DCZ + 0.5), (120.23, DCZ + 0.5, 3.5), (115.9, -41.3, 6.7), (50.0, -38.8, 0)], 7)
    boolean(guard, prism_obj('ghole', ghole, -8, 8, 'x'))
    round_edges(guard, lambda a, b: abs(abs(a.x) - 4.6) < 1e-3 and abs(abs(b.x) - 4.6) < 1e-3, 1.9, 5)
    boolean(fr, guard, 'UNION')
    cuts = []
    # magazine well (raked, open top and bottom)
    mw = [GZ(0.6, 4.0), GZ(-34.4, 4.0), G(-34.4, 150), G(0.6, 150)]
    cuts.append(prism_obj('magwell', mw, -7.6, 7.6, 'x'))
    # hammer slot
    cuts.append(prism_obj('hslot', rect(-12.0, -24.0, 16.5, 0.6), -4.3, 4.3, 'x'))
    # feed ramp: polished slope from the magazine well up to the chamber
    cuts.append(prism_obj('ramp', [(74.5, -3.6), (81.2, 0.0), (81.2, 1.0), (74.5, 1.0)], -4.4, 4.4, 'x'))
    boolean(fr, merge_cutters('fcuts', cuts))
    bevel(fr, 0.4, 3)
    # serial number (right side of the frame above the trigger guard), cut after the bevel
    boolean(fr, text_mesh('ser', 'No  45K-19370', 1.8, 0.6, (FH, 110.0, -6.0), (0, 1, 0), (1, 0, 0)))

    parts = []
    # mainspring housing with real checkering
    pts = [on_fb(-46.0), on_fb(-51.0), GZ(-51.0, -52.0), GZ(-46.0, -52.0)]
    msh = prism_obj('msh', rpoly([pts[0] + (0,), pts[1] + (1.6,), pts[2] + (0.6,), pts[3] + (0,)]), -9.8, 9.8, 'x')
    q_top = (O[1] + 51.0 * SR + 52.0) / CR
    q_bot = (lambda pp: (O[0] + (-51.0) * CR - pp[0]) / SR)(on_fb(-51.0))
    q0, q1 = q_top + 2.2, q_bot - 3.0
    Mloc = Matrix(((1, 0, 0, 0), (0, CR, -SR, 0), (0, -SR, -CR, 0), (0, 0, 0, 1)))   # (x, P, Q) -> design

    def gpt(x, P, Q):
        y, z = G(P, Q); return (x, y, z)
    rec = bmesh.new()
    vs = [rec.verts.new(gpt(x, P, Q)) for (x, P, Q) in [(-8.3, -52, q0), (8.3, -52, q0), (8.3, -52, q1), (-8.3, -52, q1),
                                                         (-8.3, -50.45, q0), (8.3, -50.45, q0), (8.3, -50.45, q1), (-8.3, -50.45, q1)]]
    for f in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        rec.faces.new([vs[i] for i in f])
    boolean(msh, new_obj('rec', rec))
    bevel(msh, 0.35, 2)
    # pyramids: valleys at P=-50.5, points at P=-51.0, 20 lines per inch
    p = 1.27
    nx = int(16.4 / p); nq = int((q1 - q0 - 0.2) / p)
    x0 = -nx * p / 2; qa = q0 + ((q1 - q0) - nq * p) / 2
    pm = bmesh.new()
    grid = [[pm.verts.new(gpt(x0 + i * p, -50.5, qa + j * p)) for j in range(nq + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(nq):
            c = pm.verts.new(gpt(x0 + (i + 0.5) * p, -51.02, qa + (j + 0.5) * p))
            a, b, d, e = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
            for f in ((a, b, c), (b, d, c), (d, e, c), (e, a, c)): pm.faces.new(f)
    bmesh.ops.recalc_face_normals(pm, faces=pm.faces)
    me = bpy.data.meshes.new('pyr'); pm.to_mesh(me); pm.free()
    pyr = bpy.data.objects.new('pyr', me); COLL.objects.link(pyr)
    # make pyramids face outward (backward = -P direction)
    for poly in pyr.data.polygons:
        n = poly.normal
        if n.y * CR - n.z * SR > 0: poly.flip()
    parts += [msh, pyr]
    # thumb safety (left)
    ts = prism_obj('tsafe', rpoly([(3.0, -1.5, 0.6), (24.0, -1.5, 1.0), (27.0, -2.7, 1.2), (25.5, -4.9, 1.0), (9.0, -6.9, 3.0),
                                    (6.6, -10.4, 2.5), (2.0, -11.7, 2.5), (-2.4, -9.6, 2.0), (-2.7, -5.0, 2.0), (-0.6, -2.0, 1.0)]), -13.4, -FH + 0.05, 'x')
    shelf = prism_obj('shelf', rpoly([(12.0, -1.5, 0), (24.0, -1.5, 1.0), (27.0, -2.7, 1.2), (25.6, -4.3, 1.0), (12.0, -3.6, 0)]), -16.2, -13.0, 'x')
    boolean(ts, shelf, 'UNION')
    for k in range(5):
        y0 = 15.0 + k * 2.2
        boolean(ts, prism_obj('tg', rect(y0, -1.9, y0 + 0.7, 0.5), -16.5, -13.0, 'x'))
    bevel(ts, 0.3, 3); parts.append(ts)
    # plunger tube (left)
    bm = bmesh.new(); bm_lathe(bm, [(0, 27.0), (2.0, 27.0), (2.0, 45.0), (0, 45.0)], 20, Matrix.Translation((-FH - 0.6, 0, -3.6)))
    pt = new_obj('plunger', bm); bevel(pt, 0.35, 3); parts.append(pt)
    # magazine release button (left, behind the trigger)
    mr_y, mr_z = MAG_REL
    bm = bmesh.new(); bm_lathe(bm, [(0, FH - 1.0), (4.3, FH - 1.0), (4.3, FH + 1.2), (3.6, FH + 1.75), (0, FH + 1.9)], 32,
                                Matrix.Translation((0, mr_y, mr_z)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
    mr = new_obj('magrel', bm)
    for k in range(-2, 3):
        boolean(mr, prism_obj('mrg', rect(mr_y - 5, mr_z + k * 1.35 - 0.25, mr_y + 5, mr_z + k * 1.35 + 0.25), -FH - 3, -FH - 1.55, 'x'))
    bevel(mr, 0.2, 2); parts.append(mr)
    # pins
    for (y, z, r, sides) in [(SS_PIV[0], SS_PIV[1], 2.3, (1,)), (HAMMER_PIV[0], HAMMER_PIV[1], 1.9, (1,)), (GS_PIV[0], GS_PIV[1], 2.0, (1,)),
                             (19.5, -16.5, 1.6, (1,))]:
        for s in sides:
            pn = cyl_obj('pin', 'x', y, z, r, s * (FH - 0.4), s * (FH + 0.22), 20); bevel(pn, 0.15, 2); parts.append(pn)
    mp = G(-45.5, (O[0] - 45.5 * CR - on_fb(-45.5)[0]) / SR - 6.0)
    for s in (1, -1):
        pn = cyl_obj('pin', 'x', mp[0], mp[1], 1.5, s * (FH - 0.4), s * (FH + 0.2), 16); bevel(pn, 0.12, 2); parts.append(pn)
    merge_into(fr, parts)
    finish_normals(fr)
    return fr


# ================================================================= small parts
def build_hammer():
    # short ring hammer with a solid neck (fallen pose; cocked below)
    RC, RR = (-5.0, 15.3), 1.9
    prof = rpoly([(1.8, -0.9, 0.4), (-0.25, -0.2, 0.6), (-0.25, 15.0, 1.2), (-1.4, 19.6, 3.0), (-5.0, 21.2, 3.5), (-9.2, 19.6, 3.0),
                  (-10.7, 15.3, 2.5), (-10.5, 10.0, 3.5), (-9.2, 3.6, 5.0), (-4.6, -4.8, 5.0), (1.5, -11.5, 3.0), (7.5, -15.2, 4.0),
                  (12.8, -11.5, 3.5), (12.4, -5.5, 3.0), (8.0, -2.5, 2.5)], 7)
    h = prism_obj('Hammer', prof, -3.9, 3.9, 'x')
    round_edges(h, lambda a, b: abs(abs(a.x) - 3.9) < 1e-3 and abs(abs(b.x) - 3.9) < 1e-3 and max(a.z, b.z) > 0.5, 0.7, 3)
    cuts = [cyl_obj('ring', 'x', RC[0], RC[1], RR, -6, 6, 28)]
    for k in range(7):          # grip grooves across the top/back of the head
        a = math.radians(62 + k * 14)
        cx, cz = RC[0] + 5.95 * math.cos(a), RC[1] + 5.95 * math.sin(a)
        M = Matrix.Translation((0, cx, cz)) @ Matrix.Rotation(a - math.pi / 2, 4, 'X')
        cuts.append(prism_obj('hg', rect(-0.3, -0.6, 0.3, 0.6), -5, 5, 'x', M))
    boolean(h, merge_cutters('hcuts', cuts))
    bevel(h, 0.25, 2)
    piv = Vector((0, HAMMER_PIV[0], HAMMER_PIV[1]))
    h.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(HAMMER_COCK, 4, 'X') @ Matrix.Translation(-piv))
    finish_normals(h)
    return h


def build_trigger():
    shoe = rpoly([(80.6, DCZ), (85.0, DCZ), (85.0, -31.5, 1.8), (84.0, -33.2, 1.0), (80.6, -32.2, 2.2)])
    t = prism_obj('Trigger', shoe, -3.5, 3.5, 'x')
    bow = prism_obj('bow', rect(74.0, -11.5, 81.0, -8.0), -3.5, 3.5, 'x')
    round_edges(t, lambda a, b: abs(abs(a.x) - 3.5) < 1e-3 and abs(abs(b.x) - 3.5) < 1e-3 and max(a.y, b.y) > 84.0 and min(a.z, b.z) < -12, 0.9, 4)
    boolean(t, bow, 'UNION')
    for k in range(-2, 3):      # vertical grooves on the face
        boolean(t, prism_obj('tg', [(85.35, -29.5), (84.75, -29.5), (84.75, -12.5), (85.35, -12.5)], k * 1.15 - 0.2, k * 1.15 + 0.2, 'x'))
    bevel(t, 0.2, 2)
    finish_normals(t)
    return t


def build_slide_stop():
    prof = rpoly([(84.6, -0.35, 0.5), (90.2, -0.35, 0.5), (93.0, -1.0, 1.5), (98.2, -1.4, 2.0), (100.4, -5.0, 2.6), (99.0, -9.0, 2.6),
                  (94.0, -10.2, 2.0), (80.0, -9.4, 4.0), (62.0, -11.2, 3.0), (52.0, -11.8, 2.5), (49.4, -9.0, 2.0),
                  (51.0, -6.6, 1.6), (62.0, -6.5, 3.0), (80.0, -2.8, 2.0)])
    s = prism_obj('SlideStop', prof, -13.9, -FH + 0.05, 'x')
    cuts = []
    for k in range(4):
        z0 = -8.0 - k * 0.95
        cuts.append(prism_obj('ssg', [(-14.5, z0 - 0.33), (-13.45, z0), (-14.5, z0 + 0.33)], 50.0, 61.5, 'y'))
    boolean(s, merge_cutters('sscuts', cuts))
    # pin head
    bm = bmesh.new(); bm_lathe(bm, [(0, -FH), (2.3, -FH), (2.3, -14.25), (1.9, -14.55), (0, -14.6)], 24,
                                Matrix.Translation((0, SS_PIV[0], SS_PIV[1])) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    pin = new_obj('sspin', bm)
    bevel(s, 0.3, 3); merge_into(s, [pin])
    finish_normals(s)
    return s


def build_grip_safety():
    # beavertail: the tang sweeps back over the web of the hand, its underside one smooth curve into the back strap
    E = GZ(-51.0, -27.0)
    up = (SR, CR)                                  # up the back strap
    web = bezier(E, (E[0] + 9.0 * up[0], E[1] + 9.0 * up[1]), (-3.0, -11.6), (-14.6, -9.6), 12)
    top = [(7.0, -3.2, 0), (0.0, -3.9, 3.0), (-8.0, -4.3, 4.0), (-13.8, -3.9, 2.5), (-17.4, -5.0, 2.2), (-17.0, -8.4, 2.0)]
    rest = [GZ(-51.0, -36.0) + (6.0,), GZ(-53.3, -43.0) + (6.0,), GZ(-51.0, -50.5) + (3.0,),
            GZ(-51.0, -54.4) + (0.8,), GZ(-46.0, -54.4) + (0,), GZ(-46.0, -10.0) + (0,)]
    pts = top + [p + (0,) for p in reversed(web[1:])] + [E + (2.0,)] + rest
    g = prism_obj('GripSafety', rpoly(pts, 7), -9.8, 9.8, 'x')
    round_edges(g, lambda a, b: abs(abs(a.x) - 9.8) < 1e-3 and abs(abs(b.x) - 9.8) < 1e-3, 2.6, 4)
    # clearance slot for the hammer neck (the tip stays solid)
    boolean(g, prism_obj('gslot', rect(-13.0, -7.6, 12.0, 0.0), -4.3, 4.3, 'x'))
    bevel(g, 0.3, 2)
    finish_normals(g)
    return g


def build_magazine():
    top_f, top_b = GZ(0.0, MAG_TOP), GZ(-33.8, MAG_TOP)
    tube = prism_obj('Magazine', [top_f, top_b, on_fb(-33.8, -0.4), on_fb(0.0, -0.4)], -7.1, 7.1, 'x')

    def Pof(co):
        return (co.y - O[0]) * CR - (co.z - O[1]) * SR
    round_edges(tube, lambda a, b: abs(abs(a.x) - 7.1) < 1e-3 and abs(a.x - b.x) < 1e-3 and abs(Pof(a)) < 1e-2 and abs(Pof(b)) < 1e-2, 3.2, 6)
    cuts = [prism_obj('mi', [GZ(-0.75, MAG_TOP + 1), GZ(-33.05, MAG_TOP + 1), GZ(-33.05, 5.5), GZ(-0.75, 5.5)], -6.35, 6.35, 'x')]
    # witness holes (both sides)
    for k in range(6):
        y, z = GZ(-29.0, -12.0 - k * 10.5)
        for s in (1, -1):
            cuts.append(cyl_obj('wh', 'x', y, z, 1.5, s * 6.3, s * 7.6, 16))
    boolean(tube, merge_cutters('mcuts', cuts))
    bevel(tube, 0.25, 2)
    pad = prism_obj('pad', rpoly([on_fb(1.4, -0.35) + (0.6,), on_fb(-35.2, -0.35) + (0.6,), on_fb(-35.2, -4.4) + (1.6,), on_fb(1.4, -4.4) + (1.6,)]), -8.3, 8.3, 'x')
    round_edges(pad, lambda a, b: abs(abs(a.x) - 8.3) < 1e-3 and abs(abs(b.x) - 8.3) < 1e-3, 1.2, 4)
    bevel(pad, 0.25, 2)
    for poly in pad.data.polygons: poly.material_index = 1
    merge_into(tube, [pad])
    finish_normals(tube)
    return tube


def build_grips():
    def outline(left):
        pts = [GZ(-1.2, -15.5) + (2.0,), on_fb(-1.2, 2.6) + (3.5,), on_fb(-46.0, 2.6) + (3.5,), GZ(-46.0, -15.5) + (2.0,)]
        return rpoly(pts, 6)
    panels = []
    for s in (1, -1):
        x_in, x_out = s * (FH - 0.05), s * (FH + 4.6)
        pnl = prism_obj('panel', outline(s < 0), min(x_in, x_out), max(x_in, x_out), 'x')
        xo = abs(x_out)
        round_edges(pnl, lambda a, b: abs(abs(a.x) - xo) < 1e-3 and abs(abs(b.x) - xo) < 1e-3, 2.2, 5)
        # notch for the magazine release (cut on both panels so the shared texture matches)
        boolean(pnl, cyl_obj('mrn', 'x', MAG_REL[0], MAG_REL[1], 5.7, -FH - 8, FH + 8, 32))
        for (sy, sz) in SCREWS:
            boolean(pnl, cyl_obj('esc', 'x', sy, sz, 4.25, s * (FH + 3.9), s * (FH + 6), 28))
        bevel(pnl, 0.25, 2)
        panels.append(pnl)
    grips = panels[0]; merge_into(grips, panels[1:]); grips.name = 'Grips'
    finish_normals(grips, 40)
    # screws: bushing ring + slotted domed head
    scr = []
    for s in (1, -1):
        for k, (sy, sz) in enumerate(SCREWS):
            bm = bmesh.new()
            bm_lathe(bm, [(0, 0.0), (4.15, 0.0), (4.15, 0.55), (3.75, 0.75), (3.5, 0.75), (3.5, 1.1), (3.0, 1.55), (1.8, 1.85), (0, 1.9)], 22)
            ob = new_obj('screw', bm)
            boolean(ob, prism_obj('slot', rect(-0.42, 1.25, 0.42, 3), -5, 5, 'z', Matrix.Rotation(0.35 + 1.1 * k + (0.6 if s < 0 else 0), 4, 'Y')))
            bevel(ob, 0.1, 2)
            M = Matrix.Translation((s * (FH + 3.9), sy, sz)) @ Matrix.Rotation(-s * math.pi / 2, 4, 'Z')
            ob.data.transform(M); scr.append(ob)
    screws = scr[0]; merge_into(screws, scr[1:]); screws.name = 'GripScrews'
    finish_normals(screws)
    return grips, screws


def case_profile(fired):
    mouth = 5.97 if fired else 5.96
    return [(0, 3.0), (2.68, 3.0), (2.68, 0.0), (5.75, 0.0), (6.0, 0.25), (6.0, 1.05), (5.82, 1.24), (5.1, 1.62), (5.1, 1.95),
            (5.98, 2.65), (mouth, CASE_L - 0.12), (mouth - 0.12, CASE_L), (5.7, CASE_L), (5.7, 3.9), (0, 3.6)]


def build_case(name, fired):
    bm = bmesh.new(); bm_lathe(bm, case_profile(fired), 36 if fired else 28); c = new_obj(name, bm)
    if fired:
      hs = [text_mesh('hs1', 'MK', 1.25, 0.3, (0, 0.0, 4.15), (1, 0, 0), (0, -1, 0)),
          text_mesh('hs2', '45 AUTO', 1.15, 0.3, (0, 0.0, -4.15), (1, 0, 0), (0, -1, 0))]
      boolean(c, merge_cutters('hs', hs))
    bevel(c, 0.08, 2, 40)
    prim = [(0, 0.05), (2.62, 0.05), (2.62, 3.0), (0, 3.0)]
    if fired:
        prim = [(0, 0.55), (0.45, 0.48), (0.75, 0.3), (0.95, 0.12), (1.1, 0.05), (2.62, 0.05), (2.62, 3.0), (0, 3.0)]
    bm = bmesh.new(); bm_lathe(bm, prim, 32 if fired else 20); p = new_obj('primer', bm)
    merge_into(c, [p])
    finish_normals(c, 40)
    return c


def build_round():
    c = build_case('Round', False)
    nose = []
    L0 = CASE_L - 6.5; L1 = CASE_L + 1.8; LT = OAL
    nose.append((0, L0)); nose.append((BUL_R, L0)); nose.append((BUL_R, L1))
    n = 14
    for i in range(1, n + 1):
        t = i / n
        a = L1 + (LT - L1) * (1 - math.cos(t * math.pi / 2)) ** 1.0
        th = t * math.pi / 2
        r = BUL_R * math.cos(th) ** 0.85
        a = L1 + (LT - L1) * math.sin(th)
        nose.append((max(r, 0.0), a))
    nose[-1] = (0, LT)
    bm = bmesh.new(); bm_lathe(bm, nose, 28); bul = new_obj('bullet', bm)
    finish_normals(bul, 40)
    for poly in bul.data.polygons: poly.material_index = 1
    merge_into(c, [bul])
    return c


# ================================================================= derived layout values
SS_TOOTH = Vector((0, 87.4, -0.35))
_d = SS_TOOTH - Vector((0, SS_PIV[0], SS_PIV[1]))
_ty = SS_PIV[0] + _d.y * math.cos(SS_LIFT) - _d.z * math.sin(SS_LIFT)
SS_NOTCH_Y = _ty + SLIDE_TRAVEL
MAG_REL = (GZ(2.8, -18.5)[0] - 5.0, -18.5)
SCREWS = [GZ(-23.6, -27.5), GZ(-23.6, -85.0)]

# ================================================================= BUILD
print('building...')
slide = build_slide(); print('slide', tris(slide))
barrel = build_barrel(); print('barrel', tris(barrel))
frame = build_frame(); print('frame', tris(frame))
hammer = build_hammer()
trigger = build_trigger()
sstop = build_slide_stop()
gsafe = build_grip_safety()
mag = build_magazine()
grips, screws = build_grips()
casing = build_case('Casing', True)
rnd = build_round()

# live rounds in the magazine and chamber share the Round mesh
mag_round_c = Vector((0, GZ(-33.05, MAG_TOP - 0.5)[0] + 0.5, MAG_TOP - 0.5))
ch_round_c = Vector((0, BF + 0.15, BZ))

# ================================================================= materials
def mat(name, col, metal, rough):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = col; bsdf.inputs['Metallic'].default_value = metal; bsdf.inputs['Roughness'].default_value = rough
    return m

M_STEEL = mat('Steel', (0.08, 0.09, 0.1, 1), 1.0, 0.35)
M_PAD = mat('Pad', (0.02, 0.02, 0.02, 1), 0.0, 0.6)
M_GRIP = mat('Grip', (0.25, 0.12, 0.05, 1), 0.0, 0.35)
M_BRASS = mat('Brass', (0.8, 0.55, 0.25, 1), 1.0, 0.3)
M_JACKET = mat('Jacket', (0.75, 0.4, 0.25, 1), 1.0, 0.3)
STEEL_OBS = [frame, slide, barrel, hammer, trigger, sstop, gsafe, mag, screws]
for ob in STEEL_OBS:
    ob.data.materials.clear(); ob.data.materials.append(M_STEEL)
mag.data.materials.append(M_PAD)
grips.data.materials.clear(); grips.data.materials.append(M_GRIP)
for ob in (casing, rnd):
    ob.data.materials.clear(); ob.data.materials.append(M_BRASS)
rnd.data.materials.append(M_JACKET)
for poly in rnd.data.polygons:      # the jacketed nose (everything ahead of the case mouth)
    poly.material_index = 1 if poly.center.y > CASE_L + 0.01 else 0

# ================================================================= UVs
def select_only(obs, active=None):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]

select_only(STEEL_OBS)
SC.tool_settings.use_uv_select_sync = True
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
# (average_islands_scale collapses these mm-sized islands to zero area: smart project already keeps one texel density)
bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
bpy.ops.object.mode_set(mode='OBJECT')

# grip panels: planar side projection, 100 mm per UV unit (the textures are drawn in the same mm space)
GUV = dict(y0=-4.0, z0=-108.0, size=100.0)
me = grips.data
uvl = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
for loop in me.loops:
    co = me.vertices[loop.vertex_index].co
    uvl.data[loop.index].uv = ((co.y - GUV['y0']) / GUV['size'], (co.z - GUV['z0']) / GUV['size'])
for ob in (casing, rnd):
    if not ob.data.uv_layers: ob.data.uv_layers.new(name='UVMap')

# ================================================================= TEXTURES
def save_img(name, arr, quality=86):
    """arr: HxWx3 float 0..1, row 0 = bottom (Blender convention)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(OUT, name + '.webp')
    img.file_format = 'WEBP'; img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    return img


def vnoise(U, V, seed):
    """Smooth value noise on a unit lattice (U, V arrays)."""
    rng = np.random.default_rng(seed)
    u0 = np.floor(U).astype(np.int64); v0 = np.floor(V).astype(np.int64)
    umin, vmin = u0.min(), v0.min()
    tab = rng.random((u0.max() - umin + 2, v0.max() - vmin + 2)).astype(np.float32)
    iu = u0 - umin; iv = v0 - vmin
    fu = U - u0; fv = V - v0
    fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv)
    a = tab[iu, iv]; b = tab[iu + 1, iv]; c = tab[iu, iv + 1]; d = tab[iu + 1, iv + 1]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def fbm(U, V, seed, oct=4):
    s = 0; amp = 1; tot = 0
    for o in range(oct):
        s = s + amp * vnoise(U * 2 ** o, V * 2 ** o, seed + o * 17); tot += amp; amp *= 0.5
    return s / tot


def poly_sdf(Y, Z, poly):
    """Signed distance (mm) to a closed polygon; negative inside."""
    P = np.array(poly)
    d = np.full(Y.shape, 1e9, np.float32); inside = np.zeros(Y.shape, bool)
    n = len(P)
    for i in range(n):
        ay, az = P[i]; by, bz = P[(i + 1) % n]
        ey, ez = by - ay, bz - az
        t = np.clip(((Y - ay) * ey + (Z - az) * ez) / (ey * ey + ez * ez + 1e-12), 0, 1)
        dy = Y - (ay + t * ey); dz = Z - (az + t * ez)
        d = np.minimum(d, np.sqrt(dy * dy + dz * dz))
        cond = ((az > Z) != (bz > Z)) & (Y < (by - ay) * (Z - az) / (bz - az + 1e-12) + ay)
        inside ^= cond
    return np.where(inside, -d, d)


def grip_textures():
    N = 512 if FAST else 1024
    s = GUV['size']
    jj, ii = np.mgrid[0:N, 0:N].astype(np.float32)
    Y = GUV['y0'] + (ii + 0.5) / N * s
    Z = GUV['z0'] + (jj + 0.5) / N * s
    px = s / N
    outline = rpoly([GZ(-1.2, -15.5) + (2.0,), on_fb(-1.2, 2.6) + (3.5,), on_fb(-46.0, 2.6) + (3.5,), GZ(-46.0, -15.5) + (2.0,)], 6)
    sd = poly_sdf(Y, Z, outline)
    # mag release notch (left panel) – the border follows it too (mirrored panel shares the texture: keep it on both)
    dn = np.sqrt((Y - MAG_REL[0]) ** 2 + (Z - MAG_REL[1]) ** 2) - 5.7
    sd = np.maximum(sd, -dn)
    ay, az = -SR, -CR          # grip axis (down)
    py_, pz_ = CR, -SR         # across
    L = Y * ay + Z * az; W = Y * py_ + Z * pz_
    # double diamonds around the screws
    dia = np.full(Y.shape, 1e9, np.float32)
    for (sy, sz) in SCREWS:
        l0 = sy * ay + sz * az; w0 = sy * py_ + sz * pz_
        dia = np.minimum(dia, np.abs(L - l0) / 12.5 + np.abs(W - w0) / 8.0)
    # checkering: two families of grooves at +-30 deg to the grip axis, 1.25 mm pitch
    pitch = 1.25; th = math.radians(30)
    h = np.ones(Y.shape, np.float32)
    fam = []
    for sg in (1, -1):
        nl = math.cos(th) * 0 + math.sin(th) * sg; nw = math.cos(th)
        d = (L * math.sin(th) * sg + W * math.cos(th)) / pitch
        fam.append(2 * np.abs(d - np.round(d)))
    pyr = np.minimum(1.0, np.minimum(fam[0], fam[1]) / 0.9)
    checker = (sd < -3.2) & (dia > 1.18)
    h = np.where(checker, pyr, 1.0)
    # border grooves around the checkered field and the diamonds
    g1 = np.clip(np.abs(sd + 2.75) / 0.35, 0, 1)
    gd = np.clip(np.abs(dia - 1.1) * 8.0 / 0.35, 0, 1)
    groove = np.minimum(g1, np.where(sd < -2.0, gd, 1.0))
    h = np.minimum(h, 0.15 + 0.85 * groove)
    depth = 0.65
    hz, hy = np.gradient(h * depth, px)
    n = np.dstack([-hy, -hz, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    save_img('pistol_grip_n', n * 0.5 + 0.5, 92)
    # walnut colour
    # figured walnut: domain-warped growth lines that swirl round a few knots, cross-grain curl, dark mineral streaks
    wq = (fbm(L / 26, W / 26, 7, 3) - 0.5) * 2
    knot = np.zeros_like(L)
    for (kl, kw, kr) in [(40.0, 38.0, 8.0), (64.0, 60.0, 6.5), (20.0, 58.0, 5.0)]:
        r2 = ((L - kl) ** 2 + ((W - kw) * 1.6) ** 2) / (kr * kr)
        knot += 5.0 * np.exp(-r2) * np.sin(np.sqrt(r2) * 2.2)
    warp = (fbm(L / 34, W / 9, 3) - 0.5) * 11 + (fbm(L / 8, W / 3, 5) - 0.5) * 2.2 + wq * 4 + knot
    rings = W + warp + 0.08 * L
    band = 0.5 + 0.5 * np.sin(rings * 2 * math.pi / 2.6)
    band = band ** 3.0
    curl = 0.5 + 0.5 * np.sin((L + (fbm(L / 20, W / 20, 13) - 0.5) * 18) * 2 * math.pi / 3.1)
    curl = curl * np.clip((fbm(L / 18, W / 12, 17) - 0.45) / 0.2, 0, 1)
    streak = fbm(L / 30, W / 0.9, 11)
    fig = fbm(L / 14, W / 14, 21)
    mineral = np.clip((fbm(L / 40, W / 1.4, 23, 3) - 0.6) / 0.12, 0, 1)
    pores = np.clip((vnoise(L / 1.6, W / 0.16, 31) - 0.76) / 0.12, 0, 1)
    dark = np.array([0.006, 0.0025, 0.0012]); mid = np.array([0.036, 0.0145, 0.0062]); light = np.array([0.088, 0.037, 0.015])
    t = np.clip(0.2 + 0.7 * streak + 0.6 * (fig - 0.5), 0, 1)[..., None]
    col = mid * (1 - t) + light * t
    col = col * (1 - 0.75 * band[..., None]) + dark * 0.75 * band[..., None]
    col *= (1 - 0.18 * curl)[..., None]
    col = col * (1 - 0.6 * mineral[..., None]) + dark * 0.6 * mineral[..., None]
    col *= (1 - 0.4 * pores)[..., None]
    shade = np.where(checker, 0.55 + 0.45 * h, 1.0) * (0.75 + 0.25 * groove)
    col *= shade[..., None]
    # hand-polished border, a little lighter and warmer
    rim = np.clip(1 - np.abs(sd + 1.2) / 1.6, 0, 1)
    col = col * (1 + 0.12 * rim[..., None])
    save_img('pistol_grip_c', col ** (1 / 2.2), 86)      # sRGB-encoded colour
    # mask: R = occlusion, G = roughness (walnut: polished tops, dull valleys), B = G10 bumps (unused here)
    occ = np.where(checker, 0.45 + 0.55 * h, 1.0) * (0.6 + 0.4 * groove)
    rough = np.where(checker, 0.62 - 0.3 * h, 0.3) + 0.08 * (streak - 0.5)
    rough = np.maximum(rough, 0.3 * (1 - groove) + 0.25)
    save_img('pistol_grip_m', np.dstack([occ, rough, np.zeros_like(occ)]), 88)
    # G10: aggressive fine stipple with a lamination drift
    g = fbm(Y / 0.55, Z / 0.55, 41, 3) * 0.7 + fbm(Y / 2.2, Z / 2.2, 43, 2) * 0.3
    g = np.where(sd < -2.2, g, 0.5 + 0.0 * g)
    hz, hy = np.gradient(g * 0.55, px)
    n = np.dstack([-hy, -hz, np.ones_like(g)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    save_img('pistol_grip_g10n', n * 0.5 + 0.5, 90)


def setup_gpu():
    SC.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dev
            try: prefs.refresh_devices()
            except Exception: prefs.get_devices()
            ok = False
            for d in prefs.devices:
                d.use = d.type == dev; ok = ok or d.use
            if ok:
                SC.cycles.device = 'GPU'; print('bake device', dev); return
        except Exception as e:
            print('gpu', dev, e)
    SC.cycles.device = 'CPU'


def bake_metal():
    setup_gpu()
    SC.cycles.samples = 16 if FAST else 96
    nt = M_STEEL.node_tree; nd = nt.nodes; ln = nt.links
    out = nd.get('Material Output')
    emi = nd.new('ShaderNodeEmission')
    ln.new(emi.outputs[0], out.inputs['Surface'])
    pos = nd.new('ShaderNodeNewGeometry')

    def math_(op, a, b=None, clamp=False):
        n = nd.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: ln.new(v, n.inputs[i])
        return n.outputs[0]

    def mrange(v, a, b, c=0.0, d=1.0):
        n = nd.new('ShaderNodeMapRange'); n.clamp = True
        ln.new(v, n.inputs['Value']); n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def noise(scale_vec, detail=2.0, rough=0.5, rot=(0, 0, 0), dim='3D', w=0.0):
        mp = nd.new('ShaderNodeMapping'); ln.new(pos.outputs['Position'], mp.inputs['Vector'])
        mp.inputs['Scale'].default_value = scale_vec; mp.inputs['Rotation'].default_value = rot
        n = nd.new('ShaderNodeTexNoise'); ln.new(mp.outputs[0], n.inputs['Vector'])
        n.inputs['Scale'].default_value = 1.0; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']

    def combine(r, g, b):
        n = nd.new('ShaderNodeCombineColor')
        for i, v in enumerate((r, g, b)):
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: ln.new(v, n.inputs[i])
        return n.outputs[0]

    sep = nd.new('ShaderNodeSeparateXYZ'); ln.new(pos.outputs['Position'], sep.inputs[0])
    Yp, Zp = sep.outputs['Y'], sep.outputs['Z']
    # ---- convex edge mask (bevel normal vs true normal, kept only where the surface is not in a crevice)
    bev = nd.new('ShaderNodeBevel'); bev.samples = 8; bev.inputs['Radius'].default_value = 0.8
    dot = nd.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    ln.new(bev.outputs[0], dot.inputs[0]); ln.new(pos.outputs['Normal'], dot.inputs[1])
    edge = mrange(dot.outputs['Value'], 0.995, 0.86)
    aol = nd.new('ShaderNodeAmbientOcclusion'); aol.only_local = True; aol.samples = 16; aol.inputs['Distance'].default_value = 1.2
    convex = math_('MULTIPLY', edge, mrange(aol.outputs['AO'], 0.72, 0.95))
    brk = mrange(noise((0.9, 0.9, 0.9), 4.0, 0.62), 0.32, 0.72, 0.25, 1.25)
    wear = math_('MULTIPLY', convex, brk, True)
    # fine handling scratches: long thin streaks along the gun's axis (holster / hand), a few off-axis, sparse
    sc_total = None
    for k, (rot, sc, lo, amp) in enumerate([((0, 0, 0.0), (4.0, 0.03, 4.0), 0.765, 0.9), ((0, 0, 0.04), (5.5, 0.045, 5.5), 0.77, 0.7),
                                            ((0.04, 0, -0.06), (3.2, 0.025, 3.2), 0.775, 0.8), ((0, 0, 0.6), (4.0, 0.07, 4.0), 0.79, 0.35)]):
        mp = nd.new('ShaderNodeMapping'); ln.new(pos.outputs['Position'], mp.inputs['Vector'])
        mp.inputs['Rotation'].default_value = rot; mp.inputs['Scale'].default_value = sc
        nz = nd.new('ShaderNodeTexNoise'); ln.new(mp.outputs[0], nz.inputs['Vector'])
        nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 0.0
        line = mrange(nz.outputs['Fac'], lo, lo + 0.02)
        gate = mrange(noise((0.1, 0.1, 0.1), 2.0, 0.5, (k, k * 2, 0)), 0.45, 0.65)
        s_ = math_('MULTIPLY', math_('MULTIPLY', line, gate), amp)
        sc_total = s_ if sc_total is None else math_('MAXIMUM', sc_total, s_)
    scratches = math_('MULTIPLY', sc_total, 0.6, True)
    wear_c = math_('MAXIMUM', wear, scratches)
    # ---- occlusion (whole gun), handling zones, mottling
    ao = nd.new('ShaderNodeAmbientOcclusion'); ao.samples = 16; ao.inputs['Distance'].default_value = 4.0
    aof = mrange(ao.outputs['AO'], 0.0, 1.0)
    front = math_('MULTIPLY', mrange(Yp, 172.0, 204.0), 0.8)
    Xa = math_('ABSOLUTE', sep.outputs['X'])
    rear = math_('MULTIPLY', math_('MULTIPLY', mrange(Yp, 38.0, 20.0), mrange(Zp, -1.0, 3.0)), mrange(Xa, 9.0, 11.0))
    gripz = mrange(Zp, -30.0, -95.0, 0.0, 0.45)
    nsep = nd.new('ShaderNodeSeparateXYZ'); ln.new(pos.outputs['Normal'], nsep.inputs[0])
    fstrap = math_('MULTIPLY', math_('MULTIPLY', mrange(nsep.outputs['Y'], 0.45, 0.8), mrange(Zp, -16.0, -24.0)), mrange(Yp, 82.0, 79.0, 0.0, 0.85))
    gripz = math_('MAXIMUM', gripz, fstrap)
    zone = math_('MULTIPLY', math_('MAXIMUM', math_('MAXIMUM', front, rear), gripz), mrange(noise((0.18, 0.18, 0.18), 3.0, 0.6), 0.3, 0.75, 0.2, 1.2), True)
    mottle = mrange(noise((0.06, 0.06, 0.06), 3.0, 0.55), 0.25, 0.75)
    # ---- brushing streaks along the slide (Y)
    brush = mrange(noise((7.0, 0.08, 7.0), 3.0, 0.65), 0.2, 0.8)

    def bake_to(name, size, socket):
        img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color'
        tn = nd.new('ShaderNodeTexImage'); tn.image = img
        for n in nd: n.select = False
        tn.select = True; nd.active = tn
        ln.new(socket, emi.inputs['Color'])
        select_only(STEEL_OBS)
        bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
        a = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(a)
        a = a.reshape(size, size, 4)[..., :3]
        nd.remove(tn)
        return a

    big = 1024 if FAST else 2048
    a = bake_to('w', big, combine(wear_c, wear_c, wear_c)); save_img('pistol_wear', a, 88)
    a = bake_to('o', 1024, combine(aof, zone, mottle)); save_img('pistol_occ', a, 88)
    a = bake_to('b', 1024, combine(brush, brush, brush)); save_img('pistol_brush', a, 84)
    # restore a plain material for export
    for n in list(nd):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'): nd.remove(n)
    ln.new(nd.get('Principled BSDF').outputs[0], out.inputs['Surface'])


grip_textures()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'pistol_prebake.blend'))
if not NOBAKE:
    bake_metal()

# polished bright steel where light should catch inside the port: barrel hood + chamber, feed ramp, follower
# (assigned after the bake so these faces still carry the shared wear/occlusion atlas)
M_BRIGHT = mat('Bright', (0.6, 0.6, 0.6, 1), 1.0, 0.2)


def brighten(ob, pred):
    ob.data.materials.append(M_BRIGHT); idx = len(ob.data.materials) - 1; n = 0
    for poly in ob.data.polygons:
        if pred(poly.center, poly.normal): poly.material_index = idx; n += 1
    print('bright', ob.name, n)


brighten(barrel, lambda c, n: c.y < BF + 23.0)
brighten(frame, lambda c, n: 74.0 < c.y < 81.6 and -3.9 < c.z < 0.3 and abs(c.x) < 4.5 and n.z > 0.3 and n.y < -0.25)
brighten(mag, lambda c, n: True)   # stainless magazine body + follower
for p in mag.data.polygons:      # the base pad (below the frame's bottom line) stays black
    if p.center.z < zfb(p.center.y) - 0.6: p.material_index = 1

# ================================================================= origins, hierarchy, units
F = Vector((0, TRIG_Y, TRIG_Z))


def set_origin(ob, piv):
    piv = Vector(piv)
    ob.data.transform(Matrix.Translation(-piv)); ob.location = piv


def empty(name, loc):
    e = bpy.data.objects.new(name, None); COLL.objects.link(e); e.location = Vector(loc); e.empty_display_size = 2
    return e


set_origin(barrel, (0, BARREL_PIV_Y, BZ))
set_origin(hammer, (0, HAMMER_PIV[0], HAMMER_PIV[1]))
set_origin(trigger, F)
set_origin(sstop, (-12.5, SS_PIV[0], SS_PIV[1]))
set_origin(gsafe, (0, GS_PIV[0], GS_PIV[1]))
mag_top_c = Vector((0, (GZ(0.0, MAG_TOP)[0] + GZ(-33.8, MAG_TOP)[0]) / 2, MAG_TOP))
set_origin(mag, mag_top_c)
for ob in (frame, slide, grips, screws): set_origin(ob, F)
set_origin(casing, (0, CASE_L / 2, 0)); set_origin(rnd, (0, OAL / 2, 0))
mag_round = bpy.data.objects.new('MagRound', rnd.data); COLL.objects.link(mag_round)
mag_round.location = mag_round_c + Vector((0, OAL / 2, 0))
ch_round = bpy.data.objects.new('ChamberRound', rnd.data); COLL.objects.link(ch_round)
ch_round.location = ch_round_c + Vector((0, OAL / 2, 0))

root = empty('Pistol', F)
muzzle = empty('Muzzle', (0, SL + 0.3, BZ))
port = empty('Port', (HW, BF + 18.0, 12.8))
rsight = empty('RearSight', (0, 10.4, 31.4))   # notch centre at the rear sight's top line
fsight = empty('FrontSight', (0, 194.55, 31.4))

# world positions in mm (design frame) -> metres around the finger point
ALL = [root, frame, grips, screws, gsafe, slide, barrel, hammer, trigger, sstop, mag, mag_round, ch_round, muzzle, port, rsight, fsight, casing, rnd]
for ob in ALL:
    if ob.type == 'MESH' and ob.data.users == 1 or ob in (rnd,):
        pass
meshes_done = set()
for ob in ALL:
    if ob.type == 'MESH' and ob.data.name not in meshes_done:
        ob.data.transform(Matrix.Scale(0.001, 4)); meshes_done.add(ob.data.name)
    ob.location = (ob.location - F) * 0.001
casing.location = Vector((0.09, 0.0, 0.05)); rnd.location = Vector((0.13, 0.0, 0.05))

PARENT = {frame: root, grips: root, screws: grips, gsafe: root, slide: root, barrel: root, hammer: root, trigger: root,
          sstop: root, mag: root, mag_round: mag, ch_round: barrel, muzzle: root, port: slide, rsight: slide, fsight: slide}
world = {ob: ob.location.copy() for ob in ALL}
for ch, par in PARENT.items():
    ch.parent = par; ch.matrix_parent_inverse = Matrix.Identity(4); ch.location = world[ch] - world[par]

# ================================================================= stats + export
tri = {ob.name: tris(ob) for ob in ALL if ob.type == 'MESH'}
total = sum(v for k, v in tri.items() if k not in ('MagRound', 'ChamberRound', 'Round', 'Casing')) + tri['Round'] * 3 + tri['Casing']
gl = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def dirgl(v):
    v = Vector(v).normalized(); return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


info = {
    'tris': tri, 'tris_drawn_total': total,
    'SLIDE_TRAVEL': SLIDE_TRAVEL / 1000, 'TRIGGER_TRAVEL': 0.004, 'HAMMER_FALL': -HAMMER_COCK,
    'SLIDE_STOP_UP': SS_LIFT, 'BARREL_TILT': round(math.atan2(1.4, BARREL_PIV_Y - BF), 4),
    'MAG_AXIS': dirgl((0, -SR, -CR)), 'PORT_DIR': dirgl((1.0, -0.25, 0.55)),
    'BORE_Y': round((BZ - TRIG_Z) / 1000, 5), 'MUZZLE_Z': round(-(SL + 0.3 - TRIG_Y) / 1000, 5),
    'muzzle': gl(world[muzzle]), 'rear_sight': gl(world[rsight]), 'front_sight': gl(world[fsight]),
    'overall_mm': [round(-15.0, 1), SL], 'mag_top': gl(world[mag]),
}
# hammer angle that lays it under the slide at full travel (extra cocking past the rest pose)
hv = [v.co.copy() for v in hammer.data.vertices]
best = 0
ylim = (-SLIDE_TRAVEL - TRIG_Y) / 1000; zlim = (0.0 - TRIG_Z) / 1000 - 0.0003
for k in range(0, 200):
    a = k * 0.01
    R = Matrix.Rotation(a, 3, 'X')
    pts_ = [(R @ v) + world[hammer] for v in hv]
    top = max([p.z for p in pts_ if p.y > ylim] or [-1])
    if top < zlim: best = a; break
info['HAMMER_BACK'] = round(best, 3)
print(json.dumps(info, indent=1))
with open(os.path.join(WORK, 'pistol_info.json'), 'w') as f: json.dump(info, f, indent=1)

for ob in ALL:
    if ob.type == 'MESH' and ob.data.validate(clean_customdata=False): print('cleaned', ob.name)
path = os.path.join(OUT, 'pistol.glb')
want = dict(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
            export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
            export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
            export_draco_position_quantization=14, export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12, export_draco_generic_quantization=12, export_image_format='NONE')
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
print('exported', path, os.path.getsize(path))
