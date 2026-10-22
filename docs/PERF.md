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
| Mech triangles, near LOD | 15k (raised from 10k on 2026-10-20, measured below) |
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

About 40 medium rooms per process on this laptop. Large has slow ticks (9 to 12 ms in the worst 1%) from 5 rooms up, yet ticks never start more than about 1.5 ms late and the average stays at 2.5 to 5 ms even with 20 rooms. So the process keeps up, but something on large spikes now and then. Profiled below. Since fixed: see "Cheaper route searches" below, which brings 20 large rooms under 8 ms. Plan on half these numbers on a cloud core.

#### Large tier slow ticks, profiled (2026-10-17)
`--trace-gc` and `--cpu-prof` on the server under `load-test.ts large 5`, plus timing every route search inside each slow tick. Garbage collection is not the cause: the young generation is swept every 100 to 200 ms but each sweep pauses only 0.1 to 0.4 ms. Route searches are: they are about three quarters of all room tick time on large, and every tick over 6 ms held 4 to 11 searches of 1 to 2 ms each. On the 250 by 250 cell search grid (40% blocked) a search looks at about 2000 cells, and 12% use the full 6000-cell cap, two thirds of those because the goal sits in a sealed pocket. Snapshot building did not show up. Two changes (see DECISIONS.md): at most one search per room per tick (`searchesPerTick` in `data/bots.json`), and goals in unreachable pockets are swapped for the nearest reachable cell.

Before and after, run alternately on the same afternoon. The laptop was busier than for the table above (late starts of about 2.4 ms rather than 1.4), so compare within this table only. 99th percentile ms per tick, three runs each:

| Rooms | Before | After |
| :- | :- | :- |
| 5 | 10.2, 11.9, 11.1 | 7.3, 6.9, 6.4 |
| 10 | 10.1, 7.1, 10.5 | 9.1, 7.3, 9.1 |
| 20 | 10.5, 15.1, 11.4 | 12.5, 9.1, 11.1 |

The spikes in a single room are gone: 5 rooms now fit 8 ms. From 10 rooms up it helps little. Each room can still run its one search on the same tick as every other room, so the worst tick grows with the number of rooms. What remains is plain search volume: bots replan every 2 s whether they need to or not. Doubling `replanSeconds` to 4 made no clear difference in a quick try, and spreading the searches over more rooms on one cache was not the issue either (one pathfinder and twenty used in turn cost the same, 0.38 ms a search). The next step would be cheaper searches, such as one shared route field to the ring centre per ring stage, or a coarser grid for long routes. Still plan on 10 large rooms per process.

#### Cheaper route searches (2026-10-19, MacBook, Node 25)
Measured on a side branch, merged later. The weight that shipped is 1.5, together with replanning only when needed: see "Cheaper route searches (recommendation 3)" below. The rewritten loop from here is kept. Rooms are no longer built on the main thread either ("Match maps built on worker threads"), so the stall in the last paragraph is gone.

Every route search in two whole large soak matches was recorded (7,700 searches) and replayed offline. Split by goal: wander 98% of search time, ring centre 1%, noises, loot and targets under 1% together. Wander goals are a random point inside the ring, which on 2000 m is 850 m away on average, and the plain shortest-route search looked at about 1900 cells for one (8% hit the 6000 cap). A shared field to the ring centre would only have sped up the 1%. Two changes:

- The search loop rewritten with the same routes (checked identical on every replayed search): the heap in a typed array, moving a hole instead of swapping, and the line checks for straightening worked out inline. About 1.2x.
- Weighted A*, `heuristicWeight` 1.3 in `data/bots.json`. On the replayed searches: 2.7x faster on average, the slowest 1% of searches 2.3 ms down to 1.1 ms, about 490 cells looked at instead of 1900, none at the cap. Routes are about 5% longer (676 m to 714 m on average) and the first leg heads the same way (within 20 degrees) 93% of the time; otherwise it goes the other way round a building. 1.1 gave 1.55x for 3% longer routes, 1.6 gave 3.3x for 7% longer.

Before and after, run alternately on the same evening, 99th percentile ms per tick. Load test (`load-test.ts large 5,10,20`, two runs each) and in-process (`measure-rooms.ts`, large only, one run each):

| Rooms | Load test before | Load test after | In-process before | In-process after |
| :- | :- | :- | :- | :- |
| 5 | 5.63, 4.87 | 1.87, 4.07 | 4.74 | 1.81 |
| 10 | 6.82, 4.53 | 3.12, 4.26 | 7.99 | 2.97 |
| 20 | 10.33, 8.33 | 6.09, 5.70 | 12.78 | 6.52 |

Mean tick time for 20 rooms went from 3.7 to 4.0 ms down to 2.4 to 3.0 ms (load test), and from 3.8 to 2.0 ms (in-process). 20 large rooms now fit the 8 ms budget on this laptop: plan on 20 large rooms per process here, and about 10 on a cloud core until it is measured there. The second load test pair ran with ticks starting up to 2.4 ms late, so the machine was busier for it. A whole large soak match still passes (403 s, 39 knocked out, tick p99 0.46 ms).

