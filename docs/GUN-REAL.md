# Real revolver (branch `gun-real`)

The procedural revolver is replaced by an artist-made model: "Smith & Wesson's 629 Classic .44 Magnum" by Gintoki1234, CC BY 4.0 (credited in `CREDITS.md`). It is a large-frame six-shot revolver with a 6.5 in barrel. The app's API in `js/revolver.js` is unchanged: same exports, the same returned object, the same node names and anchors, the same gun-space frame.

## What was done
- `tools/blender/import_sw629.py` (new, re-runnable) imports the FBX and splits the rigged mesh into moving parts, using the rig's vertex groups plus loose-part tests. The parts are Frame (with the cylinder latch), Grip, Hammer (pivot from the hammer bone), Trigger (pivot from the trigger bone), Crane (pivot on the crane's bore-parallel swing axis), and Cylinder (axis from the cylinder bone; the ejector rod, the star and the centre pin ride along). It keeps the source face winding, because recomputing it turned the open cylinder shell inside out. It writes a Draco GLB with the anchors Muzzle, Gap, RearSight and FrontSight measured from the mesh.
- Six generic .44 Magnum class cartridges (brass case, lead semi-wadcutter, separate primer for the dent) are built in the script; the headstamp is a canvas texture that reads ".44 MAG / 240 GR". The source's own rounds, speed loader and their textures are not used.
- Maker's markings are removed from the textures: the side-plate medallion, the right-side roll mark, and the model name on the barrel. The script finds them by ray-casting the surface into UV space, then fills them from the plain steel right around each mark. The ".44 MAGNUM" calibre text is kept.
- The rubber wrap-around grip is re-textured as walnut instead of being tinted. It gets planar UVs, a generated checkered field inset from the panel outline (bordered, worn flat on the high points), and a raised round medallion on each side, modelled in the script. Its shape is still the source's wrap-around grip, not new slab panels.

## Looks (`STEEL_LOOKS`, `GRIP_LOOKS`, `MEDAL_LOOKS` in `js/revolver.js`)
- **service** (default): blue-black steel. Patina is cloudy, direction-free 3D value noise in gun space (grey worn clouds, fine speckle, a few small rust freckles), with a few fine handling scratches on top; no tile is stretched along the barrel. Edges are only worn thin (a slightly lighter grey), broken along their length by low-frequency noise, so no edge reads as a line. Bare mid-grey steel (`worn` 0x69686b, rough 0.48) appears only where a carried gun wears: the muzzle crown and the front of the barrel and underlug, the cylinder's front edge, the front sight, the top-strap corners, the bottom of the trigger guard and the hammer spur. Those places are masks on a per-vertex rest position in gun space (`aRoot`, built at load), so they stay put when parts move. Low oil sheen. Hammer and trigger are case-coloured. Satin oiled walnut grip (soft broad highlight, visible grain, checkering worn smoother on its high points) with a worn nickel medallion.
- **stainless**: cool neutral brushed stainless, black rubber grip (weak, cool sheen).
- **nickel**: bright warm-white nickel, the brightest of the three; ivory grip, brass-coloured medallion.
- The rooms are warm, so each look carries a reflection gain and tint (`env`) applied in the shader; `scene.environmentIntensity` overrides `envMapIntensity` in this three.js build. Direct lamp highlights on steel are damped at grazing angles and capped (`specMax`), so curved edges such as the trigger guard never bloom into a glowing ring.
- Open cylinder: the cylinder has its own steel material instance. On its rear face the scanned maps are blurry, so the shader draws the extractor star (arcs round each chamber, a crisp anti-aliased groove), the machined hub and the matte face; the ratchet and centre pin are the model's own geometry. Primers are satin nickel; the `.44 MAG / 240 GR` headstamps and the fired-primer dent are unchanged.

## Maps (all from the script; 2048 px max, WebP)
| file | content | bytes |
|---|---|---|
| revolver.glb | Draco mesh, 21,522 tris (gun 9,138 + 6 x (cartridge 1,424 + primer 640)); grip with smooth normals | 77,688 |
| revolver_wear.webp | baked AO / cavity / convex edge on the source UVs | 309,588 |
| revolver_normal.webp | source normal map (OpenGL), marks flattened | 185,168 |
| revolver_detail.webp | R source roughness, G source metalness, B source albedo luminance | 214,696 |
| revolver_grip_m.webp | wood grain / checkered field / figure | 98,502 |
| revolver_grip_n.webp | checkering normal map | 110,772 |
| revolver_scratch.webp | procedural scratch tile (handling scratches; the patina no longer uses it) | 242,090 |
| **total** | | **1,238,504** (old revolver set 1,137,490) |

