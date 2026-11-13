// Procedural double-action revolver (vent rib, full underlug, swing-out cylinder).
// Gun space: metres, +X right, +Y up, -Z toward the muzzle. Root origin = trigger-finger point,
// so twirling the gun around the finger is just root.rotation.x.
import * as THREE from 'three';

const BORE_Y = 0.040, CYL_R = 0.0205, CYL_LEN = 0.040, CH_R = 0.0128, HOLE_R = 0.0049;
const CYL_Y = BORE_Y - CH_R, CYL_Z = -0.016;
const FRAME_W = 0.024, BARREL_R = 0.0088, BARREL_Z0 = -0.044, MUZZLE_Z = -0.192;
const HINGE = new THREE.Vector2(-0.011, 0.0062);
const FINGER = new THREE.Vector3(0, -0.010, -0.001);
export const OPEN_ANGLE = 1.62;
export const STEP = Math.PI / 3;

const FINISHES = {
  blued: { color: 0x1c222b, roughness: 0.24, clearcoat: 0.35 },
  nickel: { color: 0xdcd6cc, roughness: 0.13, clearcoat: 0 },
  stainless: { color: 0xb8b4ac, roughness: 0.3, clearcoat: 0 },
};
const WOODS = {
  walnut: ['#2c1a10', '#5a3720', '#7b4d2a'],
  rosewood: ['#1d0c08', '#46190f', '#6a2a18'],
  honey: ['#5a3a1e', '#8a5a2e', '#b07a42'],
};

// Profile given as [z, y] pairs in gun space, extruded across X and centred.
function sideExtrude(pts, width, bevel = 0.0012, holes = [], seg = 3) {
  const v = ([z, y]) => new THREE.Vector2(-z, y);
  const shape = new THREE.Shape(pts.map(v));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(v)));
  const depth = Math.max(width - 2 * bevel, 0.0004);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// Smooth corners of a polyline by Chaikin subdivision (keeps the code free of hand-placed curves).
function smooth(pts, n = 2, closed = true) {
  let p = pts;
  for (let k = 0; k < n; k++) {
    const out = [];
    const m = closed ? p.length : p.length - 1;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function noise2(seed) {
  const r = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = r(xi, yi), b = r(xi + 1, yi), c = r(xi, yi + 1), d = r(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}

function woodTexture(cols) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), n = noise2(3), n2 = noise2(9);
  const c = cols.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const warp = n(x / 90, y / 260) * 9 + n2(x / 30, y / 40) * 1.5;
    let g = Math.sin((x / S) * 52 + warp) * 0.5 + 0.5;
    g = Math.pow(g, 2.2) * 0.8 + n2(x / 3, y / 60) * 0.2;
    const fig = n(x / 40, y / 25);
    const t = Math.min(1, Math.max(0, g * 0.75 + fig * 0.35));
    const lo = t < 0.5 ? c[0] : c[1], hi = t < 0.5 ? c[1] : c[2], f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const i = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) img.data[i + k] = lo[k] + (hi[k] - lo[k]) * f;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16;
  return t;
}