The load test made its rooms back to back, and a large room takes about 0.8 s to build, with the whole process stopped meanwhile. The players already in kept sending inputs with no ticks to refill their message budget and were kicked for flooding, so the test was quietly measuring 3 rooms whatever it asked for. It now waits 1.5 s between rooms. The same stall hits real players: everyone in every room on the process freezes for most of a second whenever someone makes a large room.

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
1. Serve `.glb` compressed, or quantise the mech models. The four roster models are 900 kB of the 1.2 MB first load when the host does not compress them (many do not for `model/gltf-binary`): brotli makes them 86 kB, gzip 156 kB. A host setting, no code. Failing that, `KHR_mesh_quantization` in the mech build scripts halves them raw with no loader change; meshopt or Draco would need a decoder. [deploy, then `scripts/mechs/`] Quantised on 2026-10-19; since M10 10a the server also sends every model brotli compressed (Ironclad 132 kB to 17 kB).
2. Generate maps off the main thread on the server. A large map takes about 160 ms and stalls every room in the process at each match start: a worker thread, or generating the next map during the results screen in a worker. [server, `Room.beginCountdown`]
3. Cheaper route searches for large rooms (one route field to the ring centre per ring stage, or a coarse grid for long routes): searches are 80% of a large room's tick, the limit on large rooms per process. [server, `Pathfinder.ts`, `Bot.ts`] Done, see "Cheaper route searches" below.
4. Props past about 150 m drawn as plain boxes or not at all: even culled, a view across the map still sends 2.3 to 2.9M triangles, nearly all distant props a few pixels tall. Changes the look slightly far away, so it needs Joseph's eye. [`propView.ts`] Done, see "Far props drawn as boxes" below.
5. `matrixAutoUpdate = false` on everything that never moves (map, dressing, props, backdrop, wall): `updateMatrixWorld` is the top JavaScript cost in a fight. Small, safe. [`main.ts` and the builders] Done, but the premise was wrong: see "Static objects frozen" below.
6. Merge each remote mech's leg pieces per paint: a fight is 150 to 400 draw calls, mostly mech parts and their outlines. [`mechModel.ts`, `legRig.ts`] Done, see "Mech parts merged" below.
7. Load lil-gui and the debug panel on the first F1: 19 kB (6 kB gz) off the start. Small gain. [`main.ts`, `debugPanel.ts`] Done, see "Tuning panel loaded on F1" below.
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

### Far props drawn as boxes (2026-10-19, recommendation 4 of the performance pass)
A standing crate, junk pile or barrel more than 150 m from the camera is drawn as one plain toon box round its model, with an outline, in the paint seen most from its sides and top (`props/standIn.ts`: crate rust orange, junk deep rust, barrel spark yellow). It turns back into its model inside 140 m, so a prop at the boundary does not flicker (`farBoxes` in `data/props.json`). Debris stays debris at any distance. The far test is a squared distance per prop in the loop that already culls them, so nothing is allocated per frame; each prop type adds two draw calls when any of its props are far.

Same method as the pass above (production build, `vite preview`, headless Chrome 1600 x 900, vsync and frame cap off), offline large tier, before and after builds alternated, two runs each. Spawn is the game's own view at spawn; overview (`&overview`) looks down on the whole map from above, the worst case. The laptop was busy with other agents, so frame times vary a lot between runs (seed 7 at spawn, unchanged by this, measured 1.8 to 4.0 ms across both builds); triangles and draw calls are exact.

| View | Triangles before / after | Draw calls before / after | Uncapped ms per frame before | After |
| :- | :- | :- | :- | :- |
| seed 7, spawn | 0.62M / 0.62M | 137 / 137 | 1.8 to 3.9 | 3.6 to 4.0 |
| seed 11, spawn | 2.91M / 0.69M | 129 / 135 | 3.9 to 5.8 | 3.4 to 3.9 |
| seed 23, spawn | 2.71M / 0.65M | 129 / 135 | 4.0 to 5.3 | 3.6 to 4.0 |
| seed 7, overview | 4.85M / 0.67M | 129 / 113 | 4.3 to 7.4 | 3.7 to 4.1 |
| seed 11, overview | 4.89M / 0.73M | 129 / 113 | 5.6 to 7.2 | 4.2 to 4.3 |
| seed 23, overview | 4.80M / 0.69M | 129 / 113 | 2.2 to 7.4 | 4.0 |

Seed 7's spawn view sees no prop past 150 m, so it is unchanged. A view across the map now sends about a quarter of the triangles, and the overview a seventh; the frame time is close to what the rest of the scene costs. Screenshots of the same views before and after: seed 7 identical, seeds 11 and 23 differ in 500 to 800 pixels, all along the horizon (far crates lose their white marking and barrels their black bands, and read as orange and yellow blocks under the haze).

### Static objects frozen (2026-10-19, recommendation 5 of the performance pass)
Everything placed once and never moved now has `matrixAutoUpdate = false` (`freeze.ts`): the map's box meshes, the dressing (frozen again after each chunk rebuild), the edge wall (far quads and the near models after each rebuild), the backdrop, the contact shadow meshes, the sky, the effect pools whose instances move but whose mesh never does (sprites, cards, debris), and the title screen's hall, gantry frames and painted decals. Not frozen: mechs, projectiles, grenades, pickups, the ring wall, explosion light, the scene lights (the key light is re-aimed per light preset), the camera, and the props (`propView.ts`, owned elsewhere at the time; one `freeze(this.group)` at the end of its constructor would do it). `matrixWorldAutoUpdate = false` on a root was not used: in three r186 it only skips that node's own world matrix and still walks every child, so it saves nothing over the above.

What the scene holds (headless Chrome, production build): a busy online arena (`?create&tier=arena&bots=7`) is about 1,500 objects, of which the eight mechs are about 1,300 (143 to 189 parts each); offline large (seed 7, no bots) is 293. Only 88 of them are static, because the world was already merged into a few meshes per paint. So the top `updateMatrixWorld` cost in a fight is the mech parts, not the world.

`scene.updateMatrixWorld()` timed in the page, best of 15 rounds of 500 calls, with the static objects frozen and unfrozen alternately in the same page so the busy laptop affects both alike, microseconds per call:

| Scene | Nothing frozen | Frozen as shipped | Props frozen too |
| :- | :- | :- | :- |
| offline large, seed 7 (two runs) | 59.0, 57.0 | 52.2, 51.8 | 48.0, 48.8 |
| online arena fight (three runs) | 186, 345, 79 | 180, 337, 78 | 192, 334, 77 |

