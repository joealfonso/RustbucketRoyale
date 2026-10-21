# DESIGN.md: Rustbucket Royale

## Vision
Shiny, freshly painted mechs drop into an overgrown junkyard, and the ones that survive leave as rustbuckets. Every hit strips paint to rust, plates fall off, parts smoke, and by the end of a match you can read each mech's whole fight on its body. Funny, chunky, readable. If a design choice makes the game look cooler but harder to read, readability wins.

## Palette (starting values, verify in engine at 10 m, 50 m, 150 m)
- Rust orange: #C4622D
- Deep rust: #7A3B1E
- Moss green: #5E7F3A
- Dark moss: #3B5230
- Scrap steel: #6E7B80
- Soot: #2A2F2E
- Warm light: #F2E3C0
- Spark yellow: #FFC93C
- Zone magenta: #E83F8B (used only for the zone ring)
- HUD amber: #FFB000 on soot, warning red #FF4D3D
- Mech paint (clean, before any damage): each mech wears its own factory scheme from `docs/MECH_ROSTER.md` (Ironclad-IV dark grey with yellow and black hazard stripes, Stiletto-B blue and white urban camouflage, Cataclysm tan and rust-brown desert camouflage, Arbiter polished white with teal). On top of that, each pilot gets one accent colour as a small marking (a shoulder band or a stripe), so two of the same mech can be told apart. Clean factory paint against a rust and moss world is what makes a fresh mech pop and a hurt one sink into the junk.
Player accent colors must contrast with both moss green and rust orange. Enemy and player mechs must be told apart at 150 m by silhouette and accent, never by guessing hues.

## Shapes
Chunky, simplified, big readable masses. Exaggerate joints, feet, and weapons. Every mech has a unique silhouette feature (antenna, shoulder plate, tank) that survives at distance. Avoid thin details that vanish at 50 m.

