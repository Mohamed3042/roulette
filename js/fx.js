// Shot effects: muzzle flash + light, smoke, paper debris, and the placard target.
import * as THREE from 'three';

function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const flashTex = () => canvasTex(256, 256, (g, S) => {
  const c = S / 2;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, len = c * (0.5 + Math.random() * 0.5), w = 0.16 + Math.random() * 0.16;
    const grd = g.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
    grd.addColorStop(0, 'rgba(255,240,200,.9)'); grd.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(c, c);
    g.lineTo(c + Math.cos(a - w) * len * 0.3, c + Math.sin(a - w) * len * 0.3);
    g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    g.lineTo(c + Math.cos(a + w) * len * 0.3, c + Math.sin(a + w) * len * 0.3); g.closePath(); g.fill();
  }
  const r = g.createRadialGradient(c, c, 0, c, c, c * 0.62);
  r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.22, 'rgba(255,216,130,.95)'); r.addColorStop(0.6, 'rgba(255,120,30,.3)'); r.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
});

const smokeTex = () => canvasTex(128, 128, (g, S) => {
  for (let i = 0; i < 14; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.35, y = S / 2 + (Math.random() - 0.5) * S * 0.35, r = S * (0.18 + Math.random() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(235,230,222,.22)'); grd.addColorStop(1, 'rgba(235,230,222,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
});

// Placard card face: paper, gold rules, the word, bullet holes.
const CARD_W = 0.22, CARD_H = 0.125, TEX_W = 1100, TEX_H = 625;
function drawCard(g, word, holes, eyebrow) {
  g.fillStyle = '#efe5cf'; g.fillRect(0, 0, TEX_W, TEX_H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(120,96,60,.05)' : 'rgba(255,255,255,.08)';
    g.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 1 + Math.random() * 6, 1);
  }
  const vg = g.createRadialGradient(TEX_W / 2, TEX_H / 2, TEX_H * 0.3, TEX_W / 2, TEX_H / 2, TEX_W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(110,80,40,.22)');
  g.fillStyle = vg; g.fillRect(0, 0, TEX_W, TEX_H);
  g.strokeStyle = '#a8833e'; g.lineWidth = 6; g.strokeRect(34, 34, TEX_W - 68, TEX_H - 68);
  g.lineWidth = 2; g.strokeRect(50, 50, TEX_W - 100, TEX_H - 100);
  g.fillStyle = '#2b2118'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  g.font = '500 30px "Cormorant Garamond", Georgia, serif';
  g.globalAlpha = 0.7; g.fillText(eyebrow, TEX_W / 2, 118); g.globalAlpha = 1;
  if ('letterSpacing' in g) g.letterSpacing = word.length > 9 ? '4px' : '14px';
  let size = 190;
  const text = word.toUpperCase();
  do { g.font = `400 ${size}px "Libre Caslon Display", "Cormorant Garamond", Georgia, serif`; size -= 6; } while (g.measureText(text).width > TEX_W * 0.74 && size > 40);
  g.fillText(text, TEX_W / 2, TEX_H / 2 + 34);
  for (const [hx, hy] of holes) {
    const burn = g.createRadialGradient(hx, hy, 6, hx, hy, 46);
    burn.addColorStop(0, 'rgba(40,24,10,.75)'); burn.addColorStop(0.45, 'rgba(70,45,20,.28)'); burn.addColorStop(1, 'rgba(70,45,20,0)');
    g.fillStyle = burn; g.beginPath(); g.arc(hx, hy, 46, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(25,15,8,.8)'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, l = 22 + Math.random() * 16;
      g.beginPath(); g.moveTo(hx + Math.cos(a) * 12, hy + Math.sin(a) * 12); g.lineTo(hx + Math.cos(a) * l, hy + Math.sin(a) * l); g.stroke();
    }
    g.fillStyle = '#0b0705'; g.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 13 + Math.random() * 6;
      i ? g.lineTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r) : g.moveTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = 'rgba(255,248,230,.6)';
    for (let i = 0; i < 9; i++) { const a = Math.random() * Math.PI * 2; g.fillRect(hx + Math.cos(a) * 17, hy + Math.sin(a) * 17, 3, 2); }
  }
}

function makePlacard() {
  const group = new THREE.Group(); group.name = 'placard';
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc9a253, metalness: 1, roughness: 0.25 });
  const add = (geo, mat, parent = group) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  add(new THREE.BoxGeometry(0.25, 0.008, 0.026).translate(0, 0.004, 0), brass);
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(0.0115, 24, 16).translate(sx * 0.128, 0.0115, 0), brass);
    add(new THREE.BoxGeometry(0.012, 0.03, 0.012).translate(sx * 0.098, 0.022, 0), brass);
  }
  const cv = document.createElement('canvas'); cv.width = TEX_W; cv.height = TEX_H;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const hinge = new THREE.Group(); hinge.position.set(0, 0.012, 0); group.add(hinge);
  const paper = new THREE.MeshStandardMaterial({ color: 0xefe5cf, roughness: 0.92 });
  const card = add(new THREE.BoxGeometry(CARD_W, CARD_H, 0.0018).translate(0, CARD_H / 2, 0), [paper, paper, paper, paper, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88 }), paper], hinge);
  const state = { word: '?', holes: [], eyebrow: 'FIRE TO DECIDE' };
  const redraw = () => { drawCard(cv.getContext('2d'), state.word, state.holes, state.eyebrow); tex.needsUpdate = true; };
  redraw();
  return {
    group, hinge, card,
    set(word, eyebrow) { state.word = word; state.eyebrow = eyebrow; state.holes = []; redraw(); },
    // New round on the same card: old bullet holes stay.
    reset() { state.word = '?'; state.eyebrow = 'FIRE TO DECIDE'; redraw(); },
    // u,v in 0..1 across the card face; returns the world point of the hole.
    hit(word, u, v) {
      state.word = word; state.eyebrow = 'YOUR PICK'; state.holes.push([u * TEX_W, (1 - v) * TEX_H]); redraw();
      return card.localToWorld(new THREE.Vector3((u - 0.5) * CARD_W, v * CARD_H, 0.001));
    },
    redraw,
  };
}

