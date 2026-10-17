# Milestones

Current code milestone: M5 (in three gates: 5a rooms, match loop and ring; 5b bots; 5c radar and soak test)
Current visual milestone: V1 (not started)

Update the two lines above when a gate passes. Claude Code reads this file first every session and works only on the current milestone.

## Code
- M1: one mech walks, runs, jets, shoots on a fixed grey-box map, offline, in the browser. Port the feel numbers from the Unity prototype first, then tune by playing. Gate: it is fun on its own for an hour. Also test run speed against a 2000 m distance.
- M2: authoritative Node server with one room, 2 clients in browsers, client prediction and reconciliation, snapshots with interpolation for other mechs.
- M3: weapons, grenade, armor, server side hit zones, over the shoulder aim rule.
- M4: seeded chunk generation, validation, server navigation grid, three size tiers.
- M5: zone ring, bots with level of detail, radar, full match loop with friends and bot fill, room lobby by link.
- M6: destructible props, loot drops, noise, looting wrecks.
- M7: part damage, broken states, crawl, repair.
- M8: upgrades, tuning pass with the debug panel, perf pass, bot count tuning from soak data, first load test for rooms per server.

## Visual
- V1 style test: one grey-box mech and one chunk in the browser with the toon shader, outline, palette, and lighting. Gate: screenshots at 10 m, 50 m, and 150 m read well on a mid-range laptop before any more assets get made. Draw three thumbnail silhouettes of the first mech on paper before opening Blender, and keep the scan of the chosen one in the repo next to the screenshots. Also build the asset import checker (`Assets/Editor/Import/`) that fails an import over the triangle budget, with the wrong naming, or without the master toon material.
- V2 mech kit: modular parts, three damage states each, LODs, VFX hooks.
- V3 junkyard chunk kit and destructible props.
- V4 HUD and radar.
- V5 VFX pass.
- V6 lighting, fog, and perf pass.

## Gate log
Record each gate here: date, what was played, who played, what felt bad.

- 2026-10-17, M1 first look (not the full gate): played by Joseph for a short session. Feels fine for now. Known issue: the camera clips through walls when pressed against them, deferred. Shot camera shake turned off because it made the camera bounce. The one-hour gate is still to do.
- 2026-10-17, M1 gate passed by Joseph's call after a short session (not a full hour). Wall camera clipping deferred. Moving to M2.
- 2026-10-17: Unity prototype M1 reached a first look, then the project moved to the web. M1 restarts in TypeScript. The Unity feel numbers (walk 8, run 16 m/s, jets, stamina) are the starting point, not a pass.
- 2026-10-17: M1 (web) passed by Joseph's call after playing it. Camera raised and crosshair added during the playtest. Moving to M2.
- 2026-10-17: M2 built, waiting for its gate. To play: `npm run server`, `npm run dev`, open two tabs at http://localhost:5173/?online.
- 2026-10-17: M2 passed by Joseph's call after two-tab play: players see each other, shots show. Bullets do not hit mechs yet, by design (M3). Moving to M3.
- 2026-10-17: M3 built, waiting for its gate. To play: stop any old server, `npm run server`, `npm run dev`, open two tabs at http://localhost:5173/?online. Shoot the other mech, press G for a grenade. Tuning panel sliders only change your own client, so online they can rubber-band you.
- 2026-10-17: M3 passed by Joseph's call after two-tab play. Requested during the playtest: tap Shift to dash. Added to the movement sim (below). M4 not started.
- 2026-10-17: Dash (double-press Shift, or double-press a direction key) passed by Joseph's call after playing it. M3 stays passed. M4 not started.
- 2026-10-17: M4 started on Joseph's go. Plan: collision grid first, then chunk generation, validation, navigation grid, wire to server and client.
- 2026-10-17: M4 built, waiting for its gate. To play: stop any old server, `npm run server` (builds a medium map from a random seed; set `TIER=small|large`), `npm run dev`, open two tabs at http://localhost:5173/?online. Both should see the same map. Offline: `?tier=small&seed=5`, add `&overview` to look down on it. Not in M4 by design: bots and path finding (M5), loot density check (M6), real chunk art (V3).
- 2026-10-17: M4 passed by Joseph's call after playing it. Controls changed during the playtest: double-press W sprints, Shift dashes in any direction. M5 not started.
- 2026-10-17: M5 started on Joseph's go, split into gates 5a (rooms by link, match loop, ring, spectating), 5b (bots, bot fill, nearby-only updates), 5c (radar, soak test, numbers).
- 2026-10-17: Gate 5a built, waiting for its playtest. To play: `npm run server`, `npm run dev`, open http://localhost:5173, Create room (small is quickest), copy the invite link into a second tab, press Enter in the first tab to start. Check: countdown, ring text, knockout and spectating, results, the next match starting alone with a new map. Bots, radar and the soak test are 5b and 5c.
- 2026-10-17: Simple bots added early for testing 5a. Menu has a bots choice, or use `?create&tier=small&bots=5`. This is not gate 5b, which still covers path finding, difficulty levels, level of detail and nearby-only updates.
- 2026-10-17: Damage now works in the lobby too (quick respawn, no effect on matches), so bots can be shot in practice. Only the countdown is safe.
- 2026-10-17: Gate 5a passed by Joseph's call, played with the simple bots, radar and lower delay. The 5 second countdown, damage in the lobby, and bots fighting each other were all added during the playtest. 5b and 5c not started.
- 2026-10-17: Gate 5b started on Joseph's go, with the binary packing pulled forward from M8 so bandwidth can meet the 64 kbps budget. Measured before starting: 272 / 673 / 1279 kbps per client on small / medium / large with bots.
- 2026-10-17: Gate 5b built, waiting for its playtest. Rooms fill themselves with bots to the tier size (12 / 24 / 40 players). Check: bots go round buildings and walls, easy / normal / hard feel different, a big medium room stays smooth, the F1 panel numbers. Network is now binary and nearby-only: 40 / 53 / 63 kbps measured on small / medium / large. Also fixed: a bug that could lift a mech onto the top of a wall.
- 2026-10-17: Gate 5b passed by Joseph's call after playing it. 5c (radar polish, the headless soak test per tier, the rooms-per-process number) not started.
- 2026-10-17: Gate 5c started on Joseph's go: radar polish, headless soak test per tier, rooms per process.
- 2026-10-17: Gate 5c built, waiting for its playtest. Check: the radar arrow points the right way and reads well, `npm run soak` passes on all three tiers. Soak and rooms-per-process numbers are in docs/PERF.md. That would finish M5.
- 2026-10-17: During the 5c check: added the 200 m Arena tier for quick tests (menu default), and sound on the radar: mechs beyond 40 m only show when they make noise (pulled forward from M6). Soak passes on arena, small, medium and large.