About 10% of a small cost on large (6 microseconds a frame, 10 with the props), 2 to 3% in a fight. The arena's absolute numbers swing with what the mechs are doing and the laptop's load. In CPU profiles (8 s, 100 microsecond sampling, alternating builds, two runs each) `updateMatrixWorld` was 0.14 to 0.33 ms a frame in the arena and 0.04 to 0.10 on large, before and after alike, and F1 work median 0.6 to 3.4 ms either way: the change is smaller than the noise. Screenshots of offline large seed 7 at spawn and medium seed 11 overview are byte for byte identical before and after; the title screen, the style test and an arena match into spectating look the same. A scratch check walked and jumped across a large map (dressing and edge rebuilds) and found every static object frozen with its world matrix right after each rebuild.

The real gain is in the mechs: about 160 parts each, every one recomputed every frame. That is recommendation 6 (merging leg pieces), plus fewer separate parts in the kits.

### Mech parts merged (2026-10-19, recommendation 6 of the performance pass)
Method. Per mech: the meshes drawn at the nearest level of detail, counted in Node from the real roster models (every fill and every outline). In a fight: the online arena with 7 bots (`?create&tier=arena&bots=7`, dev client, game server on 8080), headless Chrome over CDP at 1600 x 900, WebGL draw calls counted every frame for 20 s starting 8 s into the match, and mech draw calls counted as the meshes under a mech's level-of-detail objects that three actually drew after culling (`onBeforeRender`). Four runs each way. Other agents were changing props and static objects in the same folder at the time, so whole-frame totals move for reasons of their own; the mech numbers do not.

| Mech | Draw calls before, whole / arms and legs broken | After | Triangles (unchanged) |
| :- | :- | :- | :- |
| Ironclad | 60 / 12 | 26 / 6 | 8,240 |
| Stiletto | 76 / 18 | 33 / 4 | 7,144 |
| Cataclysm | 80 / 12 | 45 / 4 | 11,712 |
| Arbiter | 72 / 22 | 31 / 4 | 6,348 |

| Arena, per run | Before | After |
| :- | :- | :- |
| Draw calls per mech on screen, mean | 46, 59, 62, 64 | 30, 24, 26, 31 |
| Mech draw calls per frame, mean (mechs on screen, mean) | 272 (6), 258 (4), 182 (3), 236 (4) | 139 (4), 84 (4), 195 (7), 189 (6) |
| All draw calls per frame, median | 368, 358, 271, 228 | 247, 171, 265, 288 |

Parts that move together (the body, or one leg piece on its joint), share a zone and show in the same damage states are merged when a kit is first used, by kind of material, with each part's colour on its corners (`mechMerge.ts`). It costs about 1 ms once per kit and 0.2 to 0.3 ms per mech after that (Node); the merged geometry is shared by every mech of a kit, plus 12 bytes of colour per corner. It also halves the objects three updates every frame for each mech (`updateMatrixWorld`, the frozen-objects section above): 143 to 189 before (Ironclad, Stiletto, Arbiter, Cataclysm), 65 to 102 after. Look: on `style.html` the four roster close-ups (key 6) are identical to the pixel before and after (one pixel of 1.44 million differs on Stiletto); the roster (key 4) and the stand-in's four damage states (key D, at 10 and 50 m) differ only where smoke, sparks and the drones move, by as much as two runs of the old code differ from each other. The title screen hangar and walking (key W) look as before.

What is left: Cataclysm's 45 is mostly its twelve leg pieces at three calls each (rusting paint, bare frame, outline). Letting one material carry rusting and non-rusting paint (a rust flag per corner) would make that two, about 12 fewer for Cataclysm and 6 for the others; it changes the toon shader, so not done here.

### Tuning panel loaded on F1 (2026-10-19, recommendation 7 of the performance pass)
The F1 panel and lil-gui are a chunk of their own, fetched the first time F1 is pressed (a few milliseconds on a local host; the panel opens when it arrives). `FrameTimes` moved to `frameTimes.ts` so the frame loop still records frame times without it. Production build, JavaScript fetched at the start of a match: 951 kB before, 916 kB after (about 10 kB less gzipped). The panel chunk is 35.5 kB (9.7 kB gzipped). The server's tuning switch (DEV_TUNING) is remembered from the welcome and applied when the panel is built.

### Snapshots carry only what changed (2026-10-19)
Snapshots were 99% of what a player is sent, and other mechs about 73% of a snapshot at 21 bytes each. The server and each client now keep a memory per connection (`SnapshotMemory` in `wire.ts`): a mech already in view goes as the change in its position (1 byte an axis) with its health, armour, weapon and upgrades only when one changes, 9 bytes instead of 21; your own numbers go only when they differ from the last snapshot. Measured with the soak's headless players, worst of three per match, seeds 1 to 3 (small) and 1 to 3 (medium):

| Tier | Average kbps before | Average after | Busiest second before | Busiest second after | Mean snapshot bytes after |
| :- | :- | :- | :- | :- | :- |
| small | 51 | 24 | 78 | 46 to 52 | 143 to 147 |
| medium | 43 | 21 to 22 | 56 | 26 to 35 | 101 to 135 |

The busiest second on small is the opening brawl just after the countdown: snapshots about 3.9 kB, shots about 1.2 kB and hit, ability and grenade messages about 1 kB that second. Shot origins then went to 16-bit numbers at 5 cm (24 to 18 bytes a shot, about a quarter off the shots in that second); small soak 23 kbps. Next if it is ever needed: the readable hit and ability messages packed.

### Server memory per room (2026-10-19, M10 10b, MacBook Air M4, Node 25, one map worker as on Fly)
`MAP_WORKERS=1 npx tsx scripts/load-test.ts <tier> <rooms>`: the server process's resident memory with two real WebSocket players per room and bots filling the rest. Sizes the Fly machine in fly.toml.

