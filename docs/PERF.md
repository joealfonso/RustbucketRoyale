# Performance

## Budgets (starting guesses, replace with measured numbers)
| Item | Budget |
| :- | :- |
| Client frame rate | 60 fps on a mid-range laptop, integrated graphics acceptable |
| First load | game playable within 5 s on broadband, under 15 MB before the first match |
| Server tick | 30 Hz sim, 20 Hz snapshots (guess) |
| Rooms per server process | measure at M8 on the large tier with full bots, record here |
| Bandwidth per client | under 64 kbps |
| Map generation | under 3 s on small and medium, large number recorded here |
| Mech triangles, near LOD | 10k |
| Prop triangles | 300 to 2000 |
| Atlas | 2048 shared, 1024 per mech set |

## Measurements
Record each measurement with date, build, hardware, tier, bot count, and the number.

| Date | Hardware | Tier | Bots | Metric | Result |
| :- | :- | :- | :- | :- | :- |

### Map generation (2026-10-17, MacBook, Node 25, chunk set of 11 grey-box chunks)
Measured with `npx tsx scripts/measure-generation.ts`, 10 seeds per tier. Includes building the collision grid and navigation grid and checking the map.

| Tier | Seeds | Median ms | Worst ms | Boxes | Nav cells | Retries |
| :- | :- | :- | :- | :- | :- | :- |
| small | 10 | 4 | 7 | 320 | 22500 | 0 |
| medium | 10 | 41 | 43 | 3205 | 250000 | 0 |
| large | 10 | 160 | 166 | 12451 | 1000000 | 0 |

Well inside the 3 s budget. A browser will be several times slower than Node, still fine. Not measured yet: drawing 12,000 boxes on a mid-range laptop (one instanced mesh per colour, no culling), and how fast the collision grid answers with bots shooting.

### Delay (2026-10-17, localhost, in the built in browser)
| What | Before | After |
| :- | :- | :- |
| Other mechs shown behind the truth | 100 ms fixed | about 69 ms, grows with jitter (cap 200) |
| Hit check rewind | 150 ms fixed | ping plus view delay, capped at 250 ms |
| Body turn behind the camera | up to 750 ms for a half turn | none |
| Dash | up to 200 ms after the press | on the press |

Ping read 14 ms in the browser pane, which includes the pane's own timing. Still to measure on a real connection.

### Network and server cost with a full room of bots (2026-10-17, MacBook, Node 25)
One person in a running match, the other seats filled with bots to the tier's size. Measured with `npx tsx scripts/measure-bandwidth.ts`, 60 seconds each, person standing still. Bots far from the person run in the cheap mode.

| Tier | Bots | Down kbps (one person) | Snapshot bytes | Mean tick ms | 99th percentile ms | Worst ms |
| :- | :- | :- | :- | :- | :- | :- |
| small | 11 | 40 | 239 | 0.012 | 0.08 | 0.3 |
| medium | 23 | 53 | 327 | 0.033 | 0.46 | 2.0 |
| large | 39 | 63 | 387 | 0.178 | 1.96 | 8.3 |

Before the packed format and nearby-only updates the same rooms measured 272, 673 and 1279 kbps. The numbers move between runs because bots wander randomly: large is right at the 64 kbps budget when many bots happen to be near the person. Upstream, a client sends about 19 bytes per input (34 when shooting) 60 times a second, around 12 to 20 kbps. Server cost per room is tiny next to the 16.7 ms tick, so one process should hold many rooms, but that is not measured yet: next is a run with 20 rooms at once.

### Client frame cost (2026-10-17, MacBook, Claude browser pane, 60 Hz display)
Read from the new Performance readouts in the F1 panel. "Work" is the time spent on a frame before the GPU takes over, the headroom a locked 60 fps hides.

| Scene | Frame ms median / worst | Work ms median / worst | Draw calls | Triangles |
| :- | :- | :- | :- | :- |
| Large tier, 40 bots, 2 mechs in view | 16.7 / 17.8 | 0.5 / 1.2 | 17 | 206k |
| Arena, 8 mechs fighting, smoke and sparks | 16.7 / 17.7 | 0.5 / 1.5 | 65 to 76 | 4.5k |
| Large tier after V1b (toon look, outlines) | 16.7 / 17.7 | 1.0 / 1.9 | 31 | 419k |
| Large tier after V3a (junkyard dressing near you) | 16.7 / 18.7 | 1.2 / 2.9 | 69 | 623k |

