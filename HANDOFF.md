# Roulette handoff (2026-11-13, v2)

**Goal:** first-person 3D revolver decision toy, phone web app on this repo's GitHub Pages site.

**Done (Playwright 1440x900 Chromium, 390x844 Chromium + WebKit with touch, 0 console errors):**
- v2 Decide: mouse aims, left click fires, right click held = aim down the sights; pointer lock, Esc frees. Keys R spin, F inspect, Space fire, E choices, C customize, M sound.
- Phone: tap scene = fire, Aim button (or two fingers) = sights, drag = look; gestures on the gun keep tap open / double-tap fan / swipe twirl / hold inspect.
- New revolver (`js/revolver.js`, `assets/models/revolver.glb`, Draco): looks service (worn blued + walnut, default), stainless, nickel.
- Paper target with lasting holes (`js/target.js`), Customize sheet (`js/customize.js`: gun, hands, room, choices with share link, feel), 3-step coach. SW cache `roulette-v3`; precache 5.4 MB.
- Stills: `docs/shots/v2/`.

**Pending:** Range mode (semi-auto 1911: `js/pistol.js`, `assets/models/pistol*.{glb,webp}`, `tools/blender/build_pistol.py` exist but are NOT wired in; keep the mode switch hidden until the range is verified).

**Not verified:** real iPhone/Android (60 fps, haptics, audio by ear). Windows WebKit renders in software (25-55 ms frames).

**Next command:** from the folder holding this repo, `py -m http.server 5291`, open http://127.0.0.1:5291/roulette/?debug&nosw

**Do-not-do:** no casino/money theme; gun fires only at the paper; never commit reference photos; bump `CACHE` in `sw.js` when shipping changed files; no personal names, paths or keys (public repo).
