# DESIGN.md: Rustbucket Royale

## Vision
Scrappy mechs duct taped together in an overgrown junkyard. Funny, chunky, readable. If a design choice makes the game look cooler but harder to read, readability wins.

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
Player accent colors must contrast with both moss green and rust orange. Enemy and player mechs must be told apart at 150 m by silhouette and accent, never by guessing hues.

## Shapes
Chunky, simplified, big readable masses. Exaggerate joints, feet, and weapons. Every mech has a unique silhouette feature (antenna, shoulder plate, tank) that survives at distance. Avoid thin details that vanish at 50 m.

## Avoiding AI tells
Every detail has a job you can state in one sentence. A vent has an intake behind it, a cable runs from a source to a destination, a bolt holds two parts together.
Detail density is uneven on purpose: big calm shapes, a few focused details.
Parts have visible seams, hinges, and panel breaks. No melted blends.
Surfaces are flat toon bands with visible brush marks. No gloss, airbrush gradients, or baked lighting.
No gibberish text. Use none, or real text hand set in the chosen fonts. Pick one licensed monospace font for the HUD and one stencil or hand lettered font for decals, and record both here.
Chosen fonts (2026-10-17): HUD, IBM Plex Mono (SIL Open Font License). Decals, Big Shoulders Stencil (SIL Open Font License). Both get a row in docs/ASSETS.md when their files enter the repo.
Banned looks: teal and orange grading, neon rim glow, purple to blue gradients, god rays, lens flare, bokeh, hex grid decoration, glowing eye visors, glass cards, soft glow panels, stock icon packs, emoji icons.
Wear follows logic: rust where water pools, scuffs where parts rub, chips along edges.
Each mech is built from named junk, shows its repairs, and has a backstory line in docs/MECHS.md. Asymmetry needs a reason (a patch, a swapped part), never randomness.
Every hero asset starts as hand drawn thumbnail silhouettes.
Review test: show a screenshot to someone who hasn't seen the game and ask what looks off. If they say AI, find the tell.

## Shading
Toon ramp with 3 bands plus a rim light. One master toon material for everything, with shared ramp and outline settings. Outline: consistent width, thinner on far LODs, color tinted from the base color, never pure black. No imported PBR materials ship.

## Textures
One shared 2048 atlas for props and chunks, 1024 per mech set. Painted brush marks, rust streaks, and tape or patch details live in the atlas. Vertex color adds variation. No unique per asset textures except hero mech sets.

## Mech anatomy and damage
Parts: legs, arms, torso, jets, sensor, weapon mounts. States per hit zone: intact, damaged, broken.
Damaged: dents, sparks at intervals, light smoke.
Broken: missing or bent part, heavy smoke or leaking fluid, silhouette clearly changes.
A mech with a broken leg must be recognizable at 150 m.

## World kit
Chunks: buildings, ruins, cover clusters, open ground, all on the shared atlas with matching edges. Props have intact and destroyed versions with identical footprints. Overgrowth is painted into the atlas and added with simple card meshes, not heavy foliage.

## Lighting
One warm key light, cool soot shadows, soft fog for depth. Shadows near range only if the budget needs it. The zone ring is the only magenta in the world.

## HUD
Chunky retro CRT terminal. Amber on soot, bold monospace, rectangular panels. CRT post effect has an intensity slider and an off switch. Never rely on color alone for warnings. Mech damage diagram is always on screen.

## VFX
Hand painted flipbooks and simple meshes. Pooled, capped by data file values, with a low setting. Sparks and smoke are the main language of damage.

## Asset intake checklist
1. Source and license logged in docs/ASSETS.md, including how AI was used, if at all.
2. Retopo to budget (mech 10k, props 300 to 2000 triangles).
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
Ship imported materials. Ship AI geometry or textures unmodified. Use AI generated models for hero mechs. Add thin detail that disappears at distance. Use magenta anywhere except the zone ring. Add realistic particles.

## Budgets
Starting guesses until M1 and V1 profiling replace them: 60 fps mid-range GPU, host holds 60 fps with 40 bots on the large tier.