The V1b row is after the toon look: outlines are a second, slightly bigger box drawn from the inside, so triangles and draw calls roughly double; work per frame went from 0.5 to 1.0 ms and it still holds 60 fps here. Nothing to fix on these numbers: the map is already one instanced mesh per colour, and the extra draw calls in a fight are smoke puffs. Not yet measured on a mid-range laptop: Joseph to read the panel there. Download: one 662 KB script, 172 KB gzipped, against a 15 MB budget.

### Soak: a whole match per tier (2026-10-17, MacBook, Node 25)
`npm run soak`. The room fills with bots, and three headless players join that act like browsers (packed messages, prediction, replay). Three runs per tier on random seeds, all passing:

| Tier | Match length | Tick 99th percentile | Worst tick | Per player | Worst prediction correction |
| :- | :- | :- | :- | :- | :- |
| small | 34 to 45 s | 0.08 to 0.12 ms | 1.8 ms | 41 to 42 kbps | 1.2 cm |
| medium | 392 to 404 s | 0.15 to 0.17 ms | 3.0 ms | 36 to 41 kbps | under 0.1 mm |
| large | 415 to 471 s | 1.11 to 1.12 ms | 7.8 ms | 38 to 41 kbps | under 0.1 mm |

The first runs failed bandwidth on large (91 to 97 kbps): knocked out players were sent the whole map. Fixed by sending a watcher only what is near the mech it watches. Small matches are short because 12 mechs on a 300 m map find each other fast.

With gate 6c (wreck looting and bots that loot), one run per tier: arena 39, small 54, medium 57, large 58 kbps per player, tick 99th percentile 0.07 / 0.06 / 0.27 / 1.13 ms, worst tick 7.9 ms on large, all passing. Bandwidth went up from about 50 because looted wrecks spill more pickups and every pickup near you rides in every snapshot. That is 6 kbps under the 64 budget: if it gets tighter, send pickups only when the nearby set changes.

With gate 7a one medium seed reached 65 kbps, so pickups are now sent only when the set near you changes. Two full soak runs after: arena 38 to 40, small 46 to 50, medium 39 to 51, large 42 to 51 kbps, worst prediction correction 1.2 cm, all passing. The 65 kbps seed (911727268) now measures 51.

### Rooms per server process (2026-10-17, MacBook, Node 25)
`npx tsx scripts/measure-rooms.ts`. Each room is mid match with two people walking and shooting and bots filling the rest. Server work only: the cost of packing and sending messages is not included.

| Tier | Rooms | Mechs | Mean ms per tick, all rooms | 99th percentile ms | Under 8 ms |
| :- | :- | :- | :- | :- | :- |
| medium | 10 | 240 | 0.40 | 2.19 | yes |
| medium | 20 | 480 | 0.88 | 3.33 | yes |
| medium | 40 | 960 | 1.69 | 5.14 | yes |
| large | 5 | 200 | 0.88 | 4.55 | yes |
| large | 10 | 400 | 1.78 | 7.29 | yes |
| large | 20 | 800 | 3.55 | 12.74 | no |

So roughly 40 medium rooms or 10 large rooms per process on this machine, keeping half the tick spare. A cloud core is usually slower than this laptop, so plan on about half that until it is measured on the real host.

### Bot counts from soak data (2026-10-17, MacBook, Node 25)
`npx tsx scripts/measure-bots.ts [seeds] [tiers]`, with `FILL=medium:28` to try a count. Each run is a whole soak match with three headless players. "Alone" is the share of a headless player's living time with no other mech within 150 m (radar range). Seeds 1000 and up.

| Tier | Fill | Seeds | Match s (median) | Knockouts a minute | Alone | First contact s |
| :- | :- | :- | :- | :- | :- | :- |
| arena | 8 | 6 | 58 | 11.9 | 0% | 0 |
| small | 12 | 6 | 78 | 10.1 | 2% | 0 |
| small | 8 | 6 | 52 | 8.2 | 25% | 0 |
| medium | 24 | 8 | 308 | 4.6 | 65% | 0 |
| medium | 28 | 8 | 311 | 5.4 | 52% | 0 |
| medium | 30 | 8 | 366 | 5.1 | 36% | 0 (2 of 8 over 64 kbps) |
| medium | 36 | 6 | 389 | 5.4 | 35% | 0 (2 of 6 over 64 kbps) |
| large | 40 | 6 | 435 | 5.5 | 78% | 40 |
| large | 56 | 6 | 444 | 7.4 | 76% | 28 |