| Tier | Rooms | People | Server memory MB | 99th percentile tick ms |
| :- | :- | :- | :- | :- |
| small | 1 / 5 / 10 | 2 / 10 / 20 | 132 / 137 / 154 | 0.97 / 2.42 / 2.44 |
| medium | 1 / 5 / 10 | 2 / 10 / 20 | 137 / 167 / 227 | 1.90 / 2.76 / 3.82 |
| large | 1 / 3 / 5 | 2 / 6 / 10 | 195 / 277 / 301 | 2.44 / 2.28 / 4.41 |

About 130 MB before any room, then roughly 2 to 3 MB a small room, 9 a medium and 30 to 40 a large. Linux on Fly will differ somewhat from macOS; read `fly status` memory after the first real evening. Ping through the internet is not measured yet: read F1, Ping ms, from a phone on cellular during the 10b check.

### Hills (2026-10-19, M11 11a)
Map build (generateMap, median / worst ms, 10 seeds): small 5-6 / 7, medium 55-58 / 61, large 219-225 / 237, about 25% more than before, all on the map workers; unpacking on the main thread 0.1 / 0.7 / 2.4 ms (small / medium / large). measure-rooms.ts, mean / p99 ms per tick: medium 10 rooms 0.33 / 1.05, 20 rooms 0.56 / 1.34, 40 rooms 1.32 / 3.13; large 5 rooms 0.15 / 1.23, 10 rooms 0.30 / 2.11, 20 rooms 0.69 / 4.54, all inside 8 ms. Soak after the hills: small 24 kbps, medium 21, large 14, tick p99 0.13 to 0.24 ms, worst prediction correction 0.01 cm (after keeping meters at float32). Client, seed 11 at 800x600 in the browser pane, draw calls before -> after: small spawn 119 -> 122, medium spawn 107 -> 115, large spawn 107 -> 117; triangles 301k -> 313k, 350k -> 422k, 674k -> 790k. The pane holds 60 fps; uncapped frame time and Joseph's laptop are not measured yet.

### Water (2026-10-19, M11 11b)
Seed 11 spawn views, renderer.info: medium 115 -> 116 draw calls, 422k -> 434k triangles; large 117 -> 118, 790k -> 834k. The water mesh is one draw call for the whole map; the splash pool draws nothing while empty. Soak with water: small 24 kbps, medium 21, large 17, tick p99 0.15 to 0.26 ms, worst correction 0.01 cm.

### Forests (2026-10-19, M11 11c)
renderer.info at 1024x768, before -> after: medium seed 11 spawn 120 / 463k -> 130 / 473k (draw calls / triangles), overview 106 / 532k -> 108 / 566k; large seed 2 (5,610 trees) spawn 125 / 966k -> 135 / 934k, overview 91 / 976k -> 97 / 1,064k; inside a medium wood 134 / 420k. Tree culling about 0.18 ms CPU a frame on large. Server: blast prop lookups on large from 134 us (all 10,844 props) to 0.3 us (the world grid); measure-rooms medium 40 rooms 1.78 / 4.68 ms mean / p99 a tick (steering adds about 10 to 25% on medium), large 20 rooms 0.93 / 6.74; large map unpack 3.6 ms on the main thread (was 2.4). Soak: small 25 kbps, medium 22, large 18, worst correction 0.01 cm. Frame time on Joseph's laptop not measured yet.


### Sun shadows and contact darkening (2026-10-19, V7a)
Headless Chrome 155 over CDP at 1600 x 900, M4 MacBook (ANGLE Metal), frame-rate capped, the laptop busy with other agents. Draw calls and triangles counted by wrapping the WebGL draw calls (the shadow pass counted apart by its framebuffer); GPU time per frame from EXT_disjoint_timer_query_webgl2. Before is the same tree without the V7a changes, served side by side and measured alternately.

| View | Draw calls before / after (of which shadow pass) | Triangles before / after | GPU ms median before / after | Work ms median before / after |
| :- | :- | :- | :- | :- |
| medium seed 11 spawn | 133 / 191 (58) | 620k / 897k | 3.9 to 4.2 / 4.0 to 10.7 | 0.7 to 0.8 / 0.9 |
| large seed 2 spawn | 136 / 196 (60) | 1.15M / 1.72M | 10.7 to 10.9 / 5.2 to 11.6 | 0.8 / 1.0 |

The GPU numbers swing more between runs than the change itself. Toggling only the shadow depth pass in the same page (three rounds each) gives its cost: medium 3.1 to 3.3 ms without, 4.0 to 4.6 with (about 1 ms); large 5.0 to 6.0 without, 5.2 to 6.9 with (0.2 to 0.9 ms). What the depth pass draws on large: the whole map's instanced boxes 146k triangles (mostly hidden instances near you, since the dressing stands in), dressing 133k, trees 98k, props 50k, far boulders 34k, edge wall 14k, a mech 6k. The low effects quality draws a 1024 map over 70 m; on this machine its saving was lost in the noise. Not measured: Joseph's laptop (F1, Performance: the draw call and triangle readouts include the shadow pass).

### What each look feature costs (2026-10-19, gate 12c)
F1, Performance, Look features, "Measure feature costs": everything on, then each feature off for 3 s after 2 s to settle, median GPU time from the WebGL timer query. Medium seed 11 at the spawn view, the Claude desktop app's browser pane on the M4 MacBook (machine also running other work), offline: all on 6.1 ms; sun shadows save 0.7 ms, ground cover 0.7 ms, painted marks 0.1 ms. 202 draw calls. Joseph's laptop: not measured yet; press the button there and add a row.


