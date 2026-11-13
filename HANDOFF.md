# Roulette handoff (2026-11-13, v2 + Range)

**Goal:** first-person 3D gun toy, phone web app on this repo's GitHub Pages site. Two modes: Decide (revolver picks one of your choices) and Range (semi-auto pistol at an indoor range).

**Done (Playwright 1440x900 Chromium, 390x844 Chromium + WebKit with touch, 0 console errors):**
- v2 Decide: unchanged by Range (stills re-shot and compared). Revolver, paper target, Customize, coach. Stills: `docs/shots/v2/`.
- Range (`js/range.js`, `js/pistol.js`): Decide | Range switch in the top bar (`RANGE_READY` in `js/main.js`; `?range` forces it), mode kept in `roulette.mode`.
- Indoor range built in code: paper at 5/10/15 m (holes stay), 5 steel plates that ring and fall, bottles that break and cans that jump on a plank, a spinner. Reset range chip (X), optional hits/shots tally.
- Pistol loop: slide cycles, hammer, casing ejects and tinks, flash, smoke, recoil; slide locks after the 7th round; reload with R, the Reload button or fire on empty (tactical reload = 7+1). Support hand at ADS, magazine hand on reload.
- Customize in Range: Gun tab = 3 pistol tiles, target set toggles, tally toggle, Reset range.
- SW cache `roulette-v4`; precache 5.5 MB; pistol model (~1.5 MB) cached on first Range open.

**Not verified:** real iPhone/Android (60 fps, haptics, audio by ear). Windows WebKit renders in software (25-55 ms frames).

**Known gaps:** holes on the 10 and 15 m papers read small at desktop size; range lighting is moody/dark by design.

**Next command:** from the folder holding this repo, `py -m http.server 5291`, open http://127.0.0.1:5291/roulette/?debug&nosw

**Do-not-do:** no casino/money theme in Range; no people, animals or blood; never commit reference photos; bump `CACHE` in `sw.js` when shipping changed files; no personal names, paths or keys (public repo).
