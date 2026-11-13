// Double-action six-shot revolver (large frame, 6.5 in barrel, .44 Magnum class). The model is a third-party
// scan-quality asset (CC BY 4.0, see CREDITS.md) converted by tools/blender/import_sw629.py into
// assets/models/revolver.glb + maps; its finish is built here, so three looks switch live.
// Gun space: metres, +X right, +Y up, -Z toward the muzzle. Root origin = trigger-finger point.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const STEP = Math.PI / 3;
export const OPEN_ANGLE = 1.6;      // crane.rotation.z that swings the cylinder fully out to the left
export const HAMMER_COCK = 0.71;    // hammer.rotation.x when cocked (spur moves back, +Z)
export const TRIGGER_PULL = -0.36;  // trigger.rotation.x at full pull (blade moves back, +Z)
export const LOOKS = [
  { id: 'service', name: 'Service', note: 'Worn blue, walnut' },
  { id: 'stainless', name: 'Stainless', note: 'Brushed steel, black rubber' },
  { id: 'nickel', name: 'Nickel', note: 'Bright nickel, ivory' },
];
const FINISH_TO_LOOK = { blued: 'service', service: 'service', stainless: 'stainless', nickel: 'nickel' };

const MODELS = new URL('../assets/models/', import.meta.url).href;
const DRACO = new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href;
const NODES = ['Frame', 'Grip', 'Hammer', 'Trigger', 'Crane', 'Cylinder', 'Muzzle', 'Gap', 'RearSight', 'FrontSight',
  ...[0, 1, 2, 3, 4, 5].flatMap((i) => [`Cartridge${i}`, `Primer${i}`])];

// ---------------------------------------------------------------- shared assets (one download per page)
let assets = null;
function loadAssets() {
  if (assets) return assets;
  const draco = new DRACOLoader().setDecoderPath(DRACO);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const tl = new THREE.TextureLoader();
  const tex = (name, srgb = false) => tl.loadAsync(MODELS + name).then((t) => {
    t.flipY = false; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
  });
  assets = Promise.all([
    gltf.loadAsync(MODELS + 'revolver.glb'),
    tex('revolver_wear.webp'), tex('revolver_scratch.webp'), tex('revolver_grip_n.webp'), tex('revolver_grip_m.webp'),
    tex('revolver_normal.webp'), tex('revolver_detail.webp'),
  ]).then(([g, wear, scratch, gripN, gripM, normal, detail]) => {
    scratch.wrapS = scratch.wrapT = THREE.RepeatWrapping; scratch.flipY = true;
    draco.dispose();
    return { scene: g.scene, wear, scratch, gripN, gripM, normal, detail };
  });
  return assets;
}

// The model's own frame (origin = trigger pivot) placed in gun space: the trigger pivot sits where the old gun's
// did, 13 mm above and 3 mm behind the trigger-finger point, so the hand, the finger and the sights keep their places.
const FIT = { pos: new THREE.Vector3(0, 0.013, 0.003), rx: 0 };
const FIT_M = new THREE.Matrix4().compose(FIT.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(FIT.rx, 0, 0)), new THREE.Vector3(1, 1, 1));
const FIT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(FIT.rx, 0, 0));
// Model-frame anchors (from the GLB), used before it loads.
const CH_R = 0.0141;
const RAW = {
  muzzle: [0, 0.0424, -0.2046], gap: [0, 0.0424, -0.0389], rear: [0, 0.0631, 0.0178], front: [0, 0.0646, -0.1983],
  crane: [-0.0045, 0, 0.0058], cylinder: [0.0045, 0.0283, 0],
};

