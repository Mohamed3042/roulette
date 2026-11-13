# Roulette handoff (2026-11-13)

**Goal:** first-person 3D revolver decision toy as a phone web app on GitHub Pages: https://mohamed3042.github.io/roulette/

**Done (verified with Playwright, 390x844 Chromium + WebKit with touch, 1440x900 Chromium, 0 console errors):**
- App = v6 from the home folder (MakeHuman hands + procedural revolver); three.js r170, GSAP and fonts vendored, so it runs offline.
- PWA: `manifest.webmanifest`, icons (192/512/maskable/apple 180), `sw.js` (precaches shell + 1920 px plates; 4K plates only on big screens, cached on use).
- Gestures: swipe gun = twirl (swipe direction), tap gun = open, double-tap = fan the hammer (left palm, 5 dry clicks), hold = slow inspect with light sweep (drag turns it), flick open cylinder = free spin with ticks, drag/tilt = sway. Ripple + sparks + `navigator.vibrate` on touches.
- Fire: letterbox, slow-mo, muzzle light on hands/room, recoil, smoke; a "No" chamber gives a dry click, no hole.
- First-run Tricks card (3 lines). DPR capped at 2, loop pauses when hidden, reduced motion = short fades.

**Not verified:** a real iPhone/Android (tilt signs, iOS motion prompt, haptics, 60 fps, audio by ear). Windows WebKit only renders ~8-25 fps in software and its screenshots go black after a canvas resize (GL readback is fine); real Safari not checked.

**Pending:** none asked. Ideas: tilt calibration button; sound for the fan per click.

**Exact next command (local check):** from the folder that holds this repo, `py -m http.server 5291`, then open http://127.0.0.1:5291/roulette/?debug (`?nosw` skips the service worker).

**Do-not-do:** never copy the old 500 MB scratch folder (`_work`) here; no casino/money theme; the gun only fires at the placard; bump `CACHE` in `sw.js` when shipping changed files; keep the repo free of personal names, paths and keys (it is public).
