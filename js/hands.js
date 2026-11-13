// Rigged hands cut from the MakeHuman/MPFB CC0 base mesh, re-rigged in Blender with WebXR joint names, posed with our own FK.
// The rig is flat (every joint is a direct child of the armature), so each frame we chain
// joint rotations ourselves: joint -Z runs along the bone, +Y is the back of the hand,
// so curling a finger is a negative rotation about the joint's local X.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FINGERS = { index: 'index-finger', middle: 'middle-finger', ring: 'ring-finger', pinky: 'pinky-finger' };
const LONG = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

export const SKINS = {
  light: { color: 0xe3c0aa, sheen: 0xe0a294, sss: 0xc0402a },
  medium: { color: 0xb38569, sheen: 0xc08a78, sss: 0xa0331e },
  deep: { color: 0x684634, sheen: 0x9a6b58, sss: 0x6a1e10 },
  gloves: { color: 0x15110f, sheen: 0x6e5d4e, glove: true },
};

function grainNormal() {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  for (let k = 0; k < 2; k++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; h[i] = (h[i] + h[y * S + ((x + 1) % S)] + h[((y + 1) % S) * S + x]) / 3;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, dx = h[y * S + ((x + 1) % S)] - h[i], dy = h[((y + 1) % S) * S + x] - h[i];
    img.data[i * 4] = 128 + dx * 220; img.data[i * 4 + 1] = 128 + dy * 220; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.5, 2.5); t.anisotropy = 16;
  return t;
}

function tweedTexture(base, fleck) {
  const S = 1024, K = S / 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) {
    const herring = ((Math.floor(x / 8) + (Math.floor(y / 16) % 2 ? y : -y) / 2) % 4 + 4) % 4 < 2;
    g.fillStyle = herring ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.12)';
    g.fillRect(x * K, y * K, 2 * K, 2 * K);
    if (Math.random() < 0.035) { g.fillStyle = fleck; g.fillRect(x * K, y * K, 2 * K, K); }
  }
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = y % 4 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.04)';
    for (let x = (y / 2) % 4; x < S; x += 4) g.fillRect(x, y, 2, 1);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 4); t.anisotropy = 16;
  return t;
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