### Buildings with real structure (2026-10-19, gate V8)
The building builders gained their structure (corrugated folds, castings and door gear on containers; posts, girts, bracing, gutters, windows and shutters on sheet walls; the warehouse roof with rafters and purlins, its columns and crates; a concrete frame with a slab, bent rebar and a bricked-up window in the ruins; sills, glazing bars and steel bracing on towers; footing, knee braces, cross-bracing, raised columns and shores on the edge wall). The per-box limit is now one setting, `triangleBudget` in data/dressing.json (budget.ts): 60 a cubic metre, at least 150, at most 4,500 (was 40 and 2,500 in code). Scrap piles keep their own old numbers. The edge wall's per-bay test limit went from 3,500 to 4,000.

Triangles per box, every box on medium seed 11 (Node, `builders` only): container 808 -> 2,002, sheet 858 -> 1,277 (a 34 m warehouse wall up to about 4,400), ruin 1,233 -> 1,410, tower 1,109 -> 3,031; building triangles within 120 m of the middle 38k -> 64k (small seed 123: 28.5k -> 48k). Edge wall bay median 2,378 -> 2,684, worst 3,432 -> 3,768.

Browser, headless Chrome 155 over CDP at 1600 x 900, M4 MacBook (ANGLE Metal), spawn view, offline, draw calls and triangles counted by wrapping the WebGL draws (shadow pass counted apart), GPU time from EXT_disjoint_timer_query_webgl2, old and new dressing sources swapped in alternately on the same dev server:

| View | Draw calls before / after (shadow pass) | Triangles drawn before / after | GPU ms median, alternating runs before / after |
| :- | :- | :- | :- |
| medium seed 11 spawn | 203 (62) / 210 (65) | 889k / 977k | 6.5, 9.7, 8.0-8.3, 9.1-10.3, 10.0-11.2 / 7.5, 10.3, 9.3-9.7, 7.8-8.4, 7.3-7.7 |
| small seed 123 spawn | 167 (54) / 176 (57) | 517k / 593k | 5.8, 6.6 / 6.4, 8.1 |

The GPU time swings more between runs than between versions (four other agents were rendering mechs on the same machine), so the change's own cost is lost in that noise; it adds about 10% more triangles, no new shaders, and one more paint and surface pair in view (2 draw calls and its shadow), plus the edge wall's concrete footing (the same again where the wall is near). Joseph's laptop: not measured; F1, Performance, "Measure feature costs" there gives the number.

Building and merging got cheaper rather than dearer, measured in Node (`scripts/measure-dressing.ts medium 11`, and timing the builders and a chunk change on the same map). Most of the old cost was not the builders but the merge on entering a new chunk: every dressed chunk near you was merged again and every corner's outline normal worked out again by a string key, 33 ms each time before this gate and 55 ms with the new geometry. Each chunk's arrays and outline normals are now made once when it is built (a numeric hash table, the same normals as outlineNormals.ts, tested), and a chunk change only copies them; the edge wall does the same. Builders place stretched copies of unit shapes (structure.ts) and move pieces into the world without trigonometry.

| Medium seed 11 | Before | After |
| :- | :- | :- |
| Chunk change, the merge, median / worst | 33 / 46 ms | 2.7 / 5.0 ms |
| Building builders per 50 m chunk, median / p90 / worst | 2.6 / 5.1 / 7.7 ms | 1.6 / 3.0 / 4.3-6.5 ms |
| First build at the middle | 180 ms | 147 ms |
| Sprinting corner to corner, p99 / worst frame | 5.3 / 69 ms | 4.8 / 9.8 ms |
| Spectator cuts, every frame p99 / worst | 10.1 / 57 ms | 8.3 / 11.2 ms |
| Edge wall alone, worst frame | 25.5 ms | 6.1 ms |

### Optimization evaluation after V7, V8 and 13a (2026-10-19, MacBook Air M4, Node 25.6, Chrome 155 headless)
Method as in the earlier performance pass: production build served by `vite preview`, headless Chrome at 1600 x 900 with vsync and the frame cap off, F1 readouts (frame, work, GPU ms from the timer query, draw calls, triangles) at the spawn of small 123, medium 11, large 7; allocation from DevTools heap metrics and the sampling heap profiler over 10 s of an idle offline match; server numbers from measure-generation, measure-bandwidth, measure-rooms and load-test. The Air is fanless and slowed over the session (the same build measured 3.6 then 4.6 to 5.0 GPU ms on medium twenty minutes apart), so before and after were compared by alternating two builds back to back, not by run order.

| What | Measured | Budget | Verdict |
| :- | :- | :- | :- |
| Client frame, uncapped (small / medium / large) | 3.3 / 3.6 / 4.3 ms; GPU 3.5 / 3.6 / 4.7 ms (cool machine) | 16.7 ms on a mid-range laptop | fine here; the laptop is unmeasured, press F1 > Measure there |
| Draw calls / triangles | 176 / 0.59M, 210 / 0.98M, 204 / 1.7M | none set | fine |
| Look features, medium (GPU ms saved by switching off) | shadows 1.0 to 1.4, ground cover 0.6 to 1.6, paint 0 to 0.2 | | the first two to offer on a low setting if the laptop struggles |
| JS heap at spawn (small / medium / large) | 56 / 121 / 223 MB | none set | large is big but stable; not a frame cost |
| Garbage made per second, idle medium, uncapped | 22.8 MB/s, 7 to 9 collections in 10 s | "no allocations in the frame loop" | over: fixed below |
| Download, whole build | 3.2 MB raw, 898 kB gz, 650 kB br (mechs 1.77 MB raw, 248 kB br as served) | 15 MB | fine; V8 doubled the mech files, the server's brotli keeps them small |
| Map generation (median / worst) | small 6 / 7, medium 60 / 123, large 230 / 472 ms | 3 s | fine |
| Bandwidth per person (small / medium / large) | 21 / 13 / 11 kbps | 64 kbps | fine |
| Server tick, real clients | 40 small rooms 2.1 ms mean, 4.0 p99; 40 medium 3.7 ms mean, 5.3 p99 | 8 ms | fine; memory 283 MB for 40 small, 717 MB for 40 medium |

