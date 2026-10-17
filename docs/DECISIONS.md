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

## 2026-10-17: Plain `ws` server with our own Room, not Colyseus
Prediction and interest management are custom anyway, and Colyseus's automatic state sync would fight them. The Room class is about 150 lines, has no transport inside it, and is tested without sockets. Cost: no built in matchmaking or room lists, we write those at M5.

## 2026-10-17: Every input is processed once, in order, at most two per tick
The server steps a player once per received input, not once per server tick. That keeps the client's recorded history and the server in lockstep, so replaying after a snapshot reproduces the server exactly (tested to 1e-6 under latency). The two per tick cap lets a lagging client catch up but stops anyone speeding up by sending extra inputs. Cost: a player who stops sending simply freezes.

## 2026-10-17: Shots aim at a point the client sends (M2 stand-in for the open aim rule)
The input carries the world point under the crosshair. The server fires from its own barrel position toward it, rate limited on the player's step clock. So the crosshair stays accurate with our over the shoulder camera, and a client cannot fire faster or from somewhere else. Clients ignore the server echo of their own shots. M3 still decides the real rule and adds hit checks.

## 2026-10-17: JSON messages, everyone sees everyone (for now)
Easy to read while building. Binary packing and nearby only snapshots come at the bandwidth pass (M8) and with bots (M4/M5). Cost: inputs cost roughly 48 kbps upstream, near the 64 kbps budget, so this must be packed before bots and 8 players.

## 2026-10-17: Aim rule: the camera picks the point, the barrel has to be able to reach it
The client sends the world point under the crosshair. The server fires from the barrel toward that point. If a wall is between the barrel and the point, the shot hits the wall. So what the crosshair shows is almost always what you hit, and peeking round corners with the barrel still counts. Settles the open question from M1.

## 2026-10-17: Hitscan with a short rewind, not flying bullets
The server checks a shot instantly against where each target stood about 150 ms ago (data/combat.json), because the shooter was looking at a slightly old picture. The flying bullet on screen is only a fast tracer. Real projectile hits would need lag compensation on every flight frame for little gain at this speed. Cost: the 150 ms is a fixed guess, not each player's measured delay, and the rewind makes it possible to be hit just after running behind cover.

## 2026-10-17: Grenade splash hits every zone, walls block it
A blast damages legs, arms and torso together, scaled by distance, so a close one wrecks parts and makes a story. Includes the thrower. Client and server fly the same deterministic arc, so only the throw and the blast are sent.

## 2026-10-17: Destroyed mechs respawn after 3 seconds (stopgap until M5)
Torso at zero destroys the mech. It looks around but cannot move or fire, then returns at its spawn with full health. This keeps playtests rolling until the real match loop and spectating land at M5.


## 2026-10-17: Pressing Shift dashes at once, holding it runs
First version waited for the key to come up to tell a tap from a hold, which added up to 0.2 s of delay and felt bad. Now the dash fires on the press itself, and a held Shift carries on as a run. The dash is a short fixed burst toward where you steer (straight ahead if standing still), costs stamina, and has a cooldown, all in data. It lives in the shared movement step, so the server decides it and prediction replays it exactly. Cost: starting a run always starts with a dash while stamina and cooldown allow it. If that gets annoying, tune the cost or make the dash need a direction key held.
