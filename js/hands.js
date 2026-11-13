// Rigged hands cut from the MakeHuman/MPFB CC0 base mesh, re-rigged in Blender with WebXR joint names, posed with our own FK.
// The rig is flat (every joint is a direct child of the armature), so each frame we chain
// joint rotations ourselves: joint -Z runs along the bone, +Y is the back of the hand,
// so curling a finger is a negative rotation about the joint's local X.
// The skin maps (albedo, relief, occlusion/roughness/pigment, glove relief, pore and leather tiles) are baked by
// tools/blender/build_hands.py from anatomy laid out around this rig; both hands share one UV atlas.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const FINGERS = { index: 'index-finger', middle: 'middle-finger', ring: 'ring-finger', pinky: 'pinky-finger' };
const LONG = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

// Skin looks. The maps are baked for "medium"; `gain` re-grades the albedo per channel, weighted by the pigment mask
// (palms and nails take less of it, as on real hands). `wrap` is how far direct light bleeds past the terminator per
// channel (red furthest), a cheap stand-in for light scattered under the skin.
export const SKINS = {
  light: { gain: [1.3, 1.42, 1.5], wrap: [0.5, 0.24, 0.16], sss: 0xd07058, sheen: 0xd8a898, spec: 0.5, cap: 0x4a3028 },
  medium: { gain: [1, 1, 1], wrap: [0.48, 0.22, 0.15], sss: 0xb0503a, sheen: 0xb88878, spec: 0.5, cap: 0x3a2218 },
  deep: { gain: [0.3, 0.25, 0.23], wrap: [0.4, 0.18, 0.12], sss: 0x5a2418, sheen: 0x5a4038, spec: 0.55, cap: 0x1c100a },
  gloves: { glove: true, color: 0x2a1c14, wrap: [0.1, 0.08, 0.08], spec: 0.85, cap: 0x0e0a08 },
};

const MODELS = new URL('../assets/models/', import.meta.url).href;
const DRACO = new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href;
// Must match tools/blender/build_hands.py: tile size (px), slope range of the relief maps, physical size of the tiles (m).
const MAP = { tile: 512, slopeMax: 1.0, tileSkin: 0.016, tileLeather: 0.02 };

