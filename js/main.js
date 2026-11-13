// Roulette v2: a first-person revolver that decides. Plays like a shooter: the mouse (or a drag) aims,
// left click (or a tap) fires, right click (or the Aim button) aims down the sights. The cylinder is the
// roulette: the chamber under the hammer is the pick, the bullet lands where you aimed.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRevolver, OPEN_ANGLE, STEP, HAMMER_COCK, TRIGGER_PULL, LOOKS } from './revolver.js';
import { loadHands } from './hands.js';
import { createFx } from './fx.js';
import { createTarget } from './target.js';
import { Sound } from './sound.js';
import { createCustomize } from './customize.js';

const gsap = window.gsap;
const TAU = Math.PI * 2;
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const store = {
  get(k, d) { try { const v = localStorage.getItem('roulette.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('roulette.' + k, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ } },
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const buzz = (p) => { if (!S.vibrate) return; try { navigator.vibrate?.(p); } catch { /* blocked */ } };
function securePick(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }

// ---------- Rooms ----------
// target: the painted target's centre (u, v) and size (w, h) as fractions of the room photo; stand = photo v of the desk edge.
export const ROOMS = {
  study: {
    name: 'The Study', blurb: 'Lamplight, green leather', sleeve: '#2c3b30', cuff: '#ece6da',
    target: { u: 0.5265, v: 0.2865, w: 0.0995, h: 0.161, shape: 'square' },
    key: { color: 0xffd6ac, intensity: 2.4, pos: [-0.8, 1.0, -0.55] },
    rim: { color: 0xffcf9a, intensity: 0.8, pos: [0.8, 0.5, -1.8] },
    hemi: [0x8a8f98, 0x2a1c12, 0.45], env: 1.9, shadow: 0.55,
    lamps: [{ d: [-0.75, 0.25, -0.6], c: 0xfff0dc, i: 10, s: 0.5 }, { d: [-0.15, 0.55, -1], c: 0xffe2b8, i: 7, s: 0.35 }, { d: [0.3, 0.55, -1], c: 0xffe2b8, i: 7, s: 0.35 }, { d: [0.5, 0.8, 1], c: 0xf2efe8, i: 0.9, s: 1 }],
    grade: { vignette: 0.42, grain: 0.04, tint: [1.02, 1.0, 0.97] },
  },
  salon: {
    name: 'The Salon', blurb: 'Velvet, whisky, night', sleeve: '#3b2a22', cuff: '#efe9de',
    target: { u: 0.4995, v: 0.1895, w: 0.1255, h: 0.1885, shape: 'round' },
    key: { color: 0xffcf9e, intensity: 2.3, pos: [-0.85, 1.0, -0.55] },
    rim: { color: 0xff8a6a, intensity: 0.8, pos: [0.4, 0.4, -2.2] },
    hemi: [0x8a5a54, 0x1c0c0a, 0.4], env: 1.8, shadow: 0.6,
    lamps: [{ d: [-0.8, 0.2, -0.6], c: 0xfff0dc, i: 10, s: 0.5 }, { d: [-0.45, 0.6, -1], c: 0xffdcae, i: 6, s: 0.3 }, { d: [0.6, 0.55, -1], c: 0xffdcae, i: 6, s: 0.3 }, { d: [0.5, 0.8, 1], c: 0xf2ebe4, i: 0.8, s: 1 }],
    grade: { vignette: 0.48, grain: 0.045, tint: [1.03, 0.99, 0.96] },
  },
  atelier: {
    name: 'The Atelier', blurb: 'Roman light, afternoon', sleeve: '#4a4239', cuff: '#f4efe6',
    target: { u: 0.5, v: 0.33, w: 0.092, h: 0.15, shape: 'square', stand: 0.492 },
    key: { color: 0xffe8cc, intensity: 3.6, pos: [1.2, 1.1, -1.6] },
    rim: { color: 0xfff1d6, intensity: 1.1, pos: [-0.6, 0.6, 0.6] },
    hemi: [0xfff1dc, 0x7a3a2c, 0.9], env: 1.9, shadow: 0.42,
    lamps: [{ d: [0, 0.35, -1], c: 0xfff4e6, i: 6, s: 1.6 }, { d: [0.7, 0.45, -0.7], c: 0xfff0d8, i: 9, s: 0.6 }, { d: [0.5, 0.8, 1], c: 0xf6f2ea, i: 1.1, s: 1 }],
    grade: { vignette: 0.26, grain: 0.03, tint: [1.01, 1.0, 0.98] },
  },
};
export const PRESETS = {
  Tonight: ['Coffee', 'Dinner', 'Cinema', 'Walk', 'Stay in', 'Road trip'],
  Food: ['Pizza', 'Sushi', 'Burgers', 'Tacos', 'Salad', 'Cook at home'],
  'Yes or no': ['Yes', 'No', 'Yes', 'No', 'Yes', 'No'],
  'Heads or tails': ['Heads', 'Tails'],
};

// ---------- Settings (all remembered on this device) ----------
const S = {
  room: store.get('room', 'study'), look: store.get('look', 'service'), skin: store.get('skin', 'medium'),
  choices: store.get('choices', PRESETS.Tonight), lists: store.get('lists', []),
  slowmo: store.get('slowmo', true), muted: store.get('muted', false), vibrate: store.get('vibrate', true),
  crosshair: store.get('crosshair', 'dot'), sens: store.get('sens', 1), lefty: store.get('lefty', false),
  // Range mode: the semi-auto on the indoor range.
  mode: store.get('mode', 'decide'), pistolLook: store.get('pistolLook', 'classic'), tally: store.get('tally', true),
  targets: store.get('targets', { paper: true, steel: true, bottles: true, spinner: true }),
};
// The Decide | Range switch shows once the range is verified; ?range shows it early.
const RANGE_READY = true;
const RANGE_ON = RANGE_READY || params.has('range');
if (!RANGE_ON || !['decide', 'range'].includes(S.mode)) S.mode = 'decide';
if (!['classic', 'stainless', 'black'].includes(S.pistolLook)) S.pistolLook = 'classic';
if (!S.targets || typeof S.targets !== 'object') S.targets = { paper: true, steel: true, bottles: true, spinner: true };
if (!ROOMS[S.room]) S.room = 'study';
if (!LOOKS.some((l) => l.id === S.look)) S.look = 'service';
const cleanChoices = (a) => (Array.isArray(a) ? a.map((s) => String(s).trim().slice(0, 24)).filter(Boolean).slice(0, 6) : []);
S.choices = cleanChoices(S.choices); if (S.choices.length < 2) S.choices = PRESETS.Tonight.slice();
// A share link carries the choices in the hash: #c=["A","B",...]
let sharedLoaded = false;
try {
  const m = location.hash.match(/^#c=(.+)$/);
  if (m) { const c = cleanChoices(JSON.parse(decodeURIComponent(m[1]))); if (c.length >= 2) { S.choices = c; sharedLoaded = true; store.set('choices', c); } history.replaceState(null, '', location.pathname + location.search); }
} catch { /* bad link: ignore */ }

// ---------- Renderer, scene, camera ----------
const DESK_Y = -0.27, PLATE_PITCH = -0.12, PLATE_D = 9, TARGET_K = 4.2 / PLATE_D;
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.localClippingEnabled = true;   // the sleeves end at the elbow (hands.js aimSleeve)
const MAX_DPR = 2;
let quality = 1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050403);
// rig holds the camera and turns with the look; plateRig holds the room photo and the target and never moves.
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 40); rig.add(camera);
const mir = new THREE.Group(); camera.add(mir); // left-handed mirror for the viewmodel
const vm = new THREE.Group(); mir.add(vm);
const lmir = new THREE.Group(); scene.add(lmir); // the same mirror for the resting hand
const plateRig = new THREE.Group(); plateRig.rotation.x = PLATE_PITCH; scene.add(plateRig);
const pmrem = new THREE.PMREMGenerator(renderer);

const plateU = { uBias: { value: 0 }, uGain: { value: 1 }, uFlash: { value: 0 } };
const plateMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
plateMat.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, plateU);
  s.fragmentShader = 'uniform float uBias, uGain, uFlash;\n' + s.fragmentShader.replace('#include <map_fragment>',
    // Past the photo's edges the picture mirrors, blurs and falls to dark, so looking around never shows a hard border.
    '#ifdef USE_MAP\nvec2 q = vMapUv; vec2 o = max(vec2(0.), max(-q, q - 1.)); float out_ = length(o);\n' +
    'vec2 m = clamp(q, vec2(.001), vec2(.999));\nvec4 sampledDiffuseColor = texture2D(map, m, uBias + out_ * 24.); diffuseColor *= sampledDiffuseColor;\n' +
    'diffuseColor.rgb *= uGain * (1. - smoothstep(0., .18, out_) * .7); diffuseColor.rgb += uFlash * vec3(1.0, .72, .42) * max(0., 1.0 - distance(q, vec2(.5, .4)) * 1.3);\n#endif');
};
// The mesh is three photos wide and tall: the photo sits in the middle third, the rest is the shader's mirrored, darkened fringe.
const plateGeo = new THREE.PlaneGeometry(3, 3);
{ const uv = plateGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3 - 1, uv.getY(i) * 3 - 1); }
const plate = new THREE.Mesh(plateGeo, plateMat);
plate.position.z = -PLATE_D; plate.renderOrder = -1; plateRig.add(plate);

