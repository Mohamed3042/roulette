# Real hands and quiet sleeves (v4)

The gun looked real; the hands were one flat tan colour with a plastic sheen, and at aim the shirt cuff and jacket
sleeve filled the bottom half of a phone. This pass keeps the same rigged meshes (topology, joint names, rest pose,
so every pose in both modes is unchanged) and moves the realism into baked maps and skin shading, and rebuilds the
sleeve as a tailored oval tube.

## What changed

**Hands** (`js/hands.js`, `assets/models/hand_*`, `tools/blender/build_hands.py`)
- The meshes moved out of the base64 module (`js/hands-data.js`, removed) into Draco GLBs, `hand_left.glb` and
  `hand_right.glb`, with a new UV atlas shared by both hands (the old UVs ran outside 0..1 and were unusable). Nodes,
  skin and inverse bind matrices are copied byte for byte; the mesh is only re-split along the new UV seams.
- Every map is baked from anatomy laid out around the rig in 3D (no photo): flexion creases on the palm side of each
  finger joint and the palmar digital crease, curved knuckle wrinkle sets and joint pads on the back of the PIP and DIP
  joints, MCP knuckle pads, nail plates with lateral grooves, a cuticle fold, lunula, onychodermal band and a pale free
  edge, fingertip pads with a faint whorl, the palm lines (heart, head, life, a faint fate line, two wrist creases and
  fine palm lines), extensor tendons fanning to the knuckles, a dorsal vein network with an arch and the cephalic and
  basilic veins, redder knuckles, fingertips and finger sides, paler palms, mottling, fine speckle and a few spots,
  ray-cast occlusion in the bind pose plus crease cavity.
- The relief ships as surface slopes along u and v (two grey maps). A lossy height map differentiated in the shader
  showed every compression block; slopes taken in float at bake time only pick up tiny direction noise.
- Shading (`skinMaterial`): `MeshPhysicalMaterial` with the albedo, an ORM map (occlusion, roughness: nails glossy,
  knuckles drier, pads oilier; pigment weight), the slope relief plus a tiled micro relief (furrow network and pores,
  16 mm tile) that fades out as it drops below a pixel, wrapped direct diffuse (red wraps furthest, a cheap stand-in
  for light under the skin), a low per-tone sheen, a faint warm self-light. Light, medium and deep re-grade the same
  albedo per channel, weighted by the pigment mask, so palms and nails stay pale on deep skin.
- Gloves: dark brown leather on the same atlas: glove relief (stitched side seams on every finger, the three stitched
  points on the back, a hem, broad leather creases at the joints), a pebbled leather grain tile, a lighter thread
  colour on the stitches, semi-gloss.
- Under the cuff the forearm stub is drawn in toward the wrist axis (up to 30 %), so a bent wrist cannot push skin
  through the cuff. It is never visible there.

**Sleeves**
- Oval cross-sections fitted to the wrist: shirt cuff 67.6 x 54 mm, jacket hem 75.6 x 60.4 mm tapering out to
  88 x 74 mm toward the elbow, both with a turned hem of real thickness. 13.5 mm of shirt cuff shows past the jacket.
- The jacket has soft ease folds above the hem and toward the elbow, and three horn buttons on the outer back of each
  Decide sleeve (none on the Range jacket: `buttons: false` in `js/range.js`).
- Herringbone tweed at real scale (32 mm tile, 8 mm stripes, 1.1 mm twill, sparse flecks) with a matching normal
  map; oxford shirting relief on the cuff with a topstitch line. Room sleeve and cuff colours are unchanged.
- The sleeve rolls with the wrist so the oval keeps to the forearm, its axis runs between the elbow line and the
  hand's own axis (70/30), and the cuff turns up to 8 degrees further toward the hand on a pivot at the hem.
- The watch moved onto the back of the left wrist just past the cuff (the cuff on that hand stops 9 mm higher);
  the strap is fitted to the wrist.
- At aim the right forearm drops more steeply (`js/main.js` ADS elbow offset, `js/range.js` `FORE_ADS`), and the
  Range support forearm comes in from further out (`SUP.elbow`).