export function createFx(scene) {
  const flashMats = [0, 1, 2].map(() => new THREE.SpriteMaterial({ map: flashTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  const flash = new THREE.Sprite(flashMats[0]); flash.visible = false; flash.renderOrder = 10; scene.add(flash);
  const flashSide = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: flashMats[1].map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  flashSide.visible = false; scene.add(flashSide);
  const light = new THREE.PointLight(0xffb066, 0, 4, 1.6); scene.add(light);

  const smokeMat = new THREE.SpriteMaterial({ map: smokeTex(), depthWrite: false, transparent: true, color: 0xd9d2c6 });
  const puffs = Array.from({ length: 48 }, () => { const s = new THREE.Sprite(smokeMat.clone()); s.visible = false; scene.add(s); return { s, v: new THREE.Vector3(), age: 9, life: 1, size: 0.02, grow: 0.1 }; });
  const bitGeo = new THREE.PlaneGeometry(0.007, 0.0045);
  const bitMat = new THREE.MeshStandardMaterial({ color: 0xefe5cf, roughness: 0.9, side: THREE.DoubleSide });
  const bits = Array.from({ length: 22 }, () => { const m = new THREE.Mesh(bitGeo, bitMat); m.visible = false; m.castShadow = true; scene.add(m); return { m, v: new THREE.Vector3(), w: new THREE.Vector3(), age: 9 }; });

  const placard = makePlacard(); scene.add(placard.group);
  let flashT = 0, deskY = -0.3;
  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();

  return {
    placard,
    setDesk(y) { deskY = y; },
    muzzleFlash(muzzle, scale = 1) {
      muzzle.getWorldPosition(tmp); muzzle.getWorldQuaternion(q);
      flash.material = flashMats[(Math.random() * 3) | 0];
      flash.material.rotation = Math.random() * Math.PI * 2;
      flash.position.copy(tmp); flash.scale.setScalar(0.11 * scale); flash.visible = true;
      flashSide.position.copy(tmp).add(new THREE.Vector3(0, 0, -0.06).applyQuaternion(q));
      flashSide.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.random() * Math.PI)));
      flashSide.scale.set(0.07 * scale, 0.16 * scale, 1); flashSide.visible = true;
      light.position.copy(tmp); light.intensity = 9 * scale; flashT = 0.07;
    },
    smoke(origin, dir, n = 14, speed = 0.7) {
      origin.getWorldPosition ? origin.getWorldPosition(tmp) : tmp.copy(origin);
      let k = 0;
      for (const p of puffs) {
        if (p.age < p.life) continue;
        p.age = 0; p.life = 1.2 + Math.random() * 1.2; p.size = 0.01 + Math.random() * 0.015; p.grow = 0.05 + Math.random() * 0.07;
        p.s.position.copy(tmp);
        p.v.copy(dir).multiplyScalar(speed * (0.3 + Math.random())).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.3) * 0.12, (Math.random() - 0.5) * 0.12));
        p.s.material.rotation = Math.random() * 6.28; p.s.visible = true;
        if (++k >= n) break;
      }
    },
    debris(point, normal) {
      for (const b of bits) {
        b.age = 0; b.m.visible = true; b.m.position.copy(point);
        b.v.copy(normal).multiplyScalar(0.4 + Math.random() * 0.9).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.7, (Math.random() - 0.5) * 0.5));
        b.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      }
    },
    update(dt) {
      if (flashT > 0) {
        flashT -= dt;
        light.intensity *= Math.pow(0.55, dt * 60);
        if (flashT <= 0) { flash.visible = flashSide.visible = false; light.intensity = 0; }
      }
      for (const p of puffs) {
        if (p.age >= p.life) continue;
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { p.s.visible = false; continue; }
        p.v.multiplyScalar(Math.exp(-dt * 2.4)); p.v.y += dt * 0.05;
        p.s.position.addScaledVector(p.v, dt);
        p.s.scale.setScalar(p.size + p.grow * Math.sqrt(k));
        p.s.material.opacity = Math.min(1, k * 12) * (1 - k) * 0.3;
      }
      for (const b of bits) {
        if (b.age > 1.6) { b.m.visible = false; continue; }
        b.age += dt;
        if (b.m.position.y > deskY + 0.003) {
          b.v.y -= 2.2 * dt; b.v.multiplyScalar(Math.exp(-dt * 1.5));
          b.m.position.addScaledVector(b.v, dt);
          b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt;
        } else { b.m.position.y = deskY + 0.002; b.m.rotation.x = -Math.PI / 2; }
      }
    },
  };
}