Medium moves from 24 to 28: a quarter less time alone, inside the bandwidth budget on every seed. Bandwidth, not server time, is what stops it going higher. Small stays at 12: fewer bots made matches shorter, not longer, so its short matches come from how hard bots fight, not how many there are. Large stays at 40: 56 (every spawn) barely changes the loneliness, because 2000 m is simply a lot of ground, and it costs more. If large feels empty in play, the fix is the map or the ring, not more bots.

### Rooms per process with real WebSocket clients (2026-10-17, MacBook, Node 25)
`npx tsx scripts/load-test.ts [tier] [room counts]`. Starts the real server as its own process with `LOAD_STATS=1`, then connects two players per room over WebSocket, each walking, turning and shooting at 60 inputs a second; bots fill each room. Timings are the server's own, over 5 s after 15 s of settling, and include packing and sending every message. "Late start" is how far behind schedule a tick began: if it stays small, the game keeps time.

| Tier | Rooms | People | Mean ms per tick (all rooms) | 99th percentile ms | 99th percentile late start ms | kbps per person | p99 under 8 ms |
| :- | :- | :- | :- | :- | :- | :- | :- |
| medium | 5 | 10 | 1.37 | 5.34 | 1.35 | 29 | yes |
| medium | 10 | 20 | 1.54 | 5.23 | 1.37 | 31 | yes |
| medium | 20 | 40 | 2.51 | 5.91 | 1.48 | 31 | yes |
| medium | 40 | 80 | 4.06 | 7.90 | 1.60 | 34 | yes |
| medium | 50 | 100 | 5.01 | 8.86 | 5.89 | 35 | no |
| medium | 60 | 120 | 4.83 | 9.10 | 1.53 | 36 | no |
| large | 5 | 10 | 2.54 | 12.48 | 1.41 | 22 | no |
| large | 10 | 20 | 3.68 | 9.37 | 1.44 | 24 | no |
| large | 15 | 30 | 4.37 | 12.33 | 1.35 | 24 | no |
| large | 20 | 40 | 5.27 | 11.46 | 1.32 | 25 | no |

About 40 medium rooms per process on this laptop. Large has slow ticks (9 to 12 ms in the worst 1%) from 5 rooms up, yet ticks never start more than about 1.5 ms late and the average stays at 2.5 to 5 ms even with 20 rooms. So the process keeps up, but something on large spikes now and then. Profiled below. Until the rest is fixed, plan on 10 large rooms per process, and half these numbers on a cloud core.

#### Large tier slow ticks, profiled (2026-10-17)
`--trace-gc` and `--cpu-prof` on the server under `load-test.ts large 5`, plus timing every route search inside each slow tick. Garbage collection is not the cause: the young generation is swept every 100 to 200 ms but each sweep pauses only 0.1 to 0.4 ms. Route searches are: they are about three quarters of all room tick time on large, and every tick over 6 ms held 4 to 11 searches of 1 to 2 ms each. On the 250 by 250 cell search grid (40% blocked) a search looks at about 2000 cells, and 12% use the full 6000-cell cap, two thirds of those because the goal sits in a sealed pocket. Snapshot building did not show up. Two changes (see DECISIONS.md): at most one search per room per tick (`searchesPerTick` in `data/bots.json`), and goals in unreachable pockets are swapped for the nearest reachable cell.

Before and after, run alternately on the same afternoon. The laptop was busier than for the table above (late starts of about 2.4 ms rather than 1.4), so compare within this table only. 99th percentile ms per tick, three runs each:

| Rooms | Before | After |
| :- | :- | :- |
| 5 | 10.2, 11.9, 11.1 | 7.3, 6.9, 6.4 |
| 10 | 10.1, 7.1, 10.5 | 9.1, 7.3, 9.1 |
| 20 | 10.5, 15.1, 11.4 | 12.5, 9.1, 11.1 |

The spikes in a single room are gone: 5 rooms now fit 8 ms. From 10 rooms up it helps little. Each room can still run its one search on the same tick as every other room, so the worst tick grows with the number of rooms. What remains is plain search volume: bots replan every 2 s whether they need to or not. Doubling `replanSeconds` to 4 made no clear difference in a quick try, and spreading the searches over more rooms on one cache was not the issue either (one pathfinder and twenty used in turn cost the same, 0.38 ms a search). The next step would be cheaper searches, such as one shared route field to the ring centre per ring stage, or a coarser grid for long routes. Still plan on 10 large rooms per process.