Where the garbage came from: three.js re-deciding shader programs every frame (getParameters, the program cache key strings), because one material was shared by objects that need different programs. Seven a frame were the shadow pass, where three draws every caster with one shared depth material and every switch between an instanced and a plain mesh re-decides it; two were the trees' white fill, shared by trunks (no instance colour) and crowns (instance colour). Fixed by one depth material per kind of caster (sunShadows.ts depthFor) and a trunk material of its own: re-decisions 9 a frame to 0, garbage 22.8 to 13.3 MB/s uncapped (about 3 MB/s at 60 fps). GPU time: within noise of before when the two builds alternated (with 4.8, 5.0, 4.6; without 4.6, 4.4, 4.6 ms). What is left is inside three's uniform upload (its value caches box numbers as V8 stores them), short lived and collected in well under a millisecond every few seconds; not worth patching three for. Two small ones of ours went too: the dressing worked out the camera's chunk through a closure and a pair every frame, and the supply drop's radar hook made a closure every frame.

Also fixed: a server whose log output closes (a load test ending, a host restarting its log collector) crashed with EPIPE on its next line; it now ignores that.

### Terrain in the way (2026-10-20, gate 15a)
How open the maps are, from `npx tsx scripts/measure-sightlines.ts 6`: the share of open-ground spots at a mech's eye height (3 m) that can see each other, by distance apart.

| Tier | 40 to 100 m, before / after | 100 to 250 m, before / after | Boxes, before / after |
| :- | :- | :- | :- |
| small | 51% / 32% | 23% / 10% | 453 / 538 |
| medium | 49% / 28% | 20% / 7% | 5,629 / 6,775 |
| large | 47% / 26% | 18% / 6% | 23,498 / 28,414 |

Map building (measure-generation, median / worst): small 7 / 8 ms, medium 62 / 131, large 253 / 511, retries unchanged. Server (measure-rooms): 40 medium rooms 1.55 to 1.97 ms a tick, 20 large 0.86 to 1.04; soak passes on every tier. Bot routes cost more on large: the weighted search now looks at about two thirds of the cells the exact one does, not under half (Pathfinder test relaxed to three quarters). Client, uncapped, headless, a busier machine than the earlier rows: small 0.59M triangles and 3.3 to 5.2 GPU ms as before; medium 0.98M to 1.3M triangles, GPU 3.9 to 4.5 ms (about as before); large 1.7M to 2.8M triangles and about 10 GPU ms, up from about 5. Large's extra is the far stone stand-ins (farBoulders.ts), which draw every outcrop on the 2 km map at once; distance-culling them is the fix, left for when large is the focus.

### Arena island (2026-10-20)
Map building, `npx tsx scripts/measure-generation.ts` (10 seeds, median / worst ms), before and after the Arena became an island: arena 3 / 10 before, 3 / 11 after (boxes 243 to 112: no edge wall, and shore chunks become open ground); small 7 / 9, medium 78 / 155, large 314 / 610 before against 7 / 14, 61 / 132, 236 / 502 after, the same maps (a fingerprint of small, medium and large boxes, props, heights, water and nav grid matched before and after), so those differences are machine noise. Over 1000 Arena seeds: 2.2 ms mean, 11.4 ms worst, about one retry in nine maps (a spawn near the shore with fewer than two loot props in reach), none failed. Land is about half the square (50% over those 1000 seeds), plus a 5 m band of shallows a mech can wade. The open sea costs the client, on an island only, 400 triangles of water past the map's edge (in the water's own draw call) and 400 of seabed under it (one more draw call); the junkyard backdrop, its apron and the mountain ranges are not drawn there (not measured). Soak, arena, 6 seeds: pass, worst correction 0.00 cm, tick p99 0.10 to 0.24 ms, and no mech ever past the sea limit (a new soak check).

### Retina pixels and dynamic resolution (2026-10-20, Joseph: "noticeable mouse lag and the performance is poor")
The game drew at the screen's full pixel ratio, 2 on Joseph's MacBook Air (Retina, 2560 x 1664): nearly three times the pixels of the 1600 x 900 at ratio 1 every earlier row was measured at, and the toon, paint and shadow shaders cost per pixel. Headless Chrome as a Retina screen (1440 x 900 at ratio 1.5, frame cap off, machine also running a model agent at load 10): small and medium about 12 GPU ms a frame, shadows 3.1 ms of it, against 3.3 to 5 ms at ratio 1; ratio 2 is about 1.8 times ratio 1.5, past 16.7 ms, which queues frames and is felt as mouse lag. Now the ratio is chosen as frames go (renderScale.ts, data/render.json): it starts at 1.25, steps down by 0.25 to 1.0 while the median frame is over 18 ms, and steps up toward the screen's own after 4 s under 8 GPU ms. F1 > Performance shows the current ratio. Also found and stopped: a headless Chrome left running by an earlier agent run had been playing the game in the background for 16 hours, competing for the same GPU.

### Mech surfaces and crease lines (2026-10-20, gate V9)
What changed: the roster's shading normals (bent over chamfers at build time, no runtime cost), an edge wear byte per vertex (`_WEAR`), and in the master toon material for kit mechs one more noise read for paint chips, the metal glint and the rubber band (look.json `mech`). Download: the committed Ironclad rebuilt with them is 417,304 to 525,620 bytes raw, 99.8 to 108.0 kB gzipped, 54.9 to 57.7 kB brotli (the wear byte sits in four for alignment; the padding compresses away). Build time per mech unchanged to the eye (under 0.5 s).

Method: headless Chrome over CDP at 1600 x 900, ratio 1, vsync and frame cap off, M4 MacBook (ANGLE Metal), other agents rebuilding mechs on the same machine. Before is HEAD (cd77a78) served from a worktree on its own dev server, after the working tree with the mech agents' models in progress, measured alternately. Style page: GPU time from a timer query around each animation frame, 5 s per view. Medium seed 11 at the spawn: the F1 readouts and "Measure feature costs".

