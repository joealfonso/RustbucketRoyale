# Style test (V1)

Screenshots of `style.html` (run `npm run dev`, open http://localhost:5173/style.html, keys 1 / 2 / 3), taken in the Claude browser pane at 800 × 600. Left to right in each: your mech (blue accent), someone else (bone accent), someone with broken legs. Behind them, the "containers" chunk; in front of it, a crate, a junk pile and a barrel.

| Distance | Screenshot | What to judge |
| :- | :- | :- |
| 10 m | ![10 m](v1a-10m.jpg) | Bands, outline width and colour, rim, palette next to each other |
| 50 m | ![50 m](v1a-50m.jpg) | Can you still tell your mech, someone else and the broken one apart? |
| 150 m | ![150 m](v1a-150m.jpg) | At this size the mechs are a few pixels tall. Grey boxes cannot pass DESIGN.md's "broken leg recognisable at 150 m" by shading alone: that needs the real silhouettes (V2) and is worth checking on your bigger screen. |

Thumbnails: three paper silhouettes of the first mech go here (`thumb-1.jpg` ...), with the chosen one marked, before any Blender work. Joseph draws these.

## V1b: the look across the game

| Where | Screenshot | Notes |
| :- | :- | :- |
| Small tier, lobby, looking away from the sun | ![small](v1b-small-in-game.jpg) | Facing away from the key light everything sits in the darker bands, so it reads dim. Band brightness and light strength are in `data/look.json`. |
| Large tier with the F1 panel | ![large](v1b-large-with-panel.jpg) | 31 draw calls, 419k triangles, 1.0 ms of work a frame, 60 fps (browser pane). Outlines doubled the triangles, as expected. |

## V2a: the mech kit pipeline, with the stand-in

On `style.html` the stand-in kit mech stands in front of the others; D steps it through whole, damaged, arms broken, legs broken. In the game, add `&kit=standin` to a room link.

| What | Screenshot |
| :- | :- |
| Kit mech (left edge) with damaged arms: the dented arm part | ![damaged](v2a-kit-arm-damaged.jpg) |
| Arms broken: the stub part | ![broken](v2a-kit-arm-broken.jpg) |
| In a match with `&kit=standin`: jets on the back, sensor on top | ![in game](v2a-kit-in-game.jpg) |

## V2b: clean to rust

Mechs start in clean paint (white, navy frame, a pilot accent) and rust as they are hurt. Behind, left to right: you (clean), then 75%, 40%, 15%, then arms and legs broken. In front: the stand-in kit mech, clean.

| Distance | Screenshot |
| :- | :- |
| 10 m | ![10 m](v2b-clean-to-rust-10m.jpg) |
| 50 m | ![50 m](v2b-clean-to-rust-50m.jpg) |

To judge: the red accent for other pilots sits close to rust orange once a mech is rusty. A cooler accent (teal, yellow) may separate better.

## V2c: the first roster

Four mechs from Joseph's brief, each built by a script in `scripts/mechs/` from low-poly shapes: Ironclad-IV (brawler), Stiletto-B (flanker), Cataclysm (four-legged artillery), Arbiter (dome and drones). On `style.html` press 4; in a game add `&kit=roster` and each player gets one by player number.

| What | Screenshot |
| :- | :- |
| The roster, left to right: Ironclad-IV (blue: as you), Stiletto-B, Cataclysm, Arbiter | ![roster](v2c-roster.jpg) |
| Closer, from the side | ![close](v2c-roster-close.jpg) |
| In a match as Stiletto-B | ![in game](v2c-stiletto-in-game.jpg) |

To judge: the game still adds its own weapon-coloured barrel at each gun mount, which doubles up on mechs whose gun is modelled.