// One material per look, on MeshPhysicalMaterial:
//  - normals from the baked slope maps (u and v) plus a tiled micro relief (pores, or leather grain),
//  - albedo graded per look with the pigment mask; gloves take a leather colour and the stitch mask,
//  - wrapped direct diffuse (see `wrap`).
function skinMaterial(look, T, uvMeters) {
  const s = SKINS[look] || SKINS.medium, glove = !!s.glove;
  const m = new THREE.MeshPhysicalMaterial({
    color: glove ? s.color : 0xffffff, map: glove ? null : T.albedo,
    roughness: glove ? 0.46 : 1, roughnessMap: glove ? null : T.orm, aoMap: T.orm, aoMapIntensity: 1,
    normalMap: glove ? T.gloveNx : T.nx,
    specularIntensity: s.spec, sheen: glove ? 0.4 : 0.12, sheenRoughness: glove ? 0.45 : 0.7, sheenColor: glove ? 0x6a5848 : s.sheen,
    clearcoat: glove ? 0.3 : 0, clearcoatRoughness: 0.42,
    emissive: glove ? 0x000000 : s.sss, emissiveIntensity: glove ? 0 : 0.02,
  });
  const detail = glove ? T.leather : T.pores;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uOrm: { value: T.orm }, uSt: { value: T.gloveSt }, uNy: { value: glove ? T.gloveNy : T.ny }, uDetail: { value: detail }, uGain: { value: new THREE.Vector3(...(s.gain || [1, 1, 1])) },
      uDetailRep: { value: uvMeters / (glove ? MAP.tileLeather : MAP.tileSkin) },
      uDetailK: { value: glove ? 2.2 : 1.6 }, uWrap: { value: new THREE.Vector3(...s.wrap) },
    });
    sh.fragmentShader = 'uniform sampler2D uOrm, uSt, uNy, uDetail; uniform vec3 uGain, uWrap; uniform float uDetailRep, uDetailK;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 ormT = texture2D( uOrm, vNormalMapUv );
        ${glove ? `diffuseColor.rgb *= 0.7 + 0.3 * ormT.r;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.17, 0.14 ), smoothstep( 0.2, 0.8, texture2D( uSt, vNormalMapUv ).r ) * 0.8 );`
        : 'diffuseColor.rgb *= mix( vec3( 1.0 ), uGain, ormT.b );'}`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec2 g = ( vec2( texture2D( normalMap, vNormalMapUv ).r, texture2D( uNy, vNormalMapUv ).r ) * 2.0 - 1.0 ) * ${MAP.slopeMax.toFixed(2)};
        vec2 dUv = vNormalMapUv * uDetailRep; const float dT = 1.0 / ${MAP.tile}.0;
        vec2 gd = vec2( texture2D( uDetail, dUv + vec2( dT, 0.0 ) ).r - texture2D( uDetail, dUv - vec2( dT, 0.0 ) ).r,
                        texture2D( uDetail, dUv + vec2( 0.0, dT ) ).r - texture2D( uDetail, dUv - vec2( 0.0, dT ) ).r );
        // fade the micro relief out as its texels shrink below a pixel, so it never shimmers
        float dFade = clamp( 1.6 - 0.12 * ${MAP.tile}.0 * length( fwidth( dUv ) ), 0.25, 1.0 );
        vec3 mapN = vec3( -( g + gd * uDetailK * dFade ), 1.0 );`))
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `float nlW = dot( geometryNormal, directLight.direction );
        vec3 wrapIrr = directLight.color * clamp( ( vec3( nlW ) + uWrap ) / ( 1.0 + uWrap ), 0.0, 1.0 );
        reflectedLight.directDiffuse += wrapIrr * BRDF_Lambert( material.diffuseColor );`));
  };
  m.customProgramCacheKey = () => 'hand-' + look;
  return m;
}

// ---------------------------------------------------------------- fabric
// Small value-noise helpers for the fabric tiles (periodic on the tile).
function noiseTile(S, cells, seed) {
  let x = seed * 9301 + 49297; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const g = new Float32Array(cells * cells).map(rnd), out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const fx = (xx / S) * cells, fy = (y / S) * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % cells) * cells + (ix % cells)], b = g[(iy % cells) * cells + ((ix + 1) % cells)];
    const c = g[((iy + 1) % cells) * cells + (ix % cells)], d = g[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
    out[y * S + xx] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}
function heightToNormal(h, S, k) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const dx = (h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)]) * k, dy = (h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x]) * k;
    const l = Math.hypot(dx, dy, 1);
    img.data[i * 4] = 128 - (dx / l) * 127; img.data[i * 4 + 1] = 128 + (dy / l) * 127; img.data[i * 4 + 2] = (1 / l) * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// Wool tweed in a herringbone, at real scale: the tile is 32 mm square, stripes 8 mm wide, twill about 1.1 mm.
