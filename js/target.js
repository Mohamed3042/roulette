// The paper target: a 3D sheet laid exactly over the target painted in the room photo, so bullet holes
// land where the player aimed. It sits on the same line of sight as the painted one (closer, scaled
// down), so pure camera rotation never shows parallax. Holes stay until the paper is changed.
import * as THREE from 'three';

const TEX = 1024;

function paperGrain(g, w, h) {
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(110,90,60,.045)' : 'rgba(255,255,255,.07)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
  }
}

function drawFace(g, shape, holes) {
  const S = TEX, c = S / 2;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  if (shape === 'round') g.arc(c, c, c - 2, 0, Math.PI * 2); else g.rect(0, 0, S, S);
  g.clip();
  g.fillStyle = '#efe8d8'; g.fillRect(0, 0, S, S);
  paperGrain(g, S, S);
  // Printed scoring rings, the black aiming mark, ring numbers.
  const R = shape === 'round' ? c * 0.94 : c * 0.82;
  g.strokeStyle = 'rgba(40,30,22,.75)'; g.fillStyle = 'rgba(40,30,22,.8)';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${S * 0.026}px Georgia, serif`;
  for (let k = 10; k >= 1; k--) {
    const r = R * k / 10;
    if (k <= 4) { g.fillStyle = '#141110'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill(); }
    g.lineWidth = S * 0.0022; g.strokeStyle = k <= 4 ? 'rgba(239,232,216,.75)' : 'rgba(40,30,22,.7)';
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    if (k > 1 && k < 10) {
      g.fillStyle = k <= 4 ? 'rgba(239,232,216,.8)' : 'rgba(40,30,22,.75)';
      const t = String(11 - k), m = (R * (k - 0.5)) / 10;
      g.fillText(t, c, c - m); g.fillText(t, c, c + m); g.fillText(t, c - m, c); g.fillText(t, c + m, c);
    }
  }
  g.strokeStyle = 'rgba(239,232,216,.8)'; g.lineWidth = S * 0.003;
  g.beginPath(); g.moveTo(c - R * 0.03, c); g.lineTo(c + R * 0.03, c); g.moveTo(c, c - R * 0.03); g.lineTo(c, c + R * 0.03); g.stroke();
  if (shape !== 'round') {
    g.fillStyle = 'rgba(40,30,22,.55)'; g.font = `500 ${S * 0.03}px Georgia, serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${S * 0.012}px`;
    g.fillText('ROULETTE  ·  NO. 6', c, S * 0.055);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  }
  // Soft edge darkening, like paper that has hung in a room.
  const vg = g.createRadialGradient(c, c, S * 0.3, c, c, S * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(90,70,40,.22)');
  g.fillStyle = vg; g.fillRect(0, 0, S, S);
  for (const h of holes) drawHole(g, h);
  g.restore();
}

function drawHole(g, { x, y, r, seed }) {
  const rnd = mulberry(seed);
  const burn = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
  burn.addColorStop(0, 'rgba(40,26,14,.55)'); burn.addColorStop(1, 'rgba(40,26,14,0)');
  g.fillStyle = burn; g.beginPath(); g.arc(x, y, r * 2.6, 0, Math.PI * 2); g.fill();
  // Torn rim: lighter fibres pushed inward, then the dark hole.
  g.fillStyle = 'rgba(250,244,228,.85)'; g.beginPath();
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2, rr = r * (1.15 + rnd() * 0.35); i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill();
  g.fillStyle = '#070504'; g.beginPath();
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2, rr = r * (0.82 + rnd() * 0.3); i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill();
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createTarget() {
  const group = new THREE.Group(); group.name = 'target';
  const hinge = new THREE.Group(); group.add(hinge);
  const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), mat); sheet.name = 'paper';
  hinge.add(sheet);
  const clipMat = new THREE.MeshStandardMaterial({ color: 0xb8924a, metalness: 1, roughness: 0.35 });
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.01), clipMat); hinge.add(clip);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 16), clipMat); pole.visible = false; group.add(pole);
  const state = { shape: 'square', holes: [], w: 1, h: 1, swing: 0, vswing: 0, twist: 0, vtwist: 0 };
  const redraw = () => { drawFace(cv.getContext('2d'), state.shape, state.holes); tex.needsUpdate = true; };

  const api = {
    group, sheet,
    get holes() { return state.holes.length; },
    // Place the sheet over the plate patch (centre p, size w x h, all in the plate's own frame), pulled toward the eye by k.
    place(parent, p, w, h, k, shape, stand) {
      if (group.parent !== parent) parent.add(group);
      const changed = shape !== state.shape;
      state.shape = shape; state.w = w * k; state.h = h * k;
      group.position.copy(p).multiplyScalar(k);
      // The sheet hangs from its top edge so a hit swings it back.
      hinge.position.set(0, state.h / 2, 0);
      sheet.scale.set(state.w, state.h, 1); sheet.position.set(0, -state.h / 2, 0);
      clip.scale.setScalar(state.w * 1.2); clip.position.set(0, -state.w * 0.004, 0.002); clip.visible = shape !== 'round';
      if (stand) {
        // A slim brass stand down to the given height (the desk line in the plate), behind the sheet.
        const top = -state.h / 2, bot = stand * k - group.position.y, len = Math.max(0.01, top - bot), r = state.w * 0.012;
        pole.visible = true; pole.scale.set(r, len, r); pole.position.set(0, (top + bot) / 2, -0.01);
      } else pole.visible = false;
      if (changed || !tex.image.dataset.ready) { tex.image.dataset.ready = '1'; redraw(); }
    },
    // World ray -> uv on the sheet (0..1, v up) or null when it misses the plane.
    uvFromRay(ray) {
      sheet.updateMatrixWorld();
      const inv = sheet.matrixWorld.clone().invert();
      const o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv);
      if (Math.abs(d.z) < 1e-6) return null;
      const t = -o.z / d.z; if (t <= 0) return null;
      const lp = o.addScaledVector(d, t);
      return { u: lp.x + 0.5, v: lp.y + 0.5, dist: t };
    },
    // Keep a hit on the paper: clamp to the printed area.
    clampUv({ u, v }) {
      if (state.shape === 'round') {
        const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy), m = 0.44;
        return r > m ? { u: 0.5 + dx * m / r, v: 0.5 + dy * m / r, clamped: true } : { u, v };
      }
      const cu = Math.min(0.94, Math.max(0.06, u)), cvv = Math.min(0.9, Math.max(0.06, v));
      return { u: cu, v: cvv, clamped: cu !== u || cvv !== v };
    },
    onPaper({ u, v }) {
      if (state.shape === 'round') return Math.hypot(u - 0.5, v - 0.5) < 0.47;
      return u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98;
    },
    worldAt(u, v) { sheet.updateMatrixWorld(); return sheet.localToWorld(new THREE.Vector3(u - 0.5, v - 0.5, 0.002)); },
    hit(u, v, size = 1) {
      state.holes.push({ x: u * TEX, y: (1 - v) * TEX, r: TEX * 0.0105 * size, seed: (Math.random() * 1e9) | 0 });
      if (state.holes.length > 40) state.holes.shift();
      redraw();
      state.vswing -= 3.2; state.vtwist += (u - 0.5) * 2.4;
    },
    clear() { state.holes = []; redraw(); },
    redraw,
    update(dt) {
      state.vswing += (-60 * state.swing - 3.2 * state.vswing) * dt; state.swing += state.vswing * dt;
      state.vtwist += (-40 * state.twist - 3 * state.vtwist) * dt; state.twist += state.vtwist * dt;
      hinge.rotation.set(state.swing * 0.09, state.twist * 0.05, 0);
    },
  };
  redraw();
  return api;
}
