// Range-mode pistol: a full-size single-action .45 in the 1911 pattern, built in Blender
// (tools/blender/build_pistol.py) and loaded from assets/models/pistol.glb (Draco).
// Gun space: metres, +X right, +Y up, -Z toward the muzzle. Root origin = trigger-finger point.
// The three looks share one steel material whose colour, roughness and metalness are built in the
// shader from baked masks (wear = convex edges + scratches, occ = AO / handling zones / patina, brush).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const ROOT_URL = new URL('../', import.meta.url);
const MODELS = new URL('assets/models/', ROOT_URL).href;
const DRACO = new URL('vendor/three/addons/libs/draco/gltf/', ROOT_URL).href;

export const SLIDE_TRAVEL = 0.032;       // +Z (back) from battery to locked back
export const TRIGGER_TRAVEL = 0.004;     // +Z when pulled
export const HAMMER_FALL = -0.6;        // rotation.x from cocked (rest) to fallen
export const HAMMER_BACK = 0.37;         // extra rotation.x past cocked while the slide rides over it
export const SLIDE_STOP_UP = -0.16;      // rotation.x that lifts the stop into the slide notch
export const BARREL_TILT = 0.0147;       // rotation.x at full travel (chamber drops, pivot at the bushing)
export const GRIP_SAFETY_IN = 0.06;      // rotation.x when the hand presses the beavertail
export const MAG_AXIS = new THREE.Vector3(0, -0.9511, 0.309);   // drop direction, root frame
export const PORT_DIR = new THREE.Vector3(0.856, 0.471, 0.214); // casing ejection: right, up, a little back
export const MAG_SIZE = 7;

export const LOOKS = [
  { id: 'classic', name: 'Classic', note: 'Worn blue, walnut' },
  { id: 'stainless', name: 'Stainless', note: 'Brushed steel, black grips' },
  { id: 'black', name: 'Black', note: 'Nitride, G10' },
];

// Steel parameters per look (linear colours).
// Base colours lean cool on purpose: the range room is lit warm, and metal tints every reflection by its base.
const STEEL = {
  classic: { base: [0.016, 0.022, 0.04], bare: [0.52, 0.54, 0.57], metal: 1, rough: 0.34, bareRough: 0.22, lo: 0.15, hi: 0.48,
    zone: 0.6, mottle: 0.25, tint: [0.85, 0.92, 1.0], brush: 0.1, brushR: 0.1, clearcoat: 0.15, ccRough: 0.22 },
  stainless: { base: [0.2, 0.28, 0.46], bare: [0.38, 0.48, 0.7], metal: 1, rough: 0.3, bareRough: 0.16, lo: 0.3, hi: 0.85,
    zone: 0.35, mottle: 0.06, tint: [1, 1, 1], brush: 0.5, brushR: 0.3, clearcoat: 0, ccRough: 0.3 },
  black: { base: [0.007, 0.008, 0.011], bare: [0.42, 0.47, 0.56], metal: 1, rough: 0.6, bareRough: 0.26, lo: 0.12, hi: 0.45,
    zone: 0.25, mottle: 0.08, tint: [1, 1, 1], brush: 0.04, brushR: 0.05, clearcoat: 0, ccRough: 0.5 },
};
const BRIGHT_FORCE = 0.88;   // polished parts in the port (barrel hood, chamber, feed ramp, follower)

const NODES = {
  Pistol: 'root', Frame: 'frame', Grips: 'grips', GripScrews: 'gripScrews', GripSafety: 'gripSafety', Slide: 'slide',
  Barrel: 'barrel', Hammer: 'hammer', Trigger: 'trigger', SlideStop: 'slideStop', Magazine: 'magazine', MagRound: 'magRound',
  ChamberRound: 'chamberRound', Muzzle: 'muzzle', Port: 'port', RearSight: 'rearSight', FrontSight: 'frontSight',
};

let shared = null;   // textures + loaded scene, shared by every pistol instance

function loadShared() {
  if (shared) return shared;
  const tl = new THREE.TextureLoader();
  const tex = (name, srgb = false) => {
    const t = tl.load(MODELS + name);
    t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
    return t;
  };
  const draco = new DRACOLoader().setDecoderPath(DRACO);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  shared = {
    wear: tex('pistol_wear.webp'), occ: tex('pistol_occ.webp'), brush: tex('pistol_brush.webp'),
    gripC: tex('pistol_grip_c.webp', true), gripN: tex('pistol_grip_n.webp'), gripM: tex('pistol_grip_m.webp'), g10N: tex('pistol_grip_g10n.webp'),
    gltf: loader.loadAsync(MODELS + 'pistol.glb'),
  };
  return shared;
}

