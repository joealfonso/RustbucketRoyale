# Game design: Rustbucket Royale

Casual 3D mech battle royale built for fun first. Players drop in, a safe zone ring shrinks in stages, last mech standing wins.

## Match setup
- Players: up to 8 humans per match. Bots fill the rest, and there are many more bots than humans.
- Match length: 8 minutes on every map tier.
- Maps: procedurally generated every match from a seed. Three tiers: small 300 m, medium 1000 m, large 2000 m. A 200 m Arena exists for quick tests only. The room creator picks the tier in the lobby, default medium.
- Bot target per tier (starting guesses, tune with the soak test): small 12, medium 24, large 40. Bots fill up to the target minus the humans present.
- Camera: third person, over the shoulder, with wall collision so it never clips through geometry.

## World generation
- The server picks a seed and sends only the seed. The server and every client build the same map from it. Generation is deterministic: same seed, same result. Never use unseeded random calls or anything time based in generation code.
- Use integer math for placement decisions. Floats can differ between CPU architectures (different browsers and CPUs), so floats only appear after decisions are made, for visuals.
- Build maps from hand-made chunks (buildings, ruins, cover clusters, open ground) placed on a grid. No fully random terrain in v1.
- Validation after generation: regenerate the seed if spawns are blocked, the map is not connected, or loot density is out of bounds.
- The server builds a navigation grid at match start, for bots only. Check build time on the large tier and chunk it if it blows the generation budget.
- Loot counts, ring timings, bot targets, and prop density scale from map area, all in data files.
- Ring timing: the ring finishes closing inside the 8 minute match on all tiers. If the large map is not crossable at normal run speed in that time, say so and propose a fix (faster run speed, smaller first ring, or a ring that starts partly closed) instead of silently changing values.

## Mechanics
- Zone: outer ring closes in stages. Wait time, shrink time, and damage per second per stage live in a data file per tier.
- Loadout: 2 weapons, 1 grenade type weapon, a few armor parts. All stats in data files.
- Part damage: three hit zones for v1 (legs, arms, torso), each with intact, damaged, and broken states, clearly visible on the mech and in the HUD. Hits resolve on the server. Shots come from the camera ray then the weapon, and the rule for which wins is documented in DECISIONS.md.
- Broken legs: the mech can crawl or hover at reduced speed. Repair is slow, interruptible, cancelled by damage, and upgradeable. Losing a leg should feel like a story, not a punishment.
- Movement: WASD, mouse look, hold Shift to run (drains stamina or heat), Space for jump jets (limited fuel, upgradeable). Client predicted, server corrected.
- Destruction: props are discrete objects with a seed derived ID and one replicated state (intact or destroyed). No mesh fracturing. Destroying a prop drops loot and makes noise. It does not change the navmesh in v1.
- Noise: every action has a loudness value in a data file (walk, run, jets, weapons, prop destruction, looting, repair). Players inside the radius see a radar pulse at a fuzzed position, never the exact one. Bots react to the same noise events through the same path.
- Looting others: a killed mech leaves a wreck. Looting is timed, interruptible, and noisy.
- Radar: shows the zone edge and noise pulses, plus mechs within a short direct detection range. Range is upgradeable.
- Upgrades: found in match only, a small set of big obvious choices. No accounts, no saved progression.

## Bots
- Use the same input struct as humans. Easy, normal, and hard tiers. Avoid the zone, loot props, react to noise, fight, retreat to repair. Easy bots should be beatable and a little funny.
- Level of detail: a bot within twice the detection range of any human runs full AI. A bot farther away runs a cheap mode (low tick rate, no perception checks, coarse pathing, ring avoidance only) and switches to full AI when a human or noise event gets close. Bot versus bot fights far from humans can resolve abstractly. Distance thresholds and tick rates are data values.
