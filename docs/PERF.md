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