Share of a 390 x 844 phone screen covered by sleeve plus cuff (rendered alone, white on black):

| view | before (v3) | after |
|---|---|---|
| Decide hip | 2.4 % | 1.8 % |
| Decide ADS | 16.9 % | 13.4 % |
| Range hip | 4.4 % | 3.8 % |
| Range ADS | 19.0 % | 14.9 % (left 5.7, right 9.2) |

## Maps

| file | size | what |
|---|---|---|
| `hand_left.glb` | 81,164 B | Draco mesh, 8,654 vertices, rig unchanged |
| `hand_right.glb` | 80,844 B | Draco mesh, 8,654 vertices, rig unchanged |
| `hand_albedo.webp` | 259,022 B | 2048, sRGB, the medium skin |
| `hand_nx.webp` | 232,028 B | 2048, relief slope along u |
| `hand_ny.webp` | 231,226 B | 2048, relief slope along v |
| `hand_orm.webp` | 205,908 B | 1024, occlusion, roughness, pigment weight |
| `hand_glove_nx.webp` | 40,886 B | 1024, glove relief slope along u |
| `hand_glove_ny.webp` | 41,424 B | 1024, glove relief slope along v |
| `hand_glove_st.webp` | 55,414 B | 1024, glove stitch mask |
| `hand_pores.webp` | 127,324 B | 512 tile (16 mm), skin micro relief |
| `hand_leather.webp` | 155,492 B | 512 tile (20 mm), leather grain |
| **total** | **1,510,732 B** | the old base64 module was 1,469,523 B |

Texel size on the hand: 0.22 mm.

## Sources and licences

- Hand meshes: MakeHuman / MPFB base mesh, CC0 (as before). No new third-party asset: every map, the tweed and the
  shirting are procedural. Nothing was downloaded for this pass.

## Frame cost

Synced frame (`composer.render()` plus a 1-pixel `readPixels`), 80 frames, median, 1170 x 2532, Chromium (desktop
GPU), old build (446e0f1) and new build alternated twice:

| view | before | after |
|---|---|---|
| hip | 3.55 ms | 3.45 ms |
| ADS | 3.55 ms | 3.85 ms (+8 %) |
| open cylinder | 4.10 ms | 3.95 ms |

## Rebuild

```
git show 446e0f1:js/hands-data.js > %TEMP%\hands-data.js
"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" -b --factory-startup --python tools/blender/build_hands.py -- --src %TEMP%\hands-data.js --out assets/models
npx @gltf-transform/cli@4 draco %TEMP%\roulette-hands-work\hand_left.raw.glb assets/models/hand_left.glb --quantize-position 14 --quantize-normal 10 --quantize-texcoord 14 --quantize-generic 12
npx @gltf-transform/cli@4 draco %TEMP%\roulette-hands-work\hand_right.raw.glb assets/models/hand_right.glb --quantize-position 14 --quantize-normal 10 --quantize-texcoord 14 --quantize-generic 12
```

The bake takes about 3 minutes (`--res 512` for a quick look). It is deterministic, so the meshes and maps always
agree. `MAP` in `js/hands.js` must match the tile sizes and slope range in the script.

Stills: `docs/shots/v4-hands/`.

## Still not real

- The shape is still the MakeHuman base hand: fingertips are a little blunt and round, there is no nail plate in the
  geometry (the nail is relief and colour), and the knuckles do not change shape when a finger bends.
- Creases are baked in the rest pose: they do not deepen when a finger curls, and the occlusion between fingers is a
  bind-pose bake, so fingers pressed together in a grip get no extra contact shadow beyond the shadow maps.
- No hair on the back of the hand or fingers, no fingerprint ridges you can see at phone size.
- The skin "scattering" is wrapped lighting, not subsurface transport; thin parts never glow red against a lamp.
- The glove is the hand shape in leather: no fullness at the fingertips, no wrinkles that follow a grip.
- The sleeve is a rigid tube between the cuff and the elbow line; it does not bunch at the elbow or sag.
