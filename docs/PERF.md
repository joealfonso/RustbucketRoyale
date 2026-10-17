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

### Soak: a whole match per tier (2026-10-17, MacBook, Node 25)
`npm run soak`. The room fills with bots, and three headless players join that act like browsers (packed messages, prediction, replay). Three runs per tier on random seeds, all passing:

| Tier | Match length | Tick 99th percentile | Worst tick | Per player | Worst prediction correction |
| :- | :- | :- | :- | :- | :- |
| small | 34 to 45 s | 0.08 to 0.12 ms | 1.8 ms | 41 to 42 kbps | 1.2 cm |
| medium | 392 to 404 s | 0.15 to 0.17 ms | 3.0 ms | 36 to 41 kbps | under 0.1 mm |
| large | 415 to 471 s | 1.11 to 1.12 ms | 7.8 ms | 38 to 41 kbps | under 0.1 mm |

The first runs failed bandwidth on large (91 to 97 kbps): knocked out players were sent the whole map. Fixed by sending a watcher only what is near the mech it watches. Small matches are short because 12 mechs on a 300 m map find each other fast.

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