`revolver_normal.webp` and `revolver_detail.webp` are new names: `sw.js` precaches them and `CACHE` is `roulette-v5`. Precache (sum of the `SHELL` files, `./` counted as index.html): 5,591,171 bytes here, 5,585,579 at 32055a5.

## Fit (`FIT` in `js/revolver.js`)
The model's frame (origin = trigger pivot) is placed so the trigger pivot sits where the old one did: 13 mm above and 3 mm behind the trigger-finger origin, with no rotation or scale. The model is kept at its real size. Hand, trigger finger and grip stay in place; `hands.js` and `main.js` are untouched. What moved, because the real gun is bigger:
- The bore is 55.4 mm above the finger point (was 46).
- The muzzle is at z -0.2016 (was -0.135): the barrel is 66 mm longer.
- The sights are at y 0.076 / 0.078 (were 0.059). The aim pose reads them from the anchors, so the sight picture lines up (see `service-sights.jpg`, `*-ads.jpg`).
- The cylinder is 43 mm across (was 36.6). The chamber circle radius is 14.1 mm (was 11.6), and the label ring uses the new `dims`.
- `HAMMER_COCK` is 0.71 rad, the model's own hammer travel (was 0.75).
- The grip is longer than the old one and reaches below the little finger at the hip.

## Verified
- Preview stills (1600x1000): `docs/shots/v3-gun/service-{side,q34,open,sights,grip,rear}.jpg`, `stainless-{side,q34}.jpg`, `nickel-{side,q34}.jpg`, checked at full size and in crops against the two reference photos (worn blued revolver with walnut grip; open cylinder macro).
- In-app (`index.html?nosw&debug`, the governor held off with `dbg.noGovernor` so Windows WebKit keeps its canvas in screenshots):
  - Phone 390x844 with touch, DPR 3, Chromium and WebKit: `phone-{chromium,webkit}-{hip,ads,open,fire,custom}.jpg`.
  - Desktop 1440x900 Chromium: `desk-chromium-{hip,ads,open}.jpg`.
  - Range mode loads and fires: `phone-chromium-range-fire.jpg`.
  - 0 console errors and 0 failed requests in every run.
  - The sight picture lines up at ADS (front sight in the rear notch on the bull), and the six choice labels point at the six chambers in the open view.
- Customize tiles `assets/ui/gun-*.webp` (480x300) re-rendered from the new looks.
- Not re-measured after the look pass: frame time. The shader adds 3D value noise (8 octave lookups) per steel pixel and the star block on the cylinder face only.

## Hunks outside the revolver files
- `sw.js`: `CACHE` is `roulette-v5`, and the precache list gains `revolver_normal.webp` and `revolver_detail.webp`.
- `CREDITS.md`: only the revolver line changed.

## Not matching the reference photos yet / not verified
- The reference revolvers have a 4 in barrel and a slimmer older frame. This model is a large frame with a 6.5 in barrel and a full underlug, which is fixed by the model.
- The grip keeps the wrap-around target-stock shape: wood covers the backstrap. The references have two slab panels with the steel backstrap showing.
- The patina is colour and roughness only: no pitting or micro-relief in the normals. The extractor star is drawn in the shader, not modelled. The headstamp is a flat texture, not stamped geometry.
- Not checked on a real iPhone or Android phone (frame rate, look under a phone GPU).

## Rebuild
Unzip the original download to a folder outside the repo (never commit it), then:
```
blender -b --factory-startup --python tools/blender/import_sw629.py -- "<source folder>" assets/models
```
Tested with Blender 4.2. The full run takes about 6 min on a GPU, most of it the wear bake. `--no-bake` keeps the wear map and `--no-maps` keeps the normal and detail maps. Geometry and UVs are deterministic, so partial runs stay consistent. Stills: `tools/revolver-preview.html?look=service&cam=side&hud=0`, with cam one of q34, open, sights, grip, side, right, rear, front or top.
