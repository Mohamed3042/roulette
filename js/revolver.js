// Double-action service revolver (medium frame, 4 in barrel, six .38 Special rounds), modelled in Blender
// (tools/blender/build_revolver.py) and loaded from assets/models/revolver.glb. Three looks switch live.
// Gun space: metres, +X right, +Y up, -Z toward the muzzle. Root origin = trigger-finger point.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const STEP = Math.PI / 3;
export const OPEN_ANGLE = 1.6;      // crane.rotation.z that swings the cylinder fully out to the left
export const HAMMER_COCK = 0.75;    // hammer.rotation.x when cocked (spur moves back, +Z)
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
  ]).then(([g, wear, scratch, gripN, gripM]) => {
    scratch.wrapS = scratch.wrapT = THREE.RepeatWrapping; scratch.flipY = true;
    draco.dispose();
    return { scene: g.scene, wear, scratch, gripN, gripM };
  });
  return assets;
}

// ---------------------------------------------------------------- looks
const lin = (hex) => new THREE.Color(hex);
const STEEL_LOOKS = {
  // base = intact finish, thin = finish worn thin on high spots, worn = bare steel at edges/scratches, cav = grime in recesses
  service: {
    base: lin(0x12161e), thin: lin(0x394049), worn: lin(0xa4a7ab), cav: lin(0x0e0c0a),
    rBase: 0.2, rWorn: 0.38, rCav: 0.8, mBase: 0.55, mWorn: 1.0,
    edge: 1.35, thinAmt: 0.7, scratch: 1.0, brush: 0.05, cavAmt: 0.85, blotch: 0.45, cc: 0.8, ccR: 0.12, caseAmt: 1.0, iri: 0, iriNm: 330,
  },
  stainless: {
    base: lin(0x8f8e8a), thin: lin(0x9a9994), worn: lin(0xb5b4b0), cav: lin(0x3a3936),
    rBase: 0.3, rWorn: 0.2, rCav: 0.55, mBase: 1.0, mWorn: 1.0,
    edge: 0.65, thinAmt: 0.1, scratch: 0.22, brush: 0.3, cavAmt: 0.5, blotch: 0.1, cc: 0.0, ccR: 0.3, caseAmt: 0.0, iri: 0, iriNm: 300,
  },
  nickel: {
    base: lin(0xd2d4d6), thin: lin(0xc8cacc), worn: lin(0xeaebec), cav: lin(0x3a3a3a),
    rBase: 0.16, rWorn: 0.1, rCav: 0.5, mBase: 1.0, mWorn: 1.0,
    edge: 0.5, thinAmt: 0.25, scratch: 0.3, brush: 0.06, cavAmt: 0.75, blotch: 0.25, cc: 0.0, ccR: 0.3, caseAmt: 0.0, iri: 0, iriNm: 300,
  },
};
const GRIP_LOOKS = {
  service: { dark: lin(0x110906), light: lin(0x2e1a11), hi: lin(0x5a3722), grain: 1.0, rough: 0.35, roughChk: 0.6, cc: 1.0, ccR: 0.04, normal: 'checker', nScale: 1.0 },
  stainless: { dark: lin(0x0b0b0b), light: lin(0x141414), hi: lin(0x1c1c1c), grain: 0.0, rough: 0.78, roughChk: 0.78, cc: 0.0, ccR: 0.6, normal: 'stipple', nScale: 0.7 },
  nickel: { dark: lin(0xcdbf9f), light: lin(0xece5d3), hi: lin(0xf4efe3), grain: 0.25, rough: 0.3, roughChk: 0.3, cc: 0.45, ccR: 0.25, normal: null, nScale: 0 },
};