const TWEED_MM = 32;
let tweedH = null;
function tweedHeight() {
  if (tweedH) return tweedH;
  const S = 512, mm = S / TWEED_MM, h = new Float32Array(S * S), fleck = new Float32Array(S * S);
  const n1 = noiseTile(S, 64, 3), n2 = noiseTile(S, 16, 7), n3 = noiseTile(S, 128, 11), nf = noiseTile(S, 96, 5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, X = x / mm, Y = y / mm;
    const stripe = Math.floor(X / 8), dir = stripe % 2 ? 1 : -1;
    const ph = (Y + dir * X) / 1.1 + n1[i] * 0.6;
    const tw = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
    const seam = Math.min(1, Math.abs((X % 8) - 0) * 1.5, Math.abs(8 - (X % 8)) * 1.5);
    h[i] = (0.55 * tw * tw + 0.25 * n3[i] + 0.2 * n2[i]) * (0.75 + 0.25 * seam);
    fleck[i] = Math.max(0, nf[i] * 0.6 + n3[i] * 0.5 - 0.86) * 4;
  }
  return (tweedH = { h, fleck, S });
}
function tweedMaps(base, fleckCol) {
  const { h, fleck, S } = tweedHeight();
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  const b = new THREE.Color(base), f = new THREE.Color(fleckCol);
  const br = b.r * 255, bg = b.g * 255, bb = b.b * 255;
  for (let i = 0; i < S * S; i++) {
    const v = 0.72 + 0.5 * h[i], k = Math.min(1, fleck[i]);
    img.data[i * 4] = Math.min(255, br * v * (1 - k) + f.r * 255 * k);
    img.data[i * 4 + 1] = Math.min(255, bg * v * (1 - k) + f.g * 255 * k);
    img.data[i * 4 + 2] = Math.min(255, bb * v * (1 - k) + f.b * 255 * k);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  tweedMaps.normal ||= heightToNormal(h, S, 2.2);
  return { map, normal: tweedMaps.normal };
}
// Shirting: a fine oxford weave (6 mm tile) as relief only; the cuff colour comes from the room.
const OXFORD_MM = 6;
let oxfordN = null;
function oxfordNormal() {
  if (oxfordN) return oxfordN;
  const S = 256, mm = S / OXFORD_MM, h = new Float32Array(S * S), n = noiseTile(S, 32, 13);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const X = x / mm, Y = y / mm, wx = Math.floor(X / 0.25), wy = Math.floor(Y / 0.25);
    const over = (wx + wy) % 2;
    const sx = Math.sin(((X % 0.25) / 0.25) * Math.PI), sy = Math.sin(((Y % 0.25) / 0.25) * Math.PI);
    h[y * S + x] = (over ? sx * 0.8 + sy * 0.2 : sy * 0.8 + sx * 0.2) * 0.7 + n[y * S + x] * 0.3;
  }
  return (oxfordN = heightToNormal(h, S, 1.2));
}

