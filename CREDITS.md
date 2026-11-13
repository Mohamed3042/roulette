# Credits and licences

Every asset that ships in this repository, and where it comes from:

- Revolver (`assets/models/revolver.glb` and `revolver_*.webp`): based on "Smith & Wesson's 629 Classic .44 Magnum" by Gintoki1234 (https://gintoki1234.itch.io/smith-wessons-629-classic-44-magnum), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified for this app by `tools/blender/import_sw629.py`: re-exported as a Draco GLB, split into separately pivoted moving parts (frame, grip, hammer, trigger, crane, cylinder), maker's markings removed from the textures, the textures re-graded and repacked (normal map, a roughness/metalness/luminance map and a baked wear map; the blued, stainless and nickel finishes are built in `js/revolver.js`), the rubber grip re-textured as checkered walnut with a medallion, and new generic cartridges. The original cartridges, speed loader and full-size textures are not included. The scratch map (`revolver_scratch.webp`) is procedural, from `tools/blender/build_revolver.py`. No endorsement by the author or by any manufacturer is implied.
- Pistol (`assets/models/pistol.glb` and `pistol_*.webp`): modelled and textured procedurally for this app by `tools/blender/build_pistol.py`. No third-party model or texture.
- Hands (`assets/models/hand_left.glb`, `hand_right.glb`): cut from the MakeHuman / MPFB base mesh (CC0, https://creativecommons.org/publicdomain/zero/1.0/; https://github.com/makehumancommunity), re-rigged in Blender. Modified: new UV atlas and Draco compression by `tools/blender/build_hands.py`. The skin, glove, pore and leather maps (`assets/models/hand_*.webp`) are procedural, baked by the same script; no third-party texture or photo. The jacket tweed and shirting weave are generated in code (`js/hands.js`).
- Paper target, flash, smoke: canvas textures and three.js geometry written for this app.
- Range mode (`js/range.js`): the indoor range, paper, steel, bottles, cans and spinner are built in code from three.js geometry and canvas noise textures written for this app. No photos or third-party models.
- Customize tiles (`assets/ui/`, including `pistol-*.webp`): rendered from the app's own models.
- Sound: synthesized at runtime with Web Audio (no samples), the range shots, steel rings, glass and casing tinks included.
- Room plates: AI-generated for this app, upscaled with Real-ESRGAN.
- three.js r170 (including GLTFLoader, DRACOLoader and the Draco decoder in `vendor/three/addons/libs/draco/`): MIT licence (header in `vendor/three/three.module.js`); the Draco decoder is Apache-2.0 (Google).
- GSAP 3.12.5: GreenSock standard licence (header in `vendor/gsap.min.js`).
- Fonts: Cormorant Garamond and Libre Caslon Display, SIL Open Font License 1.1 (`vendor/fonts/OFL-*.txt`).
