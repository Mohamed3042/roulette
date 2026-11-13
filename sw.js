// Offline cache: the shell and phone assets are stored on install; everything else same-origin is cached on first use.
// Responses come from the cache at once and refresh in the background, so a new push shows on the next open.
const CACHE = 'roulette-v5';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/revolver.js', 'js/hands.js', 'js/hands-data.js', 'js/fx.js', 'js/sound.js', 'js/target.js', 'js/customize.js',
  'js/range.js', 'js/pistol.js', 'assets/ui/pistol-classic.webp', 'assets/ui/pistol-stainless.webp', 'assets/ui/pistol-black.webp',
  // The pistol model and its textures (about 1.5 MB) are cached the first time Range opens.
  'assets/models/revolver.glb', 'assets/models/revolver_wear.webp', 'assets/models/revolver_scratch.webp', 'assets/models/revolver_grip_m.webp', 'assets/models/revolver_grip_n.webp', 'assets/models/revolver_normal.webp', 'assets/models/revolver_detail.webp',
  'vendor/three/addons/loaders/DRACOLoader.js', 'vendor/three/addons/libs/draco/gltf/draco_decoder.wasm', 'vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js',
  'vendor/gsap.min.js', 'vendor/three/three.module.js',
  'vendor/three/addons/postprocessing/EffectComposer.js', 'vendor/three/addons/postprocessing/RenderPass.js',
  'vendor/three/addons/postprocessing/UnrealBloomPass.js', 'vendor/three/addons/postprocessing/ShaderPass.js',
  'vendor/three/addons/postprocessing/OutputPass.js', 'vendor/three/addons/postprocessing/Pass.js',
  'vendor/three/addons/postprocessing/MaskPass.js', 'vendor/three/addons/shaders/CopyShader.js',
  'vendor/three/addons/shaders/LuminosityHighPassShader.js', 'vendor/three/addons/shaders/OutputShader.js',
  'vendor/three/addons/loaders/GLTFLoader.js', 'vendor/three/addons/utils/BufferGeometryUtils.js',
  'vendor/fonts/fonts.css', 'vendor/fonts/cormorant.woff2', 'vendor/fonts/cormorant-italic.woff2', 'vendor/fonts/libre-caslon-display.woff2',
  'assets/plates/study-2k.jpg', 'assets/plates/salon-2k.jpg', 'assets/plates/atelier-2k.jpg',
  'assets/plates/study-thumb.jpg', 'assets/plates/salon-thumb.jpg', 'assets/plates/atelier-thumb.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never precaches an old file.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // The app page is stored once under './' (any query such as ?debug maps to it); other pages keep their own entry.
  const url = new URL(req.url), root = new URL('./', location.href);
  const isApp = req.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html');
  const key = isApp ? root.href : req;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(key, { ignoreSearch: isApp });
    const net = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    // Offline and not cached: a page request still gets the app.
    return net.catch(async () => (req.mode === 'navigate' && (await c.match(root.href))) || Response.error());
  }));
});