const shadowMat = new THREE.ShadowMaterial({ opacity: 0.5, color: 0x0a0604 });
const desk = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), shadowMat);
desk.rotation.x = -Math.PI / 2; desk.position.y = DESK_Y; desk.receiveShadow = true; scene.add(desk);
const key = new THREE.SpotLight(0xffffff, 3, 0, 0.6, 0.9, 0);
key.castShadow = true; key.shadow.mapSize.setScalar(Math.min(renderer.capabilities.maxTextureSize, coarse ? 1024 : 2048)); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.01;
key.shadow.camera.near = 0.3; key.shadow.camera.far = 4; key.shadow.radius = 3;
key.target.position.set(0.08, -0.1, -0.35); scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffffff, 1); scene.add(rim);
const front = new THREE.DirectionalLight(0xffe6c8, 0.8); front.position.set(0.4, 0.7, 1.2); scene.add(front);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5); scene.add(hemi);

// ---------- Post ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: devicePixelRatio < 1.5 ? 4 : 2 }));
const renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.26, 0.5, 0.96); composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.4 }, uGrain: { value: 0.04 }, uFlash: { value: 0 }, uAberr: { value: 0.01 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uDim: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uFlash, uAberr, uDim; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - .5; float r2 = dot(d, d); vec2 o = d * r2 * uAberr;
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b) * uTint;
      c += uFlash * vec3(1., .82, .58) * (1. - r2 * 1.6);
      float v = smoothstep(.95, .25, length(d * vec2(1., .9)));
      c *= mix(1. - uVignette - uDim * .5, 1., v) * (1. - uDim * .2);
      c += (hash(vUv * 1000. + fract(uTime * 7.3)) - .5) * uGrain;
      gl_FragColor = vec4(c, 1.);
    }`,
});
composer.addPass(grade);

// ---------- Content ----------
const gun = createRevolver({ look: S.look });
vm.add(gun.root);
const target = createTarget();
const fx = createFx(scene); fx.setDesk(DESK_Y);
const sound = new Sound();
let hands = null;

// ---------- Poses (camera space, metres / radians; x is mirrored for left-handers) ----------
const FOV = { hip: 50, ads: 34, hipP: 60, adsP: 44 };
const HIP = { land: { x: 0.108, y: -0.084, z: -0.27 }, port: { x: 0.046, y: -0.098, z: -0.36 }, rz: -0.12 };
const ADS_EYE = { land: 0.42, port: 0.46 };
// Action poses (absolute): the open-cylinder read (close, from behind, like a macro shot), inspect.
const LOAD = { land: { x: 0.03, y: -0.045, z: -0.17, rx: 0.42, ry: 0.36, rz: -0.95 }, port: { x: 0.012, y: -0.03, z: -0.19, rx: 0.42, ry: 0.36, rz: -0.95 } };
const P = { ads: 0, act: 0, twirl: 0, crane: 0, hammer: 0, trig: 0, grip: 1, thumb: 0 };
const A = { x: 0, y: 0, z: -0.3, rx: 0, ry: 0, rz: 0 }; // the action pose P.act blends toward
const ELBOW_R = new THREE.Vector3(0.25, -0.55, 0);
const RH = { pos: new THREE.Vector3(-0.027, -0.01, 0.102), finger: new THREE.Vector3(-0.041, 0.088, -0.995), palm: new THREE.Vector3(-0.999, 0.018, 0.043) };
const GRIP = { thumb: [0.7, 0.1, -0.4, 0.05], index: [-0.5, 1.3, 0.72, -0.25], middle: [0.53, 1.31, 1.4, 0], ring: [0.38, 1.12, 0.83, 0], pinky: [0, 0.72, 1.1, 0], cup: 0.3 };
const OPEN = { thumb: [0.1, 0.4, 0.05, 0.05], index: [-0.5, 1.3, 0.72, -0.25], middle: [0.25, 0.3, 0.2, 0], ring: [0.3, 0.35, 0.2, 0], pinky: [0.35, 0.35, 0.2, 0.05], cup: 0.05 };
const THUMB_COCK = [-1.5, -0.3, 0.45, 0.9], THUMB_TUCK = [0.4, -0.6, 0.2, 0.3], TRIG_IDX = [0.12, 0.35];
const REST = { thumb: [0.15, 0.55, 0.15, 0.15], index: [0.25, 0.35, 0.2, 0.02], middle: [0.3, 0.45, 0.25, 0], ring: [0.35, 0.5, 0.25, -0.02], pinky: [0.4, 0.5, 0.25, -0.05], cup: 0.15 };
const FLAT = { thumb: [0.1, 0.2, 0.1, 0.1], index: [0.05, 0.1, 0.05, 0], middle: [0.05, 0.1, 0.05, 0], ring: [0.08, 0.12, 0.06, 0], pinky: [0.1, 0.15, 0.08, 0], cup: 0.05 };
const LH = { desk: new THREE.Vector3(-0.17, DESK_Y + 0.024, -0.5), elbow: new THREE.Vector3(-0.24, DESK_Y + 0.03, -0.12) };
const FAN = { off: new THREE.Vector3(-0.035, 0.03, -0.045), sweep: 0.065, finger: new THREE.Vector3(1, 0.25, -0.35), palm: new THREE.Vector3(0.1, -0.7, 0.7), elbow: new THREE.Vector3(-0.22, -0.18, 0.2) };
const LF = { k: 0, s: 0 }, HOLD = { on: false, yaw: 0, pitch: 0 };
const rec = { r: 0, vr: 0, z: 0, vz: 0, roll: 0, vroll: 0 }, kick = { p: 0, vp: 0 }, sway = { x: 0, y: 0, vx: 0, vy: 0 };
let shake = 0, portrait = false, LQ = new THREE.Quaternion();
const lerpPose = (a, b, t, out = {}) => {
  for (const k of ['thumb', 'index', 'middle', 'ring', 'pinky']) out[k] = a[k].map((v, i) => v + (b[k][i] - v) * t);
  out.cup = a.cup + (b.cup - a.cup) * t; return out;
};
function orient(obj, finger, palm, localFinger, localPalm) {
  const f = finger.clone().normalize(), n = palm.clone().sub(f.clone().multiplyScalar(palm.dot(f))).normalize();
  const m1 = new THREE.Matrix4().makeBasis(f, n, f.clone().cross(n));
  const lf = localFinger.clone().normalize(), ln = localPalm.clone().normalize();
  const m0 = new THREE.Matrix4().makeBasis(lf, ln, lf.clone().cross(ln));
  obj.quaternion.setFromRotationMatrix(m1.multiply(m0.invert()));
}

// ---------- Look ----------
// base = straight at the target's centre; yaw/pitch are offsets inside limits around it.
const look = { yaw: 0, pitch: 0, ty: 0, tp: 0, baseYaw: 0, basePitch: 0, limY: 0.2, limP: 0.14, vy: 0, vp: 0, moved: 0 };
function setLook(ty, tp) { look.ty = clamp(ty, -look.limY, look.limY); look.tp = clamp(tp, -look.limP, look.limP); }

// ---------- Cylinder ----------
const cyl = { angle: 0, vel: 0, mode: 'idle', notch: 0 };
const chamberOnTop = () => (((Math.round(cyl.angle / STEP) % 6) + 6) % 6);
function freeSpin(v) { cyl.mode = 'free'; cyl.vel = v; }
function settleTo(index) {
  const dir = Math.sign(cyl.vel) || 1;
  let d = (((index * STEP - cyl.angle) * dir) % TAU + TAU) % TAU;
  if (d < STEP * 1.5) d += TAU;
  cyl.mode = 'idle'; gsap.killTweensOf(cyl);
  const v = Math.max(8, Math.abs(cyl.vel));
  return gsap.to(cyl, { angle: cyl.angle + dir * d, vel: 0, duration: Math.min(0.9, (2 * d) / v), ease: 'power2.out' });
}
function updateCylinder(dt) {
  if (cyl.mode === 'free') {
    cyl.vel *= Math.exp(-dt * 0.9); cyl.vel -= Math.sign(cyl.vel) * dt * 2.2;
    cyl.angle += cyl.vel * dt;
    if (Math.abs(cyl.vel) < 1.6) { cyl.mode = 'idle'; gsap.to(cyl, { angle: Math.round(cyl.angle / STEP) * STEP, duration: 0.35, ease: 'back.out(2)' }); }
  }
  const notch = Math.floor(cyl.angle / (STEP / 2));
  if (notch !== cyl.notch) {
    const speed = Math.abs(cyl.vel);
    if (speed < 42 || Math.random() < 42 / speed) sound.click(Math.min(1, 0.35 + speed / 30));
    const now = performance.now();
    if (speed > 0.5 && speed < 30 && now - (cyl.buzzAt || 0) > 50) { cyl.buzzAt = now; buzz(4); }
    cyl.notch = notch;
  }
}

// ---------- Sequences ----------
let busy = false, spun = false, resultUp = false, lastInput = performance.now(), tl = null;
const to = (vars) => gsap.to(P, vars);
const toA = (pose, d, ease = 'power3.inOut') => gsap.to(A, { ...pose, duration: d, ease });
function isOpen() { return P.crane > OPEN_ANGLE * 0.6; }
const loadedIdx = () => S.choices.map((c, i) => i);
function loadPose() { return portrait ? LOAD.port : LOAD.land; }
// Bring the action pose to where the gun is now, so blending into it never jumps.
function grabPose() { Object.assign(A, current); }

async function openCylinder() {
  if (isOpen()) return;
  gsap.to(A, { rz: A.rz - 0.4, duration: 0.11, ease: 'power2.in', yoyo: true, repeat: 1 });
  await wait(0.08); sound.cylinderOpen();
  await to({ crane: OPEN_ANGLE, duration: 0.3, ease: 'back.out(2.2)' });
}
async function closeCylinder() {
  if (P.crane < 0.05) return;
  gsap.to(A, { rz: A.rz + 0.38, duration: 0.09, ease: 'power2.in', yoyo: true, repeat: 1 });
  await to({ crane: 0, duration: 0.13, ease: 'power3.in' });
  sound.cylinderClose(); shake = Math.max(shake, 0.15); rec.vr += 0.6; buzz(12);
}
// The spin: a reload-style move. Fresh rounds, swing out, wrist-snap the cylinder, slam it shut on a random chamber.
async function spinMove() {
  if (busy) return;
  busy = true; setUi(); hideResult();
  const idx = loadedIdx(), pick = idx[securePick(idx.length)];
  for (let i = 0; i < 6; i++) { gun.setLoaded(i, i < S.choices.length); gun.setFired(i, false); }
  grabPose(); gsap.to(P, { act: 1, ads: 0, duration: 0.3, ease: 'power2.inOut' }); toA(loadPose(), 0.32);
  await openCylinder();
  sound.whoosh(0.25);
  freeSpin(28 + Math.random() * 10);
  await wait(reduced ? 0.2 : 0.55);
  await closeCylinder();
  // Double action: the trigger pull turns the cylinder one more chamber, onto the pick.
  await settleTo((pick + 5) % 6);
  await gsap.to(P, { act: 0, duration: 0.32, ease: 'power2.inOut' });
  spun = true; busy = false; setUi();
  return pick;
}

async function fire() {
  if (mode === 'range') { if (R && !switching) { sound.unlock(); if (R.fire()) { coach.done('fire'); crossKick(); } } return; }
  if (resultUp) { again(); return; }
  if (busy) { if (tl) killTrick(); else return; }
  if (S.choices.length < 2) { toast('Load at least two choices first.'); custom.open('choices'); return; }
  sound.unlock();
  if (!spun || isOpen()) await spinMove();
  if (busy) return;
  busy = true; setUi(); hint('');
  coach.done('fire');
  // Double-action pull: the hammer rises and the cylinder turns one chamber, then the hammer falls.
  const pullT = 0.11;
  gsap.to(cyl, { angle: Math.round(cyl.angle / STEP) * STEP + STEP, duration: pullT * 0.9, ease: 'power1.inOut' });
  gsap.to(P, { hammer: HAMMER_COCK, duration: pullT, ease: 'power1.in' });
  await to({ trig: 1, duration: pullT, ease: 'power1.in' });
  P.hammer = 0;
  const pick = chamberOnTop(), word = (S.choices[pick] || '').trim();
  const dud = /^(no|nope|nah)$/i.test(word);
  // Where the bullet goes: the crosshair, with a little spread from the hip, none down the sights.
  const ray = aimRay(P.ads > 0.6 ? 0.0006 : 0.006);
  if (dud) {
    sound.dryFire(); buzz(18);
    rec.vr += reduced ? 0.4 : 2; shake = reduced ? 0.03 : 0.15;
    to({ trig: 0, duration: 0.2, delay: 0.15 });
    await wait(0.5);
    showResult(word, 'Click. An empty chamber.');
  } else {
    sound.shot(); buzz([40, 30, 70]);
    if (S.slowmo && !reduced) slowmo(0.22, 0.28, 0.5);
    const fl = 1 - P.ads * 0.6; fx.muzzleFlash(gun.muzzle, 1.1 * fl); fx.gap(gun.gap, fl);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(gun.muzzle.getWorldQuaternion(new THREE.Quaternion()));
    fx.smoke(gun.muzzle, fwd, 14, 0.8);
    fx.smoke(gun.gap, new THREE.Vector3(0, 0.5, 0), 6, 0.2);
    gun.setFired(pick, true);
    rec.vr += reduced ? 2 : 11; rec.vz += reduced ? 0.2 : 1.2; rec.vroll += reduced ? 0.5 : 4; kick.vp += reduced ? 0.3 : 3;
    shake = reduced ? 0.05 : 0.5;
    grade.uniforms.uFlash.value = 0.32; plateU.uFlash.value = 0.4;
    crossKick();
    to({ trig: 0, duration: 0.22, delay: 0.08 });
    await wait(0.03);
    let uv = target.uvFromRay(ray);
    uv = uv ? target.clampUv(uv) : { u: 0.5, v: 0.5 };
    target.hit(uv.u, uv.v);
    const p = target.worldAt(uv.u, uv.v);
    fx.debris(p, camera.getWorldPosition(new THREE.Vector3()).sub(p).normalize(), 5);
    sound.paperHit(0.012);
    await wait(0.55);
    showResult(word, 'A suggestion. You decide.');
  }
  spun = false; busy = false; setUi();
  lastInput = performance.now();
}
function aimRay(spread) {
  camera.updateMatrixWorld();
  const o = camera.getWorldPosition(new THREE.Vector3());
  const d = new THREE.Vector3((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, -1).normalize().transformDirection(camera.matrixWorld);
  return new THREE.Ray(o, d);
}
function again() { hideResult(); spinMove(); }

// ---------- Tricks ----------
const TRICKS = {
  async twirl(dir = 1) {
    await to({ grip: 0, duration: 0.12 });
    sound.whoosh(0.5); buzz(8);
    await to({ twirl: P.twirl + dir * TAU * 3, duration: 0.95, ease: 'power1.inOut' });
    P.twirl %= TAU; sound.catchGun(); rec.vr -= 1.5; buzz(25);
    await to({ grip: 1, duration: 0.1 });
  },
  async inspect() {
    grabPose(); await Promise.all([to({ act: 1, ads: 0, duration: 0.3 }), toA({ x: 0.05, y: -0.1, z: -0.27, rx: 0.15, ry: -0.75, rz: 0.75 }, 0.8, 'power2.inOut')]);
    await wait(0.6);
    await toA({ ry: 0.55, rz: -0.85, rx: 0.05 }, 0.9, 'power2.inOut');
    await wait(0.5);
    await to({ act: 0, duration: 0.6, ease: 'power2.inOut' });
  },
  async fan() {
    if (isOpen()) await closeCylinder();
    gsap.killTweensOf(cyl); cyl.mode = 'idle';
    await Promise.all([to({ trig: 1, ads: 0, duration: 0.3, ease: 'power3.out' }), gsap.to(LF, { k: 1, s: 0, duration: 0.32, ease: 'power3.out' })]);
    for (let i = 0; i < 5; i++) {
      await Promise.all([gsap.to(LF, { s: 1, duration: 0.075, ease: 'power2.in' }), to({ hammer: HAMMER_COCK, duration: 0.075, ease: 'power2.in' })]);
      P.hammer = 0; sound.dryFire(); buzz(14);
      rec.vr += 2.6; shake = Math.max(shake, 0.12);
      cyl.angle = Math.round(cyl.angle / STEP) * STEP; gsap.to(cyl, { angle: cyl.angle + STEP, duration: 0.07, ease: 'power2.out' });
      await gsap.to(LF, { s: 0, duration: 0.1, ease: 'power2.out' });
    }
    sound.catchGun(); buzz(20); spun = false;
    await Promise.all([gsap.to(LF, { k: 0, s: 0, duration: 0.45, ease: 'power2.inOut' }), to({ trig: 0, duration: 0.45 })]);
  },
};
async function softTrick() { sound.catchGun(); buzz(10); await gsap.to(ui.fade, { opacity: 0.35, duration: 0.14, yoyo: true, repeat: 1 }); ui.fade.style.opacity = ''; }
async function doTrick(name, arg) {
  if (busy) return;
  if (isOpen()) { toggleCylinder(); return; }
  busy = true; setUi(); hideResult();
  const run = reduced ? softTrick() : TRICKS[name](arg);
  tl = run;
  try { await run; } finally { if (tl === run) { tl = null; busy = false; setUi(); } }
}
function killTrick() {
  gsap.killTweensOf(P); gsap.killTweensOf(A); gsap.killTweensOf(LF); tl = null; busy = false;
  to({ trig: 0, hammer: 0, thumb: 0, grip: 1, act: 0, duration: 0.2 }); gsap.to(LF, { k: 0, s: 0, duration: 0.3 });
}
async function toggleCylinder() {
  if (busy) return;
  busy = true; setUi(); hideResult();
  if (isOpen()) { await closeCylinder(); await to({ act: 0, duration: 0.4, ease: 'power2.inOut' }); hint(''); }
  else {
    grabPose(); to({ act: 1, ads: 0, duration: 0.35 }); toA(loadPose(), 0.4);
    await openCylinder();
    hint(coarse ? 'Drag the cylinder to spin it. Tap the gun to close.' : 'Your choices, one per chamber. O or R closes it.');
  }
  busy = false; setUi();
}
// Hold on the gun (or F) = slow inspect with a light sweeping the steel.
const sweep = new THREE.PointLight(0xfff0d8, 0, 0.16, 2); gun.root.add(sweep);
const sweepPos = { z: 0.04 };
let sweepTween = null;
function holdStart() {
  if (busy || HOLD.on) return;
  HOLD.on = true; busy = true; setUi(); hideResult(); buzz(22);
  const d = reduced ? 0 : 0.8;
  grabPose(); to({ act: 1, ads: 0, twirl: 0, duration: d * 0.6 });
  toA({ x: portrait ? 0 : 0.02, y: portrait ? -0.05 : -0.07, z: portrait ? -0.3 : -0.26, rx: 0.12, ry: -0.95, rz: 0.5 }, d, 'power3.out');
  gsap.to(grade.uniforms.uDim, { value: 0.5, duration: d });
  gsap.to(sweep, { intensity: 1.4, duration: 0.4 });
  sweepTween = gsap.fromTo(sweepPos, { z: 0.04 }, { z: gun.dims.MUZZLE_Z - 0.01, duration: reduced ? 0.01 : 1.5, ease: 'sine.inOut', repeat: reduced ? 0 : -1, yoyo: true });
}
function holdEnd() {
  if (!HOLD.on) return;
  HOLD.on = false; sweepTween?.kill(); sweepTween = null;
  gsap.to(sweep, { intensity: 0, duration: 0.3 });
  gsap.to(HOLD, { yaw: 0, pitch: 0, duration: 0.5, ease: 'power2.out' });
  gsap.to(grade.uniforms.uDim, { value: 0, duration: 0.5 });
  buzz(10);
  to({ act: 0, duration: reduced ? 0 : 0.55, ease: 'power2.inOut', onComplete: () => { busy = false; setUi(); lastInput = performance.now(); } });
}

// ---------- Aim down the sights ----------
let adsWant = false, adsHeldAt = 0;
function setAds(on) {
  if (on === adsWant) return;
  adsWant = on;
  if (on) { adsHeldAt = performance.now(); hideResult(); }
  else if (adsHeldAt && performance.now() - adsHeldAt > 450) coach.done('ads');
  ui.adsBtn?.classList.toggle('on', on);
}

// ---------- Input ----------
const ray = new THREE.Raycaster();
const toScreen = (v) => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight }; };
function hitsGun(x, y) {
  ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return ray.intersectObject(gun.root, true).length > 0;
}
function nearGun(x, y) {
  for (const [ox, oy] of [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]]) if (hitsGun(x + ox, y + oy)) return true;
  return false;
}
function cylScreen() {
  const c = gun.cylinder.getWorldPosition(new THREE.Vector3());
  const s = toScreen(c), e = toScreen(gun.cartridges[0].getWorldPosition(new THREE.Vector3()));
  const axis = new THREE.Vector3(0, 0, 1).transformDirection(gun.cylinder.matrixWorld);
  const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(c);
  return { x: s.x, y: s.y, r: Math.hypot(e.x - s.x, e.y - s.y) / (gun.dims.CH_R / gun.dims.CYL_R), facing: axis.dot(toCam) > 0 ? 1 : -1 };
}
const touchLayer = $('#touch');
function ripple(x, y, big = false) {
  const el = document.createElement('div'); el.className = big ? 'tap big' : 'tap';
  el.style.left = x + 'px'; el.style.top = y + 'px';
  if (!reduced) for (let i = 0; i < 7; i++) {
    const sp = document.createElement('i');
    sp.style.setProperty('--a', (i * 51.4 + Math.random() * 18).toFixed(1) + 'deg'); sp.style.setProperty('--d', -(26 + Math.random() * (big ? 34 : 18)).toFixed(0) + 'px');
    el.appendChild(sp);
  }
  touchLayer.appendChild(el); setTimeout(() => el.remove(), 650);
}
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('button')) { buzz(6); } }, true);

let lastTouch = -1e9;
const locked = () => document.pointerLockElement === canvas;
function lockPointer() {
  if (coarse || locked() || !canvas.requestPointerLock) return;
  try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(() => { try { canvas.requestPointerLock(); } catch { /* not allowed here */ } }); } catch { /* not allowed here */ }
}
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('locked', locked());
  if (!locked()) { setAds(false); if (ready && !custom.isOpen()) hint('Click the room to aim again.'); }
  else hint('');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (locked() || e.target === canvas) e.preventDefault(); });

// Mouse: shooter controls.
canvas.addEventListener('mousedown', (e) => {
  if (!ready || e.sourceCapabilities?.firesTouchEvents || performance.now() - lastTouch < 800) return;
  sound.unlock(); lastInput = performance.now(); coach.wake();
  if (e.button === 0) { if (!locked()) lockPointer(); fire(); }
  else if (e.button === 2) setAds(true);
});
document.addEventListener('mousedown', (e) => { if (locked() && e.target !== canvas) { if (e.button === 0) fire(); else if (e.button === 2) setAds(true); } });
document.addEventListener('mouseup', (e) => { if (e.button === 2) setAds(false); });
document.addEventListener('mousemove', (e) => {
  if (!ready || coarse) return;
  const k = 0.0022 * S.sens * (P.ads > 0.5 ? 0.6 : 1);
  // Chrome can report one huge jump right after the lock engages: ignore it.
  if (locked()) { if (Math.abs(e.movementX) + Math.abs(e.movementY) < 300) setLook(look.ty + e.movementX * k, look.tp - e.movementY * k); }
  else if (e.target === canvas && !HOLD.on) setLook(((e.clientX / innerWidth) * 2 - 1) * look.limY, -((e.clientY / innerHeight) * 2 - 1) * look.limP);
  else if (HOLD.on) { HOLD.yaw = clamp(HOLD.yaw + e.movementX * 0.006, -1.1, 1.1); HOLD.pitch = clamp(HOLD.pitch + e.movementY * 0.005, -0.6, 0.6); }
});

// Touch: tap the room = fire, drag = look, gestures that start on the gun = tricks.
const touches = new Map();
const pointer = { id: null, mode: '', x: 0, y: 0, sx: 0, sy: 0, t0: 0, hist: [] };
let tapTimer = 0, holdTimer = 0, lastTap = { t: 0, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (!ready || e.pointerType === 'mouse') return;
  e.preventDefault(); lastTouch = performance.now(); // no compatibility mouse events after a tap
  sound.unlock(); lastInput = performance.now(); coach.wake();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  // Two fingers held = aim down the sights.
  if (touches.size >= 2) { pointer.mode = 'two'; clearTimeout(holdTimer); setAds(true); return; }
  if (tl) killTrick();
  const onGun = mode !== 'range' && !adsWant && nearGun(e.clientX, e.clientY);
  Object.assign(pointer, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), hist: [], onGun });
  ripple(e.clientX, e.clientY, onGun);
  const c = cylScreen();
  pointer.mode = !busy && isOpen() && Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.r * 1.5 ? 'cyl' : onGun ? 'gun' : 'look';
  if (pointer.mode === 'cyl') { cyl.mode = 'idle'; gsap.killTweensOf(cyl); pointer.a = Math.atan2(-(e.clientY - c.y), e.clientX - c.x); }
  clearTimeout(holdTimer);
  if (pointer.mode === 'gun' && !busy) {
    const id = e.pointerId;
    holdTimer = setTimeout(() => { if (pointer.id === id && pointer.mode === 'gun' && Math.hypot(pointer.x - pointer.sx, pointer.y - pointer.sy) < 12) { clearTimeout(tapTimer); pointer.mode = 'hold'; holdStart(); } }, 420);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerId !== pointer.id) return;
  lastInput = performance.now();
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  if (pointer.mode === 'hold') { HOLD.yaw = clamp(HOLD.yaw + dx * 0.008, -1.1, 1.1); HOLD.pitch = clamp(HOLD.pitch + dy * 0.006, -0.6, 0.6); }
  else if (pointer.mode === 'cyl') {
    const c = cylScreen(), a = Math.atan2(-(e.clientY - c.y), e.clientX - c.x);
    let d = a - pointer.a; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    cyl.angle += d * c.facing; pointer.a = a; pointer.hist.push({ t: performance.now(), d: d * c.facing });
  } else if (pointer.mode === 'look' || (pointer.mode === 'gun' && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 60 && performance.now() - pointer.t0 > 450)) {
    pointer.mode = 'look';
    const k = 0.0026 * S.sens * (P.ads > 0.5 ? 0.6 : 1);
    setLook(look.ty + dx * k, look.tp - dy * k);
  }
  pointer.x = e.clientX; pointer.y = e.clientY;
});
const endPointer = (e) => {
  if (e.pointerType === 'mouse') return;
  touches.delete(e.pointerId);
  if (pointer.mode === 'two') { if (touches.size < 2) setAds(false); if (!touches.size) { pointer.mode = ''; pointer.id = null; } return; }
  if (e.pointerId !== pointer.id) return;
  clearTimeout(holdTimer);
  const dt = performance.now() - pointer.t0, moved = Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy);
  const tap = dt < 300 && moved < 12;
  if (pointer.mode === 'hold') holdEnd();
  else if (pointer.mode === 'cyl') {
    const now = performance.now(), recent = pointer.hist.filter((h) => now - h.t < 90);
    const v = recent.length ? recent.reduce((s, h) => s + h.d, 0) / (Math.max(30, now - recent[0].t) / 1000) : 0;
    if (Math.abs(v) > 2) { freeSpin(clamp(v, -60, 60)); buzz(12); }
    else gsap.to(cyl, { angle: Math.round(cyl.angle / STEP) * STEP, duration: 0.3, ease: 'back.out(2)' });
    if (tap) toggleCylinder();
  } else if (pointer.mode === 'gun') {
    if (tap) {
      // Tap the gun = open / close the cylinder; a quick second tap = fan the hammer.
      const now = performance.now();
      if (!isOpen() && now - lastTap.t < 280 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 70) { clearTimeout(tapTimer); lastTap.t = 0; doTrick('fan'); }
      else { lastTap = { t: now, x: e.clientX, y: e.clientY }; clearTimeout(tapTimer); tapTimer = setTimeout(() => toggleCylinder(), isOpen() ? 0 : 280); }
    } else if (moved > 45 && dt < 450 && !isOpen()) {
      const sx = e.clientX - pointer.sx, sy = e.clientY - pointer.sy;
      doTrick('twirl', Math.abs(sy) > Math.abs(sx) ? (sy < 0 ? 1 : -1) : (sx > 0 ? 1 : -1));
    }
  } else if (pointer.mode === 'look' && tap) fire();
  pointer.id = null; pointer.mode = '';
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

addEventListener('keydown', (e) => {
  if (!ready || e.target.closest?.('input, textarea, [role="dialog"]') || e.repeat && e.key !== ' ') return;
  sound.unlock(); lastInput = performance.now();
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') { e.preventDefault(); if (!e.repeat) fire(); }
  else if (mode === 'range') {
    if (k === 'r') R?.reload();
    else if (k === 'x') resetRange();
    else if (k === 'c') { document.exitPointerLock?.(); custom.open(); }
    else if (k === 'm') toggleSound();
  }
  else if (k === 'r') { if (resultUp) again(); else spinMove(); }
  else if (k === 'f') holdStart();
  else if (k === 'o') toggleCylinder();
  else if (k === 't') doTrick('twirl', 1);
  else if (k === 'v') doTrick('fan');
  else if (k === 'e') { document.exitPointerLock?.(); custom.open('choices'); }
  else if (k === 'c') { document.exitPointerLock?.(); custom.open(); }
  else if (k === 'm') toggleSound();
});
addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'f') holdEnd(); });

// ---------- UI ----------
const ui = {
  hint: $('#hint'), toast: $('#toast'), result: $('#result'), word: $('#result-word'), sub: $('#result-sub'),
  again: $('#again'), change: $('#change'), labels: $('#labels'), leaders: $('#leaders'), fade: $('#fade'),
  count: $('#count'), countBtn: $('#choices-btn'), soundBtn: $('#sound-btn'), customBtn: $('#custom-btn'),
  adsBtn: $('#ads-btn'), spinBtn: $('#spin-btn'), cross: $('#cross'), keys: $('#keys'), veil: $('#veil'), chrome: $('#chrome'),
};
Object.assign(ui, { mode: $('#mode'), reloadBtn: $('#reload-btn'), resetBtn: $('#reset-btn'), ammo: $('#ammo'), tally: $('#tally') });
function setUi() {
  const n = S.choices.length;
  ui.count.innerHTML = `${n}<span class="lbl"> choices</span>`;
  ui.countBtn.title = S.choices.join(' · ');
  ui.spinBtn.disabled = busy;
}
let hintTimer;
function hint(text, ms = 5000) {
  clearTimeout(hintTimer);
  ui.hint.textContent = text; ui.hint.classList.toggle('show', !!text);
  if (text) hintTimer = setTimeout(() => ui.hint.classList.remove('show'), ms);
}
let toastTimer;
function toast(text) {
  ui.toast.textContent = text; ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
}
function showResult(word, sub) {
  resultUp = true; document.body.classList.add('has-result');
  ui.word.textContent = word; ui.sub.textContent = sub;
  ui.result.hidden = false;
  gsap.fromTo(ui.result, { opacity: 0, y: 20, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'power3.out' });
  gsap.fromTo('#result .stagger', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, delay: 0.08, ease: 'power2.out' });
  hint(coarse ? '' : 'Click or R: again   ·   E: change choices', 6000);
}
function hideResult() {
  if (!resultUp) return;
  resultUp = false; document.body.classList.remove('has-result');
  gsap.to(ui.result, { opacity: 0, y: 12, duration: 0.2, onComplete: () => { if (!resultUp) ui.result.hidden = true; } });
}
ui.again.addEventListener('click', (e) => { e.stopPropagation(); sound.uiTick(); again(); });
ui.change.addEventListener('click', (e) => { e.stopPropagation(); sound.uiTick(); hideResult(); custom.open('choices'); });
ui.spinBtn.addEventListener('click', () => { sound.unlock(); sound.uiTick(); spinMove(); });
ui.customBtn.addEventListener('click', () => { sound.unlock(); sound.uiTick(); custom.open(); });
ui.countBtn.addEventListener('click', () => { sound.unlock(); sound.uiTick(); custom.open('choices'); });
for (const ev of ['pointerdown']) ui.adsBtn.addEventListener(ev, (e) => { e.preventDefault(); sound.unlock(); try { ui.adsBtn.setPointerCapture(e.pointerId); } catch { /* synthetic */ } setAds(true); coach.wake(); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.adsBtn.addEventListener(ev, () => setAds(false));
ui.adsBtn.addEventListener('contextmenu', (e) => e.preventDefault());
// ---------- Range mode ----------
let mode = 'decide', R = null, switching = false, rangeLoading = null;
const KEYS = {
  decide: ui.keys.innerHTML,
  range: '<span><kbd>Click</kbd> fire</span><span><kbd>Right</kbd> aim</span><span><kbd>R</kbd> reload</span><span><kbd>X</kbd> reset range</span><span><kbd>C</kbd> customize</span><span><kbd>M</kbd> sound</span>',
};
function loadRange() {
  rangeLoading ||= import('./range.js').then(async (mod) => {
    R = mod.createRange({
      scene, camera, vm, lmir, mir, renderer, pmrem, fx, sound, gsap, S, P, reduced,
      lights: { key, rim, front, hemi },
      hands: () => hands, orient, lerpPose, REST, ELBOW_R, LQ: () => LQ,
      portrait: () => portrait, wait, buzz, aimRay, toA, grabPose,
      recoil(r, z, roll, k, sh) { rec.vr += r; rec.vz += z; rec.vroll += roll; kick.vp += k; shake = Math.max(shake, sh); },
      flash(v) { grade.uniforms.uFlash.value = v; },
      onAmmo: drawAmmo, onTally: drawTally,
      onEmpty() { if (mode === 'range' && !R.busy) hint(coarse ? 'Empty. Tap Reload, or tap again.' : 'Empty. R to reload, or click again.', 3500); },
    });
    await R.ready;
    return R;
  });
  return rangeLoading;
}
async function setMode(m, instant = false) {
  if (!RANGE_ON || m === mode || switching) return;
  if (mode === 'decide' && (busy || HOLD.on)) return;
  switching = true; sound.unlock();
  ui.mode.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  hideResult(); setAds(false); hint('');
  if (!instant) { ui.fade.classList.add('on'); await wait(0.4); }
  try {
    if (m === 'range') {
      if (!R) { $('#veil-status').textContent = 'Opening the range…'; await loadRange(); }
      gun.root.visible = false; plateRig.visible = false; desk.visible = false;
      if (scene.environment) scene.environment.dispose();
      R.enter();
      const g = R.GRADE; grade.uniforms.uGrain.value = g.grain; grade.uniforms.uTint.value.set(...g.tint);
      if (hands) for (const h of [hands.left, hands.right]) { h.dress({ ...R.SLEEVE }); scene.add(h.sleeve); }
      mode = 'range';
    } else {
      R?.leave();
      mode = 'decide';
      gun.root.visible = true; plateRig.visible = true; desk.visible = true;
      scene.environment = null; fx.setDesk(DESK_Y);
      if (hands) { orient(hands.right.group, RH.finger, RH.palm, new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)); hands.left.group.quaternion.copy(LQ); }
      await applyRoom(S.room);
    }
    S.mode = mode; store.set('mode', mode);
  } catch (err) { console.error(err); toast('The range could not load. Try again.'); }
  applyModeUi(); resize();
  if (!instant) { await wait(0.08); ui.fade.classList.remove('on'); }
  switching = false;
  if (mode === 'range' && ready) hint(coarse ? 'Tap to fire. Reload when the slide locks back.' : 'Click to fire. R reloads when the slide locks back.', 4500);
}
function applyModeUi() {
  const range = mode === 'range';
  document.documentElement.dataset.mode = mode;
  document.body.classList.toggle('range', range);
  ui.mode.hidden = !RANGE_ON;
  ui.mode.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  ui.countBtn.hidden = range; ui.spinBtn.hidden = range;
  ui.resetBtn.hidden = ui.reloadBtn.hidden = ui.ammo.hidden = !range;
  ui.tally.hidden = !range || !S.tally;
  ui.keys.innerHTML = KEYS[mode];
  canvas.setAttribute('aria-label', range
    ? 'First-person view on an indoor shooting range: your hands hold a semi-auto pistol. Paper, steel plates, bottles and a spinner stand downrange.'
    : 'First-person view: your hand holds a revolver, a paper target stands across the room. Click or tap to fire; the chamber under the hammer is your pick.');
  if (range) R?.report();
}
let ammoKey = '';
function drawAmmo({ chamber, mag, locked, reloading }) {
  const key = `${chamber}${mag}${locked}${reloading}`;
  if (key === ammoKey) return; ammoKey = key;
  const n = (chamber ? 1 : 0) + mag;
  ui.ammo.querySelector('.n').textContent = String(n);
  ui.ammo.querySelector('.pips').innerHTML = `<i class="ch${chamber ? ' on' : ''}"></i>` + Array.from({ length: 7 }, (_, i) => `<i class="${i < mag ? 'on' : ''}"></i>`).join('');
  ui.ammo.classList.toggle('empty', locked);
  ui.ammo.querySelector('.s').textContent = reloading ? 'Reloading' : locked ? 'Slide locked' : '';
  ui.ammo.setAttribute('aria-label', `${n} rounds${locked ? ', slide locked back' : ''}`);
  ui.reloadBtn.classList.toggle('pulse', locked && !reloading);
  if (reloading) hint('');
}
function drawTally(h, s) { ui.tally.innerHTML = `<span>${h}</span> ${h === 1 ? 'hit' : 'hits'} <i>/</i> <span>${s}</span> ${s === 1 ? 'shot' : 'shots'}`; }
function resetRange() { if (R && mode === 'range') { R.reset(); toast('Range reset.'); } }
ui.mode.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { sound.uiTick(); setMode(b.dataset.mode); } });
ui.mode.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); const m = mode === 'range' ? 'decide' : 'range'; setMode(m); ui.mode.querySelector(`[data-mode="${m}"]`).focus();
});
ui.reloadBtn.addEventListener('click', () => { sound.unlock(); R?.reload(); });
ui.resetBtn.addEventListener('click', () => { sound.unlock(); sound.uiTick(); resetRange(); });

function syncSound() { ui.soundBtn.setAttribute('aria-pressed', String(!S.muted)); ui.soundBtn.setAttribute('aria-label', S.muted ? 'Sound off' : 'Sound on'); }
function toggleSound() { sound.unlock(); S.muted = !S.muted; sound.setMuted(S.muted); store.set('muted', S.muted); syncSound(); custom.refresh(); }
ui.soundBtn.addEventListener('click', toggleSound);
sound.setMuted(S.muted); syncSound();
function setCrosshair() { ui.cross.dataset.style = S.crosshair; }
let crossK = 0;
function crossKick() { crossK = 1; }

// Chamber labels around the open cylinder.
const labelEls = [0, 1, 2, 3, 4, 5].map(() => {
  const el = document.createElement('div'); el.className = 'chamber'; ui.labels.appendChild(el);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ui.leaders.appendChild(line);
  return { el, line };
});
let labelsAlpha = 0;
function updateLabels(dt) {
  const show = P.crane > OPEN_ANGLE * 0.9 && P.act > 0.6;
  labelsAlpha += ((show && Math.abs(cyl.vel) < 9 ? 1 : 0) - labelsAlpha) * Math.min(1, dt * 8);
  ui.labels.style.opacity = ui.leaders.style.opacity = labelsAlpha.toFixed(3);
  if (labelsAlpha < 0.01) return;
  const c = cylScreen();
  labelEls.forEach(({ el, line }, i) => {
    const text = (S.choices[i] || '').trim();
    if (el.textContent !== text) { el.textContent = text; el.style.display = text ? '' : 'none'; line.style.display = text ? '' : 'none'; el._w = el.offsetWidth; }
    if (!text) return;
    const p = toScreen(gun.cartridges[i].getWorldPosition(new THREE.Vector3()));
    let dx = p.x - c.x, dy = p.y - c.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const r1 = len + c.r * 0.45, r2 = c.r * 1.5 + 22;
    const lx = c.x + dx * r2, ly = c.y + dy * r2;
    line.setAttribute('x1', c.x + dx * r1); line.setAttribute('y1', c.y + dy * r1); line.setAttribute('x2', lx - dx * 6); line.setAttribute('y2', ly - dy * 6);
    const w = el._w || 0, left = dx > 0.25 ? lx : dx < -0.25 ? lx - w : lx - w / 2;
    el.style.transform = `translate(${Math.min(Math.max(left, 12), innerWidth - w - 12)}px, ${ly}px) translateY(-50%)`;
    el.classList.toggle('top', i === chamberOnTop() && Math.abs(cyl.vel) < 0.5);
  });
}

// ---------- First-run coach: three steps, each done by doing it ----------
const coach = (() => {
  const el = $('#coach'), text = $('#coach-text'), dots = [...document.querySelectorAll('#coach i')];
  const steps = coarse
    ? [['look', 'Drag across the room to look around'], ['fire', 'Tap the room to fire'], ['ads', 'Hold the Aim button to look down the sights']]
    : [['look', 'Move the mouse to aim'], ['fire', 'Left click to fire'], ['ads', 'Hold right click to aim down the sights']];
  let i = -1, active = false;
  const show = () => {
    dots.forEach((d, k) => d.classList.toggle('on', k <= i));
    text.textContent = steps[i][1];
    el.hidden = false; gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  };
  return {
    start(force = false) { if (!force && store.get('coachDone', false)) return; i = 0; active = true; show(); },
    wake() { /* reserved: the coach waits for the player */ },
    done(step) {
      if (!active || steps[i][0] !== step) return;
      i++;
      if (i >= steps.length) { active = false; store.set('coachDone', true); gsap.to(el, { opacity: 0, y: 8, duration: 0.3, onComplete: () => { el.hidden = true; } }); toast('That is all. Enjoy.'); return; }
      gsap.to(el, { opacity: 0, duration: 0.15, onComplete: show });
    },
    get active() { return active; },
  };
})();

// ---------- Rooms ----------
const texLoader = new THREE.TextureLoader();
const plateTex = {};
function getPlate(id) {
  if (!plateTex[id]) {
    const big = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio, MAX_DPR) > 2400;
    plateTex[id] = texLoader.loadAsync(`assets/plates/${id}-${big ? '4k' : '2k'}.jpg`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }
  return plateTex[id];
}
// Image-based lighting that matches the room: the photo wrapped round (front, mirrored sides and back, toned down),
// plus HDR panels where the room's lamps and the light behind the player are, so steel gets real highlights.
function buildEnv(img, r) {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), q = W / 4, y0 = H * 0.22, h = H * 0.6;
  if ('filter' in g) g.filter = 'saturate(0.35)';
  const draw = (cx, flip, alpha) => { g.save(); g.globalAlpha = alpha; g.translate(cx, 0); g.scale(flip ? -1 : 1, 1); g.drawImage(img, -q * 0.75, y0, q * 1.5, h); g.restore(); };
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  draw(W * 0.75, true, 0.7); draw(0, true, 0.55); draw(W, true, 0.55); draw(W * 0.5, false, 0.55); draw(W * 0.25, false, 1);
  g.filter = 'none';
  g.drawImage(cv, 0, y0, W, 2, 0, 0, W, y0); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, W, y0);
  g.drawImage(cv, 0, y0 + h - 2, W, 2, 0, y0 + h, W, H - y0 - h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const envScene = new THREE.Scene();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(5, 48, 24), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide }));
  sphere.rotation.y = -Math.PI / 2; envScene.add(sphere);
  for (const L of r.lamps) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L.s, L.s * 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(L.c).multiplyScalar(L.i), side: THREE.DoubleSide }));
    m.position.set(...L.d).normalize().multiplyScalar(3); m.lookAt(0, 0, 0); envScene.add(m);
  }
  const env = pmrem.fromScene(envScene, 0.02).texture;
  t.dispose(); envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}
async function applyRoom(id) {
  const r = ROOMS[id];
  const tex = await getPlate(id);
  plateMat.map = tex; plateMat.needsUpdate = true;
  plate.userData.aspect = tex.image.width / tex.image.height;
  if (scene.environment) scene.environment.dispose();
  scene.environment = buildEnv(tex.image, r);
  scene.environmentIntensity = r.env;
  key.color.setHex(r.key.color); key.intensity = r.key.intensity; key.position.set(...r.key.pos);
  rim.color.setHex(r.rim.color); rim.intensity = r.rim.intensity; rim.position.set(...r.rim.pos);
  hemi.color.setHex(r.hemi[0]); hemi.groundColor.setHex(r.hemi[1]); hemi.intensity = r.hemi[2];
  shadowMat.opacity = r.shadow;
  grade.uniforms.uVignette.value = r.grade.vignette; grade.uniforms.uGrain.value = r.grade.grain; grade.uniforms.uTint.value.set(...r.grade.tint);
  if (hands) for (const h of [hands.left, hands.right]) { h.dress({ sleeve: r.sleeve, cuff: r.cuff, watch: h === hands.left }); scene.add(h.sleeve); }
  document.documentElement.dataset.room = id;
  sound.setRoom(id);
  roomId = id;
  resize();
}
let roomId = null;
async function switchRoom(id) {
  if (id === roomId) return;
  ui.fade.classList.add('on'); await wait(0.4);
  await applyRoom(id); target.clear();
  ui.fade.classList.remove('on');
}

// ---------- Customize ----------
const custom = createCustomize({
  S, ROOMS, PRESETS, LOOKS, coarse,
  save(k, v) { S[k] = v; store.set(k, v); },
  setLook(id) { S.look = id; store.set('look', id); gun.setLook(id); },
  setSkin(id) { S.skin = id; store.set('skin', id); if (hands) { hands.left.setSkin(id); hands.right.setSkin(id); } },
  setRoom(id) { S.room = id; store.set('room', id); switchRoom(id); },
  setChoices(list) { S.choices = list; store.set('choices', list); applyChoices(); },
  setFeel(k, v) {
    S[k] = v; store.set(k, v);
    if (k === 'muted') { sound.setMuted(v); syncSound(); }
    if (k === 'lefty') applyHand();
    if (k === 'crosshair') setCrosshair();
  },
  showCoach() { store.set('coachDone', false); coach.start(true); },
  clearTarget() { if (mode === 'range') R?.papers.forEach((p) => p.clear()); else target.clear(); },
  mode: () => mode,
  PISTOL_LOOKS: [{ id: 'classic', name: 'Classic', note: 'Worn blue, walnut' }, { id: 'stainless', name: 'Stainless', note: 'Brushed steel, black grips' }, { id: 'black', name: 'Black', note: 'Nitride, G10' }],
  TARGET_SETS: [
    { id: 'paper', name: 'Paper at 5, 10 and 15 m' }, { id: 'steel', name: 'Steel plates' },
    { id: 'bottles', name: 'Bottles and cans' }, { id: 'spinner', name: 'Spinner' },
  ],
  setPistolLook(id) { S.pistolLook = id; store.set('pistolLook', id); R?.setLook(id); },
  setTarget(k, on) { S.targets = { ...S.targets, [k]: on }; store.set('targets', S.targets); R?.setSets(S.targets); },
  setTally(on) { S.tally = on; store.set('tally', on); ui.tally.hidden = !(on && mode === 'range'); },
  resetRange() { resetRange(); },
  sound, toast,
  onOpen() { document.exitPointerLock?.(); setAds(false); hideResult(); },
});
function applyChoices() {
  for (let i = 0; i < 6; i++) { gun.setLoaded(i, i < S.choices.length); gun.setFired(i, false); }
  spun = false; setUi();
}
function applyHand() { mir.scale.x = lmir.scale.x = S.lefty ? -1 : 1; }

// ---------- Frame ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const poseR = {}, poseL = {};
const current = { x: 0, y: 0, z: -0.3, rx: 0, ry: 0, rz: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  portrait = w / h < 0.85;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const full = Math.min(devicePixelRatio, MAX_DPR), pr = Math.max(Math.min(full, 1), full * quality);
  renderer.setPixelRatio(pr); composer.setPixelRatio(1);
  renderer.setSize(w, h, false); composer.setSize(Math.floor(w * pr), Math.floor(h * pr)); bloom.resolution.set(w / 2, h / 2);
  // The photo fills the hip view with a margin to look around in; the target sits over the painted one.
  const fov = portrait ? FOV.hipP : FOV.hip;
  const hgt = 2 * PLATE_D * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 1.12, a = plate.userData.aspect || 1.5;
  const wid = Math.max(hgt * a, hgt * camera.aspect * 1.12);
  plate.scale.set(wid, wid / a, 1);
  const T = ROOMS[roomId || S.room].target;
  const p = new THREE.Vector3((T.u - 0.5) * wid, (0.5 - T.v) * (wid / a), -PLATE_D);
  const standY = T.stand ? (0.5 - T.stand) * (wid / a) : 0;
  target.place(plateRig, p, T.w * wid, T.h * (wid / a), TARGET_K, T.shape, T.stand ? standY : 0);
  // Look straight at the target; the limits keep the crosshair around the paper.
  plateRig.updateMatrixWorld();
  const c = plateRig.localToWorld(p.clone());
  look.baseYaw = Math.atan2(-c.x, -c.z); look.basePitch = Math.atan2(c.y, Math.hypot(c.x, c.z));
  const halfW = Math.atan((T.w * wid) / 2 / PLATE_D), halfH = Math.atan((T.h * (wid / a)) / 2 / PLATE_D);
  look.limY = halfW + 0.07; look.limP = halfH + 0.05;
  LH.desk.x = portrait ? -0.1 : -0.17;
  if (mode === 'range' && R) {
    // The range is real 3D: look straight downrange, with room to swing across every target.
    look.baseYaw = 0; look.basePitch = R.LOOK.pitch; look.limY = R.LOOK.limY; look.limP = R.LOOK.limP;
    R.REST_L.pos.x = portrait ? -0.13 : -0.2;
  }
  setLook(look.ty, look.tp);
}
addEventListener('resize', resize);

function hipPose(out) {
  const range = mode === 'range', Hs = range ? R.HIP : HIP, H = portrait ? Hs.port : Hs.land;
  // Point the bore at the crosshair's spot on the paper (converging hip aim).
  const D = range ? R.HIP.D : 4.2;
  const bx = H.x, by = H.y + (range ? R.gun : gun).dims.BORE_Y, bz = H.z;
  const dx = 0 - bx, dy = 0 - by, dz = -D - bz, len = Math.hypot(dx, dy, dz);
  out.x = H.x; out.y = H.y; out.z = H.z;
  out.rx = Math.asin(dy / len); out.ry = Math.atan2(-dx, -dz); out.rz = Hs.rz;
  return out;
}
const sightTmp = { a: new THREE.Vector3(), b: new THREE.Vector3() };
function adsPose(out) {
  // Rear and front sights on the eye's centre line: pitch the gun so the sight line is level, then slide it onto the axis.
  const range = mode === 'range';
  const rs = sightTmp.a.copy(range ? R.sights.rear : gun.rearSight.position), fs = sightTmp.b.copy(range ? R.sights.front : gun.frontSight.position);
  const rx = Math.atan2(fs.y - rs.y, -(fs.z - rs.z));
  const c = Math.cos(-rx), s = Math.sin(-rx);
  const ry_ = rs.y * c - rs.z * s, rz_ = rs.y * s + rs.z * c;
  const EYE = range ? R.ADS_EYE : ADS_EYE, eye = portrait ? EYE.port : EYE.land;
  out.x = -rs.x; out.y = -ry_ - 0.0004; out.z = -eye - rz_;
  out.rx = -rx; out.ry = 0; out.rz = 0;
  return out;
}
const hipP = {}, adsP = {};
function update(dt, t, raw) {
  const range = mode === 'range';
  if (!range) updateCylinder(dt);
  // Springs: recoil (muzzle flip, push back, wrist roll), camera kick, weapon sway.
  rec.vr += (-170 * rec.r - 15 * rec.vr) * dt; rec.r += rec.vr * dt;
  rec.vz += (-220 * rec.z - 18 * rec.vz) * dt; rec.z += rec.vz * dt;
  rec.vroll += (-150 * rec.roll - 14 * rec.vroll) * dt; rec.roll += rec.vroll * dt;
  kick.vp += (-90 * kick.p - 13 * kick.vp) * dt; kick.p += kick.vp * dt;
  // Look: the view eases to the aim; the gun lags behind it with a little weight.
  const ease = Math.min(1, raw * (locked() || coarse ? 22 : 9));
  const py = look.yaw, pp = look.pitch;
  look.yaw += (look.ty - look.yaw) * ease; look.pitch += (look.tp - look.pitch) * ease;
  const vy = (look.yaw - py) / Math.max(raw, 1e-4), vp = (look.pitch - pp) / Math.max(raw, 1e-4);
  look.moved += Math.abs(look.yaw - py) + Math.abs(look.pitch - pp);
  if (look.moved > 0.12) coach.done('look');
  sway.vx += (-80 * sway.x - 11 * sway.vx - vy * 1.6) * dt; sway.x += sway.vx * dt;
  sway.vy += (-80 * sway.y - 11 * sway.vy - vp * 1.6) * dt; sway.y += sway.vy * dt;
  shake *= Math.exp(-raw * 7);
  const m = reduced ? 0.15 : 1;
  const adsK = P.ads, calm = 1 - adsK * 0.75;
  const breathe = (Math.sin(t * 1.1) * 0.003 + Math.sin(t * 0.37) * 0.002) * calm;
  rig.rotation.set(look.basePitch + look.pitch + (kick.p * 0.03 + (Math.random() - 0.5) * shake * 0.012) * m, look.baseYaw - look.yaw + ((Math.random() - 0.5) * shake * 0.012) * m, 0, 'YXZ');
  camera.rotation.set(breathe * 0.25 * m, Math.sin(t * 0.53) * 0.002 * calm * m, 0);
  const fov0 = portrait ? FOV.hipP : FOV.hip, fov1 = portrait ? FOV.adsP : FOV.ads;
  camera.fov = lerp(fov0, fov1, adsK) - (HOLD.on ? 4 : 0); camera.updateProjectionMatrix();
  plateU.uBias.value = lerp(0, 2.2, Math.max(adsK, P.act * (isOpen() ? 1 : 0.6)));
  plateU.uFlash.value *= Math.exp(-raw * 14); grade.uniforms.uFlash.value *= Math.exp(-raw * 16);
  plateU.uGain.value = 1 - grade.uniforms.uDim.value * 0.25 - adsK * 0.06;
  grade.uniforms.uVignette.value = (range ? R.GRADE : ROOMS[roomId || 'study'].grade).vignette + adsK * 0.18;

  // Viewmodel: hip <-> sights by P.ads, then any action pose by P.act, then recoil and sway on top.
  hipPose(hipP); adsPose(adsP);
  const e = adsK * adsK * (3 - 2 * adsK), lift = Math.sin(e * Math.PI) * 0.012;
  for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz']) current[k] = lerp(lerp(hipP[k], adsP[k], e), A[k], P.act);
  current.y -= lift;
  if (range) { const k = 1 - P.act; for (const c of ['x', 'y', 'z', 'rx', 'ry', 'rz']) current[c] += R.tilt[c] * k; }
  const sw = 1 - adsK * 0.7;
  vm.position.set(current.x - sway.x * 0.02 * sw, current.y + sway.y * 0.015 * sw + Math.sin(t * 1.1) * 0.0012 * calm * m, current.z + rec.z * 0.045);
  vm.rotation.set(current.rx + rec.r * 0.075 + sway.y * 0.12 * sw + HOLD.pitch, current.ry + sway.x * 0.18 * sw + HOLD.yaw, current.rz - rec.roll * 0.05 + sway.x * 0.08 * sw, 'YXZ');
  if (sweep.intensity > 0.001) {
    gun.root.updateMatrixWorld();
    const side = gun.root.worldToLocal(camera.getWorldPosition(tmpV)).x > 0 ? 1 : -1;
    sweep.position.set(side * 0.03, gun.dims.BORE_Y + 0.018, sweepPos.z);
  }
  gun.root.rotation.x = P.twirl;
  gun.crane.rotation.z = P.crane;
  gun.cylinder.rotation.z = cyl.angle;
  gun.hammer.rotation.x = P.hammer;
  gun.trigger.rotation.x = P.trig * TRIGGER_PULL;
  // Crosshair: gives way to the sights, opens on a shot.
  crossK *= Math.exp(-raw * 9);
  ui.cross.style.opacity = String(Math.max(0, 1 - adsK * 2.2) * (1 - P.act) * (busy && !spun && !range ? 0.6 : 1));
  ui.cross.style.setProperty('--spread', (1 + crossK * 1.6).toFixed(3));

  if (range) { R.update(dt, raw, t); R.updateHands(raw, t); }
  else if (hands) {
    const { right, left } = hands;
    right.group.position.copy(RH.pos);
    lerpPose(OPEN, GRIP, P.grip, poseR);
    poseR.thumb = poseR.thumb.map((v, i) => v + THUMB_COCK[i] * P.thumb + THUMB_TUCK[i] * (P.crane / OPEN_ANGLE));
    poseR.index[1] += P.trig * TRIG_IDX[1]; poseR.index[0] += P.trig * TRIG_IDX[0];
    right.apply(poseR);
    left.group.position.copy(LH.desk); left.group.quaternion.copy(LQ);
    lerpPose(REST, FLAT, LF.k, poseL);
    const elbowNow = tmpV2.copy(LH.elbow);
    if (LF.k > 0.001) {
      const k = LF.k * LF.k * (3 - 2 * LF.k);
      camera.getWorldQuaternion(tmpQ);
      const fanP = gun.hammer.getWorldPosition(new THREE.Vector3()).add(tmpV.copy(FAN.off).setZ(FAN.off.z + LF.s * FAN.sweep).applyQuaternion(tmpQ));
      lmir.worldToLocal(fanP);
      left.group.position.lerp(fanP, k);
      const o = new THREE.Object3D();
      orient(o, tmpV.copy(FAN.finger).applyQuaternion(tmpQ), new THREE.Vector3().copy(FAN.palm).applyQuaternion(tmpQ), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
      left.group.quaternion.slerp(o.quaternion, k);
      elbowNow.lerp(fanP.clone().add(tmpV.copy(FAN.elbow).applyQuaternion(tmpQ)), k);
    }
    const drum = (t % 7) - 5.2;
    ['pinky', 'ring', 'middle', 'index'].forEach((f, i) => { const ph = (drum - i * 0.11) / 0.22; if (ph > 0 && ph < 1 && !reduced) poseL[f][0] -= Math.sin(ph * Math.PI) * 0.45; });
    left.apply(poseL);
    scene.updateMatrixWorld();
    const fore = tmpV.set(0, 0, 1).transformDirection(right.wrist.matrixWorld).add(new THREE.Vector3().copy(ELBOW_R).add(new THREE.Vector3(-0.15 * P.ads, -1.2 * P.ads, 0)).multiply(new THREE.Vector3(mir.scale.x, 1, 1)).applyQuaternion(camera.getWorldQuaternion(tmpQ))).normalize();
    right.aimSleeve(right.wrist.getWorldPosition(new THREE.Vector3()).addScaledVector(fore, 0.3));
    left.aimSleeve(lmir.localToWorld(elbowNow.clone()));
  }
  fx.update(dt);
  if (!range) { target.update(dt); if (hands) updateLabels(raw); }
  if (adsWant !== (P.ads > 0.5) || (adsWant && P.ads < 1) || (!adsWant && P.ads > 0)) {
    const want = adsWant && !P.act ? 1 : 0;
    P.ads += clamp(want - P.ads, -raw / 0.16, raw / 0.2);
  }
}

// Slow motion: time drops to s0 for `hold` real seconds, then eases back over `ramp`.
const slow = { s0: 1, from: 0, hold: 0, ramp: 0 };
function slowmo(s0, hold, ramp) { Object.assign(slow, { s0, from: performance.now(), hold: hold * 1000, ramp: ramp * 1000 }); }
function timeScaleNow() {
  const e = performance.now() - slow.from;
  if (e >= slow.hold + slow.ramp) return 1;
  if (e < slow.hold) return slow.s0;
  const k = (e - slow.hold) / slow.ramp; return slow.s0 + (1 - slow.s0) * k * k;
}
const perf = { t: 0, n: 0 }, debugCam = new THREE.PerspectiveCamera(30, 1, 0.005, 40);
let running = true;
function frame() {
  if (document.hidden) { running = false; return; }
  const ts = timeScaleNow(); gsap.globalTimeline.timeScale(ts);
  const raw = Math.min(clock.getDelta(), 1 / 20), dt = raw * ts, t = clock.elapsedTime;
  if (ready && !window.dbg?.noGovernor && (perf.t += raw, ++perf.n === 90)) {
    if (perf.t / 90 > 1 / 48 && renderer.getPixelRatio() > 1) { quality *= 0.8; resize(); }
    perf.t = perf.n = 0;
  }
  if (!(debug && window.dbg?.freeze)) update(dt, t, raw);
  grade.uniforms.uTime.value = t;
  const v = debug && window.dbg?.view;
  if (v) {
    const c = vm.localToWorld(new THREE.Vector3(...(v.at || [0, 0, 0])));
    debugCam.aspect = camera.aspect; debugCam.fov = v.fov || 30; debugCam.updateProjectionMatrix();
    debugCam.position.copy(camera.localToWorld(new THREE.Vector3(...v.from)).sub(camera.getWorldPosition(new THREE.Vector3())).add(c));
    debugCam.lookAt(c); renderPass.camera = debugCam;
  } else renderPass.camera = camera;
  composer.render();
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sound.suspend(); return; }
  sound.resume(); clock.getDelta(); perf.t = perf.n = 0;
  if (!running) { running = true; requestAnimationFrame(frame); }
});

// ---------- Boot ----------
let ready = false;
setCrosshair(); applyHand(); setUi(); applyModeUi();
ui.keys.hidden = coarse;
document.body.classList.toggle('touch', coarse);
(async () => {
  resize();
  const [h] = await Promise.all([loadHands(), gun.ready]);
  hands = h;
  scene.add(hands.left.group); lmir.add(hands.left.group); vm.add(hands.right.group);
  orient(hands.right.group, RH.finger, RH.palm, new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0));
  orient(hands.left.group, new THREE.Vector3(0.25, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
  LQ = hands.left.group.quaternion.clone();
  for (const x of [hands.left, hands.right]) x.setSkin(S.skin);
  applyChoices();
  await applyRoom(S.room);
  if (S.mode === 'range') { $('#veil-status').textContent = 'Opening the range…'; await setMode('range', true); }
  await document.fonts.ready;
  ready = true;
  gsap.to(ui.veil, { opacity: 0, duration: 0.8, onComplete: () => { ui.veil.hidden = true; } });
  ui.chrome.hidden = false; gsap.fromTo(ui.chrome, { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.3 });
  if (sharedLoaded) toast(`Loaded ${S.choices.length} shared choices.`);
  coach.start();
  if (!coach.active) hint(mode === 'range' ? (coarse ? 'Tap to fire. Reload when the slide locks back.' : 'Click to fire. R reloads when the slide locks back.') : coarse ? 'Tap to fire. Hold Aim for the sights.' : 'Click to fire. Hold right click to aim.');
})().catch((err) => { $('#veil-status').textContent = 'The room could not load. Refresh to try again.'; console.error(err); });
frame();
if ('serviceWorker' in navigator && !params.has('nosw')) {
  // A new version takes over: if it lands in the first seconds after opening, reload straight into it.
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && performance.now() < 12000 && !sessionStorage.getItem('swReloaded')) { sessionStorage.setItem('swReloaded', '1'); location.reload(); } });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (debug) window.dbg = { P, A, S, HIP, LOAD, ADS_EYE, FOV, RH, GRIP, OPEN, REST, LH, FAN, cyl, gun, target, look, hands: () => hands, camera, rig, vm, mir, renderer, composer, scene, fx, fire, spinMove, toggleCylinder, holdStart, holdEnd, doTrick, setAds, slowmo, key, rim, front, hemi, plate, gsap, THREE, orient, coach, custom, freeze: false, view: null,
  reorient() { orient(hands.right.group, RH.finger, RH.palm, new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)); },
  setMode, get R() { return R; }, get mode() { return mode; }, resetRange,
  // Point the view at a world point (tests and stills).
  aimAt(x, y, z) { look.ty = look.yaw = -Math.atan2(-x, -z) + look.baseYaw; look.tp = look.pitch = Math.atan2(y, Math.hypot(x, z)) - look.basePitch; } };