### Junkyard dressing builds (2026-10-18, MacBook, Node 25, large map seed 5)
Timed outside the browser on the real map with the real builders. The first build of the 25 or so chunks within 120 m takes 110 ms, once, at spawn while the map is loading. Crossing into a new chunk costs 4 to 6 ms (the merge), because the chunks just beyond are built ahead, one per quiet frame, at up to 7 ms each. Before building ahead, a crossing cost 17 to 25 ms, a dropped frame every few seconds at a sprint.

### Walking mechs (2026-10-18, browser pane on the MacBook, large tier, 9 mechs in view)
Cutting the legs into thigh, shin and foot pieces adds draw calls: per mech at the nearest level of detail, Ironclad 40 to 60, Stiletto 46 to 76, Cataclysm 58 to 78, Arbiter 50 to 70 (counted in a test, every mesh plus its outline). The walk itself (gait, leg solve, footfalls for every mech within 120 m) is lost in the noise: work per frame read 2.5 to 2.8 ms with others walking and with them standing (`farMeters` 0), steady 60 fps, 150 to 320 draw calls depending on the view. The pane runs slower than the earlier 1.0 ms reading, so the number to trust is Joseph's laptop (F1, Performance). If draw calls bite, merge each joint's pieces that share a paint.

### Abilities and bandwidth (2026-10-18, soak, all tiers)
Snapshots grew for 9b: your own state carries the ability's time, cooldown and direction (self block 65 to 81 bytes) and each other mech one more byte (20 to 21). Soak: 44 kbps arena, 57 small, 59 medium, 47 large, against the 64 kbps budget. Medium and small are now within about 10% of it, so the next thing added to snapshots should pay for itself, for example by sending the ability fields only while they change.

### Environment pass (2026-10-19, large tier seed 7, F1 at spawn)
Sky, haze, ground and contact shadows (V6a): 127 to 130 draw calls, 4.78M to 4.81M triangles, work about 2.2 to 2.3 ms. Border barrier and backdrop (V6b): 130 to 153 draw calls, 4.81M to 4.92M triangles. Frame times were read in a hidden browser pane, which throttles frames, so they are not trustworthy; the number to trust is Joseph's laptop on large (F1, Performance).

### Performance and size pass (2026-10-19, MacBook Air M4 10-core, 16 GB, Node 25.6, Chrome 155 headless)
Method. Client: the production build served by `vite preview`, driven over the Chrome DevTools Protocol in headless Chrome at a fixed 1600 x 900 window (device pixel ratio 1, Metal through ANGLE). "Uncapped" runs Chrome with vsync and its frame cap off, so frames per second give the true cost of a frame (CPU and GPU together); a locked 60 fps hides it. Draw calls and triangles are counted by wrapping the WebGL draw calls. Parts of the scene were hidden one at a time to find the GPU cost of each. Allocations: CDP heap sampling with garbage included. Server: `scripts/measure-rooms.ts` and `npm run soak` on fixed seeds, old and new code run alternately on the same afternoon (the laptop was busy with other agents, so compare within these tables only). The scripts live outside the repo except `scripts/measure-dressing.ts`.

**Download** (`npm run build`, sizes gzip -9 / brotli -q11):

| What | Before | After |
| :- | :- | :- |
| JS loaded at start (4 files, then 5) | 942 kB, 266 kB gz, 211 kB br | same bytes; three.js now its own 636 kB (160 kB gz) file |
| JS a returning player re-fetches after a game update | all 266 kB gz | about 107 kB gz (three stays cached) |
| Fonts in the build | 91 kB woff2 + 93 kB woff never used | 91 kB woff2 |
| Fonts fetched at start | 56 kB woff2 | same |
| Mech models fetched at start (all four roster glbs) | 900 kB raw, 156 kB gz, 86 kB br | same (see recommendations) |
| Whole build | 2220 kB raw, 646 kB gz | 2129 kB raw, 554 kB gz |
| First load transfer measured (uncached, preview server gzips JS but not glb) | 1222 kB | 1223 kB |

