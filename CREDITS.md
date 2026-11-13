# Credits and licences

Every asset that ships in this repository, and where it comes from:

- Revolver (`assets/models/revolver.glb` and `revolver_*.webp`): modelled and textured procedurally for this app in Blender by `tools/blender/build_revolver.py`. No third-party model or texture. Same licence as this repository's code.
- Pistol (`assets/models/pistol.glb` and `pistol_*.webp`): modelled and textured procedurally for this app by `tools/blender/build_pistol.py`. No third-party model or texture.
- Hands: cut from the MakeHuman / MPFB base mesh (CC0), re-rigged in Blender.
- Paper target, flash, smoke: canvas textures and three.js geometry written for this app.
- Customize tiles (`assets/ui/`): rendered from the app's own models.
- Sound: synthesized at runtime with Web Audio (no samples).
- Room plates: AI-generated for this app, upscaled with Real-ESRGAN.
- three.js r170 (including GLTFLoader, DRACOLoader and the Draco decoder in `vendor/three/addons/libs/draco/`): MIT licence (header in `vendor/three/three.module.js`); the Draco decoder is Apache-2.0 (Google).
- GSAP 3.12.5: GreenSock standard licence (header in `vendor/gsap.min.js`).
- Fonts: Cormorant Garamond and Libre Caslon Display, SIL Open Font License 1.1 (`vendor/fonts/OFL-*.txt`).