## Avoiding AI tells
These rules are about how the game looks and reads: menus, HUD, UI systems and visual design patterns. They do not ban AI-made models; those follow the asset intake checklist like any other model.
Every detail has a job you can state in one sentence. A vent has an intake behind it, a cable runs from a source to a destination, a bolt holds two parts together.
Detail density is uneven on purpose: big calm shapes, a few focused details.
Parts have visible seams, hinges, and panel breaks. No melted blends.
Surfaces are flat toon bands with visible brush marks. No gloss, airbrush gradients, or baked lighting.
No gibberish text. Use none, or real text hand set in the chosen fonts. Pick one licensed monospace font for the HUD and one stencil or hand lettered font for decals, and record both here.
Chosen fonts (2026-10-19, replacing IBM Plex Mono): HUD, three faces, all SIL Open Font License and self-hosted from npm (@fontsource): Chakra Petch (500, 700) for words, labels and headings; Share Tech Mono for every number and small key caps; Barlow (400, 600) for running text in menus and results. Decals, Big Shoulders Stencil (SIL Open Font License). Each has a row in docs/ASSETS.md once its files enter the repo. In the client they are CSS tokens (--hud-word, --hud-num, --hud-body) in packages/client/src/hud.css, with the colours (--hud-amber, --hud-amber-dim, --hud-soot, --hud-panel, --hud-warn, --hud-text).
Banned looks: teal and orange grading, neon rim glow, purple to blue gradients, god rays, lens flare, bokeh, hex grid decoration, glass cards, soft glow panels, stock icon packs, emoji icons.
Allowed on mechs (from the roster designs): glowing sensors and visors, and small emissive energy accents on weapons, conduits and drones, in each mech's own colours. They are flat emissive toon colour, never a bloom halo or a rim glow round the whole mech. A mech's sensor goes dark when its torso breaks, which makes a destroyed mech read at a glance.
Allowed in the hangar only (the title screen, Joseph's call 2026-10-19): the Aegis Dynamics development hangar from docs/MECH_ROSTER.md may have its hexagonal floor grid, glowing yellow-orange light strips and blue holographic schematic displays. It is the clean factory the mechs leave from, so its high-tech look is the contrast to the junkyard. These stay out of the match world. No full-screen bloom pass, which costs too much for a menu.
Wear follows logic: rust where water pools, scuffs where parts rub, chips along edges.
Each mech is a factory machine from Aegis Dynamics that arrives clean and leaves the match a rustbucket. It has a backstory line in docs/MECHS.md. Asymmetry needs a reason (a shield arm, a weapon arm, an electronics mast), never randomness.
Every hero asset starts as hand drawn thumbnail silhouettes.
Review test: show a screenshot to someone who hasn't seen the game and ask what looks off. If they say AI, find the tell.

## Shading
Toon ramp with 3 bands plus a rim light. One master toon material for everything, with shared ramp and outline settings. Outline: an even width on screen near and far (thinning past a set distance), color tinted from the base color, never pure black. At the high effects quality, thin crease lines mark panel seams and folds inside the silhouette, in the surface's own darkened color, fading out with distance. No imported PBR materials ship.

## Textures
One shared 2048 atlas for props and chunks, 1024 per mech set. Painted brush marks, rust streaks, and tape or patch details live in the atlas. Vertex color adds variation. No unique per asset textures except hero mech sets.

## Mech roster
The four launch mechs (Ironclad-IV, Stiletto-B, Cataclysm, Arbiter) and the hangar are described in `docs/MECH_ROSTER.md`. Where those designs clash with this file, they are listed there under Open questions, and this file wins until they are settled.

## Mech anatomy and damage
Parts: legs, arms, torso, jets, sensor, weapon mounts. States per hit zone: intact, damaged, broken.
Rust: as a zone loses hit points its paint is eaten away to rust in hard-edged toon patches with a dark rim, from a few spots to most of the part when broken. It is a shader effect on the master material, so every model gets it with no extra art.
Damaged: rust, dents, sparks at intervals, light smoke.
Broken: missing or bent part, heavy smoke or leaking fluid, silhouette clearly changes.
A mech with a broken leg must be recognizable at 150 m.

## World kit
Chunks: buildings, ruins, cover clusters, open ground, all on the shared atlas with matching edges. Props have intact and destroyed versions with identical footprints. Overgrowth is painted into the atlas and added with simple card meshes, not heavy foliage.

## Lighting
One warm key light, cool soot shadows, soft fog for depth. Shadows near range only if the budget needs it. The zone ring is the only magenta in the world.

## HUD
Chunky retro CRT terminal. Amber on soot, bold squared type with monospace numbers, rectangular panels with one clipped corner. CRT post effect has an intensity slider and an off switch. Never rely on color alone for warnings. Mech damage diagram is always on screen.

## VFX
Hand painted flipbooks and simple meshes. Pooled, capped by data file values, with a low setting and a high setting that adds crease lines. Sparks and smoke are the main language of damage.

## Asset intake checklist
1. Source and license logged in docs/ASSETS.md, including how AI was used, if at all.
2. Retopo to budget (mech 15k, props 300 to 2000 triangles).
3. Unwrapped to the shared atlas.
4. Master toon material assigned, original materials removed.
5. Palette and outline match checked next to the reference mech at 10 m and 150 m.
6. Pivot, scale, and naming follow conventions (Mech_Leg_L_Intact, Prop_Barrel_Destroyed).
7. Damage states and destroyed variants have identical footprints and pivots.
8. LODs exist and pass a perf check on the large tier.
9. Passes the Avoiding AI tells review: every detail has a stated job, wear has logic, no text artifacts, silhouette came from a hand drawn thumbnail.

## Do
Keep silhouettes strong. Reuse the atlas. Show damage on the model. Check every new asset next to the reference mech.

## Do not
Ship imported materials. Add thin detail that disappears at distance. Use magenta anywhere except the zone ring. Add realistic particles.

## Budgets
Starting guesses until M1 and V1 profiling replace them: 60 fps mid-range GPU, host holds 60 fps with 40 bots on the large tier.