// Diamond checkering as a tangent-space normal map.
function checkerNormal() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), P = 16;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = ((x + y) % P) / P - 0.5, v = ((x - y + S) % P) / P - 0.5;
    const nx = (u > 0 ? 1 : -1) * (Math.abs(u) > Math.abs(v) ? 0.55 : 0.15);
    const ny = (v > 0 ? 1 : -1) * (Math.abs(v) >= Math.abs(u) ? 0.55 : 0.15);
    const i = (y * S + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = 230; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Cartridge head: brushed brass, primer pocket ring, stamped headstamp.
function headTexture() {
  const S = 1024, K = S / 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 10 * K, S / 2, S / 2, S / 2);
  grd.addColorStop(0, '#d9b45e'); grd.addColorStop(0.7, '#c49a45'); grd.addColorStop(1, '#a87d34');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.18;
  for (let a = 0; a < 360; a += 1.5 / K) {
    g.strokeStyle = Math.random() > 0.5 ? '#fff3c4' : '#6b4a1a';
    g.beginPath(); g.arc(S / 2, S / 2, (40 + Math.random() * 85) * K, a * Math.PI / 180, (a + 4) * Math.PI / 180); g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(60,40,10,.75)'; g.lineWidth = 5 * K; g.beginPath(); g.arc(S / 2, S / 2, 50 * K, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(70,45,12,.85)'; g.font = `600 ${26 * K}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const stamp = ['R', '·', 'P', ' ', '3', '5', '7', ' ', 'M', 'A', 'G'];
  stamp.forEach((ch, i) => {
    const a = -Math.PI / 2 + (i - (stamp.length - 1) / 2) * 0.27;
    g.save(); g.translate(S / 2 + Math.cos(a) * 88 * K, S / 2 + Math.sin(a) * 88 * K); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

function cylinderGeometry() {
  const shape = new THREE.Shape(), N = 288;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Flutes sit between chambers (30deg offset); smooth cosine dip.
    const d = Math.abs(((a + Math.PI / 6) % STEP) - STEP / 2);
    const dip = d < 0.2 ? (Math.cos((d / 0.2) * Math.PI) * 0.5 + 0.5) * 0.0024 : 0;
    const r = CYL_R - dip, x = Math.sin(a) * r, y = Math.cos(a) * r;
    i ? shape.lineTo(x, y) : shape.moveTo(x, y);
  }
  for (let i = 0; i < 6; i++) {
    const h = new THREE.Path();
    h.absarc(Math.sin(i * STEP) * CH_R, Math.cos(i * STEP) * CH_R, HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const ctr = new THREE.Path(); ctr.absarc(0, 0, 0.0026, 0, Math.PI * 2, true); shape.holes.push(ctr);
  const g = new THREE.ExtrudeGeometry(shape, { depth: CYL_LEN - 0.0016, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0007, bevelSegments: 3, curveSegments: 56 });
  g.translate(0, 0, -(CYL_LEN - 0.0016) / 2);
  return g;
}

const zCyl = (r, len, seg = 64) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

export function createRevolver({ finish = 'blued', wood = 'walnut' } = {}) {
  const F = FINISHES[finish] || FINISHES.blued;
  const steel = new THREE.MeshPhysicalMaterial({ color: F.color, metalness: 1, roughness: F.roughness, clearcoat: F.clearcoat, clearcoatRoughness: 0.18 });
  const steelSatin = steel.clone(); steelSatin.roughness = Math.min(0.6, F.roughness + 0.18);
  const dark = new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.6, roughness: 0.55 });
  const woodMap = woodTexture(WOODS[wood] || WOODS.walnut);
  woodMap.repeat.set(9, 9); woodMap.rotation = 1.37;
  const checker = checkerNormal(); checker.repeat.set(60, 60);
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodMap, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.28, normalMap: checker, normalScale: new THREE.Vector2(0.55, 0.55) });
  // Case heads face the player, who has little behind them to reflect, so they get extra env light.
  const brass = new THREE.MeshPhysicalMaterial({ map: headTexture(), metalness: 0.9, roughness: 0.24, color: 0xffffff, envMapIntensity: 2.4 });
  const brassSide = new THREE.MeshPhysicalMaterial({ color: 0xc89c4a, metalness: 1, roughness: 0.3, envMapIntensity: 1.8 });
  const primer = new THREE.MeshPhysicalMaterial({ color: 0xcfc6b8, metalness: 1, roughness: 0.32, envMapIntensity: 2.2 });
  const primerFired = new THREE.MeshPhysicalMaterial({ color: 0x7d6a55, metalness: 1, roughness: 0.55 });
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd8b25c, metalness: 1, roughness: 0.22 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3121b, roughness: 0.35, emissive: 0x2a0000 });

  const root = new THREE.Group(); root.name = 'revolver';
  const model = new THREE.Group(); model.position.copy(FINGER).negate(); root.add(model);
  const add = (geo, mat, parent = model) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

  // Frame with the cylinder window cut through it.
  const frameOuter = smooth([
    [-0.046, 0.0555], [0.004, 0.0555], [0.007, 0.052], [0.014, 0.0475], [0.021, 0.0445],
    [0.027, 0.040], [0.031, 0.031], [0.033, 0.019], [0.034, 0.006], [0.036, -0.008], [0.038, -0.016],
    [0.020, -0.016], [0.012, -0.007], [0.008, -0.001], [0.002, 0], [-0.046, 0], [-0.046, 0.02],
  ], 2);
  const windowHole = smooth([[-0.0365, 0.0063], [0.0047, 0.0063], [0.0047, 0.049], [-0.0365, 0.049]], 1);
  add(sideExtrude(frameOuter, FRAME_W, 0.0016, [windowHole], 4), steel);

  // Trigger guard ring.
  const ring = [], hole = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    ring.push([-0.004 + Math.cos(a) * 0.0205, -0.013 + Math.sin(a) * 0.0152]);
    hole.push([-0.004 + Math.cos(a) * 0.0168, -0.0128 + Math.sin(a) * 0.0117]);
  }
  add(sideExtrude(ring, 0.0085, 0.0014, [hole]), steel);

  // Barrel with crowned muzzle, dark bore.
  const bl = BARREL_Z0 - MUZZLE_Z;
  const lathe = new THREE.LatheGeometry([
    new THREE.Vector2(0.0047, 0), new THREE.Vector2(0.0074, 0), new THREE.Vector2(0.0085, 0.0009), new THREE.Vector2(BARREL_R, 0.0024), new THREE.Vector2(BARREL_R, bl),
  ], 96).rotateX(-Math.PI / 2).translate(0, BORE_Y, MUZZLE_Z);
  add(lathe, steel);
  add(zCyl(0.0047, bl, 48).translate(0, BORE_Y, MUZZLE_Z + bl / 2), dark);

  // Ventilated rib: top plate on posts.
  const ribTop = BORE_Y + BARREL_R + 0.0052;
  add(new THREE.BoxGeometry(0.0078, 0.0024, bl - 0.002).translate(0, ribTop - 0.0012, MUZZLE_Z + bl / 2 + 0.001), steelSatin);
  for (let i = 0; i < 6; i++) {
    const z = BARREL_Z0 - 0.006 - i * ((bl - 0.014) / 5);
    add(new THREE.BoxGeometry(0.0062, 0.0046, 0.0075).translate(0, ribTop - 0.0035, z - 0.003), steel);
  }
  // Front sight ramp with red insert, rear sight blades.
  add(sideExtrude([[MUZZLE_Z + 0.003, ribTop], [MUZZLE_Z + 0.003, ribTop + 0.0068], [MUZZLE_Z + 0.009, ribTop + 0.0068], [MUZZLE_Z + 0.027, ribTop]], 0.0034, 0.0004), steel);
  add(new THREE.BoxGeometry(0.0036, 0.0028, 0.0045).translate(0, ribTop + 0.0047, MUZZLE_Z + 0.0085), red);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.0042, 0.0052, 0.009).translate(sx * 0.0035, 0.058, 0.0), steelSatin);

  // Full-length underlug (ejector shroud).
  const lugS = new THREE.Shape();
  const lw = 0.0074, lb = CYL_Y - 0.0105, lr = 0.0058;
  lugS.moveTo(-lw, BORE_Y); lugS.lineTo(-lw, lb + lr); lugS.quadraticCurveTo(-lw, lb, -lw + lr, lb);
  lugS.lineTo(lw - lr, lb); lugS.quadraticCurveTo(lw, lb, lw, lb + lr); lugS.lineTo(lw, BORE_Y); lugS.closePath();
  const lugLen = BARREL_Z0 - MUZZLE_Z - 0.012 + 0.006;
  const lug = new THREE.ExtrudeGeometry(lugS, { depth: lugLen, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0028, bevelSegments: 5, curveSegments: 20 });
  lug.translate(0, 0, MUZZLE_Z + 0.012);
  add(lug, steel);

  // Grip panels (wood, rounded) + medallion.
  const gripPts = smooth([
    [0.011, -0.003], [0.015, -0.03], [0.020, -0.06], [0.025, -0.088], [0.029, -0.101], [0.040, -0.106],
    [0.055, -0.103], [0.058, -0.091], [0.053, -0.062], [0.046, -0.032], [0.041, -0.01], [0.038, 0.006], [0.034, 0.016], [0.027, 0.008], [0.02, 0.0],
  ], 2);
  add(sideExtrude(gripPts, 0.0315, 0.0062, [], 6), woodMat);
  for (const sx of [-1, 1]) add(zCyl(0.0045, 0.0012, 64).rotateY(Math.PI / 2).translate(sx * 0.0162, -0.022, 0.026), gold);

  // Hammer (pivots back when cocked: +rotation.x).
  const hammer = new THREE.Group(); hammer.position.set(0, 0.034, 0.02); model.add(hammer);
  add(sideExtrude(smooth([[0.004, -0.006], [-0.002, 0.012], [-0.001, 0.02], [0.006, 0.023], [0.018, 0.022], [0.021, 0.018], [0.012, 0.012], [0.008, -0.006]], 1), 0.0068, 0.0009), steelSatin, hammer);
  // Trigger (pulled: -rotation.x).
  const trigger = new THREE.Group(); trigger.position.set(0, 0.001, -0.003); model.add(trigger);
  add(sideExtrude(smooth([[-0.002, 0.001], [-0.004, -0.007], [-0.003, -0.015], [0.001, -0.021], [0.004, -0.02], [0.002, -0.011], [0.003, -0.002]], 1), 0.0062, 0.0008), steelSatin, trigger);

  // Cylinder release latch and side-plate screws.
  add(new THREE.BoxGeometry(0.003, 0.006, 0.011).translate(-FRAME_W / 2 - 0.001, 0.034, 0.012), steelSatin);
  for (const [z, y] of [[0.018, 0.034], [0.024, 0.006], [-0.006, -0.003]]) add(zCyl(0.0021, 0.0008, 32).rotateY(Math.PI / 2).translate(FRAME_W / 2 + 0.0002, y, z), steelSatin);

  // Crane + cylinder assembly.
  const crane = new THREE.Group(); crane.position.set(HINGE.x, HINGE.y, CYL_Z); model.add(crane);
  const toAxis = new THREE.Vector2(-HINGE.x, CYL_Y - HINGE.y);
  const arm = add(new THREE.BoxGeometry(0.0085, toAxis.length() + 0.006, 0.0042), steel, crane);
  arm.position.set(toAxis.x / 2, toAxis.y / 2, -CYL_LEN / 2 - 0.0026); arm.rotation.z = -Math.atan2(toAxis.x, toAxis.y);
  add(zCyl(0.0031, CYL_LEN + 0.006, 32), steel, crane);
  const cylinder = new THREE.Group(); cylinder.position.set(toAxis.x, toAxis.y, 0); crane.add(cylinder);
  add(cylinderGeometry(), steel, cylinder);
  add(zCyl(0.0027, 0.058, 32).translate(0, 0, -CYL_LEN / 2 - 0.029), steel, cylinder);
  add(zCyl(0.0034, 0.0065, 40).translate(0, 0, -CYL_LEN / 2 - 0.058), steelSatin, cylinder);
  // Ejector star on the rear face.
  const star = new THREE.Shape();
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, r = i % 2 ? 0.0115 : 0.0072; const x = Math.sin(a) * r, y = Math.cos(a) * r; i ? star.lineTo(x, y) : star.moveTo(x, y); }
  add(new THREE.ExtrudeGeometry(star, { depth: 0.0007, bevelEnabled: false }).translate(0, 0, CYL_LEN / 2 - 0.0005), steelSatin, cylinder);

  const headGeo = zCyl(0.00575, 0.0011, 96), caseGeo = zCyl(0.0047, CYL_LEN - 0.002, 48), primerGeo = zCyl(0.0021, 0.0004, 64);
  // Cap UVs face the camera: rotate so the headstamp reads upright.
  const cartridges = [], primers = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    c.position.set(Math.sin(i * STEP) * CH_R, Math.cos(i * STEP) * CH_R, 0);
    const head = add(headGeo, [brassSide, brass, brass], c); head.position.z = CYL_LEN / 2 + 0.0002; head.rotation.z = -i * STEP;
    add(caseGeo, brassSide, c);
    const p = add(primerGeo, primer, c); p.position.z = CYL_LEN / 2 + 0.0007;
    cylinder.add(c); cartridges.push(c); primers.push(p);
  }

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, BORE_Y, MUZZLE_Z - 0.002); model.add(muzzle);
  const gap = new THREE.Object3D(); gap.position.set(0, BORE_Y, -0.0375); model.add(gap);

  return {
    root, crane, cylinder, hammer, trigger, muzzle, gap, cartridges,
    dims: { BORE_Y: BORE_Y - FINGER.y, MUZZLE_Z: MUZZLE_Z - FINGER.z, CYL_R, CH_R },
    setFired(i, fired) { primers[i].material = fired ? primerFired : primer; primers[i].scale.set(1, 1, fired ? 0.5 : 1); },
    setLoaded(i, loaded) { cartridges[i].visible = loaded; },
    setFinish(name) { const f = FINISHES[name] || FINISHES.blued; for (const m of [steel, steelSatin]) { m.color.setHex(f.color); m.clearcoat = f.clearcoat; } steel.roughness = f.roughness; steelSatin.roughness = Math.min(0.6, f.roughness + 0.18); },
    setWood(name) { const old = woodMat.map; woodMat.map = woodTexture(WOODS[name] || WOODS.walnut); woodMat.map.repeat.copy(old.repeat); woodMat.map.rotation = old.rotation; old.dispose(); woodMat.needsUpdate = true; },
  };
}
