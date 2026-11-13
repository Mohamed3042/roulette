// Range mode: a semi-auto .45 on an indoor shooting range built in code. Fire until the slide locks back, reload,
// fire again. Targets sit at real distances (paper at 5, 10 and 15 m, a steel plate rack, bottles and cans on a
// plank, a spinner), so they move with real parallax. World: metres, eye at the origin, -Z downrange.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPistol, SLIDE_TRAVEL, TRIGGER_TRAVEL, HAMMER_FALL, HAMMER_BACK, SLIDE_STOP_UP, GRIP_SAFETY_IN, BARREL_TILT, MAG_AXIS, PORT_DIR, MAG_SIZE, LOOKS } from './pistol.js';
import { createTarget } from './target.js';

export { LOOKS as PISTOL_LOOKS };
export const TARGET_SETS = [
  { id: 'paper', name: 'Paper', note: 'Bullseyes at 5, 10 and 15 m' },
  { id: 'steel', name: 'Steel plates', note: 'Five plates that ring and fall' },
  { id: 'bottles', name: 'Bottles and cans', note: 'On a plank at 6 m' },
  { id: 'spinner', name: 'Spinner', note: 'Spins when you hit a paddle' },
];

export const FLOOR_Y = -1.55;
const CEIL_Y = 1.3, HALF_W = 3.2, BACK_Z = -18.2, BERM_Z = -15.9;
const SHELF_Y = -0.3, SHELF = { x0: -0.8, x1: 0.8, z0: -0.76, z1: -0.12 };
const BOOTH_X = 0.84, BOOTH_Z = [0.5, -1.2];
const PLANK = { x: -1.55, z: -6, y: -0.95, len: 1.2, d: 0.22 };
const RACK = { x: 1.45, z: -8.2, y: -0.78 };
const SPIN = { x: -2.05, z: -12, y: -0.5 };
const PAPERS = [{ x: -0.42, z: -5, y: 0.2, size: 1.2 }, { x: 0.55, z: -10, y: 0.24, size: 2.1 }, { x: -0.14, z: -15, y: 0.28, size: 3 }];
const MUZZLE_V = 260;   // m/s, a .45 ACP: the hit lands a beat after the shot at 15 m

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- canvas textures (no downloads)
function tileNoise(S, cells, seed) {
  // Tileable value noise: a wrapped random grid, smoothstep-interpolated.
  let s = seed | 0; const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 8) & 0xffff) / 65535; };
  const grid = Float32Array.from({ length: cells * cells }, rnd), out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const gy = (y / S) * cells, y0 = Math.floor(gy), ty = gy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % cells;
    for (let x = 0; x < S; x++) {
      const gx = (x / S) * cells, x0 = Math.floor(gx), tx = gx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cells;
      const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1], c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
      out[y * S + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
function pixels(S, fn, { srgb = true, aniso = 8 } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const c = fn(i % S, (i / S) | 0, i); d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c[3] ?? 255; }
  g.putImageData(img, 0, 0);
  return finish(cv, srgb, aniso);
}
function painted(w, h, draw, { srgb = true, aniso = 8 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  return finish(cv, srgb, aniso);
}
function finish(cv, srgb, aniso) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rgb = (v, r, g, b) => [Math.min(255, v * r), Math.min(255, v * g), Math.min(255, v * b)];

function makeTextures() {
  const S = 512;
  const n4 = tileNoise(S, 4, 7), n16 = tileNoise(S, 16, 11), n64 = tileNoise(S, 64, 23), n6 = tileNoise(S, 6, 31);
  const concrete = pixels(S, (x, y, i) => {
    const stain = Math.max(0, n6[i] - 0.55) * 1.4;
    const v = (0.5 + (n4[i] - 0.5) * 0.22 + (n16[i] - 0.5) * 0.14 + (n64[i] - 0.5) * 0.12 + (Math.random() - 0.5) * 0.09 - stain * 0.35) * 255;
    return rgb(v, 0.98, 0.93, 0.86);
  });
  const block = pixels(S, (x, y, i) => {
    // Painted concrete block, 4 courses by 2 blocks per tile, offset every other course.
    const row = Math.floor(y / 128), bx = (x + (row % 2) * 128) % 256, by = y % 128;
    const mortar = bx < 5 || by < 5 ? 0.8 : 1;
    const v = (0.55 + (n16[i] - 0.5) * 0.08 + (n64[i] - 0.5) * 0.1 + (Math.random() - 0.5) * 0.06) * mortar * 255;
    return rgb(v, 0.93, 0.88, 0.8);
  });
  const wood = pixels(S, (x, y, i) => {
    // Straight grain along u, boards 1/4 of the tile wide, each board a slightly different tone.
    const board = Math.floor(y / 128), tone = [0, 0.06, -0.04, 0.03][board];
    const yy = y + n16[i] * 6 + n4[i] * 10;
    const grain = Math.pow(Math.abs(Math.sin(yy * 0.55 + Math.sin(x * 0.012 + board) * 2.2)), 6);
    const seam = y % 128 < 2 ? 0.55 : 1;
    const v = (0.5 + tone - grain * 0.12 + (n64[(y * S + ((x * 4) % S))] - 0.5) * 0.08 + (Math.random() - 0.5) * 0.04) * seam * 255;
    return rgb(v, 0.98, 0.74, 0.5);
  });
  const rubber = pixels(256, (x, y, i) => {
    const v = (0.13 + Math.random() * 0.1 + (Math.random() < 0.05 ? 0.12 : 0) + (n16[(y * 2) * S + x * 2] - 0.5) * 0.08) * 255;
    return rgb(v, 1, 0.86, 0.72);
  });
  const felt = pixels(256, (x, y, i) => {
    const v = (0.2 + (n64[(y * 2) * S + x * 2] - 0.5) * 0.07 + (Math.random() - 0.5) * 0.06 + (x % 64 < 2 ? -0.06 : 0)) * 255;
    return rgb(v, 0.9, 0.88, 0.86);
  });
  const fabric = pixels(256, (x, y, i) => {
    // Acoustic panel cloth: a fine basket weave over soft mottling.
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.035 : -0.035;
    const v = (0.27 + weave + (n16[(y * 2) * S + x * 2] - 0.5) * 0.06 + (Math.random() - 0.5) * 0.05) * 255;
    return rgb(v, 0.92, 0.9, 0.88);
  });
  const mat = pixels(256, (x, y, i) => {
    // Rubber bench mat: fine pebble grain with scuffs.
    const scuff = Math.max(0, n4[(y * 2) * S + x * 2] - 0.62) * 0.5;
    const v = (0.1 + Math.random() * 0.05 + (n64[(y * 2) * S + x * 2] - 0.5) * 0.05 + scuff) * 255;
    return rgb(v, 1, 0.97, 0.94);
  });
  return { concrete, block, wood, rubber, felt, fabric, mat };
}

// Floor paint: the firing line and the distance numbers, worn.
function floorMark(text, w = 256, h = 128) {
  return painted(w, h, (g) => {
    g.fillStyle = 'rgba(214,172,64,.92)';
    if (text) { g.font = `700 ${h * 0.82}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h * 0.56); }
    else g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 2); }
  }, { aniso: 8 });
}
function canLabel(c1, c2, c3) {
  return painted(256, 128, (g, w, h) => {
    g.fillStyle = c1; g.fillRect(0, 0, w, h);
    g.fillStyle = c2; g.fillRect(0, h * 0.18, w, h * 0.16); g.fillRect(0, h * 0.7, w, h * 0.08);
    g.fillStyle = c3; for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(w * (0.25 + i * 0.5), h * 0.52, h * 0.14, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  });
}

// ---------------------------------------------------------------- the room
function uvScale(geo, su, sv) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return geo; }
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  return geo.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
}
// Box with UVs in metres (so tiling textures keep their scale on any size).
function box(w, h, d, x, y, z, rx, ry, rz, k = 1) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [a, b] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * a * k, uv.getY(i) * b * k);
  }
  return place(g, x, y, z, rx, ry, rz);
}

export function createRange(ctx) {
  const { scene, camera, vm, lmir, mir, renderer, pmrem, fx, sound, gsap, S } = ctx;
  const reduced = ctx.reduced;
  const group = new THREE.Group(); group.name = 'range'; group.visible = false; scene.add(group);
  const room = new THREE.Group(); group.add(room);
  const T = makeTextures();

  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: T.concrete, roughness: 0.86, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ map: T.block, roughness: 0.9, metalness: 0 }),
    ceil: new THREE.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.74, metalness: 0 }),
    darkWood: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x6a4a34, roughness: 0.6, metalness: 0 }),
    // Acoustic baffles: dark cloth over rubber, framed in timber.
    baffle: new THREE.MeshStandardMaterial({ map: T.fabric, roughness: 1, metalness: 0 }),
    mat: new THREE.MeshStandardMaterial({ map: T.mat, roughness: 0.82, metalness: 0 }),
    berm: new THREE.MeshStandardMaterial({ map: T.rubber, roughness: 0.97, metalness: 0 }),
    felt: new THREE.MeshStandardMaterial({ map: T.felt, roughness: 0.96, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2c2b29, roughness: 0.45, metalness: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8c7650, roughness: 0.35, metalness: 0.9 }),
  };
  const statics = new Map(), hitMeshes = [];
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x0c0b0a });
  const add = (mat, geo) => { if (!statics.has(mat)) statics.set(mat, []); statics.get(mat).push(geo); };

  // Floor, ceiling, walls, the back wall.
  const L = -BACK_Z + 1.5, cz = (BACK_Z + 1.5) / 2;
  add(mats.floor, uvScale(place(new THREE.PlaneGeometry(HALF_W * 2, L), 0, FLOOR_Y, cz, -Math.PI / 2), HALF_W * 2 / 2.2, L / 2.2));
  add(mats.ceil, place(new THREE.PlaneGeometry(HALF_W * 2, L), 0, CEIL_Y, cz, Math.PI / 2));
  const H = CEIL_Y - FLOOR_Y;
  for (const s of [-1, 1]) add(mats.wall, uvScale(place(new THREE.PlaneGeometry(L, H), s * HALF_W, FLOOR_Y + H / 2, cz, 0, -s * Math.PI / 2), L / 1.6, H / 1.6));
  add(mats.wall, uvScale(place(new THREE.PlaneGeometry(HALF_W * 2, H), 0, FLOOR_Y + H / 2, BACK_Z, 0), HALF_W * 2 / 1.6, H / 1.6));
  add(mats.wall, uvScale(place(new THREE.PlaneGeometry(HALF_W * 2, H), 0, FLOOR_Y + H / 2, 1.5, 0, Math.PI), HALF_W * 2 / 1.6, H / 1.6));
  // The berm: a dark rubber-crumb slope across the back, with a timber kick-board at its foot.
  const bermLen = Math.hypot(BERM_Z - BACK_Z, H * 0.92), bermA = Math.atan2(H * 0.92, BERM_Z - BACK_Z);
  add(mats.berm, uvScale(place(new THREE.PlaneGeometry(HALF_W * 2, bermLen), 0, FLOOR_Y + H * 0.46, (BERM_Z + BACK_Z) / 2, -bermA), 4, 2));
  add(mats.darkWood, box(HALF_W * 2, 0.2, 0.12, 0, FLOOR_Y + 0.1, BERM_Z + 0.06, 0, 0, 0, 1.2));
  // Parts built in a panel's own frame, then moved into place as one.
  const M4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
  const at = (m, mat, geo) => add(mat, geo.applyMatrix4(m));
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc68a).multiplyScalar(0.55) });
  // Overhead safety baffles: angled acoustic panels across the range, timber-framed, a warm light strip on the lower edge.
  for (const z of [-3.4, -6.9, -10.4, -13.8]) {
    const m = M4(0, CEIL_Y - 0.34, z, -0.62, 0, 0), W = HALF_W * 2 - 0.1, D = 0.8;
    at(m, mats.baffle, box(W, 0.07, D, 0, 0, 0, 0, 0, 0, 1.5));
    for (const e of [-1, 1]) at(m, mats.darkWood, box(W + 0.02, 0.09, 0.035, 0, 0, e * (D / 2 + 0.0175), 0, 0, 0, 1.4));
    at(m, edgeMat, box(W - 0.4, 0.01, 0.014, 0, -0.04, -D / 2 - 0.02));
    for (const x of [-2.2, 0, 2.2]) add(mats.steel, box(0.012, 0.3, 0.012, x, CEIL_Y - 0.15, z + 0.2));
  }
  // Side baffles: angled acoustic panels down both walls, so a stray shot is turned toward the berm.
  // Dark cloth face, a timber frame, a brass edge on the leading side that catches the lamps.
  for (let z = -1.7; z > BERM_Z + 0.9; z -= 1.2) for (const s of [-1, 1]) {
    const ph = H * 0.66, pw = 1.08, m = M4(s * (HALF_W - 0.3), FLOOR_Y + 0.42 + ph / 2, z, 0, s * 0.5, 0);
    at(m, mats.baffle, box(0.07, ph, pw, 0, 0, 0, 0, 0, 0, 1.5));
    for (const e of [-1, 1]) at(m, mats.darkWood, box(0.09, 0.05, pw + 0.04, 0, e * (ph / 2 + 0.025), 0, 0, 0, 0, 1.4));
    at(m, mats.darkWood, box(0.09, ph + 0.1, 0.04, 0, 0, -pw / 2 - 0.02, 0, 0, 0, 1.4));
    at(m, mats.trim, box(0.095, ph + 0.1, 0.012, 0, 0, pw / 2 + 0.006));
    at(m, mats.steel, box(0.03, 0.42, 0.03, -s * 0.06, -ph / 2 - 0.21, 0));   // stand-off foot
  }
  // A steel kick plate along the foot of each wall.
  for (const s of [-1, 1]) add(mats.steel, box(0.02, 0.35, L, s * (HALF_W - 0.01), FLOOR_Y + 0.175, cz));
  // The booth: felt-covered side partitions with a timber cap and edge, a laminate shelf with a steel lip.
  for (const s of [-1, 1]) {
    add(mats.felt, box(0.06, 2.15, BOOTH_Z[0] - BOOTH_Z[1], s * BOOTH_X, FLOOR_Y + 1.075, (BOOTH_Z[0] + BOOTH_Z[1]) / 2, 0, 0, 0, 0.8));
    add(mats.darkWood, box(0.08, 0.04, BOOTH_Z[0] - BOOTH_Z[1] + 0.02, s * BOOTH_X, FLOOR_Y + 2.17, (BOOTH_Z[0] + BOOTH_Z[1]) / 2));
    add(mats.darkWood, box(0.08, 2.19, 0.04, s * BOOTH_X, FLOOR_Y + 1.095, BOOTH_Z[1]));
  }
  add(mats.felt, box(BOOTH_X * 2, SHELF_Y - 0.04 - FLOOR_Y, 0.05, 0, (SHELF_Y - 0.04 + FLOOR_Y) / 2, SHELF.z0 + 0.03, 0, 0, 0, 0.8));   // front skirt under the shelf
  const shelfMat = new THREE.MeshStandardMaterial({ map: T.wood, color: 0x9d8a74, roughness: 0.48, metalness: 0 });
  const shelf = new THREE.Mesh(box(SHELF.x1 - SHELF.x0, 0.04, SHELF.z1 - SHELF.z0, 0, SHELF_Y - 0.02, (SHELF.z0 + SHELF.z1) / 2, 0, 0, 0, 1.4), shelfMat);
  shelf.receiveShadow = true; shelf.userData.kind = 'wood'; room.add(shelf); hitMeshes.push(shelf);
  add(mats.steel, box(SHELF.x1 - SHELF.x0, 0.012, 0.02, 0, SHELF_Y + 0.004, SHELF.z0 + 0.01));
  // Neighbouring lanes: felt partitions either side, so the line reads as one booth in a row.
  for (const s of [-1, 1]) {
    const x = s * 2.5;
    add(mats.felt, box(0.06, 2.15, BOOTH_Z[0] - BOOTH_Z[1], x, FLOOR_Y + 1.075, (BOOTH_Z[0] + BOOTH_Z[1]) / 2, 0, 0, 0, 0.8));
    add(mats.darkWood, box(0.08, 2.19, 0.04, x, FLOOR_Y + 1.095, BOOTH_Z[1]));
    add(mats.darkWood, box(0.08, 0.04, BOOTH_Z[0] - BOOTH_Z[1] + 0.02, x, FLOOR_Y + 2.17, (BOOTH_Z[0] + BOOTH_Z[1]) / 2));
    add(mats.felt, box(1.6, SHELF_Y - 0.04 - FLOOR_Y, 0.05, s * 1.67, (SHELF_Y - 0.04 + FLOOR_Y) / 2, SHELF.z0 + 0.03, 0, 0, 0, 0.8));
    add(shelfMat, box(1.6, 0.04, SHELF.z1 - SHELF.z0, s * 1.67, SHELF_Y - 0.02, (SHELF.z0 + SHELF.z1) / 2, 0, 0, 0, 1.4));
  }
  // The bench: a rubber mat on the laminate, a rounded hardwood nosing on the range side.
  add(mats.mat, box(SHELF.x1 - SHELF.x0 - 0.12, 0.006, SHELF.z1 - SHELF.z0 - 0.1, 0, SHELF_Y + 0.003, (SHELF.z0 + SHELF.z1) / 2 + 0.03, 0, 0, 0, 2.5));
  add(mats.darkWood, uvScale(place(new THREE.CylinderGeometry(0.024, 0.024, SHELF.x1 - SHELF.x0 + 0.02, 16), 0, SHELF_Y - 0.018, SHELF.z0 - 0.004, 0, 0, Math.PI / 2), 1, 3));
  // Carrier control box on the right partition: two buttons.
  add(mats.steel, box(0.04, 0.14, 0.2, BOOTH_X - 0.05, SHELF_Y + 0.22, -0.55));
  for (const [y, c] of [[0.25, 0], [0.19, 1]]) add(c ? mats.trim : mats.darkWood, place(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12), BOOTH_X - 0.075, SHELF_Y + y, -0.5, 0, 0, Math.PI / 2));
  // Paper carriers: an I-beam rail per lane from the booth to the target, with the drive cable alongside.
  for (const p of PAPERS) {
    const len = -p.z + 0.4, zc = p.z / 2 - 0.2, y = CEIL_Y - 0.17;
    add(mats.steel, box(0.07, 0.008, len, p.x, y, zc));
    add(mats.steel, box(0.008, 0.06, len, p.x, y - 0.034, zc));
    add(mats.steel, box(0.07, 0.008, len, p.x, y - 0.068, zc));
    for (const s of [-1, 1]) add(wireMat, place(new THREE.CylinderGeometry(0.0025, 0.0025, len, 4), p.x + s * 0.05, y - 0.05, zc, Math.PI / 2));
    for (let z = -0.6; z > p.z; z -= 2.5) add(mats.steel, box(0.01, 0.17, 0.01, p.x, CEIL_Y - 0.085, z));
  }
  // Floor paint.
  const markMat = (t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const line = new THREE.Mesh(place(new THREE.PlaneGeometry(HALF_W * 2 - 0.2, 0.08), 0, FLOOR_Y + 0.002, BOOTH_Z[1] - 0.25, -Math.PI / 2), markMat(floorMark('', 64, 16)));
  room.add(line);
  // Lane lines down the range, between the booths.
  const laneMat = markMat(floorMark('', 64, 16)); laneMat.opacity = 0.7;
  const z0 = BOOTH_Z[1] - 0.25, z1 = BERM_Z + 0.4, lanes = [];
  for (const x of [-2.5, -0.84, 0.84, 2.5]) lanes.push(place(new THREE.PlaneGeometry(0.05, z0 - z1), x, FLOOR_Y + 0.002, (z0 + z1) / 2, -Math.PI / 2));
  room.add(new THREE.Mesh(mergeGeometries(lanes), laneMat));
  for (const [d, x] of [[5, -1.6], [10, 1.6], [15, -1.6]]) {
    const m = new THREE.Mesh(place(new THREE.PlaneGeometry(0.9, 0.45), x, FLOOR_Y + 0.002, -d, -Math.PI / 2), markMat(floorMark(String(d))));
    room.add(m);
  }

  // Lamps: pendant shades with warm bulbs that pool light on the floor, and a flood on the target line.
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd29a).multiplyScalar(14) });
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  const lamps = [];
  const pendant = (x, z, power) => {
    const y = CEIL_Y - 0.62;
    add(shadeMat, place(new THREE.CylinderGeometry(0.07, 0.24, 0.2, 24, 1, true), x, y, z));
    add(mats.steel, place(new THREE.CylinderGeometry(0.006, 0.006, 0.62, 6), x, CEIL_Y - 0.31, z));
    add(bulbMat, place(new THREE.SphereGeometry(0.045, 16, 8), x, y - 0.04, z));
    const l = new THREE.SpotLight(0xffc98f, power, 0, 0.92, 0.75, 2);
    l.position.set(x, y - 0.06, z); l.target.position.set(x, FLOOR_Y, z + 0.4); room.add(l, l.target); lamps.push(l);
    beams.push(place(new THREE.CylinderGeometry(0.2, 1.5, y - FLOOR_Y, 24, 1, true).translate(0, -(y - FLOOR_Y) / 2, 0), x, y - 0.08, z));
  };
  // Light shafts: faint additive cones in the haze under each lamp (the cinematic part, almost free).
  const beams = [];
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(0xffc68a) }, uK: { value: 0.035 } },
    vertexShader: 'varying float vH; varying vec3 vN, vV; void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uK; varying float vH; varying vec3 vN, vV; void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(uColor * uK * rim * vH * vH, 1.); }',
  });
  pendant(-1.3, -5.5, 52); pendant(1.35, -8.6, 56); pendant(-1.4, -12.1, 60);
  const shafts = new THREE.Mesh(mergeGeometries(beams), beamMat); shafts.renderOrder = 3; room.add(shafts);
  // Target lights: a long fixture under the first baffle, washing the far targets and the berm.
  add(bulbMat, box(1.6, 0.025, 0.06, 0, CEIL_Y - 0.62, -6));
  add(mats.steel, box(1.7, 0.06, 0.14, 0, CEIL_Y - 0.58, -6));
  const flood = new THREE.SpotLight(0xffe2bf, 120, 0, 0.7, 1, 2);
  flood.position.set(0, CEIL_Y - 0.66, -6.05); flood.target.position.set(0.1, -0.7, -14); room.add(flood, flood.target); lamps.push(flood);
  const ambient = new THREE.HemisphereLight(0x5f6670, 0x24170e, 1.7); room.add(ambient);

  // Merge each material's static geometry into one mesh.
  const KIND = new Map([[mats.floor, 'concrete'], [mats.wall, 'concrete'], [mats.ceil, 'concrete'], [mats.wood, 'wood'], [mats.darkWood, 'wood'], [mats.baffle, 'felt'], [mats.mat, 'felt'], [mats.trim, 'steel'], [edgeMat, 'steel'], [shelfMat, 'wood'], [wireMat, 'steel'], [mats.berm, 'berm'], [mats.felt, 'felt'], [mats.steel, 'steel'], [shadeMat, 'steel'], [bulbMat, 'steel']]);
  for (const [mat, list] of statics) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat);
    m.userData.kind = KIND.get(mat) || 'concrete'; m.matrixAutoUpdate = false; m.updateMatrix();
    room.add(m); hitMeshes.push(m);
  }

  // ---------------------------------------------------------------- targets
  const sets = { paper: new THREE.Group(), steel: new THREE.Group(), bottles: new THREE.Group(), spinner: new THREE.Group() };
  for (const g of Object.values(sets)) group.add(g);
  const tgtHit = [];   // meshes that are targets (counted as hits)
  const mark = (m, kind, extra = {}) => { m.userData.kind = kind; Object.assign(m.userData, extra); tgtHit.push(m); return m; };

  // Paper: hanging from a trolley on the carrier track.
  const papers = PAPERS.map((p) => {
    const t = createTarget();
    t.place(sets.paper, V(p.x, p.y - 0.25, p.z), 0.5, 0.5, 1, 'square', 0);
    // Paper under target lights reads bright: a little of its own printed face as glow (holes stay dark).
    Object.assign(t.sheet.material, { envMapIntensity: 0.35, emissive: new THREE.Color(0xfff2dc), emissiveMap: t.sheet.material.map, emissiveIntensity: p.z > -6 ? 0.1 : 0.03, color: new THREE.Color(p.z > -6 ? 0xffffff : p.z > -12 ? 0xb8b8b8 : 0xe0e0e0) });
    mark(t.sheet, 'paper', { target: t, size: p.size, dist: -p.z });
    const hw = new THREE.Group(); hw.position.set(p.x, 0, p.z); sets.paper.add(hw);
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.16), mats.steel); trolley.position.y = CEIL_Y - 0.27; hw.add(trolley);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.018, 0.02), mats.steel); bar.position.y = p.y + 0.012; hw.add(bar);
    for (const s of [-1, 1]) {
      const len = CEIL_Y - 0.28 - (p.y + 0.02);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 4), wireMat); w.position.set(s * 0.2, p.y + 0.02 + len / 2, 0); hw.add(w);
    }
    for (const m of [trolley, bar]) { m.userData.kind = 'steel'; hitMeshes.push(m); }
    return t;
  });

  // Steel: a plate rack. Each plate falls back on its hinge when hit.
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.55, metalness: 0.1 });
  const plates = [];
  {
    const r = sets.steel, frame = [];
    frame.push(box(1.26, 0.05, 0.05, RACK.x, RACK.y - 0.14, RACK.z));
    for (const s of [-1, 1]) { frame.push(box(0.05, RACK.y - 0.14 - FLOOR_Y, 0.05, RACK.x + s * 0.6, (RACK.y - 0.14 + FLOOR_Y) / 2, RACK.z)); frame.push(box(0.06, 0.03, 0.6, RACK.x + s * 0.6, FLOOR_Y + 0.015, RACK.z)); }
    frame.push(box(1.3, 0.12, 0.02, RACK.x, RACK.y - 0.22, RACK.z + 0.04));   // a guard plate over the hinges
    const fm = new THREE.Mesh(mergeGeometries(frame), new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.55, metalness: 0.7 }));
    fm.userData.kind = 'steel'; r.add(fm); hitMeshes.push(fm);
    const disc = new THREE.CylinderGeometry(0.085, 0.085, 0.012, 32).rotateX(Math.PI / 2).translate(0, 0.16, 0);
    const stem = new THREE.BoxGeometry(0.03, 0.12, 0.012).translate(0, 0.06, 0);
    const plateGeo = mergeGeometries([disc, stem]);
    for (let i = 0; i < 5; i++) {
      const hinge = new THREE.Group(); hinge.position.set(RACK.x + (i - 2) * 0.24, RACK.y - 0.11, RACK.z); r.add(hinge);
      const m = new THREE.Mesh(plateGeo, plateMat); hinge.add(m);
      plates.push(mark(m, 'plate', { i, dist: -RACK.z }) && { hinge, m, a: 0, w: 0, down: false, landed: false });
    }
  }

  // Bottles and cans on a plank over two trestles.
  const bodies = [];   // anything loose that falls: casings, cans, magazines, glass
  const trestle = [];
  trestle.push(box(PLANK.len, 0.03, PLANK.d, PLANK.x, PLANK.y - 0.015, PLANK.z, 0, 0, 0, 1.5));
  for (const s of [-1, 1]) for (const f of [-1, 1]) {
    const hgt = PLANK.y - 0.03 - FLOOR_Y, x = PLANK.x + s * (PLANK.len / 2 - 0.12);
    trestle.push(box(0.04, hgt / Math.cos(0.18), 0.05, x, FLOOR_Y + hgt / 2, PLANK.z + f * 0.1, f * 0.18, 0, 0, 1.5));
  }
  for (const s of [-1, 1]) trestle.push(box(0.05, 0.05, PLANK.d + 0.06, PLANK.x + s * (PLANK.len / 2 - 0.12), PLANK.y - 0.055, PLANK.z, 0, 0, 0, 1.5));
  const tm = new THREE.Mesh(mergeGeometries(trestle), mats.wood); tm.userData.kind = 'wood'; sets.bottles.add(tm); hitMeshes.push(tm);
  const glass = [
    new THREE.MeshPhysicalMaterial({ color: 0x3d6b2a, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.72, envMapIntensity: 1.6, specularIntensity: 1, depthWrite: false }),
    new THREE.MeshPhysicalMaterial({ color: 0x5a3212, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 1.6, specularIntensity: 1, depthWrite: false }),
  ];
  const bottleProfile = [[0, 0], [0.031, 0], [0.033, 0.006], [0.033, 0.15], [0.03, 0.17], [0.014, 0.205], [0.012, 0.24], [0.014, 0.246], [0.011, 0.25], [0, 0.25]].map(([x, y]) => new THREE.Vector2(x, y));
  const bottleGeo = new THREE.LatheGeometry(bottleProfile, 20);
  const stubGeo = new THREE.LatheGeometry([[0, 0], [0.031, 0], [0.033, 0.006], [0.033, 0.03], [0.026, 0.045], [0.03, 0.038], [0.02, 0.04], [0, 0.012]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 24).translate(0, 0.061, 0);
  const canMats = [canLabel('#8a1f1a', '#e9e2d0', '#d9a441'), canLabel('#1f3a5a', '#c7ccd2', '#e9e2d0'), canLabel('#2d4a2a', '#d9c27a', '#e9e2d0')]
    .map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.32, metalness: 0.65 }));
  const canEnd = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, roughness: 0.25, metalness: 1 });
  const items = [];
  ['bottle', 'can', 'bottle', 'can', 'bottle', 'can'].forEach((kind, i) => {
    const x = PLANK.x - PLANK.len / 2 + 0.14 + i * ((PLANK.len - 0.28) / 5), z = PLANK.z + (i % 2 ? 0.03 : -0.02);
    if (kind === 'bottle') {
      const m = mark(new THREE.Mesh(bottleGeo, glass[(i / 2) % 2]), 'bottle'); m.position.set(x, PLANK.y, z); m.renderOrder = 2; sets.bottles.add(m);
      const stub = new THREE.Mesh(stubGeo, m.material); stub.position.copy(m.position); stub.visible = false; stub.renderOrder = 2; sets.bottles.add(stub);
      const it = { kind, m, stub, home: m.position.clone(), broken: false }; m.userData.item = it; items.push(it);
    } else {
      const m = mark(new THREE.Mesh(canGeo, [canMats[(i - 1) / 2], canEnd, canEnd]), 'can');
      m.position.set(x, PLANK.y, z); m.rotation.y = Math.random() * 6; sets.bottles.add(m);
      const b = body(m, { r: 0.033, half: 0.061, pivot: 0.061, bounce: 0.32, stand: true, kind: 'can' }); b.rest = true;
      const it = { kind, m, b, home: m.position.clone(), homeQ: m.quaternion.clone() }; m.userData.item = it; items.push(it);
    }
  });
  // Glass shards: a small shared pool.
  const shardGeos = [0, 1, 2].map(() => {
    const g = new THREE.BufferGeometry(), s = 0.03 + Math.random() * 0.03;
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s, s * 0.2, 0, s * 0.3, s * 0.9, 0, -s * 0.2, s * 0.5, 0.002], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
  });
  const shards = Array.from({ length: 30 }, (_, i) => {
    const m = new THREE.Mesh(shardGeos[i % 3], glass[0]); m.visible = false; m.renderOrder = 2; group.add(m);
    const b = body(m, { r: 0.003, half: 0, flat: true, bounce: 0.2, kind: 'shard' }); b.rest = true; b.free = true;
    return b;
  });

  // The spinner: two paddles on an arm that turns about a horizontal axle.
  const spinner = { a: 0, w: 0 };
  {
    const post = new THREE.Mesh(mergeGeometries([
      box(0.04, SPIN.y - FLOOR_Y, 0.04, SPIN.x, (SPIN.y + FLOOR_Y) / 2, SPIN.z),
      box(0.5, 0.03, 0.3, SPIN.x, FLOOR_Y + 0.015, SPIN.z),
      place(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), SPIN.x + 0.06, SPIN.y, SPIN.z, 0, 0, Math.PI / 2),
    ]), new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.55, metalness: 0.7 }));
    post.userData.kind = 'steel'; sets.spinner.add(post); hitMeshes.push(post);
    const arm = new THREE.Group(); arm.position.set(SPIN.x + 0.11, SPIN.y, SPIN.z); sets.spinner.add(arm);
    const paddleMat = new THREE.MeshStandardMaterial({ color: 0xc8662c, roughness: 0.5, metalness: 0.15 });
    const g = mergeGeometries([
      new THREE.BoxGeometry(0.02, 0.5, 0.012),
      new THREE.CylinderGeometry(0.075, 0.075, 0.012, 28).rotateX(Math.PI / 2).translate(0, 0.24, 0),
      new THREE.BoxGeometry(0.14, 0.14, 0.012).translate(0, -0.24, 0),
    ]);
    const m = mark(new THREE.Mesh(g, paddleMat), 'spinner', { dist: -SPIN.z }); arm.add(m);
    spinner.arm = arm;
  }

  // ---------------------------------------------------------------- loose bodies (casings, cans, magazines, glass)
  function body(m, o) {
    const b = { m, v: V(), w: V(), r: o.r, half: o.half, pivot: o.pivot || 0, bounce: o.bounce, stand: !!o.stand, flat: !!o.flat, axis: o.axis || V(0, 1, 0),
      kind: o.kind, rest: false, still: 0, onLand: o.onLand };
    bodies.push(b); return b;
  }
  const tmpA = V(), tmpB = V(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), UP = V(0, 1, 0);
  function groundAt(p) {
    if (p.x > SHELF.x0 && p.x < SHELF.x1 && p.z > SHELF.z0 && p.z < SHELF.z1 && p.y > SHELF_Y - 0.03) return [SHELF_Y, 'shelf'];
    if (sets.bottles.visible && Math.abs(p.x - PLANK.x) < PLANK.len / 2 && Math.abs(p.z - PLANK.z) < PLANK.d / 2 && p.y > PLANK.y - 0.03) return [PLANK.y, 'plank'];
    return [FLOOR_Y, 'floor'];
  }
  function stepBody(b, dt) {
    if (b.rest) return;
    const m = b.m;
    b.v.y -= 9.8 * dt;
    m.position.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-4) { tmpQ.setFromAxisAngle(tmpA.copy(b.w).divideScalar(wl), wl * dt); m.quaternion.premultiply(tmpQ); }
    // The body's centre sits `pivot` above its origin along its own axis.
    const ax = tmpA.copy(b.axis).applyQuaternion(m.quaternion);
    const c = tmpB.copy(m.position).addScaledVector(ax, b.pivot);
    const [gy, surf] = groundAt(c);
    const low = b.half * Math.abs(ax.y) + b.r * Math.sqrt(Math.max(0, 1 - ax.y * ax.y));
    let touching = false;
    if (c.y - low < gy) {
      touching = true;
      m.position.y += gy - (c.y - low);
      if (b.v.y < -0.25) {
        const imp = -b.v.y; b.v.y = imp * b.bounce;
        b.v.x *= 0.62; b.v.z *= 0.62; b.w.multiplyScalar(0.55);
        b.onLand?.(imp, surf);
      } else b.v.y = Math.max(0, b.v.y);
      // Settle: lie down (or stand, when nearly upright and allowed), and let friction stop the slide.
      const want = b.flat ? UP : (b.stand && Math.abs(ax.y) > 0.86 ? (ax.y > 0 ? UP : tmpB.set(0, -1, 0)) : tmpB.set(ax.x, 0, ax.z).normalize());
      if (want.lengthSq() > 0.5) { tmpQ2.setFromUnitVectors(ax.clone(), want); tmpQ.identity().slerp(tmpQ2, Math.min(1, dt * 14)); m.quaternion.premultiply(tmpQ); }
      const f = Math.exp(-dt * 5); b.v.x *= f; b.v.z *= f; b.w.multiplyScalar(Math.exp(-dt * 8));
    }
    // Booth walls and room walls: bounce off.
    if (m.position.z > BOOTH_Z[1] && m.position.z < BOOTH_Z[0] && Math.abs(m.position.x) > BOOTH_X - 0.035 && Math.abs(m.position.x) < BOOTH_X + 0.05 && Math.sign(b.v.x) === Math.sign(m.position.x)) {
      b.onLand?.(Math.abs(b.v.x) * 0.6, 'wall'); b.v.x *= -0.35; b.w.multiplyScalar(0.7);
    }
    if (Math.abs(m.position.x) > HALF_W - 0.05) b.v.x = -Math.abs(b.v.x) * Math.sign(m.position.x) * 0.3;
    if (touching && b.v.lengthSq() < 0.004) { if ((b.still += dt) > 0.4) { b.rest = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); } } else b.still = 0;
  }

  // ---------------------------------------------------------------- the pistol
  const gun = createPistol({ look: S.pistolLook });
  gun.root.visible = false; vm.add(gun.root);
  const sights = { rear: V(), front: V() };
  const base = {};
  const ready = gun.ready.then(() => {
    gun.root.updateMatrixWorld(true);
    const inv = gun.root.matrixWorld.clone().invert();
    sights.rear.copy(gun.rearSight.getWorldPosition(V()).applyMatrix4(inv));
    sights.front.copy(gun.frontSight.getWorldPosition(V()).applyMatrix4(inv));
    base.trigZ = gun.trigger.position.z; base.slideZ = gun.slide.position.z; base.magPos = gun.magazine.position.clone();
    base.hammer = gun.hammer.rotation.x; base.stop = gun.slideStop.rotation.x; base.grip = gun.gripSafety.rotation.x; base.barrel = gun.barrel.rotation.x;
    newMag = gun.makeMagazine(); newMag.visible = false; gun.root.add(newMag);
    newMag.quaternion.copy(gun.magazine.quaternion);
    setLook(S.pistolLook);
    buildEnv();
  });
  let newMag = null;
  const casingPool = [], magPool = [];
  function setLook(id) { gun.setLook(id); }

  // Gun state: the round counter is the chamber plus the magazine.
  const st = { mag: MAG_SIZE - 1, chamber: true, locked: false, shotT: 9, lastShot: -1e9, trig: 0, lockK: 0, reloading: false, ejected: true, dropT: 9, shots: 0, hits: 0 };
  const RL = { magOut: 0, np: 1, lh: 0, thumb: 0 };
  const queue = [];   // bullets in flight: { t, fn }
  const tilt = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, k: 0 };
  const SHOW = { x: -0.01, y: 0.01, z: 0, rx: 0.06, ry: 0.08, rz: 0.38 };   // empty gun: cant it toward the player so the locked-back slide shows, still in the hand
  const report = () => ctx.onAmmo?.({ chamber: st.chamber, mag: st.mag, locked: st.locked, reloading: st.reloading });
  const tally = () => ctx.onTally?.(st.hits, st.shots);

  function slideK() {
    // Back fast, a short dwell, forward a little slower; a slide drop is its own quick run forward.
    const t = st.shotT;
    let k = t < 0.004 ? 0 : t < 0.02 ? 1 - Math.pow(1 - (t - 0.004) / 0.016, 2) : t < 0.028 ? 1 : t < 0.066 ? 1 - Math.pow((t - 0.028) / 0.038, 2) : 0;
    if (st.locked && t >= 0.028) k = 0.985;
    if (st.dropT < 0.05) k = Math.min(k, 0.985 * (1 - Math.pow(st.dropT / 0.05, 2)));
    return k;
  }

  function fire() {
    if (st.reloading) return false;
    if (st.locked || !st.chamber) { reload(); return false; }
    const now = performance.now();
    if (now - st.lastShot < 110) return false;   // the slide has to cycle before the next one
    st.lastShot = now; st.shotT = 0; st.dropT = 9; st.trig = 1; st.ejected = false;
    st.chamber = false;
    if (st.mag > 0) { st.mag--; st.chamber = true; } else st.locked = true;
    st.shots++;
    sound.pistolShot(); ctx.buzz([30, 20, 50]);
    const ads = ctx.P.ads;
    fx.muzzleFlash(gun.muzzle, 1.0 * (1 - ads * 0.55));
    const fwd = V(0, 0, -1).applyQuaternion(gun.muzzle.getWorldQuaternion(new THREE.Quaternion()));
    fx.smoke(gun.muzzle, fwd, 5, 0.8);
    const r = reduced ? 0.25 : 1, two = 1 - ads * 0.35;
    ctx.recoil(9 * r * two, 1.1 * r, 2.6 * r * two, 2.4 * r * two, reduced ? 0.04 : 0.32);
    ctx.flash(0.26);
    // The bullet: down the camera's line, a little spread from the hip, none down the sights.
    const ray = ctx.aimRay(ads > 0.6 ? 0.0004 : 0.005);
    shoot(ray);
    report(); tally();
    if (st.locked) setTimeout(() => ctx.onEmpty?.(), 250);
    return true;
  }

  const rc = new THREE.Raycaster();
  function shoot(ray) {
    rc.set(ray.origin, ray.direction); rc.far = 40;
    const list = hitMeshes.filter(visibleNow).concat(tgtHit.filter(visibleNow));
    const hits = rc.intersectObjects(list, false);
    const h = hits[0];
    if (!h) return;
    const dist = h.distance;
    queue.push({ t: dist / MUZZLE_V, fn: () => impact(h, ray, hits) });
  }
  const visibleNow = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function worldNormal(h) {
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V(0, 0, 1);
    return n;
  }
  function impact(h, ray, all) {
    const kind = h.object.userData.kind, p = h.point, n = worldNormal(h), dist = h.distance;
    if (n.dot(ray.direction) > 0) n.negate();
    const counted = ['paper', 'plate', 'spinner', 'bottle', 'can'].includes(kind);
    if (counted) { st.hits++; tally(); }
    const far = Math.min(2.2, Math.max(0.7, dist / 7));
    if (kind === 'paper') {
      const ud = h.object.userData; const uv = h.uv || { x: 0.5, y: 0.5 };
      ud.target.hit(uv.x, uv.y, ud.size);
      sound.paperHit(0);
      // The bullet goes on through the paper into the berm.
      const behind = all.find((x) => x.object.userData.kind === 'berm' || x.object.userData.kind === 'concrete');
      if (behind) { const nn = worldNormal(behind); fx.dust(behind.point, nn, 4, 0x5c4b3b, Math.min(2.2, behind.distance / 7)); }
    } else if (kind === 'plate') {
      const pl = plates[h.object.userData.i];
      fx.sparks(p, n, 10); sound.steelRing(dist, 1);
      if (!pl.down) { pl.down = true; pl.w = -(6 + Math.random() * 2); pl.landed = false; }
      else pl.w -= 2;
    } else if (kind === 'spinner') {
      const local = spinner.arm.worldToLocal(p.clone());
      spinner.w += (local.y > 0 ? -1 : 1) * (14 + Math.random() * 4);
      fx.sparks(p, n, 8); sound.steelRing(dist, 0.75);
    } else if (kind === 'bottle') {
      breakBottle(h.object.userData.item, ray.direction); sound.glassBreak(dist);
    } else if (kind === 'can') {
      const it = h.object.userData.item, b = it.b;
      b.rest = false; b.still = 0;
      b.v.copy(ray.direction).multiplyScalar(2.2 + Math.random()).add(V((Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 1.4, 0));
      b.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 30);
      sound.canClank(dist); fx.sparks(p, n, 3);
    } else if (kind === 'steel') {
      fx.sparks(p, n, 7); sound.steelRing(dist, 1.4);
    } else if (kind === 'berm') {
      fx.dust(p, n, 6, 0x5c4b3b, far); sound.dirtHit(dist);
    } else if (kind === 'wood' || kind === 'felt') {
      fx.dust(p, n, 4, kind === 'wood' ? 0x9a7a55 : 0x55504a, far * 0.8); fx.debris(p, n, 0.8); sound.dirtHit(dist);
    } else {
      fx.dust(p, n, 5, 0x9a9184, far); fx.sparks(p, n, 3); sound.dirtHit(dist);
    }
  }

  function breakBottle(it, dir) {
    if (it.broken) return;
    it.broken = true; it.m.visible = false; it.stub.visible = true;
    const c = it.m.position.clone().add(V(0, 0.12, 0));
    let k = 0;
    for (const s of shards) {
      if (!s.free) continue;
      s.free = false; s.rest = false; s.still = 0; s.m.visible = true; s.m.material = it.m.material;
      s.m.position.copy(c).add(V((Math.random() - 0.5) * 0.05, (Math.random() - 0.3) * 0.18, (Math.random() - 0.5) * 0.05));
      s.m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.v.copy(dir).multiplyScalar(0.8 + Math.random() * 1.6).add(V((Math.random() - 0.5) * 2.2, Math.random() * 2.2, (Math.random() - 0.5) * 1.6));
      s.w.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
      if (++k >= 10) break;
    }
    fx.dust(c, dir.clone().negate(), 3, 0xd8e0d0, 0.6);
  }

  function ejectCasing() {
    let c = casingPool.find((x) => x.rest && x.age > 30) || null;
    if (casingPool.length < 24 && !c) {
      const m = gun.makeCasing(); group.add(m);
      c = body(m, { r: 0.006, half: 0.0114, axis: V(0, 0, 1), bounce: 0.42, kind: 'casing', onLand: (imp, surf) => { if (imp > 0.35) sound.casingTink(Math.min(1, imp / 3), surf); } });
      casingPool.push(c);
    } else if (!c) c = casingPool.reduce((a, b) => (a.age > b.age ? a : b));
    c.age = 0; c.rest = false; c.still = 0; c.m.visible = true;
    gun.port.getWorldPosition(c.m.position);
    gun.root.getWorldQuaternion(c.m.quaternion);
    const dir = PORT_DIR.clone().transformDirection(gun.root.matrixWorld);
    c.v.copy(dir).multiplyScalar(2.6 + Math.random() * 0.9).add(V(0, 0.4, 0));
    c.w.set((Math.random() - 0.5) * 50, 20 + Math.random() * 30, (Math.random() - 0.5) * 20);
  }

  function dropMag() {
    let d = magPool.find((x) => x.rest && x.age > 1) || null;
    if (!d) {
      if (magPool.length >= 4) d = magPool.reduce((a, b) => (a.age > b.age ? a : b));
      else {
        const m = gun.makeMagazine(); group.add(m);
        m.traverse((o) => { if (o.name === 'magRound') o.visible = false; });
        d = body(m, { r: 0.012, half: 0.055, pivot: -0.03, bounce: 0.25, kind: 'mag', onLand: (imp) => { if (imp > 0.6) sound.casingTink(Math.min(1, imp / 4) * 0.7, 'shelf'); } });
        magPool.push(d);
      }
    }
    d.age = 0; d.rest = false; d.still = 0; d.m.visible = true;
    gun.magazine.getWorldPosition(d.m.position); gun.magazine.getWorldQuaternion(d.m.quaternion);
    d.v.copy(MAG_AXIS).transformDirection(gun.root.matrixWorld).multiplyScalar(1.3);
    d.w.set((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
  }

  const gwait = (s) => new Promise((r) => gsap.delayedCall(s, r));   // game time, so slow motion slows it too
  // The reload: drop the magazine, the support hand brings a fresh one up and seats it, the slide drops.
  async function reload() {
    if (st.reloading || !ready) return;
    if (st.chamber && st.mag >= MAG_SIZE) return;
    st.reloading = true; report();
    const P = ctx.P, d = reduced ? 0.5 : 1;
    gsap.killTweensOf(RL);
    ctx.grabPose();
    gsap.to(P, { act: 1, duration: 0.24 * d, ease: 'power2.out' });
    ctx.toA(ctx.portrait() ? RELOAD.port : RELOAD.land, 0.28 * d, 'power2.out');
    gsap.to(RL, { lh: 1, duration: 0.32 * d, ease: 'power2.inOut' });
    await gwait(0.1 * d);
    await gsap.to(RL, { thumb: 1, duration: 0.05 });
    sound.magOut();
    await gsap.to(RL, { magOut: 1, duration: 0.11, ease: 'power2.in' });
    dropMag(); gun.magazine.visible = false; RL.magOut = 0; gsap.to(RL, { thumb: 0, duration: 0.1 });
    newMag.visible = true; RL.np = 1;
    newMag.traverse((o) => { if (o.name === 'magRound') o.visible = true; });
    await gsap.to(RL, { np: 0.12, duration: 0.4 * d, ease: 'power2.out' });
    await gsap.to(RL, { np: 0, duration: 0.07, ease: 'power3.in' });
    sound.magIn(); ctx.recoil(1.4, 0.2, -0.6, 0.3, 0.06); ctx.buzz(14);
    gun.magazine.visible = true; newMag.visible = false;
    const wasLocked = st.locked;
    st.mag = MAG_SIZE; report();
    gsap.to(RL, { lh: 0, duration: 0.4 * d, ease: 'power2.inOut', delay: 0.06 });
    if (wasLocked) {
      await gwait(0.14 * d);
      await gsap.to(RL, { thumb: 1, duration: 0.06 });
      st.dropT = 0; st.locked = false; st.mag--; st.chamber = true; st.shotT = 9;
      sound.slideDrop(); ctx.recoil(2.4, 0.3, 0.8, 0.5, 0.1); ctx.buzz(18);
      gsap.to(RL, { thumb: 0, duration: 0.12, delay: 0.04 });
    }
    await gwait(0.1 * d);
    await gsap.to(P, { act: 0, duration: 0.34 * d, ease: 'power2.inOut' });
    st.reloading = false; report();
  }
  const RELOAD = {
    land: { x: 0.045, y: 0.05, z: -0.34, rx: 0.42, ry: 0.25, rz: -0.8 },
    port: { x: 0.02, y: 0.02, z: -0.4, rx: 0.42, ry: 0.2, rz: -0.8 },
  };

  function reset() {
    for (const t of papers) t.clear();
    for (const pl of plates) { pl.down = false; pl.w = 0; gsap.to(pl, { a: 0, duration: reduced ? 0 : 0.5, ease: 'back.out(1.6)' }); }
    spinner.w = 0; gsap.to(spinner, { a: Math.round(spinner.a / (Math.PI * 2)) * Math.PI * 2, duration: 0.6, ease: 'power2.out', onComplete: () => { spinner.a = 0; } });
    for (const it of items) {
      if (it.kind === 'bottle') { it.broken = false; it.m.visible = true; it.stub.visible = false; }
      else { it.b.rest = true; it.b.v.set(0, 0, 0); it.b.w.set(0, 0, 0); it.m.position.copy(it.home); it.m.quaternion.copy(it.homeQ); }
    }
    for (const s of shards) { s.free = true; s.rest = true; s.m.visible = false; }
    for (const c of casingPool) { c.rest = true; c.m.visible = false; c.age = 99; }
    for (const m of magPool) { m.rest = true; m.m.visible = false; m.age = 99; }
    st.hits = 0; st.shots = 0; tally();
    sound.rangeReset();
  }

  function setSets(on) {
    for (const [k, g] of Object.entries(sets)) g.visible = on[k] !== false;
  }
  setSets(S.targets || {});

  // ---------------------------------------------------------------- environment, enter / leave
  let env = null;
  const fog = new THREE.FogExp2(0x100c09, 0.022);
  function buildEnv() {
    // Image-based lighting from the range itself: render the room (lamps lit) from the eye.
    // Plus a few soft panels only the reflections see (the booth light overhead, warm bounce at the sides),
    // so the steel always has a highlight to hold, like the Decide rooms' lamp panels.
    const envScene = new THREE.Scene();
    const parent = room.parent; envScene.add(room);
    const panels = [[[0, 1, 0.35], 0xffe2c0, 5, [1.6, 0.9]], [[-1, 0.3, -0.5], 0xffc890, 2.2, [1.2, 1.6]], [[1, 0.25, 0.3], 0xffd8b0, 1.4, [1.4, 1.2]], [[0, 0.2, 1], 0xf0e6da, 0.9, [2.4, 1.2]]]
      .map(([d, c, i, [w, h]]) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
        m.position.set(...d).normalize().multiplyScalar(2); m.lookAt(0, 0, 0); envScene.add(m); return m;
      });
    env = pmrem.fromScene(envScene, 0.03, 0.05, 40).texture;
    for (const m of panels) { m.geometry.dispose(); m.material.dispose(); }
    parent.add(room);
  }

  const saved = {};
  function enter() {
    group.visible = true; gun.root.visible = true;
    saved.fog = scene.fog; scene.fog = fog;
    scene.environment = env; scene.environmentIntensity = 1.5;
    const { key, rim, front, hemi } = ctx.lights;
    key.color.setHex(0xffd2a0); key.intensity = 2.2; key.position.set(-0.5, 0.75, 0.2); key.target.position.set(0.06, -0.25, -0.45);
    rim.color.setHex(0xffb98a); rim.intensity = 0.55; rim.position.set(0.6, 0.6, -1.6);
    front.intensity = 0.35;
    hemi.color.setHex(0x7a6c5c); hemi.groundColor.setHex(0x1a120c); hemi.intensity = 0.25;
    fx.setDesk(FLOOR_Y);
    sound.setRoom('range');
    report(); tally();
  }
  function leave() {
    group.visible = false; gun.root.visible = false;
    scene.fog = saved.fog || null;
    ctx.lights.front.intensity = 0.8;
  }

  // ---------------------------------------------------------------- per frame
  const RH = { pos: V(-0.024, -0.036, 0.104), finger: V(-0.03, 0.32, -0.947), palm: V(-0.999, 0.02, 0.04) };
  const GRIP = { thumb: [0.7, -0.25, -0.4, 0.05], index: [-0.25, 0.85, 0.45, -0.2], middle: [0.55, 1.3, 1.35, 0], ring: [0.42, 1.15, 0.85, 0], pinky: [0.1, 0.8, 1.1, 0], cup: 0.3 };
  const THUMB_PRESS = [0.35, 0.35, 0.3, 0.2];
  // Support hand (left) in gun space, when aiming: palm on the left grip panel, fingers over the shooting hand's.
  const SUP = { pos: V(-0.004, -0.03, 0.05), finger: V(0.2, -0.5, -0.84), palm: V(0.95, 0.25, 0.1), elbow: V(-0.75, -0.2, 0.05) };
  const SUP_POSE = { thumb: [0.35, 0.25, 0.1, 0.05], index: [0.8, 1.15, 0.6, 0.05], middle: [0.85, 1.2, 0.65, 0], ring: [0.9, 1.2, 0.65, 0], pinky: [0.95, 1.15, 0.6, -0.05], cup: 0.4 };
  // Magazine hand: palm under the base plate, index finger along the front of the magazine.
  const MAGH = { off: V(0, -0.098, 0.036), finger: V(0.1, 0.15, -1), palm: V(0, 1, 0.1), elbow: V(-0.12, -0.35, 0.3) };
  const MAG_POSE = { thumb: [0.3, 0.3, 0.1, 0.1], index: [0.9, 0.5, 0.2, 0.05], middle: [1.1, 1.0, 0.6, 0], ring: [1.15, 1.0, 0.6, 0], pinky: [1.2, 1.0, 0.6, 0], cup: 0.4 };
  const FORE_ADS = V(-0.1, -1.2, 0);   // right forearm direction change when aiming (camera space)
  const REST_L = { pos: V(-0.2, SHELF_Y + 0.024, -0.6), elbow: V(-0.27, SHELF_Y + 0.03, -0.2) };
  const handTmp = { o: new THREE.Object3D(), q: new THREE.Quaternion(), pose: {}, poseR: {} };

  const FETCH = V(-0.16, -0.3, 0.1), qInv = new THREE.Quaternion();
  function magPos(np, out) {
    // The last few centimetres run straight up the magazine axis into the well; before that the magazine comes
    // up from the belt, below and left of the gun in the camera's frame (so it never swings in from the wrong side).
    out.copy(base.magPos).addScaledVector(MAG_AXIS, 0.012 * Math.min(1, np * 10) + Math.min(np, 0.3) * 0.25);
    const far = Math.max(0, (np - 0.12) / 0.88);
    if (far > 0) {
      gun.root.getWorldQuaternion(qInv).invert();
      const d = tmpA.copy(FETCH).multiply(V(mir.scale.x, 1, 1)).applyQuaternion(camera.getWorldQuaternion(tmpQ)).applyQuaternion(qInv);
      out.addScaledVector(d, far * far);
    }
    return out;
  }

  function update(dt, raw, t) {
    // Bullets in flight.
    for (let i = queue.length - 1; i >= 0; i--) { const q = queue[i]; q.t -= dt; if (q.t <= 0) { queue.splice(i, 1); q.fn(); } }
    st.shotT += dt; st.dropT += dt;
    // Pistol parts.
    const k = slideK();
    gun.slide.position.z = base.slideZ + SLIDE_TRAVEL * k;
    gun.barrel.rotation.x = base.barrel + BARREL_TILT * smooth(0.08, 0.5, k);
    const ht = st.shotT, fall = ht < 0.004 ? ht / 0.004 : 1;
    let hammer = ht < 0.004 ? HAMMER_FALL * fall : ht < 0.07 ? Math.max(HAMMER_FALL * (1 - smooth(0.004, 0.012, ht)), HAMMER_BACK * k) : HAMMER_BACK * k * (st.locked ? 0.4 : 1);
    if (ht >= 0.07 && !st.locked) hammer = HAMMER_BACK * k;
    gun.hammer.rotation.x = base.hammer + hammer;
    st.trig += (0 - st.trig) * Math.min(1, dt * 14);
    gun.trigger.position.z = base.trigZ + TRIGGER_TRAVEL * st.trig;
    st.lockK += ((st.locked && k > 0.9 ? 1 : 0) - st.lockK) * Math.min(1, dt * 30);
    if (RL.thumb > 0 && !st.locked && st.dropT < 0.2) st.lockK = Math.max(0, st.lockK - dt * 20);
    gun.slideStop.rotation.x = base.stop + SLIDE_STOP_UP * st.lockK;
    tilt.k += ((st.locked && !st.reloading && st.shotT > 0.25 ? 1 : 0) - tilt.k) * Math.min(1, dt * 6);
    { const e = tilt.k * tilt.k * (3 - 2 * tilt.k) * (reduced ? 0.4 : 1); for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz']) tilt[k] = SHOW[k] * e; }
    gun.gripSafety.rotation.x = base.grip + GRIP_SAFETY_IN;
    gun.chamberRound.visible = st.chamber && k < 0.45;
    gun.magRound.visible = st.mag > 0;
    gun.magazine.position.copy(base.magPos).addScaledVector(MAG_AXIS, 0.12 * RL.magOut);
    if (newMag?.visible) magPos(RL.np, newMag.position);
    if (!st.ejected && st.shotT >= 0.016) { st.ejected = true; gun.root.updateMatrixWorld(true); ejectCasing(); if (Math.random() < 0.5) fx.smoke(gun.port, V(0, 1, 0), 1, 0.2); }
    // Targets.
    for (const pl of plates) {
      if (pl.down && !pl.landed) {
        pl.w -= 30 * Math.sin(-pl.a + 0.05) * dt; pl.a += pl.w * dt;
        if (pl.a <= -1.45) { pl.a = -1.45; if (Math.abs(pl.w) > 1.5) { pl.w = -pl.w * 0.25; sound.steelFall(-RACK.z); } else { pl.w = 0; pl.landed = true; } }
      }
      pl.hinge.rotation.x = pl.a;
    }
    // Spinner: the heavier bottom paddle pulls it back upright; the bearing slows it down.
    spinner.w += (-Math.sin(spinner.a) * 9 - spinner.w * 0.35) * dt; spinner.a += spinner.w * dt;
    spinner.arm.rotation.x = spinner.a;
    for (const p of papers) p.update(dt);
    for (const b of bodies) { if (b.age !== undefined) b.age += dt; stepBody(b, Math.min(dt, 1 / 30)); }
  }

  // Hands: the right hand holds the pistol; the left rests on the shelf, supports when aiming, and fetches magazines.
  function updateHands(raw, t) {
    const hands = ctx.hands(); if (!hands) return;
    const { right, left } = hands, P = ctx.P;
    right.group.position.copy(RH.pos);
    ctx.orient(right.group, RH.finger, RH.palm, V(0, -1, 0), V(-1, 0, 0));
    const pr = handTmp.poseR;
    ctx.lerpPose(GRIP, GRIP, 0, pr);
    pr.thumb = pr.thumb.map((v, i) => v + THUMB_PRESS[i] * RL.thumb);
    pr.index[1] += st.trig * 0.4; pr.index[0] += st.trig * 0.15;
    right.apply(pr);

    // Left: blend rest -> support (aiming) -> magazine (reloading).
    gun.root.updateMatrixWorld(true);
    const cq = camera.getWorldQuaternion(handTmp.q), mx = mir.scale.x;
    const lp = left.group.position.copy(REST_L.pos);
    left.group.quaternion.copy(ctx.LQ());
    const pose = ctx.lerpPose(ctx.REST, ctx.REST, 0, handTmp.pose);
    const elbow = V().copy(REST_L.elbow);
    const blend = (w, posRoot, finger, palm, handPose, elbowCam) => {
      if (w < 0.001) return;
      const s = w * w * (3 - 2 * w);
      const pw = gun.root.localToWorld(posRoot.clone());
      const f = finger.clone().transformDirection(gun.root.matrixWorld), n = palm.clone().transformDirection(gun.root.matrixWorld);
      const inv = lmir.matrixWorld.clone().invert();
      const pl = pw.clone().applyMatrix4(inv);
      lp.lerp(pl, s);
      ctx.orient(handTmp.o, f.transformDirection(inv), n.transformDirection(inv), V(0, -1, 0), V(1, 0, 0));
      left.group.quaternion.slerp(handTmp.o.quaternion, s);
      ctx.lerpPose(pose, handPose, s, pose);
      const ew = pw.clone().add(V(elbowCam.x * mx, elbowCam.y, elbowCam.z).applyQuaternion(cq)).applyMatrix4(inv);
      elbow.lerp(ew, s);
    };
    blend(P.ads * (1 - RL.lh), SUP.pos, SUP.finger, SUP.palm, SUP_POSE, SUP.elbow);
    if (RL.lh > 0.001) blend(RL.lh, magPos(RL.np, V()).add(MAGH.off), MAGH.finger, MAGH.palm, MAG_POSE, MAGH.elbow);
    left.apply(pose);
    scene.updateMatrixWorld();
    const fore = V(0, 0, 1).transformDirection(right.wrist.matrixWorld).add(V().copy(ctx.ELBOW_R).addScaledVector(FORE_ADS, P.ads).multiply(V(mx, 1, 1)).applyQuaternion(cq)).normalize();
    right.aimSleeve(right.wrist.getWorldPosition(V()).addScaledVector(fore, 0.3));
    left.aimSleeve(lmir.localToWorld(elbow.clone()));
  }

  return {
    group, gun, sights, ready, tilt, SHOW, papers, plates, spinner, items, st, RL, RH, GRIP, SUP, SUP_POSE, MAGH, MAG_POSE, REST_L, RELOAD, FORE_ADS, lamps, flood, ambient, mats,
    HIP: { land: { x: 0.125, y: -0.1, z: -0.4 }, port: { x: 0.052, y: -0.115, z: -0.48 }, rz: -0.1, D: 9 },
    ADS_EYE: { land: 0.55, port: 0.58 },
    LOOK: { pitch: -0.035, limY: 0.42, limP: 0.24 },
    SLEEVE: { sleeve: '#3a3b34', cuff: '#2a2a27', watch: false, buttons: false },
    GRADE: { vignette: 0.46, grain: 0.045, tint: [1.03, 1.0, 0.95] },
    get env() { return env; },
    get newMag() { return newMag; },
    get rounds() { return (st.chamber ? 1 : 0) + st.mag; },
    get busy() { return st.reloading; },
    fire, reload, reset, setLook, setSets, enter, leave, update, updateHands, report,
  };
}