| View | GPU ms median, before (two rounds) | after (two rounds) |
| :- | :- | :- |
| Style page, 10 m | 2.32, 2.04 | 1.94, 1.94 |
| Style page, roster (key 4) | 2.34, 2.45 | 2.11, 2.16 |
| Style page, 50 m | 1.88, 2.15 | 2.17, 1.84 |
| Medium 11, spawn (210 draw calls, 1.31M triangles) | 3.7, 3.7 | 3.7 to 3.8, 3.8 |

The surface changes cost nothing measurable here (within the run-to-run swing). Crease lines (creasePass.ts, off by default, F1 > Look features): 1.3 ms on medium in both runs (all on 5.0 to 5.1 ms), about a third of the frame, from drawing the scene into a 4x multisampled half-float target and one full-screen pass of five depth reads; at Joseph's ratio 1.25 to 2 it scales with pixels. Not nearly free, so it stays a proposal. Joseph's laptop: not measured; F1 > Measure feature costs there gives the number, crease lines included.

### Mech motion (2026-10-20, gate V9b)
Pistons and swaying parts are separate objects within 25 m (about 16 to 40 per mech, the Arbiter most), guns split out for recoil add about one outline each. Production build, headless Chrome 1600 x 900, frame cap off, offline spawn with your own Arbiter: small 182 to 221 draw calls, GPU 3.1 ms; medium 204 to 243, GPU 3.8 ms (both as before); work 1.3 ms. A fight with many mechs within 25 m adds the most; if it bites, the Ironclad's inner rams and the per-drone split go first.

**The Junk Titan (13c).** Every snapshot carries one more byte (is the Titan near), and 11 more while it is within interest range (position at mech steps, 16-bit yaw, hit points, action, action time). Its stomp, throw, landing and fall go as readable "titan" messages to people near. measure-bandwidth.ts, before / after (kbps, one person): small 23 / 24, medium 17 / 18, large 9 / 12 (bots wander differently each run). Worst case, the Titan beside the one person for a whole minute: medium 13.8 kbps, large 15.5, of which its messages 0.15 to 0.22 kbps. Soak seed 4242 before / after: medium 26 / 28 kbps, large 15 / 14, tick p99 0.14 / 0.24 ms (medium) and 0.17 / 0.27 ms (large), worst correction unchanged at 0.01 cm or less. Random seeds after: medium 23, large 12 kbps, all passing.

### Mech triangle budget raised to 15k (2026-10-20)
Joseph asked for a bigger mech budget if it costs no real performance. Style page roster view (all five mechs at 10 to 20 m, so at their near level), headless Chrome 1600 x 900 on the M4 (ANGLE Metal, vsync and frame cap off, machine otherwise idle), GPU time per frame from timer queries, every mech triangle drawn one, two and three times, three rounds each:

| Mech triangles | Triangles per frame | GPU ms median (three rounds) |
| :- | -: | :- |
| as built (about 9.4k near per mech) | 159k | 1.76 / 1.75 / 1.75 |
| twice | 300k | 2.08 / 2.09 / 2.09 |
| three times | 441k | 2.41 / 2.42 / 2.42 |

Each near mech is drawn about three times (colour, outline, shadow), so the five add 141k triangles a frame, and every extra 141k costs 0.33 ms here. Doubled triangles also shade their pixels again, so this overstates the cost of real denser meshes. Draw calls do not change with triangle count. At 15k a near mech draws about 16k more triangles a frame: about +0.04 ms each here, +0.3 ms with nine mechs within 25 m (the worst arena brawl), guessed at 1 to 1.5 ms on a mid-range integrated GPU at four to five times slower. At 20k that worst case would be about +0.65 ms here and 2.5 to 3 ms there, and triangle cost is not saved by dynamic resolution, which only cuts pixels. Middle and far levels keep their sizes. Download: mech files are 1.77 MB raw, 248 kB as served; filling every near level to 15k adds roughly half that, against a 15 MB budget.

### V10 mechs at about 14k near (2026-10-20)
Same method and view as the budget measurement above (roster view, five mechs at their near level, M4, 1600 x 900, three rounds): triangles a frame 159k -> 217k, GPU 1.75 -> 1.89 / 1.89 / 1.90 ms median, draw calls unchanged at 778. Near levels 13,478 to 13,952; middle levels grew 0 to 176 triangles to keep outlines across the 25 m switch. Soaks after: small 25 kbps, medium 22, large 17, tick p99 0.17 to 0.23 ms.

### Bot on bot knockouts (2026-10-20)
Soak seeds 11 to 13, small and medium, knockouts of a bot by a bot by how far the nearest living stand-in person was (within 150 m is radar range). Before / after hunting and personDistanceScale 1.6: small within 150 m 10 / 13, zone deaths 0 / 1; medium within 150 m 2 / 3, 150 to 300 m 18 / 12, more than 300 m (fought on paper) 19 / 31, zone deaths 25 / 20. Match length and bandwidth unchanged (20 to 29 kbps, tick p99 0.13 to 0.19 ms).

### V11 cleaner world (2026-10-20)
Production builds of the commit before and after, served side by side, headless Chrome 1600 x 900 on the M4, offline medium spawn: seed 11 triangles 1.32M -> 1.20M, seed 23 1.41M -> 1.28M, draw calls unchanged (249 and 243). GPU median before / after, three rounds on seed 11: 5.95 / 6.83, 7.98 / 7.16, 7.28 / 7.20 ms; seed 23 7.60 / 7.53 ms: no change beyond the run-to-run swing. Scatter over a whole medium map 704k -> 328k triangles. The water shader does one more noise lookup and three hashes per water pixel.