// ---------------------------------------------------------------- looks
const lin = (hex) => new THREE.Color(hex);
const STEEL_LOOKS = {
  // base = intact finish, pat = finish gone grey in cloudy patches (and speckle), thin = finish worn thin on edges,
  // worn = bare steel where a carried gun wears through, rustC = small rust freckles, cav = grime in recesses.
  // edge = bare-steel amount at the wear spots, thinAmt = worn-thin amount on the other edges. env = reflection gain/tint
  // (the rooms are warm). src* = how much of the scanned source maps shows through.
  service: {
    base: lin(0x161b23), pat: lin(0x55575b), thin: lin(0x50535a), worn: lin(0x77767a), cav: lin(0x0a0908), rustC: lin(0x4a2a18),
    rBase: 0.32, rWorn: 0.42, rCav: 0.82, mBase: 0.8, mWorn: 1.0,
    edge: 1.0, thinAmt: 0.75, scratch: 0.35, brush: 0.0, cavAmt: 0.85, patina: 0.9, grey: 0.0, speck: 0.6, rust: 0.6, cc: 0.12, ccR: 0.38, caseAmt: 0.85,
    srcRough: 0.15, srcLum: 0.2, iri: 0, iriNm: 330, env: [1.12, 1.2, 1.34],
  },
  stainless: {
    base: lin(0xa19f9a), pat: lin(0x9a9893), thin: lin(0xa8a7a2), worn: lin(0xc0bfbb), cav: lin(0x34332f), rustC: lin(0x9a9893),
    rBase: 0.36, rWorn: 0.24, rCav: 0.55, mBase: 1.0, mWorn: 1.0,
    edge: 0.5, thinAmt: 0.1, scratch: 0.2, brush: 0.25, cavAmt: 0.5, patina: 0.15, grey: 0, speck: 0, rust: 0, cc: 0.0, ccR: 0.3, caseAmt: 0.0,
    srcRough: 0.45, srcLum: 1.0, iri: 0, iriNm: 300, env: [1, 1, 1],
  },
  nickel: {
    base: lin(0xd0d2d4), pat: lin(0xc2c0bb), thin: lin(0xc8cacc), worn: lin(0xeaebec), cav: lin(0x3a3a3a), rustC: lin(0xc2c0bb),
    rBase: 0.2, rWorn: 0.12, rCav: 0.5, mBase: 1.0, mWorn: 1.0,
    edge: 0.45, thinAmt: 0.25, scratch: 0.28, brush: 0.05, cavAmt: 0.75, patina: 0.3, grey: 0, speck: 0, rust: 0, cc: 0.0, ccR: 0.3, caseAmt: 0.0,
    srcRough: 0.15, srcLum: 0.45, iri: 0, iriNm: 300, env: [1, 1, 1],
  },
};
const GRIP_LOOKS = {
  service: { dark: lin(0x120604), light: lin(0x301309), hi: lin(0x55291a), grain: 0.75, rough: 0.32, roughChk: 0.62, cc: 0.85, ccR: 0.08, normal: 'checker', nScale: 1.0 },
  stainless: { dark: lin(0x0b0b0b), light: lin(0x141414), hi: lin(0x1c1c1c), grain: 0.0, rough: 0.78, roughChk: 0.78, cc: 0.0, ccR: 0.6, normal: 'stipple', nScale: 0.7 },
  nickel: { dark: lin(0xcdbf9f), light: lin(0xece5d3), hi: lin(0xf4efe3), grain: 0.25, rough: 0.3, roughChk: 0.42, cc: 0.45, ccR: 0.25, normal: 'checker', nScale: 0.6 },
};
const MEDAL_LOOKS = { service: [0xb9b2a4, 0.42], stainless: [0xb9b8b4, 0.3], nickel: [0xc9a35c, 0.3] };

