// Offline cache: the shell and phone assets are stored on install; everything else same-origin is cached on first use.
// Responses come from the cache at once and refresh in the background, so a new push shows on the next open.
const CACHE = 'roulette-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'js/main.js', 'js/revolver.js', 'js/hands.js', 'js/hands-data.js', 'js/fx.js', 'js/sound.js',
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages are looked up without their query (?debug), so the app opens offline from any start URL.
  const key = req.mode === 'navigate' ? new Request(new URL('./', location.href)) : req;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(key, { ignoreSearch: req.mode === 'navigate' });
    const net = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