### V12 hangar (2026-10-20)
Title screen, production builds side by side (before V11 and V12 / after), headless Chrome 1600 x 900 on the M4, three rounds: GPU median 1.49 / 1.60, 1.55 / 1.71, 1.83 / 2.00 ms; draw calls 367 -> 393; triangles 88k -> 121k. The title screen's script went from 24 to 61 kB raw; no new model or texture files.

### 16b drop-in (2026-10-20)
The Rustbucket model is about 950 kB raw (14,940 / 7,972 / 2,412 triangles by level), merged to 2 draw calls; drop effects add at most 4 inked sprite pools (none drawn while empty) and 2 for shells. In the bay at the start of medium seed 23 a frame went from 144 draw calls to 110 once the ship was merged. Soaks: small 29 kbps, medium 40, large 23, tick p99 0.20 to 0.22 ms, worst correction 0.01 cm. Times from the match going live: median landing small 15 to 17 s, medium 26 to 33 s, large 45 to 51 s.

### 18a secondaries (2026-10-20)
Your own snapshot grows to 29 numbers (4-byte mask; zero numbers cost nothing, worst case 25 bytes more); other mechs carry pinned in a spare bit and one byte of spin or venting only while not 0; a shot message is 19 bytes. Soaks per starting gun, kbps per player: small 24 / 27 / 27, medium 25 / 37 / 26, large 21 / 17 / 17 (autocannon / scattergun / spike driver), tick p99 0.09 to 0.26 ms. A large seed (704082781) fails with a one-snapshot 14.85 m correction that predates 18a (same on 16c): the pretend player's world holds a box the server no longer has, likely a prop broken out of its sight.


### V14 cel shading (2026-10-21)
GPU per frame on the M4 at 1600 × 900, headless Chrome with timer queries, median of three interleaved rounds (before, after at normal, after at high on separate origins, with the before mech models so model changes don't count). Roster: 1.90 / 1.90 / 2.95 ms. Small, golden: 2.48 / 2.58 / 4.74 ms. Medium, dusk: 5.33 / 5.72 / 7.68 ms. Medium, overcast: 5.63 / 5.87 / 7.77 ms. Normal quality costs 0 to 0.4 ms more, mostly far trees now outlined (+2k to 38k triangles, one draw call). The crease pass at high costs 1.0 to 2.3 ms on top, more than V9's 1.3 ms estimate on busy views, so it stays off by default. Script: scratchpad gpu.mjs from the V14 session (not kept in the repo).

### Bot pathing audit (2026-10-21)
A scratch probe around real soak matches marked a bot stuck for each second it held a move key but moved under 0.8 m (landing stun, pins and harpoon pulls not counted). Same seeds, the commit before against after. Small, seeds 2000 to 2019: stuck 6.8% of trying-to-move time to 4.2%, spells of 3 s or more 6 to 1, seconds pressed into big boxes 58 to 6. Medium, seeds 2000 to 2009: 6.1% to 3.7%, spells 36 (164 s) to 8 (24 s), worst 17 s to 3 s, pressed into big boxes 528 to 89 s, near the ring edge 170 to 52 s; held-out medium seeds 3000 to 3004 3.4%, worst 4 s. Small seed 1000's 176 s spell against a wall is gone. What is left is mostly strafing in fights. Route searches in a medium soak: about 800 instead of 1000 to 1450, 53 to 84 µs each instead of about 20 (the fine-grid way out and three lines per leg), 3.6 to 5.2% of tick time instead of 2.2 to 2.9%; soak tick p99 unchanged at 0.25 to 0.36 ms. `measure-bots.ts`, 12 seeds, before / after: medium 328 / 320 s, 5.2 / 5.1 knockouts a minute, alone 18 / 14%. Small (30 seeds) 92 / 114 s and 7.5 / 6.9 knockouts a minute: small matches run about 20 s longer. No single part of the change accounts for it when undone one at a time (105 to 119 s each); my guess is that bots stuck against walls were easy knockouts.

### V15 textures (2026-10-21)
GPU per frame on the M4 at 1600 × 900, headless Chrome with timer queries, median of three interleaved rounds against the build just before V15. Roster: 2.18 → 2.40 ms. Small, golden: 4.38 → 4.87 ms. Medium, dusk: 4.69 → 5.15 ms. Medium, overcast: 5.26 → 5.87 ms. So about +0.2 to 0.6 ms (around 10%), from the extra ground detail reads out to 45 m and the 1024 atlas. Triangles and draw calls unchanged. Atlas: GPU memory 5.3 → 37.3 MB with mips (7 layers of 1024; `variants: 1` gives 21 MB); built in a Web Worker in 0.26 to 0.69 s (was 29 to 78 ms on the main thread at 512), so paint appears that long into load; the texture upload on arrival is not timed.

### Islands on every tier (2026-10-21)
Map building, `npx tsx scripts/measure-generation.ts` (10 seeds, median / worst ms): arena 3 / 12, small 7 / 15, medium 64 / 130, large 252 / 262, one retry each on small and medium; same range as before (machine noise). Over 300 seeds, small fails its first try 7% of the time (a shore spawn with too few loot props in reach) and the Arena 7% (it was 11%). Land per square, median over seeds: small 63%, medium 66%, large about 66%. Ponds: about 6% of the land on small, 11% on medium. Sightlines (seeds 3 to 8, share of spot pairs that see each other, 40 to 100 m / 100 to 250 m), walled before against islands after: small 0.35 / 0.09 to 0.39 / 0.11, medium 0.28 / 0.06 to 0.29 / 0.07 (with medium outcrops 24 m apart instead of 28). Soak, every tier: pass, tick p99 0.16 to 0.30 ms, 25 to 39 kbps per player, worst correction under 0.5 cm, no mech past the sea. Client: the edge wall, its junkyard bays and the mountain ranges are no longer drawn, and the open sea and seabed (two draw calls) are; not measured on the GPU.