What is in the JS: three.js is 610 kB of the 942 (its own code plus 140 kB of shader text), GLTFLoader 42 kB, lil-gui 19 kB, game code about 190 kB, data JSON inlined about 30 kB. The title screen hangar (24 kB) already loads only on the title screen. The 500 kB chunk warning was three.js itself, which cannot be split; the limit is now 700 kB.

**Client frame cost, offline large tier, three seeds at spawn** (uncapped ms per frame, draw calls, triangles):

| Seed | Before | After |
| :- | :- | :- |
| 7 | 4.4 to 5.5 ms, 137 calls, 4.91M | 2.3 to 3.2 ms, 137 calls, 0.62M |
| 11 | 7.0 to 7.7 ms, 151 calls, 8.20M | 3.3 to 4.0 ms, 129 calls, 2.91M |
| 23 | 6.9 to 8.2 ms, 151 calls, 8.04M | 3.6 to 5.0 ms, 129 calls, 2.71M |

Where it went: hiding parts of the scene showed the breakable props were 43% of a large-tier frame (5.1 ms with them, 2.9 without): every crate, junk pile and barrel on the whole 2 km map, about 5,300 of them at 100 to 180 triangles plus an outline each, was drawn every frame, because three's culling sphere for an instanced mesh covers all its instances. Now only props inside the camera's view are packed into the instance buffers each frame (`propView.ts`). Screenshots of the three seeds before and after are byte for byte identical. CPU work per frame (F1) stays 0.6 to 0.7 ms median on large; the M4 holds 60 fps either way, so the gain is headroom for a mid-range laptop's GPU, roughly 1.8 to 2.1 times as many frames for the same work.