// A tailored tube: elliptical cross-section A(y) x B(y) around +Y, a turned hem with real thickness, soft folds.
// prof: list of [y, d] (d = offset along the outward normal of the ellipse); bump(phi, y) adds folds (m).
function tubeGeometry({ prof, A, B, bump = () => 0, seg = 64, uRep = 1, vScale = 1, offZ = 0 }) {
  const n = prof.length, pos = new Float32Array((seg + 1) * n * 3), uv = new Float32Array((seg + 1) * n * 2), idx = [];
  let along = 0;
  for (let j = 0; j < n; j++) {
    if (j) along += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
    const [y, d] = prof[j], a = A(y), b = B(y);
    for (let i = 0; i <= seg; i++) {
      const ph = (i / seg) * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph);
      let nx = c / a, nz = s / b; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
      const off = d + bump(ph, y), k = (j * (seg + 1) + i);
      pos[k * 3] = a * c + nx * off; pos[k * 3 + 1] = y; pos[k * 3 + 2] = b * s + nz * off + offZ;
      uv[k * 2] = (i / seg) * uRep; uv[k * 2 + 1] = along * vScale;
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // weld the normals across the seam column
  const nr = g.attributes.normal;
  for (let j = 0; j < n; j++) {
    const a = j * (seg + 1), b = a + seg;
    const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
    nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}
// hem profile: outer wall from yFar down to the edge, a rounded turn of radius r, the inner wall back up to yIn.
function hemProfile(yEdge, r, yFar, yIn, steps) {
  const p = [];
  for (let k = 0; k <= steps; k++) { const t = k / steps; p.push([yFar + (yEdge + r - yFar) * Math.pow(t, 0.8), 0]); }
  for (let k = 1; k <= 8; k++) { const a = (k / 8) * Math.PI; p.push([yEdge + r - Math.sin(a) * r, -r + Math.cos(a) * r - 0 * a]); }
  p.push([yEdge + r + 0.004, -2 * r], [yIn, -2 * r]);
  return p;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Sleeve layout along the arm, in metres from the cuff edge (y = 0), which sits CUFF_AT up the arm from the wrist joint.
const CUFF_AT = -0.011;          // the wrist joint is ~2 cm up the forearm from the wrist crease; the cuff ends just past it
const CUFF = { a: 0.0338, b: 0.027, off: 0.0006 };    // shirt cuff semi-axes (across, back-to-palm); centre toward the palm
const HEM_Y = 0.0135;            // jacket hem: 13.5 mm of shirt cuff shows
const JACKET = { a0: 0.0378, b0: 0.0302, a1: 0.044, b1: 0.037, len: 0.72 };

class Hand {
  constructor(scene, side, T) {
    this.side = side; this.T = T;
    this.group = new THREE.Group(); this.group.name = side + '-hand';
    this.group.add(scene);
    scene.traverse((o) => { if (o.isSkinnedMesh) { this.mesh = o; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    this.uvMeters = this.mesh.userData.uvMeters || 0.457;
    const bone = (n) => scene.getObjectByName(n);
    this.wrist = bone('wrist');
    // Trim the forearm stub to 2 cm past the wrist (+Y runs up the arm) so it stays inside the cuff when the wrist bends.
    const g = this.mesh.geometry, y = g.attributes.position, idx = g.index.array, cut = this.wrist.position.y + 0.02, keep = [];
    for (let i = 0; i < idx.length; i += 3) if (y.getY(idx[i]) <= cut || y.getY(idx[i + 1]) <= cut || y.getY(idx[i + 2]) <= cut) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    g.setIndex(keep);
    // Slim the forearm stub where the cuff covers it (it is never seen there), so a bent wrist cannot push skin through
    // the cuff: from the cuff edge up the arm the skin is drawn in toward the wrist axis, up to 30 %.
    {
      const qi = this.wrist.quaternion.clone().invert(), wp = this.wrist.position, v = new THREE.Vector3();
      for (let i = 0; i < y.count; i++) {
        v.fromBufferAttribute(y, i).sub(wp).applyQuaternion(qi);
        const t = Math.min(1, Math.max(0, (v.z + 0.01) / 0.024)), k = 1 - 0.3 * t * t * (3 - 2 * t);
        if (k > 0.999) continue;
        v.x *= k; v.y = (v.y + 0.0016) * k - 0.0016;
        v.applyQuaternion(this.wrist.quaternion).add(wp); y.setXYZ(i, v.x, v.y, v.z);
      }
      y.needsUpdate = true;
    }
    this.chains = {};
    const build = (key, prefix, segs) => {
      const bones = segs.map((s) => bone(`${prefix}-${s}`));
      const P = bones.map((b) => b.position.clone()), Q = bones.map((b) => b.quaternion.clone());
      const rel = Q.map((q, j) => (j ? Q[j - 1].clone().invert().multiply(q) : q.clone()));
      const len = P.slice(0, -1).map((p, j) => P[j + 1].clone().sub(p).applyQuaternion(Q[j].clone().invert()));
      this.chains[key] = { bones, P, Q, rel, len };
    };
    for (const [k, p] of Object.entries(FINGERS)) build(k, p, LONG);
    build('thumb', 'thumb', THUMB);
    this.pose = { thumb: [0, 0, 0, 0], index: [0, 0, 0, 0], middle: [0, 0, 0, 0], ring: [0, 0, 0, 0], pinky: [0, 0, 0, 0], cup: 0 };
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  // pose: finger = [mcp, pip, dip, spread]; thumb = [cmcFlex, cmcSpread, mcp, ip]; cup = palm arch.
  apply(pose = this.pose) {
    const { _q: q, _e: e, _v: v } = this;
    const mirror = this.side === 'left' ? -1 : 1;
    for (const [key, ch] of Object.entries(this.chains)) {
      const p = pose[key] || [0, 0, 0, 0];
      const isThumb = key === 'thumb';
      const Q = ch.Q[0].clone(), P = ch.P[0].clone();
      const cup = isThumb ? 0 : pose.cup * ({ index: -0.1, middle: 0, ring: 0.5, pinky: 1 }[key]);
      if (isThumb) Q.multiply(q.setFromEuler(e.set(-p[0], p[1] * mirror, 0)));
      else if (cup) Q.multiply(q.setFromEuler(e.set(-cup * 0.35, 0, 0)));
      ch.bones[0].position.copy(P); ch.bones[0].quaternion.copy(Q);
      for (let j = 1; j < ch.bones.length; j++) {
        P.add(v.copy(ch.len[j - 1]).applyQuaternion(Q));
        Q.multiply(ch.rel[j]);
        const curl = isThumb ? (j === 1 ? p[2] : j === 2 ? p[3] : 0) : (p[j - 1] || 0) * (j < 4 ? 1 : 0);
        const spread = !isThumb && j === 1 ? (p[3] || 0) * mirror : 0;
        Q.multiply(q.setFromEuler(e.set(-curl, spread, 0, 'YXZ')));
        ch.bones[j].position.copy(P); ch.bones[j].quaternion.copy(Q);
      }
    }
  }

  // Forearm (shirt cuff + jacket sleeve) lives in world space and is aimed from the wrist to an elbow point each
  // frame, because the real wrist bends; it rolls with the wrist so the oval keeps to the forearm. The watch rides on
  // the hand's wrist frame. Sleeve-local axes: +Y up the arm, +X the wrist's across axis, +Z toward the palm.
  dress({ sleeve, cuff, watch, buttons = true }) {
    if (this.dressing) this.group.children[0].remove(this.dressing);
    this.sleeve ||= new THREE.Group();
    this.sleeve.traverse((o) => { if (o.isMesh && o !== this.cap) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    this.sleeve.clear();
    const right = this.side === 'right';
    // On the watch hand the cuff stops a little higher, just above the watch.
    this.cuffAt = watch ? -0.002 : CUFF_AT;
    const cuffProf = hemProfile(0, 0.0011, HEM_Y + 0.022, 0.018, 10);
    const cuffGeo = tubeGeometry({ prof: cuffProf, A: () => CUFF.a, B: () => CUFF.b, seg: 72, offZ: CUFF.off, uRep: Math.round((2 * Math.PI * 0.029) / (OXFORD_MM / 1000)), vScale: 1000 / OXFORD_MM });
    const cuffMat = new THREE.MeshPhysicalMaterial({ color: cuff, roughness: 0.82, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(cuff).multiplyScalar(0.9), normalMap: oxfordNormal(), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide });
    // topstitching 5 mm from the cuff edge: a fine darker line in the cuff's own colour
    cuffMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float yy = vNormalMapUv.y * ${OXFORD_MM / 1000}; float st = smoothstep( 0.00045, 0.0, abs( yy - 0.0058 ) ) * step( 0.5, fract( vNormalMapUv.x * 9.0 ) );
          diffuseColor.rgb *= 1.0 - 0.18 * st; }`);
    };
    const cuffMesh = new THREE.Mesh(cuffGeo, cuffMat);
    // Jacket sleeve: tapers from the hem to the elbow; a little ease bunches above the hem; two soft folds near the elbow.
    const J = JACKET, ramp = (y) => smooth(HEM_Y, HEM_Y + 0.3, y);
    const folds = (ph, y) => {
      let d = 0.0016 * Math.exp(-(((y - HEM_Y - 0.035 - 0.006 * Math.sin(ph * 2 + 0.6)) / 0.012) ** 2)) * (0.5 + 0.5 * Math.cos(ph - 0.8));
      d += 0.0022 * Math.exp(-(((y - 0.2 - 0.03 * Math.cos(ph)) / 0.03) ** 2)) * (0.55 + 0.45 * Math.sin(ph * 2 + 1.1));
      d += 0.0018 * Math.exp(-(((y - 0.3 + 0.025 * Math.sin(ph)) / 0.028) ** 2)) * (0.5 + 0.5 * Math.cos(ph * 3 + 0.4));
      d += 0.0012 * Math.sin(ph * 5 + y * 40) * smooth(0.1, 0.3, y);
      return d;
    };
    const jProf = hemProfile(HEM_Y, 0.0016, J.len, HEM_Y + 0.05, 40);
    const tw = tweedMaps(sleeve, '#b8ab90');
    const circ = Math.PI * (J.a0 + J.b0) * 1.1;
    const jGeo = tubeGeometry({ prof: jProf, A: (y) => J.a0 + (J.a1 - J.a0) * ramp(y), B: (y) => J.b0 + (J.b1 - J.b0) * ramp(y), bump: folds, seg: 96, uRep: Math.round(circ / (TWEED_MM / 1000)), vScale: 1000 / TWEED_MM });
    const jMat = new THREE.MeshPhysicalMaterial({ map: tw.map, normalMap: tw.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.9, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(sleeve).multiplyScalar(1.4), side: THREE.DoubleSide });
    const jacket = new THREE.Mesh(jGeo, jMat); this.sleeveMesh = jacket;
    // three sleeve buttons on the outer back of the sleeve (horn), kissing
    const btnMat = new THREE.MeshPhysicalMaterial({ color: 0x2a1d15, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const btnGeo = new THREE.CylinderGeometry(0.0058, 0.0056, 0.0024, 28);
    // between the back of the forearm (-Z) and its little-finger side (+X on the right wrist, -X on the left)
    const bAng = -Math.PI * 0.3;
    for (let k = 0; k < (buttons ? 3 : 0); k++) {
      const y = HEM_Y + 0.03 + k * 0.0112, a = J.a0 + (J.a1 - J.a0) * ramp(y), b = J.b0 + (J.b1 - J.b0) * ramp(y);
      const ph = right ? bAng : -Math.PI - bAng, c = Math.cos(ph), s = Math.sin(ph);
      let nx = c / a, nz = s / b; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
      const btn = new THREE.Mesh(btnGeo, btnMat);
      btn.position.set(a * c + nx * (folds(ph, y) + 0.0012), y, b * s + nz * (folds(ph, y) + 0.0012));
      btn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
      btn.castShadow = true; jacket.add(btn);
    }
    // The cuff hangs on a pivot at the jacket hem and turns part of the way toward the hand's own axis, so a bent
    // wrist stays inside it (aimSleeve sets the turn).
    const pivot = new THREE.Group(); pivot.position.y = HEM_Y; this.cuffPivot = pivot;
    cuffMesh.position.y = -HEM_Y; pivot.add(cuffMesh);
    for (const m of [jacket, cuffMesh]) { m.castShadow = m.receiveShadow = true; }
    this.sleeve.add(jacket, pivot);
    // A dark skin disc just inside the cuff closes the hand mesh's open wrist, which can show when looking down the sights.
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(CUFF.a - 0.003, 1, CUFF.b - 0.003).translate(0, 0.012, CUFF.off),
      this.capMat ||= new THREE.MeshStandardMaterial({ color: 0x3a2218, roughness: 0.8, side: THREE.DoubleSide }));
    cap.position.y = -HEM_Y; pivot.add(cap); this.cap = cap;
    // The watch rides on the wrist bone's frame (X across, Y back of the hand, Z up the arm), on the back of the wrist
    // just past the cuff, 12 o'clock toward the fingers.
    const d = new THREE.Group(); d.position.copy(this.wrist.position); d.quaternion.copy(this.wrist.quaternion);
    if (watch) {
      const z = -0.013;
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.017, 96, 1, true).rotateX(Math.PI / 2).scale(0.0301, 0.0193, 1),
        new THREE.MeshPhysicalMaterial({ color: 0x3b2316, roughness: 0.55, clearcoat: 0.2, side: THREE.DoubleSide }));
      strap.position.set(0, -0.0016, z); d.add(strap);
      const caseG = new THREE.Group(); caseG.position.set(0, 0.0215, z); d.add(caseG);
      caseG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0168, 0.0178, 0.0072, 96), new THREE.MeshPhysicalMaterial({ color: 0xd9b46a, metalness: 1, roughness: 0.2 })));
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0146, 96), new THREE.MeshPhysicalMaterial({ map: watchFace(), roughness: 0.3, clearcoat: 1 }));
      face.rotation.x = -Math.PI / 2; face.rotation.z = Math.PI; face.position.y = 0.0037; caseG.add(face);
      caseG.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    }
    this.group.children[0].add(d); this.dressing = d;
  }

  aimSleeve(elbow) {
    if (!this.sleeve) return;
    const mw = this.wrist.matrixWorld, w = this.wrist.getWorldPosition(this._v);
    // the forearm runs between the elbow line and the hand's own axis (wrist +Z): a real wrist bends, but not that far
    const dir = this._z.copy(elbow).sub(w).normalize().multiplyScalar(0.7).add(new THREE.Vector3(0, 0, 1).transformDirection(mw).multiplyScalar(0.3)).normalize();
    // roll: the wrist's across axis (+X), kept square to the forearm
    const x = this._x.set(1, 0, 0).transformDirection(mw); x.addScaledVector(dir, -x.dot(dir)).normalize();
    const z = new THREE.Vector3().crossVectors(x, dir);
    this._m.makeBasis(x, dir, z);
    // +Z of the sleeve faces the palm (the wrist's -Y); if the basis points the other way (left hand, mirrored view), reflect it
    const palm = new THREE.Vector3(0, -1, 0).transformDirection(mw);
    this.sleeve.quaternion.setFromRotationMatrix(this._m);
    this.sleeve.scale.set(1, 1, palm.dot(z) < 0 ? -1 : 1);
    this.sleeve.position.copy(w).addScaledVector(dir, this.cuffAt ?? CUFF_AT);
    // turn the cuff halfway toward the hand's forearm axis (wrist +Z), at most 8 degrees
    const hz = new THREE.Vector3(0, 0, 1).transformDirection(mw);
    const loc = new THREE.Vector3(hz.dot(x), hz.dot(dir), hz.dot(z) * this.sleeve.scale.z).normalize();
    const full = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), loc);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
    this.cuffPivot.quaternion.identity().slerp(full, ang > 1e-4 ? Math.min(0.5, 0.14 / ang) : 0);
  }

  setSkin(name) {
    const s = SKINS[name] || SKINS.medium;
    this.mats ||= {};
    const m = this.mats[name] ||= skinMaterial(name in SKINS ? name : 'medium', this.T, this.uvMeters);
    this.mesh.material = m;
    this.capMat ||= new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
    this.capMat.color.set(s.cap);
  }
}

function watchFace() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = cv.getContext('2d'), c = S / 2, d = new Date();
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#2a2116';
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30, r0 = i % 5 ? 216 : 192;
      g.lineWidth = i % 5 ? 4 : 12; g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * 236, c - Math.cos(a) * 236); g.stroke();
    }
    const hand = (a, len, w) => { g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len); g.stroke(); };
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    g.strokeStyle = '#1c150e'; hand(h * Math.PI / 6, 120, 18); hand(m * Math.PI / 30, 184, 12);
    g.fillStyle = '#b08d4a'; g.beginPath(); g.arc(c, c, 16, 0, Math.PI * 2); g.fill();
    t.needsUpdate = true;
  };
  draw(); setInterval(draw, 30000);
  return t;
}

export async function loadHands() {
  const gltf = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO));
  const tl = new THREE.TextureLoader();
  const tex = (name, srgb = false, repeat = false) => tl.loadAsync(MODELS + name).then((t) => {
    t.flipY = false; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
  const [l, r, albedo, nx, ny, orm, gloveNx, gloveNy, gloveSt, pores, leather] = await Promise.all([
    gltf.loadAsync(MODELS + 'hand_left.glb'), gltf.loadAsync(MODELS + 'hand_right.glb'),
    tex('hand_albedo.webp', true), tex('hand_nx.webp'), tex('hand_ny.webp'), tex('hand_orm.webp'),
    tex('hand_glove_nx.webp'), tex('hand_glove_ny.webp'), tex('hand_glove_st.webp'), tex('hand_pores.webp', false, true), tex('hand_leather.webp', false, true),
  ]);
  const T = { albedo, nx, ny, orm, gloveNx, gloveNy, gloveSt, pores, leather };
  return { left: new Hand(l.scene, 'left', T), right: new Hand(r.scene, 'right', T) };
}