function steelMaterial(A, isCase, muzzleZ, isCyl = false) {
  const u = {
    tWear: { value: A.wear }, tScr: { value: A.scratch }, tDet: { value: A.detail },
    uBase: { value: new THREE.Color() }, uPat: { value: new THREE.Color() }, uThin: { value: new THREE.Color() }, uWorn: { value: new THREE.Color() }, uCav: { value: new THREE.Color() },
    uR: { value: new THREE.Vector3() }, uM: { value: new THREE.Vector2() },
    uAmt: { value: new THREE.Vector4() }, uAmt2: { value: new THREE.Vector4() }, uAmt3: { value: new THREE.Vector4(0, muzzleZ, 0, 0) },
    uAmt4: { value: new THREE.Vector4() }, uRust: { value: new THREE.Color() }, uEnvK: { value: new THREE.Vector3(1, 1, 1) }, uCyl: { value: isCyl ? 1 : 0 },
  };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3, aoMap: A.wear, aoMapIntensity: 0.65, normalMap: A.normal, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  m.normalScale.set(1, -1);
  m.name = isCase ? 'steel_case' : 'steel';
  m.userData.u = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = 'attribute vec3 aRoot; varying vec3 vLP; varying vec3 vLN; varying vec3 vR;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal; vR = aRoot;');
    s.fragmentShader = `uniform sampler2D tWear, tScr, tDet; uniform vec3 uBase, uPat, uThin, uWorn, uCav, uR; uniform vec2 uM; uniform vec4 uAmt, uAmt2, uAmt3, uAmt4; uniform vec3 uRust; uniform float uCyl;
varying vec3 vLP; varying vec3 vLN; varying vec3 vR;
// 3D value noise in gun space: isotropic, so the patina has no direction and no tile
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
` + s.fragmentShader
      .replace('#include <map_fragment>', `
  vec3 wr = texture2D(tWear, vAoMapUv).rgb;            // r = ao, g = cavity, b = convex edge (baked on the model)
  vec3 dt = texture2D(tDet, vAoMapUv).rgb;             // r = source roughness, g = source metalness, b = source albedo luminance
  vec3 an = pow(abs(normalize(vLN)), vec3(4.0)); an /= (an.x + an.y + an.z);
  vec3 P = vR * 18.0;                                  // 55 mm tile
  vec4 sc = texture2D(tScr, P.zy) * an.x + texture2D(tScr, P.zx) * an.y + texture2D(tScr, P.xy) * an.z;
  vec3 Q = vR + vec3(0.37, 0.11, 0.73);
  float cBig = vn(Q * 22.0) * 0.65 + vn(Q * 51.0) * 0.35;           // ~4 cm clouds
  float cMid = vn(Q * 70.0) * 0.6 + vn(Q * 150.0) * 0.4;            // ~1 cm
  float cSm = vn(Q * 260.0) * 0.6 + vn(Q * 560.0) * 0.4;            // ~3 mm
  float cSp = vn(Q * 1100.0) * 0.6 + vn(Q * 2300.0) * 0.4;          // sub-mm speckle
  // where a carried gun really wears bare (gun space, metres): muzzle + front of barrel/underlug, cylinder front edge,
  // front sight top, top strap corners, bottom of the trigger guard, hammer spur
  float loc = smoothstep(-0.150, -0.195, vR.z);
  loc = max(loc, exp(-pow((vR.z + 0.0362) / 0.0035, 2.0)) * step(0.004, vR.y));
  loc = max(loc, smoothstep(0.056, 0.061, vR.y) * step(vR.z, 0.03));
  loc = max(loc, smoothstep(-0.031, -0.038, vR.y));
  loc = max(loc, smoothstep(0.036, 0.044, vR.y) * step(0.5, uAmt2.z));
  float crown = step(vR.z, uAmt3.y);
  // edges: the finish is only worn thin, and broken up along their length by low-frequency noise
  float e = wr.b;
  float brk = smoothstep(0.42, 0.62, cSm * 0.7 + cMid * 0.3);
  float jit = (cSp - 0.5) * 0.25 + (sc.r - 0.5) * 0.15;
  float thinE = smoothstep(0.2, 0.45, e + jit * 0.6) * brk * uAmt.y;
  float bareE = clamp(smoothstep(0.3, 0.5, e * (0.6 + 0.4 * brk) + loc * 0.4 * cMid + jit) * loc * uAmt.x + crown * smoothstep(0.3, 0.6, cSp + 0.2), 0.0, 1.0);
  float scr = smoothstep(0.6, 0.92, sc.r) * uAmt.z;                               // a few fine handling scratches
  float cav = smoothstep(0.08, 0.55, wr.g) * uAmt2.y;
  float brush = sc.g - 0.5;
  // patina: cloudy isotropic mottling (finish gone grey), fine speckle, and a few small rust freckles
  float pn = cBig * 0.5 + cMid * 0.3 + cSm * 0.2 - (1.0 - wr.r) * 0.15;
  float pat = clamp((smoothstep(0.44, 0.56, pn) * 0.45 + smoothstep(0.54, 0.66, pn) * 0.55) * uAmt2.x + uAmt3.z, 0.0, 1.0);
  float speck = smoothstep(0.62, 0.72, cSm * 0.8 + cSp * 0.2) * smoothstep(0.35, 0.55, cBig) * uAmt4.x;
  float rust = smoothstep(0.7, 0.76, cSm * 0.7 + cMid * 0.3) * smoothstep(0.5, 0.6, cBig) * uAmt4.y;
  vec3 col = mix(uBase, uPat * (0.8 + 0.4 * cSm), pat);
  col = mix(col, uPat, speck * 0.6);
  col = mix(col, uThin, clamp(thinE, 0.0, 1.0));
  col = mix(col, uThin, scr * 0.7);
  col = mix(col, uRust, rust);
  col = mix(col, uWorn, bareE);
  // case colours (hammer, trigger): mottled blue / straw / purple film over the steel
  vec3 caseC = mix(mix(vec3(0.030, 0.040, 0.075), vec3(0.120, 0.085, 0.040), smoothstep(0.5, 0.68, cMid)), vec3(0.060, 0.040, 0.075), smoothstep(0.4, 0.6, sc.b) * 0.6);
  col = mix(col, mix(mix(uBase, caseC, 0.55), uWorn, bareE * 0.8), uAmt2.z);
  col *= 1.0 + brush * uAmt.w * 0.5;
  col *= mix(1.0, clamp(dt.b / 0.72, 0.0, 1.4), uAmt3.x);                       // the scan's own scuffs and grime
  col = mix(col, uCav, cav);
  float gRough = mix(uR.x, uR.y, bareE) + pat * 0.2 + speck * 0.08 + rust * 0.3 + scr * 0.06 + brush * uAmt.w * 0.35 + (cSp - 0.5) * 0.06;
  gRough = mix(gRough, dt.r, uAmt2.w);
  gRough = clamp(mix(gRough, uR.z, cav), 0.04, 1.0);
  float gMetal = mix(uM.x, uM.y, max(bareE, uAmt2.z * 0.5)) * mix(1.0, dt.g, 0.6) * (1.0 - rust * 0.8) * (1.0 - pat * 0.3 * uAmt2.x);
  // cylinder rear face: the extractor star, ratchet and the face around them are drawn here, sharp at any distance
  // (the scanned maps are blurry there). Cylinder space, mm: axis = z, chamber 0 at +y, 14.1 mm off the axis.
  vec2 cq = vLP.xy * 1000.0; float cr = length(cq);
  float starZone = uCyl * step(-0.0012, vLP.z) * smoothstep(0.55, 0.8, normalize(vLN).z) * (1.0 - smoothstep(11.0, 11.6, cr));
  float starAO = 1.0;
  if (starZone > 0.0) {
    float seg = 1.0471976, th = atan(cq.x, cq.y);
    float k = floor(th / seg + 0.5) * seg;
    float dc = length(cq - 14.1 * vec2(sin(k), cos(k)));                       // to the nearest chamber centre
    float sd = max(7.6 - dc, cr - 9.25);                                         // < 0 inside the star: arcs round each chamber
    float fw = max(fwidth(sd), 0.02);
    float star = 1.0 - smoothstep(-fw, fw, sd);
    float groove = 1.0 - smoothstep(0.07, 0.07 + fw * 1.5, abs(sd));
    float hub = 1.0 - smoothstep(4.35 - fw, 4.35 + fw, cr);
    float machined = max(star, hub);
    vec3 face = mix(uBase, uPat, 0.55) * (0.85 + 0.3 * cSm);
    vec3 steelM = uWorn * (0.78 + 0.25 * cSm);
    vec3 zc = mix(face, steelM, machined);
    zc *= 1.0 - groove * 0.85;
    col = mix(col, zc, starZone);
    gRough = mix(gRough, mix(0.5, 0.36, machined), starZone);
    gMetal = mix(gMetal, mix(0.5, 0.75, machined), starZone);
    starAO = 1.0 - groove * 0.8;
  }
  diffuseColor.rgb = col;
  float gCoat = (1.0 - bareE * 0.7) * (1.0 - cav * 0.5) * (1.0 - pat * 0.6) * (1.0 - starZone);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, nonPerturbedNormal, starZone));')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= mix(1.0, starAO / max(ambientOcclusion, 0.05), starZone);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= gCoat;\n#endif')
      // per-look reflection gain and tint (the rooms are warm; scene.environmentIntensity overrides envMapIntensity)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n  radiance *= uEnvK; iblIrradiance *= uEnvK;\n#ifdef USE_CLEARCOAT\n  clearcoatRadiance *= uEnvK;\n#endif');
    s.fragmentShader = 'uniform vec3 uEnvK;\n' + s.fragmentShader;
  };
  m.customProgramCacheKey = () => m.name + '-v7';
  return m;
}

function applySteelLook(m, L) {
  const u = m.userData.u;
  u.uBase.value.copy(L.base); u.uPat.value.copy(L.pat); u.uThin.value.copy(L.thin); u.uWorn.value.copy(L.worn); u.uCav.value.copy(L.cav);
  u.uR.value.set(L.rBase, L.rWorn, L.rCav); u.uM.value.set(L.mBase, L.mWorn);
  u.uAmt.value.set(L.edge, L.thinAmt, L.scratch, L.brush);
  u.uAmt2.value.set(L.patina, L.cavAmt, m.name === 'steel_case' ? L.caseAmt : 0, L.srcRough);
  u.uAmt3.value.x = L.srcLum; u.uAmt3.value.z = L.grey;
  u.uAmt4.value.set(L.speck, L.rust, 0, 0); u.uRust.value.copy(L.rustC);
  u.uEnvK.value.fromArray(L.env);
  m.clearcoat = L.cc; m.clearcoatRoughness = L.ccR;
  // blued steel is a thin oxide film: iridescence tints its reflections blue
  m.iridescence = L.iri; m.iridescenceIOR = 2.0; m.iridescenceThicknessRange = [L.iriNm * 0.8, L.iriNm];
}

function gripMaterial(A) {
  const u = { tGM: { value: A.gripM }, uDark: { value: new THREE.Color() }, uLight: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uP: { value: new THREE.Vector4() } };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: A.gripM, roughness: 0.4, metalness: 0, normalMap: A.gripN, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  m.name = 'grip'; m.userData.u = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = 'uniform sampler2D tGM; uniform vec3 uDark, uLight, uHi; uniform vec4 uP;\n' + s.fragmentShader
      .replace('#include <map_fragment>', `
  vec3 gm = texture2D(tGM, vMapUv).rgb;                // r = grain, g = checkered field, b = figure
  float g = mix(0.5, gm.r, uP.x);
  vec3 col = mix(uDark, uLight, smoothstep(0.1, 0.95, g * 0.55 + (gm.b - 0.5) * 0.6 * uP.x + 0.25));
  col = mix(col, uHi, smoothstep(0.62, 0.95, gm.b) * 0.35 * uP.x);
  col *= mix(1.0, 0.72, gm.g * uP.x);
  diffuseColor.rgb = col;
  float gRough = mix(uP.y, uP.z, gm.g);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= (1.0 - gm.g * 0.7);\n#endif');
  };
  m.customProgramCacheKey = () => 'grip-v3' + (m.normalMap ? m.normalMap.uuid : '');
  return m;
}