class Hand {
  constructor(scene, side) {
    this.side = side;
    this.group = new THREE.Group(); this.group.name = side + '-hand';
    this.group.add(scene);
    scene.traverse((o) => { if (o.isSkinnedMesh) { this.mesh = o; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    const bone = (n) => scene.getObjectByName(n);
    this.wrist = bone('wrist');
    // Trim the forearm stub to 2 cm past the wrist (+Y runs up the arm) so it stays inside the cuff when the wrist bends.
    const g = this.mesh.geometry, y = g.attributes.position, idx = g.index.array, cut = this.wrist.position.y + 0.02, keep = [];
    for (let i = 0; i < idx.length; i += 3) if (y.getY(idx[i]) <= cut || y.getY(idx[i + 1]) <= cut || y.getY(idx[i + 2]) <= cut) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    g.setIndex(keep);
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
    this.paintNails();
    this.pose = { thumb: [0, 0, 0, 0], index: [0, 0, 0, 0], middle: [0, 0, 0, 0], ring: [0, 0, 0, 0], pinky: [0, 0, 0, 0], cup: 0 };
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3();
  }

  // Nails: the bind-pose mesh has none painted, so the backs of the distal phalanges read as skin. Mark the nail plate
  // in the vertex colours (paler, pinker, a white free edge) from the joint frames: +Y of a joint is the back of the finger.
  paintNails() {
    const g = this.mesh.geometry, pos = g.attributes.position, nrm = g.attributes.normal;
    if (!g.attributes.color) {
      const c = new Float32Array(pos.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const col = g.attributes.color, v = new THREE.Vector3(), n = new THREE.Vector3(), seg = new THREE.Vector3(), rel = new THREE.Vector3();
    this.nailMask = new Float32Array(pos.count);
    for (const [key, ch] of Object.entries(this.chains)) {
      const k = ch.bones.length, a = ch.P[k - 2], b = ch.P[k - 1], Q = ch.Q[k - 2];
      const dorsal = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
      seg.copy(b).sub(a); const L = seg.length(); seg.normalize();
      const w = key === 'thumb' ? 0.0068 : key === 'pinky' ? 0.0048 : 0.0056;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i); rel.copy(v).sub(a);
        const t = rel.dot(seg) / L; if (t < 0.38 || t > 1.25) continue;
        rel.addScaledVector(seg, -rel.dot(seg));
        const up = rel.dot(dorsal), side = Math.sqrt(Math.max(0, rel.lengthSq() - up * up));
        n.fromBufferAttribute(nrm, i);
        if (up <= 0 || side > w || n.dot(dorsal) < 0.35) continue;
        const edge = Math.min(1, (w - side) / 0.0012) * Math.min(1, (t - 0.38) / 0.08);
        this.nailMask[i] = Math.max(this.nailMask[i], edge * (t > 1.0 ? 2 : 1));
      }
    }
    for (let i = 0; i < pos.count; i++) {
      const m = Math.min(1, this.nailMask[i]); if (!m) continue;
      const free = this.nailMask[i] > 1 ? 1 : 0;
      const r = col.getX(i), gg = col.getY(i), bb = col.getZ(i);
      const tr = free ? 1.5 : 1.3, tg = free ? 1.45 : 1.14, tb = free ? 1.42 : 1.12;
      col.setXYZ(i, r + (Math.min(1, r * tr) - r) * m, gg + (Math.min(1, gg * tg) - gg) * m, bb + (Math.min(1, bb * tb) - bb) * m);
    }
    col.needsUpdate = true;
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

  // Forearm (cuff + sleeve) lives in world space and is aimed from the wrist to an elbow point each
  // frame, because the real wrist bends; only the watch rides on the hand's wrist frame.
  dress({ sleeve, cuff, watch }) {
    if (this.dressing) this.group.children[0].remove(this.dressing);
    this.sleeve ||= new THREE.Group();
    this.sleeve.clear();
    const sleeveMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.038, 1, 72, 1, true).translate(0, 0.5, 0), new THREE.MeshPhysicalMaterial({ map: tweedTexture(sleeve, '#d8c9a6'), roughness: 0.92, sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color(sleeve).multiplyScalar(1.6) }));
    const cuffMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.034, 0.06, 64, 1, true).translate(0, 0.02, 0), new THREE.MeshPhysicalMaterial({ color: cuff, roughness: 0.75, sheen: 0.6, sheenColor: 0xffffff, side: THREE.DoubleSide }));
    sleeveMesh.position.y = 0.035; this.sleeveMesh = sleeveMesh;
    for (const m of [sleeveMesh, cuffMesh]) { m.castShadow = m.receiveShadow = true; this.sleeve.add(m); }
    // A skin disc just inside the cuff closes the hand mesh's open wrist, which shows when looking down the sights.
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.036, 48).rotateX(-Math.PI / 2).translate(0, 0.004, 0), this.mesh.material);
    this.sleeve.add(cap); this.cap = cap;
    const d = new THREE.Group(), w = this.wrist.position;
    const dorsal = new THREE.Vector3(1, 0, 0).applyQuaternion(this.wrist.quaternion);
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(this.wrist.quaternion); // toward the elbow
    const basis = new THREE.Matrix4().makeBasis(dorsal, along, dorsal.clone().cross(along).normalize());
    d.quaternion.setFromRotationMatrix(basis); d.position.copy(w);
    if (watch) {
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.019, 80, 1, true).scale(0.86, 1, 1), new THREE.MeshPhysicalMaterial({ color: 0x3b2316, roughness: 0.55, clearcoat: 0.2, side: THREE.DoubleSide }));
      strap.position.y = 0.008; d.add(strap);
      const caseG = new THREE.Group(); caseG.position.set(0.0285, 0.008, 0); caseG.rotation.z = -Math.PI / 2; d.add(caseG);
      caseG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0185, 0.0075, 96), new THREE.MeshPhysicalMaterial({ color: 0xd9b46a, metalness: 1, roughness: 0.2 })));
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0152, 96), new THREE.MeshPhysicalMaterial({ map: watchFace(), roughness: 0.3, clearcoat: 1 }));
      face.rotation.x = -Math.PI / 2; face.rotation.z = Math.PI / 2; face.position.y = 0.0039; caseG.add(face);
      caseG.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    }
    this.group.children[0].add(d); this.dressing = d;
  }

  aimSleeve(elbow) {
    if (!this.sleeve) return;
    const w = this.wrist.getWorldPosition(this._v);
    // Start a little up the forearm from the wrist joint so the cuff hides the mesh edge.
    const dir = elbow.clone().sub(w), len = dir.length(); dir.normalize();
    this.sleeve.position.copy(w).addScaledVector(dir, -0.006);
    this.sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.sleeveMesh.scale.y = len + 0.25;
    if (this.cap.material !== this.mesh.material) this.cap.material = this.mesh.material;
  }

  setSkin(name) {
    const s = SKINS[name] || SKINS.light;
    const m = new THREE.MeshPhysicalMaterial({
      color: s.color, vertexColors: !!this.mesh.geometry.attributes.color, roughness: s.glove ? 0.42 : 0.52, sheen: s.glove ? 0.35 : 0.55, sheenRoughness: 0.45, sheenColor: s.sheen,
      clearcoat: s.glove ? 0.45 : 0.08, clearcoatRoughness: s.glove ? 0.35 : 0.42, specularIntensity: s.glove ? 1 : 0.55,
      // A touch of warm self-light stands in for light scattered under the skin, so the shadow side is never grey clay.
      emissive: s.glove ? 0x000000 : s.sss, emissiveIntensity: s.glove ? 0 : 0.11,
      normalMap: Hand.grain || (Hand.grain = grainNormal()), normalScale: new THREE.Vector2(s.glove ? 0.35 : 0.12, s.glove ? 0.35 : 0.12),
    });
    if (this.mesh.material) this.mesh.material.dispose();
    this.mesh.material = m;
  }
}

// The artifact host does not serve .glb files, so the models ship as base64 inside a JS module.
export async function loadHands() {
  const { LEFT, RIGHT } = await import('./hands-data.js');
  const loader = new GLTFLoader();
  const buf = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const [l, r] = await Promise.all([LEFT, RIGHT].map((s) => loader.parseAsync(buf(s), '')));
  return { left: new Hand(l.scene, 'left'), right: new Hand(r.scene, 'right') };
}
