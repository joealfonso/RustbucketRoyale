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