function applyGripLook(m, L, A, stipple) {
  const u = m.userData.u;
  u.uDark.value.copy(L.dark); u.uLight.value.copy(L.light); u.uHi.value.copy(L.hi);
  u.uP.value.set(L.grain, L.rough, L.roughChk, 0);
  const nm = L.normal === 'checker' ? A.gripN : L.normal === 'stipple' ? stipple : null;
  if (m.normalMap !== nm) { m.normalMap = nm; m.needsUpdate = true; }
  m.normalScale.set(L.nScale, -L.nScale);
  m.clearcoat = L.cc; m.clearcoatRoughness = L.ccR;
}

// ---------------------------------------------------------------- canvas textures (headstamp, brushing, stipple)
function canvasTex(S, draw, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  draw(cv.getContext('2d'), S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.flipY = false;
  return t;
}
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function headstampTex() {
  return canvasTex(512, (g, S) => {
    const r = rnd(5), c = S / 2, k = S / 13.2; // 13.2 mm across (the case head UV)
    g.fillStyle = '#c99a4c'; g.fillRect(0, 0, S, S);
    // fine concentric lathe marks
    for (let i = 0; i < 400; i++) {
      const rr = (2.7 + r() * 3.4) * k; g.strokeStyle = r() > 0.5 ? 'rgba(255,236,190,.10)' : 'rgba(90,60,20,.10)';
      g.lineWidth = 0.6 + r(); g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke();
    }
    // tarnish blotches
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.283, d = (2.9 + r() * 3.0) * k, rad = (0.3 + r() * 0.9) * k;
      const gr = g.createRadialGradient(c + Math.cos(a) * d, c + Math.sin(a) * d, 0, c + Math.cos(a) * d, c + Math.sin(a) * d, rad);
      gr.addColorStop(0, 'rgba(110,70,25,.22)'); gr.addColorStop(1, 'rgba(110,70,25,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    // primer pocket ring (dark crimp line)
    g.strokeStyle = 'rgba(40,24,6,.85)'; g.lineWidth = 0.22 * k; g.beginPath(); g.arc(c, c, 2.7 * k, 0, Math.PI * 2); g.stroke();
    // stamped letters: dark floor with a light upper lip
    const word = (txt, mid, flip) => {
      g.font = `700 ${1.05 * k}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const chars = [...txt], sp = 0.2;
      chars.forEach((ch, i) => {
        const a = mid + (flip ? -1 : 1) * (i - (chars.length - 1) / 2) * sp;
        g.save(); g.translate(c + Math.cos(a) * 4.45 * k, c + Math.sin(a) * 4.45 * k); g.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        g.fillStyle = 'rgba(255,235,185,.55)'; g.fillText(ch, 0, -0.05 * k);
        g.fillStyle = 'rgba(52,32,8,.92)'; g.fillText(ch, 0.02 * k, 0.04 * k); g.restore();
      });
    };
    word('.44 MAG', -Math.PI / 2, false);
    word('240 GR', Math.PI / 2, true);
  });
}
function brushTex() { // lathe-turned brass case: fine lines around the case
  return canvasTex(256, (g, S) => {
    const r = rnd(9); g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.08})`; g.fillRect(0, r() * S, S, 0.5 + r()); }
  }, false);
}
function stippleTex() { // fine rubber stipple as a normal map
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), r = rnd(3), h = new Float32Array(S * S);
  for (let i = 0; i < 2600; i++) {
    const x0 = r() * S, y0 = r() * S, rad = 1.6 + r() * 2.2;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const d = Math.hypot(x, y) / rad; if (d < 1) { const X = (Math.floor(x0) + x + S) % S, Y = (Math.floor(y0) + y + S) % S; h[Y * S + X] += Math.cos(d * Math.PI / 2); }
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S], dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const n = new THREE.Vector3(-dx, -dy, 2).normalize(), i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(26, 26);
  return t;
}

// fired primer: a firing-pin dent in the centre of the cup
function dentGeometry(src) {
  const g = src.clone(), p = g.attributes.position;
  let zmax = -Infinity; for (let i = 0; i < p.count; i++) zmax = Math.max(zmax, p.getZ(i));
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i)) * 1000; // mm
    if (p.getZ(i) > zmax - 0.00003) {
      const dent = r < 1.1 ? 0.45 * Math.cos((r / 1.1) * Math.PI / 2) ** 1.3 : 0;
      const lip = r >= 1.1 && r < 1.7 ? -0.03 * Math.sin(((r - 1.1) / 0.6) * Math.PI) : 0;
      p.setZ(i, p.getZ(i) - (dent + lip) / 1000);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the API
export function createRevolver({ look, finish } = {}) {
  let current = look || FINISH_TO_LOOK[finish] || 'service';
  const G = (name) => { const o = new THREE.Group(); o.name = name; return o; };
  const root = G('revolver'), frame = G('Frame'), grip = G('Grip'), hammer = G('Hammer'), trigger = G('Trigger');
  const crane = G('Crane'), cylinder = G('Cylinder');
  const muzzle = G('Muzzle'), gap = G('Gap'), rearSight = G('RearSight'), frontSight = G('FrontSight');
  const cartridges = [], primers = [];
  root.add(frame, grip, hammer, trigger, crane, muzzle, gap, rearSight, frontSight);
  crane.add(cylinder);
  for (let i = 0; i < 6; i++) { const c = G(`Cartridge${i}`), p = G(`Primer${i}`); c.add(p); cylinder.add(c); cartridges.push(c); primers.push(p); }
  // placeholders already sit where the model will put them, so the app can read positions before load
  muzzle.position.fromArray(RAW.muzzle).applyMatrix4(FIT_M); gap.position.fromArray(RAW.gap).applyMatrix4(FIT_M);
  rearSight.position.fromArray(RAW.rear).applyMatrix4(FIT_M); frontSight.position.fromArray(RAW.front).applyMatrix4(FIT_M);
  crane.position.fromArray(RAW.crane).applyMatrix4(FIT_M); crane.quaternion.copy(FIT_Q); cylinder.position.fromArray(RAW.cylinder);
  for (let i = 0; i < 6; i++) { cartridges[i].position.set(Math.sin(i * STEP) * CH_R, Math.cos(i * STEP) * CH_R, 0.00098); cartridges[i].rotation.z = -i * STEP; }

  const dims = { BORE_Y: muzzle.position.y, MUZZLE_Z: muzzle.position.z, CYL_R: 0.0215, CH_R };
  const state = { fired: [false, false, false, false, false, false], primerMeshes: [], mats: null, A: null, stipple: null };

  const api = {
    root, crane, cylinder, hammer, trigger, muzzle, gap, rearSight, frontSight, cartridges, dims,
    get look() { return current; },
    setFired(i, fired) {
      state.fired[i] = !!fired;
      const m = state.primerMeshes[i]; if (!m) return;
      m.geometry = fired ? m.userData.dented : m.userData.flat;
      m.material = fired ? state.mats.primerFired : state.mats.primer;
    },
    setLoaded(i, loaded) { cartridges[i].visible = !!loaded; },
    setLook(id) {
      current = STEEL_LOOKS[id] ? id : 'service';
      if (!state.mats) return;
      for (const k of ['steel', 'steelCase', 'steelCyl']) applySteelLook(state.mats[k], STEEL_LOOKS[current]);
      applyGripLook(state.mats.grip, GRIP_LOOKS[current], state.A, state.stipple);
      const [mc, mr] = MEDAL_LOOKS[current]; state.mats.medal.color.setHex(mc); state.mats.medal.roughness = mr;
    },
    setFinish(name) { api.setLook(FINISH_TO_LOOK[name] || 'service'); },
    setWood() {}, // the grips follow the look
  };

  api.ready = loadAssets().then((A) => {
    state.A = A; state.stipple = stippleTex();
    const muzzleZ = RAW.muzzle[2] + FIT.pos.z + 0.004; // gun space: the last 4 mm of the barrel is the worn crown
    const steel = steelMaterial(A, false, muzzleZ), steelCase = steelMaterial(A, true, muzzleZ), gripM = gripMaterial(A);
    const steelCyl = steelMaterial(A, false, muzzleZ, true);
    const medal = new THREE.MeshPhysicalMaterial({ color: 0xc9a35c, metalness: 1, roughness: 0.35, envMapIntensity: 1.3 });
    const brass = new THREE.MeshPhysicalMaterial({ color: 0xe7b062, metalness: 1, roughness: 0.3, roughnessMap: brushTex(), envMapIntensity: 1.3 });
    const head = new THREE.MeshPhysicalMaterial({ map: headstampTex(), metalness: 1, roughness: 0.26, envMapIntensity: 1.6 });
    const lead = new THREE.MeshPhysicalMaterial({ color: 0x55575a, metalness: 0.55, roughness: 0.55 });
    const primer = new THREE.MeshPhysicalMaterial({ color: 0xb4afa5, metalness: 1, roughness: 0.4 });   // satin nickel cup
    const primerFired = new THREE.MeshPhysicalMaterial({ color: 0x8f8170, metalness: 1, roughness: 0.46 });
    state.mats = { steel, steelCase, steelCyl, grip: gripM, medal, primer, primerFired };
    const byName = { steel, steel_case: steelCase, grip: gripM, medallion: medal, brass, brass_head: head, lead, primer };

    const holders = { Frame: frame, Grip: grip, Hammer: hammer, Trigger: trigger, Crane: crane, Cylinder: cylinder, Muzzle: muzzle, Gap: gap, RearSight: rearSight, FrontSight: frontSight };
    cartridges.forEach((c, i) => { holders[`Cartridge${i}`] = c; holders[`Primer${i}`] = primers[i]; });
    A.scene.updateMatrixWorld(true);
    A.scene.traverse((n) => {
      const h = holders[n.name]; if (!h) return;
      h.position.copy(n.position); h.quaternion.copy(n.quaternion); h.scale.copy(n.scale);
      if (n.parent === A.scene || n.parent?.name === 'Revolver') { h.position.applyMatrix4(FIT_M); h.quaternion.premultiply(FIT_Q); }
      const own = n.isMesh ? [n] : n.children.filter((c) => c.isMesh && !NODES.includes(c.name));
      for (const src of own) {
        let mat = byName[src.material.name] || steel;
        if (n.name === 'Cylinder' && mat === steel) mat = steelCyl;
        const mesh = new THREE.Mesh(src.geometry, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        if (src !== n) { mesh.position.copy(src.position); mesh.quaternion.copy(src.quaternion); }
        h.add(mesh);
        if (n.name.startsWith('Primer')) {
          const i = +n.name.slice(6);
          mesh.userData.flat = src.geometry;
          mesh.userData.dented = state.dent || (state.dent = dentGeometry(src.geometry));
          state.primerMeshes[i] = mesh;
        }
      }
    });
    // steel meshes carry their rest-pose position in gun space, so wear and patina sit at fixed places on the gun
    const rootInv = new THREE.Matrix4(), rel = new THREE.Matrix4(), v = new THREE.Vector3();
    root.updateMatrixWorld(true); rootInv.copy(root.matrixWorld).invert();
    root.traverse((o) => {
      if (!o.isMesh || ![steel, steelCase, steelCyl].includes(o.material) || o.geometry.attributes.aRoot) return;
      rel.multiplyMatrices(rootInv, o.matrixWorld);
      const p = o.geometry.attributes.position, a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(rel).toArray(a, i * 3);
      o.geometry.setAttribute('aRoot', new THREE.BufferAttribute(a, 3));
    });
    dims.MUZZLE_Z = muzzle.position.z; dims.BORE_Y = muzzle.position.y;
    api.setLook(current);
    state.fired.forEach((f, i) => api.setFired(i, f));
    return api;
  }).catch((e) => { console.error('revolver: load failed', e); throw e; });

  return api;
}
