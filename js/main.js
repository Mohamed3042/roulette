import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRevolver, OPEN_ANGLE, STEP } from './revolver.js';
import { loadHands } from './hands.js';
import { createFx } from './fx.js';
import { Sound } from './sound.js';

const gsap = window.gsap;
const TAU = Math.PI * 2;
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('roulette.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('roulette.' + k, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ } },
};

// ---------- Rooms (templates) ----------
const ROOMS = {
  study: {
    no: '01', name: 'The Study', blurb: 'Green leather, lamplight, a target on the easel.',
    finish: 'blued', wood: 'walnut', sleeve: '#2c3b30', cuff: '#ece6da',
    key: { color: 0xffb36e, intensity: 3.4, pos: [-0.9, 0.12, -1.1] },
    rim: { color: 0xffcf9a, intensity: 0.9, pos: [0.8, 0.5, -1.8] },
    hemi: [0x7a7f88, 0x2a1c12, 0.5], env: 0.85, shadow: 0.55,
    grade: { vignette: 0.5, grain: 0.05, tint: [1.03, 1.0, 0.95] },
  },
  salon: {
    no: '02', name: 'The Salon', blurb: 'Velvet drapes, whisky, a round target in the dark.',
    finish: 'nickel', wood: 'rosewood', sleeve: '#3b2a22', cuff: '#efe9de',
    key: { color: 0xffa95e, intensity: 3.0, pos: [-0.95, 0.25, -1.0] },
    rim: { color: 0xff7a5c, intensity: 1.0, pos: [0.4, 0.4, -2.2] },
    hemi: [0x8a4a44, 0x1c0c0a, 0.45], env: 0.8, shadow: 0.6,
    grade: { vignette: 0.55, grain: 0.055, tint: [1.05, 0.98, 0.95] },
  },
  atelier: {
    no: '03', name: 'The Atelier', blurb: 'Roman light, marble, an afternoon to decide.',
    finish: 'stainless', wood: 'honey', sleeve: '#4a4239', cuff: '#f4efe6',
    key: { color: 0xffe0b5, intensity: 3.6, pos: [1.2, 1.1, -1.6] },
    rim: { color: 0xfff1d6, intensity: 1.2, pos: [-0.6, 0.6, 0.6] },
    hemi: [0xfff1dc, 0x7a3a2c, 1.0], env: 1.1, shadow: 0.42,
    grade: { vignette: 0.28, grain: 0.035, tint: [1.02, 1.0, 0.97] },
  },
};
const PRESETS = {
  Tonight: ['Coffee', 'Dinner', 'Cinema', 'Walk', 'Stay in', 'Road trip'],
  Food: ['Pizza', 'Sushi', 'Burgers', 'Tacos', 'Salad', 'Cook at home'],
  'Yes or no': ['Yes', 'No', 'Yes', 'No', 'Yes', 'No'],
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

let roomId = store.get('room', null);
let skin = store.get('skin', 'medium');
let choices = store.get('choices', PRESETS.Tonight);
if (!Array.isArray(choices) || choices.length !== 6) choices = PRESETS.Tonight.slice();

// ---------- Renderer, camera, rig ----------
const DESK_Y = -0.27, PITCH = -0.12, PLATE_D = 9;
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const mobile = matchMedia('(pointer: coarse)').matches;
// Device pixel density capped at 2 (phones stay at 60 fps); `quality` steps down in frame() if fps drops.
const MAX_DPR = 2;
let quality = 1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050403);
const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 40);
const rig = new THREE.Group(); rig.rotation.x = PITCH; rig.add(camera); scene.add(rig);
const vm = new THREE.Group(); camera.add(vm);
const pmrem = new THREE.PMREMGenerator(renderer);

// Backplate: the AI room photo, mip-biased for focus pulls and lit by the muzzle flash.
const plateU = { uBias: { value: 0 }, uGain: { value: 1 }, uFlash: { value: 0 } };
const plateMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
plateMat.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, plateU);
  s.fragmentShader = 'uniform float uBias, uGain, uFlash;\n' + s.fragmentShader.replace('#include <map_fragment>',
    '#ifdef USE_MAP\nvec4 sampledDiffuseColor = texture2D(map, vMapUv, uBias); diffuseColor *= sampledDiffuseColor;\n' +
    'diffuseColor.rgb *= uGain; diffuseColor.rgb += uFlash * vec3(1.0, .72, .42) * (1.0 - distance(vMapUv, vec2(.5, .42)) * 1.3);\n#endif');
};
const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), plateMat);
plate.position.z = -PLATE_D; plate.renderOrder = -1; rig.add(plate);

// Desk shadow catcher, lights.
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.5, color: 0x0a0604 });
const desk = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), shadowMat);
desk.rotation.x = -Math.PI / 2; desk.position.y = DESK_Y; desk.receiveShadow = true; scene.add(desk);
const key = new THREE.SpotLight(0xffffff, 3, 0, 0.75, 0.9, 0);
key.castShadow = true; key.shadow.mapSize.setScalar(Math.min(renderer.capabilities.maxTextureSize, mobile ? 1024 : 2048)); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015;
key.shadow.camera.near = 0.2; key.shadow.camera.far = 5; key.shadow.radius = 4;
key.target.position.set(0.05, -0.2, -0.5); scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffffff, 1); scene.add(rim);
// Soft light from the room behind the player, so faces toward the camera are not black.
const front = new THREE.DirectionalLight(0xffe6c8, 1.1); front.position.set(0.4, 0.7, 1.2); scene.add(front);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5); scene.add(hemi);

