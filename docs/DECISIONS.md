# Decisions

Two or three lines per entry: what we chose, why, what it costs.

## 2026-10-17: Host mode, not dedicated servers
Photon Fusion 2 in host mode. One player hosts and is authoritative, bots run on the host. Casual game, so cheating risk is accepted and no server bill. A headless build exists for CI and soak tests only. Cost: host PC load grows with bot count, so bots far from humans run a cheap mode.

## 2026-10-17: Maps from hand-made chunks, not random terrain
The seed only decides which chunks go where. Every piece has been tested by a human, so balance stays testable. Fully random terrain is a possible v2.

## 2026-10-17: Integer math for generation decisions
Clients generate the map independently from the seed, and floating point can differ between CPU architectures. Placement decisions use integers and a custom `SeededRng`. Floats only appear after decisions, for visuals.

## 2026-10-17: In-match upgrades only
No accounts, no saved progression in v1. Avoids a server that stores player data.

## 2026-10-17: AI generated art is reference only
AI output is allowed for reference, mood, and blockout. Nothing AI generated ships as is. Everything is rebuilt and repainted by hand and logged in `docs/ASSETS.md`.

## Open: which wins when the camera ray and the weapon barrel disagree
Decide at M3 and record it here.

## 2026-10-17: Cinemachine 3 for the camera, direct Input System polling
Cinemachine's third person follow gives the over-the-shoulder camera, wall avoidance and screen shake (impulse) for free. Input is read straight from Keyboard and Mouse into a MechInput struct, with no action asset, so bots can fill the same struct later. Cost: rebinding keys will need real input actions later.

## 2026-10-17: M1 aim rule is a placeholder
Shots go from the muzzle to the point the camera ray hits, starting the ray in front of the camera so it skips our own mech. This is a guess for M1 only. The real rule is still the open question below, due at M3.

## 2026-10-17: Grounded comes from Move's collision flags
`CharacterController.isGrounded` flickered at high frame rates in headless tests, so the mech uses the Below flag returned by Move and sets minMoveDistance to 0.

## 2026-10-17: Gauntlet script as the gate for loops
`scripts/gauntlet.sh` runs every automated check and prints one verdict. A loop only counts an iteration if it passes. It covers tests only, never fun, so playtest gates stay human. New systems add their checks to it (determinism, map validation, import checker, soak) as they land. Cost: it closes nothing by itself, a weak check list gives a weak gauntlet.

## 2026-10-17: Rebuild for the web, server authoritative (supersedes the Unity and host mode entries)
The game must be reachable by link and able to scale, which Unity WebGL and a player-hosted browser tab cannot do well. So: TypeScript and Three.js client, Node server per room that is authoritative and runs the bots. Scale by adding rooms and processes. Cost: a server bill, a rewrite of M1, and no Unity tools. The Unity prototype stays on the `unity-prototype` branch.

## 2026-10-17: Not using Arrr.fun for now
Its ordered tick relay suits lockstep games with a deterministic simulation. Ours is server authoritative with prediction and interest management, and many bots. It is also a young third party dependency. Revisit only if we choose lockstep.

## 2026-10-17: Fixed 60 Hz sim, aim travels inside the input
The mech steps at a fixed 60 Hz and the render blends between steps. Each input carries absolute aim yaw and pitch, so the server can replay exactly what the client did at M2. Look is applied every frame so the camera answers the mouse at once. Cost: shots use the last rendered camera, so there is up to one frame of aim lag on the shot direction.

## 2026-10-17: Plain boxes for M1 collision
World collision is axis aligned boxes with simple step-up for low ledges, shared by client and server. Enough for the grey-box map and cheap to run for many bots. Cost: no slopes, so the old ramp became stairs. Revisit when real chunk art arrives.
