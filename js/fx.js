// Shot effects: muzzle flash + light, cylinder-gap flash, smoke, paper debris.
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

  const gapFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMats[2].map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: 0xffd9a0 }));
  gapFlash.visible = false; gapFlash.renderOrder = 10; scene.add(gapFlash);
  let flashT = 0, deskY = -0.3;
  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();

  return {
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
    // Hot gas spitting sideways out of the barrel-cylinder gap (a revolver tell).
    gap(node, scale = 1) {
      node.getWorldPosition(tmp);
      gapFlash.position.copy(tmp); gapFlash.scale.set(0.09 * scale, 0.035 * scale, 1); gapFlash.material.rotation = (Math.random() - 0.5) * 0.3; gapFlash.visible = true;
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
    debris(point, normal, size = 1) {
      for (const b of bits) {
        b.age = 0; b.m.visible = true; b.m.position.copy(point); b.m.scale.setScalar(size); b.floor = point.y - 2;
        b.v.copy(normal).multiplyScalar((0.4 + Math.random() * 0.9) * size).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.7, (Math.random() - 0.5) * 0.5).multiplyScalar(size));
        b.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      }
    },
    update(dt) {
      if (flashT > 0) {
        flashT -= dt;
        light.intensity *= Math.pow(0.55, dt * 60);
        if (flashT <= 0) { flash.visible = flashSide.visible = gapFlash.visible = false; light.intensity = 0; }
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
        if (b.m.position.y > Math.max(deskY + 0.003, b.floor ?? -9)) {
          b.v.y -= 2.2 * dt * b.m.scale.x; b.v.multiplyScalar(Math.exp(-dt * 1.5));
          b.m.position.addScaledVector(b.v, dt);
          b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt;
        } else { b.m.position.y = deskY + 0.002; b.m.rotation.x = -Math.PI / 2; }
      }
    },
  };
}
