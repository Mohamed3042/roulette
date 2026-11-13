# Real revolver (branch `gun-real`)

The procedural revolver is replaced by an artist-made model: "Smith & Wesson's 629 Classic .44 Magnum" by Gintoki1234, CC BY 4.0 (credited in `CREDITS.md`). It is a large-frame six-shot revolver with a 6.5 in barrel. The app's API in `js/revolver.js` is unchanged: same exports, the same returned object, the same node names and anchors, the same gun-space frame.

## What was done
- `tools/blender/import_sw629.py` (new, re-runnable) imports the FBX and splits the rigged mesh into moving parts, using the rig's vertex groups plus loose-part tests. The parts are Frame (with the cylinder latch), Grip, Hammer (pivot from the hammer bone), Trigger (pivot from the trigger bone), Crane (pivot on the crane's bore-parallel swing axis), and Cylinder (axis from the cylinder bone; the ejector rod, the star and the centre pin ride along). It keeps the source face winding, because recomputing it turned the open cylinder shell inside out. It writes a Draco GLB with the anchors Muzzle, Gap, RearSight and FrontSight measured from the mesh.
- Six generic .44 Magnum class cartridges (brass case, lead semi-wadcutter, separate primer for the dent) are built in the script; the headstamp is a canvas texture that reads ".44 MAG / 240 GR". The source's own rounds, speed loader and their textures are not used.
- Maker's markings are removed from the textures: the side-plate medallion, the right-side roll mark, and the model name on the barrel. The script finds them by ray-casting the surface into UV space, then fills them from the plain steel right around each mark. The ".44 MAGNUM" calibre text is kept.
- The rubber wrap-around grip is re-textured as walnut instead of being tinted. It gets planar UVs, a generated checkered field inset from the panel outline (bordered, worn flat on the high points), and a raised round medallion on each side, modelled in the script. Its shape is still the source's wrap-around grip, not new slab panels.

## Looks (`STEEL_LOOKS`, `GRIP_LOOKS`, `MEDAL_LOOKS` in `js/revolver.js`)
- **service** (default): blue-black steel with uneven grey-brown patina patches, finish worn thin next to edges, and bare bright steel on convex edges and the muzzle crown. The edge mask is baked from the model's curvature and AO. It also has handling scratches, grime in recesses and a little scanned scuffing. Low oil sheen, not glossy. Hammer and trigger are case-coloured. Grips are dark red-brown checkered walnut with a worn nickel medallion.
- **stainless**: the source's brushed stainless (its roughness and albedo detail mostly shown through), black stippled grip.
- **nickel**: bright nickel, ivory grip with light checkering, brass-coloured medallion.

## Maps (all from the script; 2048 px max, WebP)
| file | content | bytes |
|---|---|---|
| revolver.glb | Draco mesh, 21,522 tris (gun 9,138 + 6 x (cartridge 1,424 + primer 640)) | 78,248 |
| revolver_wear.webp | baked AO / cavity / convex edge on the source UVs | 309,588 |
| revolver_normal.webp | source normal map (OpenGL), marks flattened | 185,168 |
| revolver_detail.webp | R source roughness, G source metalness, B source albedo luminance | 214,696 |
| revolver_grip_m.webp | wood grain / checkered field / figure | 98,502 |
| revolver_grip_n.webp | checkering normal map | 110,772 |
| revolver_scratch.webp | unchanged procedural scratch tile | 242,090 |
| **total** | | **1,239,064** (old revolver set 1,137,490) |

`revolver_normal.webp` and `revolver_detail.webp` are new names: `sw.js` precaches them and `CACHE` is `roulette-v5`. Precache: 5,474,971 bytes on main (5dfabb2), 5,579,347 bytes here.

## Fit (`FIT` in `js/revolver.js`)
The model's frame (origin = trigger pivot) is placed so the trigger pivot sits where the old one did: 13 mm above and 3 mm behind the trigger-finger origin, with no rotation or scale. The model is kept at its real size. Hand, trigger finger and grip stay in place; `hands.js` and `main.js` are untouched. What moved, because the real gun is bigger:
- The bore is 55.4 mm above the finger point (was 46).
- The muzzle is at z -0.2016 (was -0.135): the barrel is 66 mm longer.
- The sights are at y 0.076 / 0.078 (were 0.059). The aim pose reads them from the anchors, so the sight picture lines up (see `service-sights.jpg`, `*-ads.jpg`).
- The cylinder is 43 mm across (was 36.6). The chamber circle radius is 14.1 mm (was 11.6), and the label ring uses the new `dims`.
- `HAMMER_COCK` is 0.71 rad, the model's own hammer travel (was 0.75).
- The grip is longer than the old one and reaches below the little finger at the hip.

## Verified
- Preview stills (1600x1000): `docs/shots/v3-gun/service-{side,q34,open,sights,grip,rear}.jpg`, `stainless-{side,q34}.jpg`, `nickel-{side,q34}.jpg`.
- In-app, on the merge with origin/main 5dfabb2:
  - Phone 390x844 with touch, Chromium and WebKit: `phone-{chromium,webkit}-{hip,ads,open,fire,custom}.jpg`.
  - Desktop 1440x900 Chromium: `desk-chromium-{hip,ads,open}.jpg`.
  - Range mode loads and fires: `phone-chromium-range-fire.jpg`.
  - 0 console errors and 0 failed requests in every run.
- Spin, swing-out, hammer, trigger, fired primer dent, twirl, inspect, hold and fan all run, captured as freeze-frame checks. Customize tiles `assets/ui/gun-*.webp` were re-rendered from the new model at 480x300.
- Frame time, phone-size Chromium: 16.7 ms median (vsync) on both main and this branch. A synced render (composer.render + readPixels, 60 frames, 780x1688) took 2.2-2.8 ms median here vs 2.1-3.3 ms on main. Windows WebKit, which renders in software: 47-54 ms.

## Hunks outside the revolver files
- `sw.js`: `CACHE` is `roulette-v5`, and the precache list gains `revolver_normal.webp` and `revolver_detail.webp`.
- `CREDITS.md`: only the revolver line changed.

## Not matching the reference photos yet / not verified
- The reference revolvers have a 4 in barrel and a slimmer older frame. This model is a large frame with a 6.5 in barrel and a full underlug, which is fixed by the model.
- The grip keeps the wrap-around target-stock shape: wood covers the backstrap. The references have two slab panels with the steel backstrap showing.
- The patina is texture-driven: there is no pitting or rust and no real micro-relief. The headstamp is a flat texture, not stamped geometry.
- Not checked on a real iPhone or Android phone (frame rate, look under a phone GPU).

## Rebuild
Unzip the original download to a folder outside the repo (never commit it), then:
```
blender -b --factory-startup --python tools/blender/import_sw629.py -- "<source folder>" assets/models
```
Tested with Blender 4.2. The full run takes about 6 min on a GPU, most of it the wear bake. `--no-bake` keeps the wear map and `--no-maps` keeps the normal and detail maps. Geometry and UVs are deterministic, so partial runs stay consistent. Stills: `tools/revolver-preview.html?look=service&cam=side&hud=0`, with cam one of q34, open, sights, grip, side, right, rear, front or top.