// ---------- Post ----------
// The scene renders off-screen, so the canvas's own antialias never applies: multisample on 1x screens (denser ones are sharp already).
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: devicePixelRatio < 1.5 ? 4 : 0 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.9); composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.4 }, uGrain: { value: 0.04 }, uFlash: { value: 0 }, uAberr: { value: 0.012 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uDim: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uFlash, uAberr, uDim; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - .5; float r2 = dot(d, d); vec2 o = d * r2 * uAberr;
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b) * uTint;
      c += uFlash * vec3(1., .82, .58) * (1. - r2 * 1.6);
      float v = smoothstep(.95, .25, length(d * vec2(1., .9)));
      c *= mix(1. - uVignette - uDim * .5, 1., v) * (1. - uDim * .25);
      c += (hash(vUv * 1000. + fract(uTime * 7.3)) - .5) * uGrain;
      gl_FragColor = vec4(c, 1.);
    }`,
});
composer.addPass(grade);

// ---------- Scene content ----------
const gun = createRevolver();
vm.add(gun.root);
const fx = createFx(scene); fx.setDesk(DESK_Y);
fx.placard.group.position.set(-0.035, DESK_Y, -0.9);
fx.placard.group.rotation.y = 0.04;
const sound = new Sound();
let hands = null;

// Pose state (tweened by GSAP, applied every frame). Viewmodel numbers are camera-space metres/radians.
const VIEW = { fov: 46, fovPortrait: 62 };
const POSE = {
  ready: { x: 0.105, y: -0.075, z: -0.44, rx: 0.04, ry: 0.16, rz: -0.05 },
  load: { x: 0.05, y: -0.04, z: -0.25, rx: 0.26, ry: 0.06, rz: -0.7 },
  low: { x: 0.14, y: -0.28, z: -0.4, rx: -0.5, ry: 0.2, rz: -0.2 },
};
// Camera-space bend added to the forearm stub's axis to find the elbow (~30 deg, a cocked wrist): keeps the stub inside the cuff in every pose.
const ELBOW_R = new THREE.Vector3(0.25, -0.55, 0);
const P = { ...POSE.low, twirl: 0, crane: 0, hammer: 0, trig: 0, grip: 1, thumb: 0, push: 0 };
const swing = { x: 0, y: 0, vx: 0, vy: 0 }, look = { x: 0, y: 0, tx: 0, ty: 0 };
// Left-hand fan (k: 0 desk .. 1 over the hammer, s: sweep across the spur) and the hold-to-inspect state.
const LF = { k: 0, s: 0 }, HOLD = { on: false, yaw: 0, pitch: 0 };
const recoil = { r: 0, vr: 0, z: 0, vz: 0 };
let shake = 0, portrait = false;

// Right-hand placement relative to the trigger-finger point. Placed from wrist/knuckle targets, fingers closed
// onto the grip by contact, index pad on the trigger, thumb on the frame's left side: _work/scenario-grip.mjs.
const RH = { pos: new THREE.Vector3(-0.027, -0.022, 0.08), finger: new THREE.Vector3(-0.041, 0.088, -0.995), palm: new THREE.Vector3(-0.999, 0.018, 0.043) };
const GRIP = { thumb: [0.7, 0.1, -0.4, 0.05], index: [-0.5, 1.3, 0.72, -0.25], middle: [0.53, 1.31, 1.4, 0], ring: [0.38, 1.12, 0.83, 0], pinky: [0, 0.72, 1.1, 0], cup: 0.3 };
const OPEN = { thumb: [0.1, 0.4, 0.05, 0.05], index: [-0.5, 1.3, 0.72, -0.25], middle: [0.25, 0.3, 0.2, 0], ring: [0.3, 0.35, 0.2, 0], pinky: [0.35, 0.35, 0.2, 0.05], cup: 0.05 };
const REST = { thumb: [0.15, 0.55, 0.15, 0.15], index: [0.25, 0.35, 0.2, 0.02], middle: [0.3, 0.45, 0.25, 0], ring: [0.35, 0.5, 0.25, -0.02], pinky: [0.4, 0.5, 0.25, -0.05], cup: 0.15 };
const LH = { desk: new THREE.Vector3(-0.17, DESK_Y + 0.024, -0.5), elbow: new THREE.Vector3(-0.24, DESK_Y + 0.03, -0.12) };
// Fan-the-hammer left hand, camera space: palm offset from the hammer, sweep toward the player, finger/palm directions, elbow offset.
const FLAT = { thumb: [0.1, 0.2, 0.1, 0.1], index: [0.05, 0.1, 0.05, 0], middle: [0.05, 0.1, 0.05, 0], ring: [0.08, 0.12, 0.06, 0], pinky: [0.1, 0.15, 0.08, 0], cup: 0.05 };
const FAN = { off: new THREE.Vector3(-0.035, 0.03, -0.045), sweep: 0.065, finger: new THREE.Vector3(1, 0.25, -0.35), palm: new THREE.Vector3(0.1, -0.7, 0.7), elbow: new THREE.Vector3(-0.22, -0.18, 0.2) };
const fanP = new THREE.Vector3(), elbowNow = new THREE.Vector3(), fanObj = new THREE.Object3D();
let LQ = new THREE.Quaternion();
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

// ---------- Cylinder spin ----------
const cyl = { angle: 0, vel: 0, mode: 'idle', a0: 0, v0: 0, dec: 0, t: 0, dur: 0, T: 0, notch: 0, snap: null };
const chamberOnTop = () => (((Math.round(cyl.angle / STEP) % 6) + 6) % 6);
function spinTo(index, v0 = 26) {
  const dir = Math.sign(v0) || 1, nat = (v0 * v0) / (2 * 11);
  let T = cyl.angle + dir * nat;
  const base = index * STEP;
  const k = dir > 0 ? Math.ceil((T - base) / TAU) : Math.floor((T - base) / TAU);
  T = base + k * TAU;
  const D = T - cyl.angle;
  Object.assign(cyl, { mode: 'target', a0: cyl.angle, v0, T, t: 0, dec: (v0 * v0) / (2 * D), dur: (2 * D) / v0 });
  return new Promise((res) => { cyl.done = res; });
}
function freeSpin(v) { cyl.mode = 'free'; cyl.vel = v; }
// Closing the crane engages the bolt: the spin dies within a few chambers and lands on `index`.
function settleTo(index) {
  const dir = Math.sign(cyl.vel) || 1;
  let d = (((index * STEP - cyl.angle) * dir) % TAU + TAU) % TAU;
  if (d < STEP * 1.5) d += TAU;
  cyl.mode = 'idle'; gsap.killTweensOf(cyl);
  const v = Math.max(8, Math.abs(cyl.vel));
  return gsap.to(cyl, { angle: cyl.angle + dir * d, vel: 0, duration: Math.min(0.9, (2 * d) / v), ease: 'power2.out' });
}
function updateCylinder(dt) {
  if (cyl.mode === 'target') {
    cyl.t = Math.min(cyl.t + dt, cyl.dur);
    cyl.angle = cyl.a0 + cyl.v0 * cyl.t - (cyl.dec * cyl.t * cyl.t) / 2;
    cyl.vel = cyl.v0 - cyl.dec * cyl.t;
    if (cyl.t >= cyl.dur) { cyl.angle = cyl.T; cyl.vel = 0; cyl.mode = 'idle'; cyl.done?.(); }
  } else if (cyl.mode === 'free') {
    cyl.vel *= Math.exp(-dt * 0.9); cyl.vel -= Math.sign(cyl.vel) * dt * 2.2;
    cyl.angle += cyl.vel * dt;
    if (Math.abs(cyl.vel) < 1.6) { cyl.mode = 'idle'; const T = Math.round(cyl.angle / STEP) * STEP; gsap.to(cyl, { angle: T, duration: 0.35, ease: 'back.out(2)' }); }
  }
  const notch = Math.floor(cyl.angle / (STEP / 2));
  if (notch !== cyl.notch) {
    const speed = Math.abs(cyl.vel);
    if (speed < 42 || Math.random() < 42 / speed) sound.click(Math.min(1, 0.35 + speed / 30));
    // A haptic tick per chamber once the spin is slow enough to feel each one.
    const now = performance.now();
    if (speed > 0.5 && speed < 30 && now - (cyl.buzzAt || 0) > 50) { cyl.buzzAt = now; buzz(4); }
    cyl.notch = notch;
  }
}

// ---------- Sequences ----------
let busy = false, lastInput = performance.now(), lastTrick = 0, lastTrickName = '', hasSpun = false, tl = null;
const to = (vars) => gsap.to(P, vars);
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
function isOpen() { return P.crane > OPEN_ANGLE * 0.6; }

async function openCylinder() {
  if (isOpen()) return;
  sound.whoosh(0.35);
  gsap.to(P, { rz: P.rz - 0.42, duration: 0.11, ease: 'power2.in', yoyo: true, repeat: 1 });
  await wait(0.08); sound.cylinderOpen();
  await to({ crane: OPEN_ANGLE, duration: 0.32, ease: 'back.out(2.2)' });
}
async function closeCylinder() {
  if (P.crane < 0.05) return;
  sound.whoosh(0.4);
  gsap.to(P, { rz: P.rz + 0.38, duration: 0.09, ease: 'power2.in', yoyo: true, repeat: 1 });
  await to({ crane: 0, duration: 0.13, ease: 'power3.in' });
  sound.cylinderClose(); shake = Math.max(shake, 0.18); recoil.vr += 0.6;
}
// Wrist snap: a quick roll of the gun sets the open cylinder whirring.
async function snapSpin(v = 24) {
  sound.whoosh(0.3);
  await to({ rz: P.rz - 0.3, duration: 0.09, ease: 'power2.in' });
  freeSpin(v);
  await to({ rz: P.rz + 0.3, duration: 0.22, ease: 'back.out(2)' });
}

async function spinOpen() {
  if (busy) return;
  busy = true; setUi();
  if (!isOpen()) { to({ ...POSE.load, duration: 0.4, ease: 'power3.inOut' }); await openCylinder(); }
  await snapSpin(20 + Math.random() * 10);
  hasSpun = true; busy = false; setUi(); hint('Drag the cylinder to spin it again. FIRE closes it and shoots.');
}

function securePick(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }

async function fire() {
  if (busy) { if (tl) killTrick(); else return; }
  const loaded = choices.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
  if (loaded.length < 2) { toast('Load at least two chambers first.'); openEditor(); return; }
  busy = true; setUi(); hideResult(); hint('');
  const pick = loaded[securePick(loaded.length)];
  fx.placard.reset();
  // Roulette: open, snap it spinning, slam it shut while it is still turning.
  to({ ...POSE.load, twirl: 0, grip: 1, duration: 0.38, ease: 'power3.inOut' });
  await openCylinder();
  labelsOn(false);
  await snapSpin(26 + Math.random() * 10);
  await wait(0.45);
  await closeCylinder();
  await settleTo(pick);
  // Aim at the placard. Letterbox in: this is the shot.
  document.body.classList.add('cine');
  const u = 0.8 + Math.random() * 0.07, v = 0.42 + Math.random() * 0.2;
  const target = fx.placard.card.localToWorld(new THREE.Vector3((u - 0.5) * 0.22, v * 0.125, 0));
  sound.whoosh(0.3);
  await to({ ...aimPose(target), duration: 0.55, ease: 'power3.inOut' });
  to({ thumb: 1, duration: 0.14, ease: 'power2.out' });
  await wait(0.1);
  sound.hammerCock();
  await to({ hammer: 0.62, duration: 0.14, ease: 'power3.out' });
  to({ thumb: 0, duration: 0.2 });
  gsap.to(P, { push: 1, duration: 0.7, ease: 'power2.inOut' });
  gsap.to(grade.uniforms.uDim, { value: 1, duration: 0.6 });
  await wait(0.62);
  // Bang. A "No" chamber is the empty one: the hammer falls on nothing, a dry click, no hole.
  const word = choices[pick].trim();
  const dud = /^(no|nope|nah)$/i.test(word);
  await to({ trig: 1, duration: 0.05, ease: 'power1.in' });
  P.hammer = 0;
  if (dud) {
    sound.dryFire(); buzz(18);
    slowmo(0.35, 0.3, 0.4);
    recoil.vr += reduced ? 0.4 : 2.4; shake = reduced ? 0.03 : 0.22;
    gsap.to(grade.uniforms.uDim, { value: 0, duration: 1.2, ease: 'power2.out', delay: 0.3 });
    gsap.to(P, { push: 0, duration: 1.4, ease: 'power2.out', delay: 0.5 });
    fx.placard.set(word, 'CLICK. EMPTY CHAMBER');
    gsap.fromTo(fx.placard.hinge.rotation, { x: -0.06 }, { x: -0.12, duration: 0.12, yoyo: true, repeat: 1 });
    to({ trig: 0, duration: 0.25, delay: 0.25 });
    await wait(1.1);
  } else {
    sound.shot(); buzz([40, 30, 80]);
    // Cinematic beat: time drops to a fifth while the flash lights the hands and the room, then catches up.
    slowmo(0.2, 0.34, 0.55);
    fx.muzzleFlash(gun.muzzle, 1.25);
    fx.smoke(gun.muzzle, new THREE.Vector3(0, 0, -1).applyQuaternion(gun.muzzle.getWorldQuaternion(new THREE.Quaternion())), 16, 0.9);
    fx.smoke(gun.gap, new THREE.Vector3(0, 0.6, 0), 6, 0.25);
    gun.setFired(pick, true);
    recoil.vr += reduced ? 2 : 10.5; recoil.vz += reduced ? 0.2 : 1.1; shake = reduced ? 0.1 : 1;
    grade.uniforms.uFlash.value = 0.6; plateU.uFlash.value = 0.55;
    gsap.to(grade.uniforms.uDim, { value: 0, duration: 1.2, ease: 'power2.out' });
    gsap.to(P, { push: 0, duration: 1.6, ease: 'power2.out', delay: 0.4 });
    await wait(0.025);
    const hit = fx.placard.hit(word, u, v);
    fx.debris(hit, new THREE.Vector3(0.1, 0.25, 1));
    sound.paperHit(0);
    gsap.fromTo(fx.placard.hinge.rotation, { x: -0.06 }, { x: -0.42, duration: 0.07, ease: 'power2.out', onComplete: () => gsap.to(fx.placard.hinge.rotation, { x: -0.06, duration: 1.2, ease: 'elastic.out(1, 0.28)' }) });
    to({ trig: 0, duration: 0.25, delay: 0.1 });
    await wait(0.9);
  }
  document.body.classList.remove('cine');
  hasSpun = false;
  showResult(word, pick);
  to({ ...POSE.ready, duration: 1.1, ease: 'power2.inOut', delay: 0.6 });
  labelsOn(true); busy = false; setUi();
  lastInput = performance.now();
}

function aimPose(world) {
  camera.updateMatrixWorld();
  const p = camera.worldToLocal(world.clone());
  const pos = new THREE.Vector3(portrait ? 0.045 : 0.07, -0.118, -0.4);
  const d = p.sub(pos).sub(new THREE.Vector3(0, gun.dims.BORE_Y, 0)).normalize();
  return { x: pos.x, y: pos.y, z: pos.z, rx: Math.asin(d.y), ry: Math.atan2(-d.x, -d.z), rz: -0.03 };
}

// ---------- Idle tricks ----------
const TRICKS = {
  async twirl(dir = 1) {
    await to({ grip: 0, duration: 0.12 });
    sound.whoosh(0.8); buzz(8);
    gsap.delayedCall(0.3, () => sound.whoosh(0.7)); gsap.delayedCall(0.6, () => sound.whoosh(0.5));
    await to({ twirl: P.twirl + dir * TAU * 3, duration: 0.95, ease: 'power1.inOut' });
    P.twirl %= TAU; sound.catchGun(); recoil.vr -= 1.5; buzz(25);
    await to({ grip: 1, duration: 0.1 });
  },
  async flick() {
    to({ ...POSE.load, duration: 0.4, ease: 'power3.inOut' });
    await openCylinder();
    await snapSpin(30);
    await wait(1.1);
    await closeCylinder();
    await to({ ...POSE.ready, duration: 0.5, ease: 'power2.inOut' });
  },
  async inspect() {
    await to({ x: 0.06, y: -0.12, z: -0.3, rx: 0.15, ry: -0.75, rz: 0.75, duration: 0.8, ease: 'power2.inOut' });
    await wait(0.6);
    await to({ ry: 0.55, rz: -0.85, rx: 0.05, duration: 0.9, ease: 'power2.inOut' });
    await wait(0.5);
    await to({ ...POSE.ready, duration: 0.7, ease: 'power2.inOut' });
  },
  async hammer() {
    await to({ thumb: 1, duration: 0.25 });
    sound.hammerCock();
    await to({ hammer: 0.62, duration: 0.16, ease: 'power3.out' });
    await wait(0.7);
    await to({ hammer: 0, duration: 0.6, ease: 'power1.inOut' });
    sound.click(0.4);
    await to({ thumb: 0, duration: 0.25 });
  },
  // Fan the hammer: trigger held, the left palm sweeps the spur back five times, the cylinder steps each time. Dry clicks only.
  async fan() {
    if (isOpen()) { await closeCylinder(); }
    gsap.killTweensOf(cyl); cyl.mode = 'idle';
    sound.whoosh(0.5);
    await Promise.all([to({ ...POSE.ready, rz: POSE.ready.rz - 0.1, trig: 1, duration: 0.3, ease: 'power3.out' }), gsap.to(LF, { k: 1, s: 0, duration: 0.32, ease: 'power3.out' })]);
    for (let i = 0; i < 5; i++) {
      await Promise.all([gsap.to(LF, { s: 1, duration: 0.075, ease: 'power2.in' }), to({ hammer: 0.62, duration: 0.075, ease: 'power2.in' })]);
      P.hammer = 0; sound.dryFire(); buzz(14);
      recoil.vr += 2.6; shake = Math.max(shake, 0.14);
      cyl.angle = Math.round(cyl.angle / STEP) * STEP; gsap.to(cyl, { angle: cyl.angle + STEP, duration: 0.07, ease: 'power2.out' });
      await gsap.to(LF, { s: 0, duration: 0.1, ease: 'power2.out' });
    }
    sound.catchGun(); buzz(20);
    await Promise.all([gsap.to(LF, { k: 0, s: 0, duration: 0.45, ease: 'power2.inOut' }), to({ ...POSE.ready, trig: 0, duration: 0.45, ease: 'power2.inOut' })]);
  },
};
// Reduced motion: a trick is a short dip to dark with its sound, nothing flies.
async function softTrick(name) {
  sound[name === 'fan' ? 'dryFire' : 'catchGun'](); buzz(10);
  await gsap.to(ui.fade, { opacity: 0.4, duration: 0.14, yoyo: true, repeat: 1 });
  ui.fade.style.opacity = '';
}
async function doTrick(name, arg) {
  if (busy) return;
  // Random picks (idle, Trick button) never fan an open cylinder; asked for by name, fan closes it first.
  const names = Object.keys(TRICKS).filter((n) => n !== lastTrickName && !(n === 'fan' && isOpen()));
  name = name || names[securePick(names.length)];
  if (isOpen() && name !== 'flick' && name !== 'fan') name = 'flick';
  busy = true; setUi(); lastTrickName = name;
  const run = reduced ? softTrick(name) : TRICKS[name](arg);
  tl = run;
  // A killed trick may still settle later: only the trick that is still current may clear `busy`.
  try { await run; } finally { if (tl === run) { tl = null; busy = false; lastTrick = performance.now(); setUi(); } }
}
function killTrick() {
  gsap.killTweensOf(P); gsap.killTweensOf(LF); gsap.killTweensOf(ui.fade); ui.fade.style.opacity = ''; tl = null; busy = false;
  to({ trig: 0, hammer: 0, thumb: 0, grip: 1, duration: 0.2 }); gsap.to(LF, { k: 0, s: 0, duration: 0.3 });
}

// ---------- Input ----------
const pointer = { id: null, mode: '', x: 0, y: 0, sx: 0, sy: 0, t0: 0, hist: [] };
const ray = new THREE.Raycaster();
function cylScreen() {
  const c = gun.cylinder.getWorldPosition(new THREE.Vector3());
  const edge = gun.cartridges[0].getWorldPosition(new THREE.Vector3());
  const s = toScreen(c), e = toScreen(edge);
  const axis = new THREE.Vector3(0, 0, 1).transformDirection(gun.cylinder.matrixWorld);
  const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(c);
  return { x: s.x, y: s.y, r: Math.hypot(e.x - s.x, e.y - s.y) / 0.62, facing: axis.dot(toCam) > 0 ? 1 : -1 };
}
function toScreen(v) { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight }; }
function hitsGun(x, y) {
  ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return ray.intersectObject(gun.root, true).length > 0;
}
// Touch feedback: a gold ring and sparks where the finger lands, plus a tiny haptic where the phone has one.
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* blocked */ } };
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
document.addEventListener('pointerdown', (e) => { if (e.target !== canvas && e.target.closest('button')) { ripple(e.clientX, e.clientY); buzz(8); } }, true);
// Fingers are fat: the gun counts as hit within ~28 px of its silhouette.
function nearGun(x, y) {
  for (const [ox, oy] of [[0, 0], [28, 0], [-28, 0], [0, 28], [0, -28]]) if (hitsGun(x + ox, y + oy)) return true;
  return false;
}
let tapTimer = 0, holdTimer = 0, lastTap = { t: 0, x: 0, y: 0 };

// Hold = slow inspect: the gun turns to the light, a highlight runs along the metal, dragging turns it.
const sweep = new THREE.PointLight(0xfff0d8, 0, 0.16, 2); gun.root.add(sweep);
const sweepPos = { z: 0.04 };
let sweepTween = null;
function holdStart() {
  if (busy || HOLD.on) return;
  HOLD.on = true; busy = true; setUi(); pointer.mode = 'hold'; dismissTricks();
  buzz(22); sound.whoosh(0.35);
  const d = reduced ? 0 : 0.9;
  to({ x: portrait ? -0.005 : 0.02, y: portrait ? -0.06 : -0.085, z: portrait ? -0.36 : -0.3, rx: 0.12, ry: -0.95, rz: 0.5, twirl: 0, duration: d, ease: 'power3.out' });
  gsap.to(grade.uniforms.uDim, { value: 0.55, duration: d });
  gsap.to(sweep, { intensity: 1.6, duration: 0.4 });
  sweepTween = gsap.fromTo(sweepPos, { z: 0.05 }, { z: gun.dims.MUZZLE_Z - 0.01, duration: reduced ? 0.01 : 1.5, ease: 'sine.inOut', repeat: reduced ? 0 : -1, yoyo: true });
  hint('');
}
function holdEnd() {
  if (!HOLD.on) return;
  HOLD.on = false; sweepTween?.kill(); sweepTween = null;
  gsap.to(sweep, { intensity: 0, duration: 0.3 });
  gsap.to(HOLD, { yaw: 0, pitch: 0, duration: 0.5, ease: 'power2.out' });
  gsap.to(grade.uniforms.uDim, { value: 0, duration: 0.5 });
  sound.whoosh(0.3); buzz(10);
  to({ ...(isOpen() ? POSE.load : POSE.ready), duration: reduced ? 0 : 0.6, ease: 'power2.inOut', onComplete: () => { busy = false; setUi(); lastInput = performance.now(); } });
}

canvas.addEventListener('pointerdown', (e) => {
  if (!roomId || pointer.id !== null) return;
  sound.unlock(); lastInput = performance.now(); dismissTricks();
  if (tl) killTrick();
  pointer.id = e.pointerId; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  Object.assign(pointer, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), hist: [], type: e.pointerType, onGun: nearGun(e.clientX, e.clientY) });
  ripple(e.clientX, e.clientY, pointer.onGun); buzz(pointer.onGun ? 10 : 5);
  const c = cylScreen();
  pointer.mode = !busy && isOpen() && Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.r * 1.5 ? 'cyl' : 'swing';
  if (pointer.mode === 'cyl') { cyl.mode = 'idle'; gsap.killTweensOf(cyl); pointer.a = Math.atan2(-(e.clientY - c.y), e.clientX - c.x); }
  clearTimeout(holdTimer);
  if (pointer.mode === 'swing' && !busy) {
    const id = e.pointerId;
    holdTimer = setTimeout(() => { if (pointer.id === id && pointer.mode === 'swing' && Math.hypot(pointer.x - pointer.sx, pointer.y - pointer.sy) < 12) { clearTimeout(tapTimer); holdStart(); } }, 420);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && !tilt.on) { look.tx = (e.clientX / innerWidth) * 2 - 1; look.ty = -(e.clientY / innerHeight) * 2 + 1; }
  if (e.pointerId !== pointer.id) return;
  lastInput = performance.now();
  const now = performance.now();
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  if (pointer.mode === 'hold') {
    HOLD.yaw = Math.max(-1.1, Math.min(1.1, HOLD.yaw + dx * 0.008)); HOLD.pitch = Math.max(-0.6, Math.min(0.6, HOLD.pitch + dy * 0.006));
  } else if (pointer.mode === 'cyl') {
    const c = cylScreen();
    const a = Math.atan2(-(e.clientY - c.y), e.clientX - c.x);
    let d = a - pointer.a; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    cyl.angle += d * c.facing; pointer.a = a;
    pointer.hist.push({ t: now, d: d * c.facing });
  } else {
    // Drag anywhere: the hands and the room sway with the finger.
    swing.vx += dx * 0.0016; swing.vy += dy * 0.0016;
    if (pointer.type !== 'mouse' && !tilt.on) { look.tx = Math.max(-1, Math.min(1, (e.clientX - pointer.sx) / (innerWidth * 0.4))); look.ty = Math.max(-1, Math.min(1, -(e.clientY - pointer.sy) / (innerHeight * 0.4))); }
    if (Math.hypot(dx, dy) > 38) sound.whoosh(Math.min(1, Math.hypot(dx, dy) / 120));
  }
  pointer.x = e.clientX; pointer.y = e.clientY;
});
const endPointer = (e) => {
  if (e.pointerId !== pointer.id) return;
  clearTimeout(holdTimer);
  const dt = performance.now() - pointer.t0, moved = Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy);
  const tap = dt < 260 && moved < 10;
  if (pointer.mode === 'hold') holdEnd();
  else if (pointer.mode === 'cyl') {
    // Flick the open cylinder: it free-spins with ticks that slow down. A tap snaps it shut.
    const now = performance.now(), recent = pointer.hist.filter((h) => now - h.t < 90);
    const v = recent.length ? recent.reduce((s, h) => s + h.d, 0) / (Math.max(30, now - recent[0].t) / 1000) : 0;
    if (Math.abs(v) > 2) { freeSpin(Math.max(-60, Math.min(60, v))); hasSpun = true; buzz(12); }
    else { const T = Math.round(cyl.angle / STEP) * STEP; gsap.to(cyl, { angle: T, duration: 0.3, ease: 'back.out(2)' }); }
    if (tap) toggleCylinder();
  } else if (tap && pointer.onGun && !isOpen()) {
    // One tap opens the cylinder; a second tap within 280 ms turns it into the fan-the-hammer flourish.
    const now = performance.now();
    if (now - lastTap.t < 280 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 70) { clearTimeout(tapTimer); lastTap.t = 0; doTrick('fan'); }
    else { lastTap = { t: now, x: e.clientX, y: e.clientY }; clearTimeout(tapTimer); tapTimer = setTimeout(() => toggleCylinder(), 280); }
  } else if (tap && pointer.onGun) toggleCylinder();
  else if (pointer.onGun && !isOpen() && moved > 45 && dt < 450) {
    // Swipe on the gun: spin it round the trigger finger, in the swipe's direction.
    const sx = e.clientX - pointer.sx, sy = e.clientY - pointer.sy;
    doTrick('twirl', Math.abs(sy) > Math.abs(sx) ? (sy < 0 ? 1 : -1) : (sx > 0 ? 1 : -1));
  }
  if (pointer.type !== 'mouse' && !tilt.on) look.tx = look.ty = 0;
  pointer.id = null; pointer.mode = '';
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!tilt.on) look.tx = look.ty = 0; });

// Device tilt sways the hands and the room (iOS asks permission on the room-pick tap).
const tilt = { on: false, b0: null, g0: null };
function onTilt(e) {
  if (e.beta == null || e.gamma == null) return;
  if (tilt.b0 == null) { tilt.b0 = e.beta; tilt.g0 = e.gamma; }
  // The neutral angle drifts slowly toward however the phone is held now.
  tilt.b0 += (e.beta - tilt.b0) * 0.004; tilt.g0 += (e.gamma - tilt.g0) * 0.004;
  if (pointer.id !== null) return;
  let gx = e.gamma - tilt.g0, by = e.beta - tilt.b0;
  const ang = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
  if (ang === 90) [gx, by] = [by, -gx]; else if (ang === 270) [gx, by] = [-by, gx];
  look.tx = Math.max(-1, Math.min(1, gx / 20)); look.ty = Math.max(-1, Math.min(1, -by / 20));
}
function enableTilt() {
  if (tilt.on || !mobile || typeof DeviceOrientationEvent === 'undefined') return;
  const on = () => { tilt.on = true; addEventListener('deviceorientation', onTilt); };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') on(); }).catch(() => {});
  else on();
}

async function toggleCylinder() {
  if (busy) return;
  busy = true; setUi();
  if (isOpen()) { await closeCylinder(); await to({ ...POSE.ready, duration: 0.45, ease: 'power2.inOut' }); hint(''); }
  else { to({ ...POSE.load, duration: 0.4, ease: 'power3.inOut' }); await openCylinder(); hint('Drag the cylinder to spin it. Tap it to snap shut.'); }
  busy = false; setUi();
}

addEventListener('keydown', (e) => {
  if (!roomId || e.target.closest('input, textarea, [role="dialog"]')) return;
  sound.unlock(); lastInput = performance.now();
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') { e.preventDefault(); fire(); }
  else if (k === 's') spinOpen();
  else if (k === 'o') toggleCylinder();
  else if (k === 't') doTrick();
  else if (k === 'e') openEditor();
  else if (k === 'f') doTrick('fan');
});

// ---------- UI ----------
const ui = {
  bar: $('#bar'), fire: $('#fire'), spin: $('#spin'), trick: $('#trick'), count: $('#count'), edit: $('#edit'),
  labels: $('#labels'), leaders: $('#leaders'), hint: $('#hint'), toast: $('#toast'),
  result: $('#result'), word: $('#result-word'), keep: $('#keep'), again: $('#again'),
  editor: $('#editor'), intro: $('#intro'), menu: $('#menu'), roomBtn: $('#room-btn'), soundBtn: $('#sound-btn'), fade: $('#fade'),
};
function setUi() {
  for (const b of [ui.spin, ui.trick]) b.disabled = busy;
  ui.fire.classList.toggle('is-busy', busy);
  const n = choices.filter((c) => c.trim()).length;
  ui.count.textContent = `${n} ${n === 1 ? 'choice' : 'choices'}`;
}
let hintTimer;
function hint(text) {
  clearTimeout(hintTimer);
  ui.hint.textContent = text; ui.hint.classList.toggle('show', !!text);
  if (text) hintTimer = setTimeout(() => ui.hint.classList.remove('show'), 6000);
}
let toastTimer;
function toast(text) {
  ui.toast.textContent = text; ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
}
ui.fire.addEventListener('click', () => { sound.unlock(); sound.uiTick(); fire(); });
ui.spin.addEventListener('click', () => { sound.unlock(); sound.uiTick(); spinOpen(); });
ui.trick.addEventListener('click', () => { sound.unlock(); sound.uiTick(); doTrick(); });
ui.edit.addEventListener('click', () => { sound.uiTick(); openEditor(); });

// Chamber labels around the open cylinder.
const labelEls = ROMAN.map((r, i) => {
  const el = document.createElement('div'); el.className = 'chamber'; ui.labels.appendChild(el);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ui.leaders.appendChild(line);
  return { el, line };
});
let labelsAlpha = 0, firing = false;
function labelsOn(on) { firing = !on; }
function updateLabels(dt) {
  const show = !firing && P.crane > OPEN_ANGLE * 0.9;
  labelsAlpha += ((show && Math.abs(cyl.vel) < 9 ? 1 : 0) - labelsAlpha) * Math.min(1, dt * 8);
  ui.labels.style.opacity = ui.leaders.style.opacity = labelsAlpha.toFixed(3);
  if (labelsAlpha < 0.01) return;
  const c = cylScreen();
  labelEls.forEach(({ el, line }, i) => {
    const text = choices[i].trim();
    if (el.textContent !== text) { el.textContent = text; el.style.display = text ? '' : 'none'; line.style.display = text ? '' : 'none'; el._w = el.offsetWidth; }
    if (!text) return;
    const p = toScreen(gun.cartridges[i].getWorldPosition(new THREE.Vector3()));
    let dx = p.x - c.x, dy = p.y - c.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const r1 = len + c.r * 0.5, r2 = c.r * 1.55 + 22;
    const lx = c.x + dx * r2, ly = c.y + dy * r2;
    line.setAttribute('x1', c.x + dx * r1); line.setAttribute('y1', c.y + dy * r1); line.setAttribute('x2', lx - dx * 6); line.setAttribute('y2', ly - dy * 6);
    // Anchor the label beside its leader line, then keep it inside the screen edges.
    const w = el._w || 0, left = dx > 0.25 ? lx : dx < -0.25 ? lx - w : lx - w / 2;
    const x = Math.min(Math.max(left, 12), innerWidth - w - 12);
    el.style.transform = `translate(${x}px, ${ly}px) translateY(-50%)`;
    el.classList.toggle('top', i === chamberOnTop() && Math.abs(cyl.vel) < 0.5);
  });
}

// Result card.
let lastPick = null;
function showResult(word, pick) {
  lastPick = { word, pick };
  ui.word.textContent = word;
  ui.result.hidden = false;
  gsap.fromTo(ui.result, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' });
  gsap.fromTo('#result .stagger', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, delay: 0.1, ease: 'power2.out' });
  ui.keep.focus({ preventScroll: true });
}
function hideResult() { if (!ui.result.hidden) gsap.to(ui.result, { opacity: 0, y: 16, duration: 0.25, onComplete: () => { ui.result.hidden = true; } }); }
ui.keep.addEventListener('click', () => {
  sound.uiTick(); hideResult();
  const word = lastPick?.word || '';
  store.set('lastPick', { word, at: Date.now() });
  toast(`Decided: ${word}. Go do it.`);
});
ui.again.addEventListener('click', () => { sound.uiTick(); fire(); });

// Editor.
const inputs = ROMAN.map((r, i) => $('#ch-' + i));
function openEditor() {
  if (busy) return;
  inputs.forEach((inp, i) => { inp.value = choices[i]; });
  ui.editor.hidden = false;
  gsap.fromTo('#editor .sheet', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
  inputs[0].focus();
}
function closeEditor() { ui.editor.hidden = true; ui.edit.focus({ preventScroll: true }); }
$('#editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const next = inputs.map((i) => i.value.trim().slice(0, 24));
  if (next.filter(Boolean).length < 2) { $('#editor-error').textContent = 'Fill at least two chambers.'; return; }
  $('#editor-error').textContent = '';
  choices = next; store.set('choices', choices);
  applyChoices(); closeEditor(); sound.cylinderClose(); toast('Chambers loaded.');
});
$('#editor-cancel').addEventListener('click', closeEditor);
ui.editor.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  PRESETS[b.dataset.preset].forEach((v, i) => { inputs[i].value = v; });
}));
function applyChoices() {
  choices.forEach((c, i) => { gun.setLoaded(i, !!c.trim()); gun.setFired(i, false); });
  fx.placard.set('?', 'FIRE TO DECIDE');
  setUi();
}

// Room menu + intro.
function roomCards(container, onPick) {
  container.innerHTML = '';
  for (const [id, r] of Object.entries(ROOMS)) {
    const b = document.createElement('button');
    b.className = 'room'; b.type = 'button'; b.dataset.room = id;
    b.innerHTML = `<img src="assets/plates/${id}-thumb.jpg" alt="" width="300" height="200"><span class="room-no">${r.no}</span><span class="room-name">${r.name}</span><span class="room-blurb">${r.blurb}</span>`;
    b.addEventListener('click', () => onPick(id));
    container.appendChild(b);
  }
}
roomCards($('#intro-rooms'), (id) => enter(id));
roomCards($('#menu-rooms'), (id) => { closeMenu(); if (id !== roomId) switchRoom(id); });
function openMenu() {
  ui.menu.hidden = false;
  document.querySelectorAll('#menu .room').forEach((b) => b.setAttribute('aria-pressed', b.dataset.room === roomId));
  document.querySelectorAll('[data-skin]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.skin === skin));
  gsap.fromTo('#menu .sheet', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
}
function closeMenu() { ui.menu.hidden = true; }
ui.roomBtn.addEventListener('click', () => { sound.uiTick(); openMenu(); });
$('#menu-close').addEventListener('click', closeMenu);
ui.menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
ui.menu.addEventListener('click', (e) => { if (e.target === ui.menu) closeMenu(); });
ui.editor.addEventListener('click', (e) => { if (e.target === ui.editor) closeEditor(); });
document.querySelectorAll('[data-skin]').forEach((b) => b.addEventListener('click', () => {
  skin = b.dataset.skin; store.set('skin', skin);
  if (hands) { hands.left.setSkin(skin); hands.right.setSkin(skin); }
  document.querySelectorAll('[data-skin]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.skin === skin));
}));
let muted = store.get('muted', false);
sound.setMuted(muted);
function syncSound() { ui.soundBtn.setAttribute('aria-pressed', String(!muted)); ui.soundBtn.querySelector('span').textContent = muted ? 'Sound off' : 'Sound on'; }
ui.soundBtn.addEventListener('click', () => { sound.unlock(); muted = !muted; sound.setMuted(muted); store.set('muted', muted); syncSound(); });
syncSound();

// ---------- Room loading ----------
const texLoader = new THREE.TextureLoader();
const plateTex = {};
async function getPlate(id) {
  if (!plateTex[id]) {
    // Phones and normal screens get the 1920 px plate; only big, dense screens pull the 4K one.
    const big = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio, MAX_DPR) > 2400;
    plateTex[id] = texLoader.loadAsync(`assets/plates/${id}-${big ? '4k' : '2k'}.jpg`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    });
  }
  return plateTex[id];
}
function buildEnv(img) {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const q = W / 4, y0 = H * 0.24, h = H * 0.56;
  // Quadrants: u=0.25 front (-Z), 0.5 right, 0.75 behind, 0 left. Behind/sides reuse the photo mirrored.
  const draw = (cx, flip, alpha) => { g.save(); g.globalAlpha = alpha; g.translate(cx, 0); g.scale(flip ? -1 : 1, 1); g.drawImage(img, -q * 0.75, y0, q * 1.5, h); g.restore(); };
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  draw(W * 0.75, true, 0.75); draw(0, true, 0.6); draw(W, true, 0.6); draw(W * 0.5, false, 0.6); draw(W * 0.25, false, 1);
  g.drawImage(cv, 0, y0, W, 2, 0, 0, W, y0); // ceiling: smear the top row, darker below
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, W, y0);
  g.drawImage(cv, 0, y0 + h - 2, W, 2, 0, y0 + h, W, H - y0 - h);
  const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const env = pmrem.fromEquirectangular(t).texture; t.dispose();
  return env;
}
async function applyRoom(id) {
  const r = ROOMS[id];
  const tex = await getPlate(id);
  plateMat.map = tex; plateMat.needsUpdate = true;
  plate.userData.aspect = tex.image.width / tex.image.height;
  if (scene.environment) scene.environment.dispose();
  scene.environment = buildEnv(tex.image);
  scene.environmentIntensity = r.env;
  key.color.setHex(r.key.color); key.intensity = r.key.intensity; key.position.set(...r.key.pos);
  rim.color.setHex(r.rim.color); rim.intensity = r.rim.intensity; rim.position.set(...r.rim.pos);
  hemi.color.setHex(r.hemi[0]); hemi.groundColor.setHex(r.hemi[1]); hemi.intensity = r.hemi[2];
  shadowMat.opacity = r.shadow;
  grade.uniforms.uVignette.value = r.grade.vignette; grade.uniforms.uGrain.value = r.grade.grain; grade.uniforms.uTint.value.set(...r.grade.tint);
  gun.setFinish(r.finish); gun.setWood(r.wood);
  if (hands) for (const h of [hands.left, hands.right]) { h.dress({ sleeve: r.sleeve, cuff: r.cuff, watch: h === hands.left }); scene.add(h.sleeve); }
  document.documentElement.dataset.room = id;
  ui.roomBtn.querySelector('span').textContent = r.name;
  sound.setRoom(id);
  resize();
}
async function switchRoom(id) {
  if (busy) return;
  busy = true;
  ui.fade.classList.add('on'); await wait(0.45);
  roomId = id; store.set('room', id);
  await applyRoom(id);
  ui.fade.classList.remove('on');
  busy = false; setUi();
}
async function enter(id) {
  sound.unlock(); enableTilt();
  roomId = id; store.set('room', id);
  ui.intro.classList.add('leaving');
  await applyRoom(id);
  await ready;
  gsap.to(ui.intro, { opacity: 0, duration: 0.6, onComplete: () => { ui.intro.hidden = true; } });
  ui.bar.hidden = false; $('#top').hidden = false;
  gsap.fromTo('#bar, #top', { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.5 });
  sound.whoosh(0.5);
  busy = true; setUi();
  await to({ ...POSE.ready, duration: 1.2, ease: 'power3.out' });
  busy = false; setUi();
  lastInput = performance.now() - 4000;
  if (!showTricks()) hint('Tap the revolver to swing the cylinder out. FIRE decides.');
}

// First run only: three gestures, one line each, then it gets out of the way.
const tricksCard = $('#tricks');
let tricksTimer = 0;
function showTricks() {
  if (store.get('tricksSeen', false)) return false;
  tricksCard.hidden = false; lastInput = performance.now() + 6000;
  gsap.fromTo(tricksCard, { opacity: 0, xPercent: -50, y: 16 }, { opacity: 1, xPercent: -50, y: 0, duration: 0.5, delay: 0.6, ease: 'power3.out' });
  tricksTimer = setTimeout(dismissTricks, 12000);
  return true;
}
function dismissTricks() {
  if (tricksCard.hidden) return;
  clearTimeout(tricksTimer); store.set('tricksSeen', true);
  gsap.to(tricksCard, { opacity: 0, y: 12, duration: 0.25, onComplete: () => { tricksCard.hidden = true; } });
}
$('#tricks-ok').addEventListener('click', () => { sound.uiTick(); dismissTricks(); });

// ---------- Frame loop ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const poseR = {}, poseL = {};
function resize() {
  const w = innerWidth, h = innerHeight;
  portrait = w / h < 0.85;
  camera.aspect = w / h; camera.fov = portrait ? VIEW.fovPortrait : VIEW.fov; camera.updateProjectionMatrix();
  const full = Math.min(devicePixelRatio, MAX_DPR), pr = Math.max(Math.min(full, 1), full * quality);
  // The composer works in whole device pixels: a fractional target size (844 x 1.6) renders black on WebKit.
  renderer.setPixelRatio(pr); composer.setPixelRatio(1);
  renderer.setSize(w, h, false); composer.setSize(Math.floor(w * pr), Math.floor(h * pr)); bloom.resolution.set(w / 2, h / 2);
  const hgt = 2 * PLATE_D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1, a = plate.userData.aspect || 1.5;
  const wid = Math.max(hgt * a, hgt * camera.aspect * 1.1);
  plate.scale.set(wid, wid / a, 1);
  POSE.ready.x = portrait ? 0.045 : 0.105;
  // Portrait: cylinder on the screen's centre line at ~44% height; measured at 375x812 (r ~44px, labels clear).
  Object.assign(POSE.load, portrait ? { x: 0.008, y: -0.022, z: -0.32 } : { x: 0.05, y: -0.04, z: -0.25 });
  LH.desk.x = portrait ? -0.1 : -0.17;
}
addEventListener('resize', resize);

function update(dt, t) {
  updateCylinder(dt);
  // Springs: recoil, swing, look.
  recoil.vr += (-180 * recoil.r - 15 * recoil.vr) * dt; recoil.r += recoil.vr * dt;
  recoil.vz += (-220 * recoil.z - 18 * recoil.vz) * dt; recoil.z += recoil.vz * dt;
  swing.vx += (-60 * swing.x - 9 * swing.vx) * dt; swing.vy += (-60 * swing.y - 9 * swing.vy) * dt;
  swing.x += swing.vx * dt; swing.y += swing.vy * dt;
  look.x += (look.tx - look.x) * Math.min(1, dt * 3); look.y += (look.ty - look.y) * Math.min(1, dt * 3);
  shake *= Math.exp(-dt * 6);
  const m = reduced ? 0.15 : 1;
  const breathe = Math.sin(t * 1.1) * 0.003 + Math.sin(t * 0.37) * 0.002;
  camera.rotation.set(
    (breathe + look.y * 0.025 + (Math.random() - 0.5) * shake * 0.03) * m,
    (Math.sin(t * 0.53) * 0.004 - look.x * 0.035 + (Math.random() - 0.5) * shake * 0.03) * m,
    (Math.sin(t * 0.71) * 0.002 + (Math.random() - 0.5) * shake * 0.01) * m,
  );
  camera.fov = (portrait ? VIEW.fovPortrait : VIEW.fov) - P.push * 4; camera.updateProjectionMatrix();
  plateU.uBias.value = isOpen() ? 1.2 : 0.4 * P.push;
  // Flash fades on real time, so slow motion does not hold the frame white.
  plateU.uFlash.value *= Math.exp(-rawDt * 14); grade.uniforms.uFlash.value *= Math.exp(-rawDt * 16);
  plateU.uGain.value = 1 - grade.uniforms.uDim.value * 0.25;

  vm.position.set(P.x + swing.x * 0.05 + look.x * 0.006, P.y - swing.y * 0.04 + Math.sin(t * 1.1) * 0.0015 * m, P.z + recoil.z * 0.05);
  vm.rotation.set(P.rx + recoil.r * 0.09 + swing.y * -0.35 + look.y * 0.03 + HOLD.pitch, P.ry - swing.x * 0.6 - look.x * 0.05 + HOLD.yaw, P.rz - swing.x * 0.3, 'YXZ');
  // Inspect highlight: rides along the barrel on the side that faces the camera.
  if (sweep.intensity > 0.001) {
    gun.root.updateMatrixWorld();
    const side = gun.root.worldToLocal(camera.getWorldPosition(tmpV)).x > 0 ? 1 : -1;
    sweep.position.set(side * 0.03, gun.dims.BORE_Y + 0.018, sweepPos.z);
  }
  gun.root.rotation.x = P.twirl;
  gun.crane.rotation.z = P.crane;
  gun.cylinder.rotation.z = cyl.angle;
  gun.hammer.rotation.x = P.hammer;
  gun.trigger.rotation.x = -P.trig * 0.32;

  if (hands) {
    const { right, left } = hands;
    right.group.position.copy(RH.pos);
    lerpPose(OPEN, GRIP, P.grip, poseR);
    // Thumb rises to cock the hammer; with the crane open it tucks under so it never covers the chambers.
    poseR.thumb = poseR.thumb.map((v, i) => v + ([-1.5, -0.3, 0.45, 0.9][i]) * P.thumb +([0.4, -0.6, 0.2, 0.3][i]) * (P.crane / OPEN_ANGLE));
    poseR.index[1] += P.trig * 0.35; poseR.index[0] += P.trig * 0.12;
    right.apply(poseR);
    // Left hand rests on the desk and drums its fingers now and then.
    left.group.position.copy(LH.desk); left.group.quaternion.copy(LQ);
    lerpPose(REST, FLAT, LF.k, poseL);
    elbowNow.copy(LH.elbow);
    if (LF.k > 0.001) {
      // Fan: the left palm rises over the hammer and sweeps back across the spur.
      const k = LF.k * LF.k * (3 - 2 * LF.k);
      camera.getWorldQuaternion(tmpQ);
      gun.hammer.getWorldPosition(fanP).add(tmpV.copy(FAN.off).setZ(FAN.off.z + LF.s * FAN.sweep).applyQuaternion(tmpQ));
      left.group.position.lerp(fanP, k);
      orient(fanObj, tmpV.copy(FAN.finger).applyQuaternion(tmpQ), tmpV2.copy(FAN.palm).applyQuaternion(tmpQ), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
      left.group.quaternion.slerp(fanObj.quaternion, k);
      elbowNow.lerp(fanP.add(tmpV.copy(FAN.elbow).applyQuaternion(tmpQ)), k);
    }
    const drum = (t % 7) - 5.2;
    ['pinky', 'ring', 'middle', 'index'].forEach((f, i) => {
      const ph = (drum - i * 0.11) / 0.22;
      if (ph > 0 && ph < 1 && !reduced) poseL[f][0] -= Math.sin(ph * Math.PI) * 0.45;
    });
    left.apply(poseL);
    scene.updateMatrixWorld();
    const fore = tmpV.set(0, 0, 1).transformDirection(right.wrist.matrixWorld).add(tmpV2.copy(ELBOW_R).applyQuaternion(camera.getWorldQuaternion(tmpQ))).normalize();
    right.aimSleeve(right.wrist.getWorldPosition(tmpV2).addScaledVector(fore, 0.3));
    left.aimSleeve(elbowNow);
  }
  fx.update(dt);
  if (hands) updateLabels(dt);

  // Idle tricks.
  const now = performance.now();
  if (roomId && !busy && !reduced && ui.editor.hidden && ui.menu.hidden && pointer.id === null && now - lastInput > 7000 && now - lastTrick > 9000) doTrick();
}

const debug = new URLSearchParams(location.search).has('debug');
const debugCam = new THREE.PerspectiveCamera(30, 1, 0.005, 40), renderPass = composer.passes[0];
const perf = { t: 0, n: 0 };
// Slow motion: time drops to `s0` for `hold` real seconds, then eases back to 1 over `ramp`.
const slow = { s0: 1, from: 0, hold: 0, ramp: 0 };
function slowmo(s0, hold, ramp) { if (!reduced) Object.assign(slow, { s0, from: performance.now(), hold: hold * 1000, ramp: ramp * 1000 }); }
function timeScaleNow() {
  const e = performance.now() - slow.from;
  if (e >= slow.hold + slow.ramp) return 1;
  if (e < slow.hold) return slow.s0;
  const k = (e - slow.hold) / slow.ramp; return slow.s0 + (1 - slow.s0) * k * k;
}
let running = true, rawDt = 0;
function frame() {
  // Hidden tab: stop rendering and silence the room; visibilitychange restarts the loop.
  if (document.hidden) { running = false; return; }
  const ts = timeScaleNow(); gsap.globalTimeline.timeScale(ts);
  const raw = Math.min(clock.getDelta(), 1 / 20), dt = raw * ts, t = clock.elapsedTime; rawDt = raw;
  // Resolution governor: 90 frames under ~48 fps cost 20% of the pixel ratio; it never steps back up, so it cannot oscillate.
  if (roomId && ui.intro.hidden && !window.dbg?.noGovernor && (perf.t += raw, ++perf.n === 90)) {
    if (perf.t / 90 > 1 / 48 && renderer.getPixelRatio() > 1) { quality *= 0.8; resize(); }
    perf.t = perf.n = 0;
  }
  if (!(debug && window.dbg?.freeze)) update(dt, t); else { camera.updateMatrixWorld(); if (hands) { hands.right.apply(poseR); } }
  grade.uniforms.uTime.value = t;
  const v = debug && window.dbg?.view;
  if (v) {
    // Debug orbit: look at the gun's finger point from an offset given in camera space.
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
const ready = (async () => {
  resize();
  hands = await loadHands();
  scene.add(hands.left.group); vm.add(hands.right.group);
  orient(hands.right.group, RH.finger, RH.palm, new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0));
  orient(hands.left.group, new THREE.Vector3(0.25, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
  LQ = hands.left.group.quaternion.clone();
  for (const h of [hands.left, hands.right]) h.setSkin(skin);
  applyChoices();
  await document.fonts.ready; fx.placard.redraw();
  if (roomId) await applyRoom(roomId);
})();
ready.catch((err) => { $('#intro-status').textContent = 'The room could not load. Refresh to try again.'; console.error(err); });
applyRoom(roomId || 'study');
frame();
// Offline web app: the service worker caches the shell and assets (relative path, so it works under /roulette/).
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
document.body.classList.add('booted');
if (debug) window.dbg = { P, POSE, VIEW, RH, GRIP, OPEN, REST, LH, cyl, gun, hands: () => hands, camera, rig, vm, renderer, composer, orient, scene, fx, fire, doTrick, toggleCylinder, spinOpen, holdStart, holdEnd, LF, FAN, HOLD, slowmo, sweep, key, rim, front, hemi, plate, gsap, THREE, freeze: false, view: null,
  reorient() { orient(hands.right.group, RH.finger, RH.palm, new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)); hands.right.group.position.copy(RH.pos); } };
