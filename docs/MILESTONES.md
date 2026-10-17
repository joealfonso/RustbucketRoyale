# Milestones

Current code milestone: M1
Current visual milestone: V1 (not started)

Update the two lines above when a gate passes. Claude Code reads this file first every session and works only on the current milestone.

## Code
- M1: one mech walks, runs, jets, shoots on a fixed grey-box map, offline. Gate: it is fun on its own for an hour. Also test run speed against a 2000 m distance.
- M2: host mode, 2 clients, prediction and reconciliation.
- M3: weapons, grenade, armor, host side hit zones, over the shoulder aim rule.
- M4: seeded chunk generation, validation, runtime navmesh, three size tiers.
- M5: zone ring, bots with level of detail, radar, full match loop with friends and bot fill.
- M6: destructible props, loot drops, noise, looting wrecks.
- M7: part damage, broken states, crawl, repair.
- M8: upgrades, tuning pass with the debug panel, perf pass, bot count tuning from soak data.

## Visual
- V1 style test: one grey-box mech and one chunk in engine with the toon shader, outline, palette, and lighting. Gate: screenshots at 10 m, 50 m, and 150 m read well on a mid-range GPU before any more assets get made. Draw three thumbnail silhouettes of the first mech on paper before opening Blender, and keep the scan of the chosen one in the repo next to the screenshots. Also build the asset import checker (`Assets/Editor/Import/`) that fails an import over the triangle budget, with the wrong naming, or without the master toon material.
- V2 mech kit: modular parts, three damage states each, LODs, VFX hooks.
- V3 junkyard chunk kit and destructible props.
- V4 HUD and radar.
- V5 VFX pass.
- V6 lighting, fog, and perf pass.

## Gate log
Record each gate here: date, what was played, who played, what felt bad.

- 2026-10-17, M1 first look (not the full gate): played by Joseph for a short session. Feels fine for now. Known issue: the camera clips through walls when pressed against them, deferred. Shot camera shake turned off because it made the camera bounce. The one-hour gate is still to do.