Garbage per frame on large fell from 154 kB to 35 kB: one material drawn by both instanced and plain meshes (the map's world colours, outlines) made three look its shader program up again at every switch, dozens of times a frame. Instanced meshes now get their own copy (`toon.instanced`). The rest is inside three (uniform uploads, fog colour conversion). Style recalculation is one per frame at about 0.07 ms; layout almost never; DOM writes are not a cost.

Busy online arena (8 mechs fighting, `?create&tier=arena&bots=7`): 3.5 to 4.7 ms uncapped before and after, 150 to 400 draw calls, 0.25M triangles; F1 work 1.5 ms median, 4.5 worst. Top JavaScript: three's `updateMatrixWorld` and `multiplyMatrices` (0.36 ms a frame together, mechs are many parts), then the render list.

**Spectator camera cuts** (`npx tsx scripts/measure-dressing.ts [tier] [seed]`, dressing and edge wall only, seed 7, eight cuts, Node):

| Tier | Frame of the cut, median / worst, before | After | Sprinting corner to corner, worst frame before / after |
| :- | :- | :- | :- |
| medium | 58 / 74 ms | 0.03 / 3.7 ms (worst frame of the catch-up 9.7) | 14.0 / 10.1 ms |
| large | 69 / 92 ms | 0.05 / 5.7 ms (worst frame of the catch-up 11.4) | 13.1 / 11.3 ms |

A cut needed 20 or so dressing chunks and the near edge wall built in one frame. Now, when more than `buildAtOnce` chunks are missing (data/dressing.json, data/backdrop.json barrier), they are built one per frame and the plain boxes or far wall quads stand in for the third of a second until all are ready. Walking is unchanged: two or fewer missing chunks still build at once.

**Server.** Route search (`Pathfinder.ts`): the heap now lives in a typed array and moves a hole instead of swapping through throwaway arrays, and the search loop reads locals. On 2000 random searches over two large maps the routes are identical to the old code, and a search takes 0.43 to 0.49 ms instead of 0.51 to 0.61 (about 19% less). `measure-rooms.ts`, 20 large rooms, alternating: mean 5.06 to 5.55 ms per tick and 99th percentile 15.5 to 18.9 before, 3.95 to 4.34 and 12.3 to 13.7 after. The current full table, before this change (medium now fills to 28, so 40 medium rooms is 1120 mechs):

| Tier | Rooms | Mechs | Mean ms per tick, all rooms | 99th percentile ms | Under 8 ms |
| :- | :- | :- | :- | :- | :- |
| medium | 10 | 280 | 0.45 | 1.68 | yes |
| medium | 20 | 560 | 0.85 | 3.23 | yes |
| medium | 40 | 1120 | 2.09 | 9.49 | no |
| large | 5 | 200 | 0.78 | 3.37 | yes |
| large | 10 | 400 | 1.69 | 6.18 | yes |
| large | 20 | 800 | 4.24 | 14.63 | no |

A CPU profile of 20 large rooms: route searches are still about 80% of tick time. Half of the whole run was map generation (`validateMap`'s flood fill), which runs on the main thread when a room starts a match, so every other room in the process waits for it (about 160 ms on large in the map generation table above).

**Bandwidth.** Your own state was 20 float32s in every snapshot even though about half are 0 most of the time (dash and ability timers and directions, regen timers, vertical speed on the ground). A 3-byte mask now says which are sent; only exact +0 is left out, so prediction replays from the same numbers. Soak on the same seed (911727268, identical matches), kbps per player:

| Tier | Before | After |
| :- | :- | :- |
| arena | 45 | 38 |
| small | 55 | 50 |
| medium | 50 | 44 |
| large | 36 | 30 |

Medium seed 77 failed the soak at 67 kbps before and passes at 61 after. A full `npm run soak` after: arena 41, small 55, medium 41, large 39 kbps, all passing.

**Still to do, ranked by gain for the effort** (owner in brackets):
1. Serve `.glb` compressed, or quantise the mech models. The four roster models are 900 kB of the 1.2 MB first load when the host does not compress them (many do not for `model/gltf-binary`): brotli makes them 86 kB, gzip 156 kB. A host setting, no code. Failing that, `KHR_mesh_quantization` in the mech build scripts halves them raw with no loader change; meshopt or Draco would need a decoder. [deploy, then `scripts/mechs/`]
2. Generate maps off the main thread on the server. A large map takes about 160 ms and stalls every room in the process at each match start: a worker thread, or generating the next map during the results screen in a worker. [server, `Room.beginCountdown`]
3. Cheaper route searches for large rooms (one route field to the ring centre per ring stage, or a coarse grid for long routes): searches are 80% of a large room's tick, the limit on large rooms per process. [server, `Pathfinder.ts`, `Bot.ts`] Done, see "Cheaper route searches" below.
4. Props past about 150 m drawn as plain boxes or not at all: even culled, a view across the map still sends 2.3 to 2.9M triangles, nearly all distant props a few pixels tall. Changes the look slightly far away, so it needs Joseph's eye. [`propView.ts`]
5. `matrixAutoUpdate = false` on everything that never moves (map, dressing, props, backdrop, wall): `updateMatrixWorld` is the top JavaScript cost in a fight. Small, safe. [`main.ts` and the builders]
6. Merge each remote mech's leg pieces per paint: a fight is 150 to 400 draw calls, mostly mech parts and their outlines. [`mechModel.ts`, `legRig.ts`]
7. Load lil-gui and the debug panel on the first F1: 19 kB (6 kB gz) off the start. Small gain. [`main.ts`, `debugPanel.ts`]
8. On the developer's disk only: `Library/` and `Logs/` in the repo folder are the Unity prototype's editor caches, 1.3 GB, ignored by git. Safe to delete when not working on the `unity-prototype` branch. [Joseph]

### Roster mech models quantised (2026-10-19, recommendation 1 of the performance pass)
`KHR_mesh_quantization` in the glb writer (`writeGlb(nodes, { quantize: true })`, used by the four roster scripts): positions as normalized 16-bit integers with each part's offset and one scale on its node, normals as 8-bit, indices 16-bit as before. 24 bytes per vertex become 12. Three's GLTFLoader reads it with no decoder. 8-bit positions were measured and dropped: only 12 of the 99 roster meshes are small enough to stay under 1 mm.

| Model | Raw before / after | gzip -9 before / after | brotli -q11 before / after |
| :- | :- | :- | :- |
| Ironclad | 221 / 132 kB | 34.5 / 28.4 kB | 17.5 / 17.5 kB |
| Stiletto | 203 / 123 kB | 36.6 / 30.1 kB | 21.7 / 19.1 kB |
| Cataclysm | 314 / 189 kB | 54.1 / 43.2 kB | 26.3 / 25.8 kB |
| Arbiter | 183 / 113 kB | 30.9 / 25.2 kB | 20.7 / 16.7 kB |
| All four | 921 / 556 kB (-40%) | 156 / 127 kB (-19%) | 86 / 79 kB (-8%) |

On a host that does not compress glb the first load drops by about 365 kB (1223 kB measured before, so about 860 kB; worked out, not measured). Compression still beats quantisation alone (79 kB brotli against 556 kB raw), so serving glb compressed stays worth doing.

Accuracy, checking every part, state, level of detail and leg piece the game builds from the old and new files (scratch script, not in the repo): worst vertex 0.033 mm off, worst normal 0.35 degrees, part bounds within 0.03 mm. Leg pieces (the walk's cut at the joints) have the same vertex counts, and the Fx, Mount_Gun and Joint_* nodes are untouched. Hit boxes (`make-hitboxes.ts`, rounded to the centimetre): one value of 97 boxes moved, Cataclysm's first torso box centre z 0.03 to 0.02, a true 0.025 that now rounds the other way. Screenshots of style.html keys 4 and 6 before and after differ only in smoke and sparks and in single outline pixels.

### Match maps built on worker threads (2026-10-19, recommendation 2 of the performance pass)
`MapPool` keeps two worker threads (`MAP_WORKERS`, 0 builds on the main thread as before) that run `generateMap` from the same data files and send the map back as flat arrays (boxes and props as Float64Array, the nav grid's heights, which-prop-is-this-box), moved rather than copied; the main thread rebuilds the box objects and the World's lookup grid, about 2 ms on large. A room asks for its next map when it opens and when results begin, and starts the countdown once it is there; if it is not, the lobby or results screen holds and the room keeps ticking. The worker's map equals the main thread's, checked field by field for three seeds on every tier (`MapPool.test.ts`).

`npx tsx scripts/measure-rooms.ts starts large 10`: ten large rooms with bots ticking in real time, hosts pressing start one room every half second. Work is one frame's starts plus a tick of every room; late is how far behind its time a frame began. Two runs each, alternating, the laptop busy with other agents:

| Tier | Rooms | Map workers | Worst frame work ms | 99th percentile work ms | Worst late start ms | Longest wait for a map |
| :- | :- | :- | :- | :- | :- | :- |
| large | 10 | 0 (before) | 390 to 450 | 195 to 224 | 376 to 434 | none |
| large | 10 | 2 | 14 to 18 | 4.7 to 5.2 | 15 to 22 | none |
| medium | 10 | 0 (before) | 105 | 51 | 90 | none |
| medium | 10 | 2 | 6.0 | 3.1 | 4.0 | none |

The worst frame left with workers is the rest of a match start (path finder, bots, spawns) plus the occasional garbage collection. No start had to wait: maps asked for at the lobby or results are ready long before anyone presses start.

`npx tsx scripts/load-test.ts large 10` (real server and WebSocket clients, which make each room and press start at once; the new column is the worst late tick over the whole step, while rooms were being made and started): 549 ms before, 363 ms with workers. What is left is making a room: its lobby map is still built on the main thread when the first person arrives (about 200 ms on large), because the room needs it to place them. Moving that too means joining a new room asynchronously in `RoomManager` and the transport; done since, see "New rooms prepared on the map workers" below.

### Cheaper route searches (2026-10-19, recommendation 3 of the performance pass)
Measured first, by counting every route search in 10 large rooms (`measure-rooms.ts` conditions, 30 s) and in a whole large soak match, by what the bot was heading for and why it searched. The ring was not the problem: no search in the first 30 s and 5% of a whole match's were for the ring centre, so a shared route field to it would have saved almost nothing. 98 to 99% of search time was wander goals (a random spot in the ring, kept 12 s), and 80% was the 2 s replan clock finding the same route again on a map that never changes. The rest was long searches: 6% of routes used the whole 6000-cell cap and stopped short, and those were replanned on the clock at about 0.9 ms each.

Two changes (see DECISIONS.md). The clock now replans only a bot that has been pushed off its route (it cannot walk straight to its next waypoint on the search grid) or is on the last leg of a route that stopped short; a new goal, a goal that moved, or no route still search at once, as before. And the search leans on its estimate of the distance left (`heuristicWeight` 1.5 in `data/bots.json`, 1 is the old exact search). 600 random searches on each of three large maps (seeds 5, 7, 11), weight 1 against 1.5: mean 0.33 to 0.10 ms, 99th percentile 0.95 to 0.35 ms, slowest 1.8 to 0.5 ms, routes that reach the goal 94% to 100%, routes 3% longer on average (worst 25%, a different side of a building). Bots behave the same: soak on four seeds, every tier passes with the same knocked-out counts and match lengths within the usual spread (large 418 to 446 s before, 424 to 452 after; medium 332 to 404 before, 285 to 399 after).

Searches in 10 large rooms over 30 s: 6270 taking 2470 ms before, 1750 taking 640 ms with the clock change alone, 1700 taking 220 ms (0.13 ms each) with the weight too. In a whole large soak match (seed 5), 4284 searches before and 1129 with the clock change.

`measure-rooms.ts` (worst tick added in a scratch copy), large, two runs each, alternating, the laptop busy with other agents:

| Rooms | Mechs | Mean ms per tick before | After | 99th percentile ms before | After | Worst tick ms before | After |
| :- | :- | :- | :- | :- | :- | :- | :- |
| 10 | 400 | 1.61, 1.70 | 0.46, 0.40 | 5.50, 5.69 | 2.16, 1.91 | 7.8, 8.0 | 3.3, 2.9 |
| 20 | 800 | 3.21, 3.29 | 0.80, 0.76 | 10.32, 10.60 | 3.99, 3.88 | 19.3, 13.3 | 5.0, 4.6 |
| 30 | 1200 | 4.91, 5.03 | 1.11, 1.13 | 15.02, 15.52 | 5.74, 5.63 | 19.1, 18.5 | 6.8, 6.5 |
| 40 | 1600 | 6.78, 6.50 | 1.61, 1.56 | 21.00, 20.13 | 7.90, 7.82 | 25.2, 22.9 | 9.1, 9.0 |

Medium, one run: 40 rooms 2.10 to 1.48 ms mean, 99th percentile 5.64 to 3.43.

`load-test.ts large 10,20,30` (real server, WebSocket clients), two runs each, alternating, mean / 99th percentile ms: 10 rooms 2.84 / 7.85 and 3.39 / 7.44 before, 1.57 / 4.06 and 1.81 / 4.96 after; 20 rooms 3.87 / 7.06 and 3.86 / 8.47 before, 2.64 / 5.62 and 2.33 / 5.35 after; 30 rooms 4.96 / 8.31 and 5.06 / 10.99 before, 3.25 / 6.10 and 2.79 / 5.29 after. Late starts stayed at 2.2 to 2.6 ms throughout. `npm run soak` large tick 99th percentile: 0.86 to 1.02 ms before, 0.14 to 0.26 after.

Route searches no longer limit large rooms. Plan on about 30 large rooms per process on this laptop (it was 10), keeping the 8 ms budget with the real server, and half that on a cloud core until it is measured there. Medium stays at about 40.

### New rooms prepared on the map workers (2026-10-19)
A new room's lobby map is now built on the map workers too. `RoomManager` takes the code, asks the pool for the map and keeps the room as "preparing": the joining socket is held with no welcome yet (the client already says "Connecting..."), anyone else using the code waits in line behind it, and when the map arrives the room is made (about 2 ms to rebuild the World, plus the room's own setup) and everyone in line is welcomed in order. A failed map retries with a new seed, and after three failures everyone waiting is refused with a reason. A room everyone gave up on is dropped and its map thrown away. Without workers (`MAP_WORKERS=0`, tests, the range) rooms are made on the spot as before.

`npx tsx scripts/measure-rooms.ts starts large 10`, which now makes each room through the `RoomManager` (one every half second) and has its host press start as soon as they are in; `LOBBY_ON_MAIN=1` builds the lobby map on the main thread, as before. Match maps on 2 workers in both. Two runs each, alternating:

| Tier | Rooms | Lobby maps | Worst frame work ms | 99th percentile work ms | Worst late start ms | Longest from making to countdown ms |
| :- | :- | :- | :- | :- | :- | :- |
| large | 10 | main thread (before) | 286, 245 | 183, 177 | 275, 229 | 567, 433 |
| large | 10 | workers | 7.5, 6.1 | 3.5, 3.7 | 13.2, 7.3 | 600, 550 |
| medium | 10 | main thread (before) | 72 | 49 | 57 | 167 |
| medium | 10 | workers | 4.1 | 2.2 | 3.0 | 167 |

`npx tsx scripts/load-test.ts large 10`, worst late tick over the step while rooms were made and started: 357 and 189 ms before, 8 and 25 ms after; tick mean and 99th percentile unchanged (1.27 / 3.07 to 3.31 before, 1.14 to 1.23 / 2.17 to 2.54 after). A new large room now takes a few tenths of a second longer to welcome its first player, since its map waits behind any other builds in the pool; nobody else pays for it.