function steelMaterial(S, force = 0) {
  const U = {
    tWear: { value: S.wear }, tOcc: { value: S.occ }, tBrush: { value: S.brush },
    uBase: { value: new THREE.Color() }, uBare: { value: new THREE.Color() }, uTint: { value: new THREE.Color() },
    uRough: { value: 0.3 }, uBareRough: { value: 0.2 }, uLo: { value: 0.2 }, uHi: { value: 0.5 }, uZone: { value: 0.5 },
    uMottle: { value: 0.2 }, uBrush: { value: 0.1 }, uBrushR: { value: 0.1 }, uMetal: { value: 1 }, uForce: { value: force },
  };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3, aoMap: S.occ, aoMapIntensity: force > 0 ? 0.5 : 1 });
  m.defines = { USE_UV: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tWear, tOcc, tBrush;
uniform vec3 uBase, uBare, uTint;
uniform float uRough, uBareRough, uLo, uHi, uZone, uMottle, uBrush, uBrushR, uMetal, uForce;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 pOcc = texture2D(tOcc, vUv).rgb;
float pWr = texture2D(tWear, vUv).r;
float pBr = texture2D(tBrush, vUv).r;
float pZone = pOcc.g * uZone * (0.35 + 0.65 * pOcc.b);
float pWear = max(smoothstep(uLo, uHi, pWr + pZone * (0.6 + 0.8 * pWr)), uForce);
vec3 pBase = uBase * mix(vec3(1.0), uTint, pOcc.b * uMottle * 2.0) * (1.0 + uMottle * (pOcc.b - 0.5));
pBase *= 1.0 + uBrush * (pBr - 0.5) * 1.6;
vec3 pBare = uBare * (0.86 + 0.28 * pBr);
diffuseColor.rgb = mix(pBase, pBare, pWear) * mix(0.5 + 0.35 * uForce, 1.0, pOcc.r);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(uRough, uBareRough, pWear) + (pBr - 0.5) * uBrushR + (1.0 - pOcc.r) * 0.25 + pZone * 0.04, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(uMetal, 1.0, pWear) * (1.0 - 0.22 * uForce);   // polished parts keep some diffuse so they read inside the port`);
  };
  m.customProgramCacheKey = () => 'pistol-steel';   // uForce is a uniform, so both variants share one program
  m.userData.U = U;
  return m;
}

function gripMaterials(S) {
  const ns = new THREE.Vector2(1, -1);
  return {
    classic: new THREE.MeshPhysicalMaterial({ map: S.gripC, normalMap: S.gripN, normalScale: ns.clone().multiplyScalar(1.1),
      roughnessMap: S.gripM, roughness: 1, aoMap: S.gripM, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.12,
      clearcoatNormalMap: S.gripN, clearcoatNormalScale: ns.clone().multiplyScalar(0.9), specularIntensity: 0.6 }),
    stainless: new THREE.MeshPhysicalMaterial({ color: 0x141414, normalMap: S.gripN, normalScale: ns.clone().multiplyScalar(1.1),
      roughnessMap: S.gripM, roughness: 1.15, aoMap: S.gripM, metalness: 0, specularIntensity: 0.5 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x18191a, normalMap: S.g10N, normalScale: ns.clone().multiplyScalar(1.4),
      roughness: 0.72, metalness: 0, specularIntensity: 0.45 }),
  };
}

export function createPistol({ look = 'classic' } = {}) {
  const S = loadShared();
  const api = { look };
  for (const key of Object.values(NODES)) { api[key] = new THREE.Group(); api[key].name = key; }
  api.dims = { BORE_Y: 0.034, MUZZLE_Z: -0.1213 };

  const steel = steelMaterial(S);
  const bright = steelMaterial(S, BRIGHT_FORCE);
  const grips = gripMaterials(S);
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xd9b56e, metalness: 1, roughness: 0.3 });
  const jacket = new THREE.MeshPhysicalMaterial({ color: 0xb0603c, metalness: 1, roughness: 0.28 });
  const pad = new THREE.MeshPhysicalMaterial({ color: 0x121212, metalness: 0, roughness: 0.62, specularIntensity: 0.5 });
  const gripMeshes = [];
  let casingT = null, roundT = null;

  api.setLook = (id) => {
    const L = STEEL[id] ? id : 'classic';
    const P = STEEL[L];
    for (const m of [steel, bright]) {
      const U = m.userData.U;
      U.uBase.value.setRGB(...P.base); U.uBare.value.setRGB(...P.bare); U.uTint.value.setRGB(...P.tint);
      U.uRough.value = P.rough; U.uBareRough.value = P.bareRough; U.uLo.value = P.lo; U.uHi.value = P.hi; U.uZone.value = P.zone;
      U.uMottle.value = P.mottle; U.uBrush.value = P.brush; U.uBrushR.value = P.brushR; U.uMetal.value = P.metal;
      m.clearcoat = P.clearcoat; m.clearcoatRoughness = P.ccRough;
    }
    for (const m of gripMeshes) m.material = grips[L];
    api.look = L;
  };
  api.setLook(look);

  const swap = (o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const n = o.material && o.material.name;
    if (n === 'Grip') { gripMeshes.push(o); o.material = grips[api.look]; }
    else if (n === 'Pad') o.material = pad;
    else if (n === 'Brass') o.material = brass;
    else if (n === 'Jacket') o.material = jacket;
    else if (n === 'Bright') o.material = bright;
    else o.material = steel;
  };

  const adopt = (node, ph) => {
    ph.position.copy(node.position); ph.quaternion.copy(node.quaternion); ph.scale.copy(node.scale);
    for (const k of [...node.children]) {
      const key = NODES[k.name];
      if (key) { ph.add(api[key]); adopt(k, api[key]); } else ph.add(k);
    }
    if (node.isMesh) {
      node.removeFromParent(); node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.set(1, 1, 1); ph.add(node);
    }
  };

  api.ready = S.gltf.then((gltf) => {
    const scene = gltf.scene.clone(true);
    const pistol = scene.getObjectByName('Pistol');
    adopt(pistol, api.root);
    api.root.traverse(swap);
    casingT = scene.getObjectByName('Casing'); roundT = scene.getObjectByName('Round');
    for (const t of [casingT, roundT]) { t.removeFromParent(); t.position.set(0, 0, 0); t.traverse(swap); }
    api.dims.BORE_Y = api.muzzle.position.y; api.dims.MUZZLE_Z = api.muzzle.position.z;
    return api;
  });

  api.makeCasing = () => (casingT ? casingT.clone() : new THREE.Group());
  api.makeRound = () => (roundT ? roundT.clone() : new THREE.Group());
  api.makeMagazine = () => {
    const m = api.magazine.clone(true);
    m.position.set(0, 0, 0); m.quaternion.identity();
    return m;
  };
  return api;
}