function steelMaterial(A, isCase) {
  const u = {
    tWear: { value: A.wear }, tScr: { value: A.scratch },
    uBase: { value: new THREE.Color() }, uThin: { value: new THREE.Color() }, uWorn: { value: new THREE.Color() }, uCav: { value: new THREE.Color() },
    uR: { value: new THREE.Vector3() }, uM: { value: new THREE.Vector2() },
    uAmt: { value: new THREE.Vector4() }, uAmt2: { value: new THREE.Vector4() },
  };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3, aoMap: A.wear, aoMapIntensity: 1, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  m.name = isCase ? 'steel_case' : 'steel';
  m.userData.u = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = 'varying vec3 vLP; varying vec3 vLN;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal;');
    s.fragmentShader = `uniform sampler2D tWear, tScr; uniform vec3 uBase, uThin, uWorn, uCav, uR; uniform vec2 uM; uniform vec4 uAmt, uAmt2;
varying vec3 vLP; varying vec3 vLN;
` + s.fragmentShader
      .replace('#include <map_fragment>', `
  vec3 wr = texture2D(tWear, vAoMapUv).rgb;            // r = ao, g = cavity, b = convex edge
  vec3 an = pow(abs(normalize(vLN)), vec3(4.0)); an /= (an.x + an.y + an.z);
  vec3 P = vLP * 18.0;                                 // 55 mm tile, streaks run along the gun (z)
  vec4 sc = texture2D(tScr, P.zy) * an.x + texture2D(tScr, P.zx) * an.y + texture2D(tScr, P.xy) * an.z;
  vec4 sc2 = texture2D(tScr, P.zy * 0.31 + 0.37) * an.x + texture2D(tScr, P.zx * 0.31 + 0.37) * an.y + texture2D(tScr, P.xy * 0.31 + 0.37) * an.z;
  // wear follows the baked convex-edge mask with a sharp threshold; a little fine noise breaks the boundary up
  float e = wr.b * uAmt.x;
  e += step(vLP.z, -0.1315) * 0.6;                                               // muzzle face and crown
  float jit = (sc.b - 0.5) * 0.22 + (sc.r - 0.5) * 0.10;
  float edgeW = smoothstep(0.46, 0.54, e + jit);
  float halo = smoothstep(0.16, 0.42, e + jit * 0.6) * uAmt.y;                    // finish worn thin next to the edges
  // directional scratches: long streaks along the gun on the barrel and frame, polishing swirls on the side plate
  vec2 sp = vec2(vLP.y - 0.031, vLP.z - 0.022);
  float swirlM = (1.0 - smoothstep(0.012, 0.022, length(sp))) * an.x;
  float swirl = texture2D(tScr, vec2(atan(sp.y, sp.x) * 0.9, length(sp) * 30.0)).g;
  float streak = mix(sc.g, swirl, swirlM);
  float scr = smoothstep(0.55, 0.9, sc.r) * uAmt.z * (0.35 + 0.65 * smoothstep(0.1, 0.5, e));
  float fine = smoothstep(0.62, 0.95, streak) * uAmt.z * 0.55;
  float cav = smoothstep(0.08, 0.55, wr.g) * uAmt2.y;
  float brush = sc.g - 0.5;
  vec3 col = mix(uBase, uThin, clamp(halo + fine * 0.8, 0.0, 1.0));
  float wornT = clamp(edgeW + scr * 0.6, 0.0, 1.0);
  col = mix(col, uWorn, wornT);
  // case colours (hammer, trigger): mottled blue / straw / purple film over the steel
  vec3 caseC = mix(mix(vec3(0.030, 0.040, 0.075), vec3(0.120, 0.085, 0.040), smoothstep(0.5, 0.68, sc2.b)), vec3(0.060, 0.040, 0.075), smoothstep(0.4, 0.6, sc.b) * 0.6);
  col = mix(col, mix(mix(uBase, caseC, 0.55), uWorn, wornT * 0.8), uAmt2.z);
  col *= 1.0 + brush * uAmt.w * 0.5;
  col = mix(col, uCav, cav);
  diffuseColor.rgb = col;
  float gRough = mix(uR.x, uR.y, wornT) + (scr + fine) * 0.08 + brush * uAmt.w * 0.35 + (sc2.g - 0.5) * 0.03;
  gRough = clamp(mix(gRough, uR.z, cav), 0.04, 1.0);
  float gMetal = mix(uM.x, uM.y, max(wornT, uAmt2.z * 0.5));
  float gCoat = (1.0 - wornT * 0.6) * (1.0 - cav * 0.5);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gMetal;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= gCoat;\n#endif');
  };
  m.customProgramCacheKey = () => m.name + '-v4';
  return m;
}

function applySteelLook(m, L) {
  const u = m.userData.u;
  u.uBase.value.copy(L.base); u.uThin.value.copy(L.thin); u.uWorn.value.copy(L.worn); u.uCav.value.copy(L.cav);
  u.uR.value.set(L.rBase, L.rWorn, L.rCav); u.uM.value.set(L.mBase, L.mWorn);
  u.uAmt.value.set(L.edge, L.thinAmt, L.scratch, L.brush);
  u.uAmt2.value.set(L.blotch, L.cavAmt, m.name === 'steel_case' ? L.caseAmt : 0, 0);
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
    const r = rnd(5), c = S / 2, k = S / 11.2; // 11.2 mm across
    g.fillStyle = '#c99a4c'; g.fillRect(0, 0, S, S);
    // fine concentric lathe marks
    for (let i = 0; i < 400; i++) {
      const rr = (2.4 + r() * 2.9) * k; g.strokeStyle = r() > 0.5 ? 'rgba(255,236,190,.10)' : 'rgba(90,60,20,.10)';
      g.lineWidth = 0.6 + r(); g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke();
    }
    // tarnish blotches
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.283, d = (2.6 + r() * 2.6) * k, rad = (0.3 + r() * 0.9) * k;
      const gr = g.createRadialGradient(c + Math.cos(a) * d, c + Math.sin(a) * d, 0, c + Math.cos(a) * d, c + Math.sin(a) * d, rad);
      gr.addColorStop(0, 'rgba(110,70,25,.22)'); gr.addColorStop(1, 'rgba(110,70,25,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    // primer pocket ring (dark crimp line)
    g.strokeStyle = 'rgba(40,24,6,.85)'; g.lineWidth = 0.22 * k; g.beginPath(); g.arc(c, c, 2.42 * k, 0, Math.PI * 2); g.stroke();
    // stamped letters: dark floor with a light upper lip
    const word = (txt, mid, flip) => {
      g.font = `700 ${0.95 * k}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const chars = [...txt], sp = 0.205;
      chars.forEach((ch, i) => {
        const a = mid + (flip ? -1 : 1) * (i - (chars.length - 1) / 2) * sp;
        g.save(); g.translate(c + Math.cos(a) * 3.85 * k, c + Math.sin(a) * 3.85 * k); g.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        g.fillStyle = 'rgba(255,235,185,.55)'; g.fillText(ch, 0, -0.05 * k);
        g.fillStyle = 'rgba(52,32,8,.92)'; g.fillText(ch, 0.02 * k, 0.04 * k); g.restore();
      });
    };
    word('38 SPL', -Math.PI / 2, false);
    word('TRIAL', Math.PI / 2, true);
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
      const dent = r < 0.95 ? 0.42 * Math.cos((r / 0.95) * Math.PI / 2) ** 1.3 : 0;
      const lip = r >= 0.95 && r < 1.5 ? -0.03 * Math.sin(((r - 0.95) / 0.55) * Math.PI) : 0;
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
  muzzle.position.set(0, 0.046, -0.13535); gap.position.set(0, 0.046, -0.033675);
  rearSight.position.set(0, 0.0586, 0.010); frontSight.position.set(0, 0.0586, -0.129);
  crane.position.set(-0.006, 0.011, 0.006); cylinder.position.set(0.006, 0.0234, 0);
  for (let i = 0; i < 6; i++) { cartridges[i].position.set(Math.sin(i * STEP) * 0.0116, Math.cos(i * STEP) * 0.0116, 0); cartridges[i].rotation.z = -i * STEP; }

  const dims = { BORE_Y: 0.046, MUZZLE_Z: -0.13535, CYL_R: 0.0183, CH_R: 0.0116 };
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
      applySteelLook(state.mats.steel, STEEL_LOOKS[current]); applySteelLook(state.mats.steelCase, STEEL_LOOKS[current]);
      applyGripLook(state.mats.grip, GRIP_LOOKS[current], state.A, state.stipple);
    },
    setFinish(name) { api.setLook(FINISH_TO_LOOK[name] || 'service'); },
    setWood() {}, // the grips follow the look
  };

  api.ready = loadAssets().then((A) => {
    state.A = A; state.stipple = stippleTex();
    const steel = steelMaterial(A, false), steelCase = steelMaterial(A, true), gripM = gripMaterial(A);
    const brass = new THREE.MeshPhysicalMaterial({ color: 0xe7b062, metalness: 1, roughness: 0.3, roughnessMap: brushTex(), envMapIntensity: 1.3 });
    const head = new THREE.MeshPhysicalMaterial({ map: headstampTex(), metalness: 1, roughness: 0.26, envMapIntensity: 1.6 });
    const lead = new THREE.MeshPhysicalMaterial({ color: 0x55575a, metalness: 0.55, roughness: 0.55 });
    const primer = new THREE.MeshPhysicalMaterial({ color: 0xc9c3b8, metalness: 1, roughness: 0.24, envMapIntensity: 1.6 });
    const primerFired = new THREE.MeshPhysicalMaterial({ color: 0x8f8170, metalness: 1, roughness: 0.42, envMapIntensity: 1.3 });
    state.mats = { steel, steelCase, grip: gripM, primer, primerFired };
    const byName = { steel, steel_case: steelCase, grip: gripM, brass, brass_head: head, lead, primer };

    const holders = { Frame: frame, Grip: grip, Hammer: hammer, Trigger: trigger, Crane: crane, Cylinder: cylinder, Muzzle: muzzle, Gap: gap, RearSight: rearSight, FrontSight: frontSight };
    cartridges.forEach((c, i) => { holders[`Cartridge${i}`] = c; holders[`Primer${i}`] = primers[i]; });
    A.scene.updateMatrixWorld(true);
    A.scene.traverse((n) => {
      const h = holders[n.name]; if (!h) return;
      h.position.copy(n.position); h.quaternion.copy(n.quaternion); h.scale.copy(n.scale);
      const own = n.isMesh ? [n] : n.children.filter((c) => c.isMesh && !NODES.includes(c.name));
      for (const src of own) {
        const mesh = new THREE.Mesh(src.geometry, byName[src.material.name] || steel);
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
    dims.MUZZLE_Z = muzzle.position.z; dims.BORE_Y = muzzle.position.y;
    api.setLook(current);
    state.fired.forEach((f, i) => api.setFired(i, f));
    return api;
  }).catch((e) => { console.error('revolver: load failed', e); throw e; });

  return api;
}
