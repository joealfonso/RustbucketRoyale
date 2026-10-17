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


## 2026-10-17: Double-press W to sprint, Shift to dash
Earlier versions tried tap-Shift, press-Shift and double-press for dashing. Each was fiddly: waiting for release added delay, firing on press made every run start with a dash. Final: two quick presses of W (0.25 s, data/mech.json) start a sprint that lasts while W is held, and Shift dashes at once toward where you are steering, in any of the eight directions, or straight ahead if you are standing still. Holding Shift no longer runs. The dash is a short fixed burst, costs stamina, and has a cooldown, all in data. Both live in the shared movement step, so the server decides them and prediction replays them exactly. Cost: sprinting means releasing and re-pressing W, and a sprint that ran out of stamina carries on by itself once stamina refills if W is still held. Double-tapping A, S or D no longer dashes. Bring that back if you miss it.

## 2026-10-17: Collision grid before generated maps
A 2000 m map has about 12,000 boxes, and every shot, grenade, camera ray and mech step used to test every box. The map now lives in a flat grid of 16 m cells (`World`), and each query only touches the boxes near it. Tested against the old brute force on 2000 random rays. Cost: boxes are only grouped by footprint, so very tall or huge boxes (the ground, the edge wall) sit in many cells.

## 2026-10-17: The map comes from a seed, retries use derived seeds
The server picks a seed and tells clients the seed and tier. Everyone builds the same map from chunk templates in `data/chunks.json`, placed on a grid with integer decisions only and a 32 bit seeded generator (`SeededRng`). If a map fails its checks (blocked spawn, spawns that cannot reach each other, too much sealed off ground), the next attempt uses a seed derived from the first, so every machine ends up on the same map. Tested for 1000 seeds built twice. Cost: chunk numbers must be exact halves and spawnable chunks must keep their middle clear, both checked by tests.

## 2026-10-17: Walkability is a height map with step checks, not a mesh
Each 2 m cell remembers the height of what a mech could stand on. Two neighbours connect when the step between them is within the climb height, so stairs and terraced hills connect, walls do not, and roofs above head height are ignored. The server keeps this grid for bots at M5. Cost: it cannot tell a jets-only rooftop from ground, so those cells just do not count towards "connected ground".

## 2026-10-17: A text scan, not ESLint, guards generation
typescript-eslint does not support our TypeScript 7 yet, so `scripts/check-determinism.ts` scans the generation folder for Math.random, clocks, Date, crypto, engine dependent maths and `**`, with its own tests. Revisit when ESLint catches up; swap it for a real rule then.

## 2026-10-17: Small map spawns sized to the bot target
Small allows 16 spawns, medium 32, large 56, a little over the bot targets in the design (12, 24, 40 players in total including humans). The first guess of 24 on small could not be met on a 6 by 6 chunk map.

## 2026-10-17: Rooms by code, many in one server process
A link like `?room=ABCD` joins that room, and the server makes it if it does not exist. `?create` makes a new room with a fresh code, and the page rewrites its own address to the invite link. A room closes when its last player leaves. A server has a room cap. Scaling is more rooms and more processes, never a bigger room. Cost: room codes are the only access control, which is fine for casual play with friends, and the server does not yet check where a connection comes from.

## 2026-10-17: A match runs lobby, countdown, active, results, and then starts again by itself
The room's host presses Start once. After that every match follows the last with no clicks, which is the "no dead time" rule. If you want to stop, you leave. Each match gets a fresh seed and map, so the next game is never the same arena. Cost: building a map takes up to about 160 ms on the server on the large tier, and the same on every client.

## 2026-10-17: Knocked out means watching, not respawning (replaces the 3 second stopgap)
A mech whose torso hits zero is out for the match. Its player watches a mech that is still standing and clicks to switch. Someone who joins mid match can only watch. Damage, grenades and the ring only do anything while a match is active, so the lobby and countdown are safe to mess around in.

## 2026-10-17: The ring is a schedule, chosen once, damage on every zone
The server picks each stage's circle when the countdown starts and sends the whole schedule. Clients draw the ring from that schedule and the match clock, with no per frame updates. Standing outside takes damage on all three zones every tick, scaled by stage. Circles are chosen so the edge never moves faster than 90% of walk speed, even in the worst case, and a test checks 300 random rings per tier. Numbers are guesses to tune. If the match clock runs out the healthiest survivor wins.

## 2026-10-17: Simple bots now, the full bot system stays at 5b
Pulled forward so there is something to test against: bots run on the server, produce the same input a person's keyboard does, and go through the same movement and combat code. Each one sees whoever is close and in line of sight, aims a few degrees off, holds a comfortable distance and strafes, throws a grenade now and then, heads for the middle of the ring when it is near the edge, and jumps when stuck. They roam and fight in the lobby and between matches too, where nothing does damage, and only freeze for the countdown. One set of numbers in `data/bots.json`, tuned to be beatable. A room gets them from `?create&bots=N` or the menu, up to what the map has spawns for. Left for 5b: easy, normal and hard, path finding round walls, level of detail for far away bots, nearby only snapshots, and filling to a target count as humans join. Cost: they walk straight at things and rely on jets to get unstuck, so they will look dumb around buildings.

## 2026-10-17: The mech body faces where you look, instantly
The body used to swing round at 240 degrees a second to add weight, and it read as lag against the camera. `turnSpeedDegrees` in `data/mech.json` is now 0, which means the body snaps to the aim direction every step, and your own mech is drawn at the camera's exact yaw between steps. Weight still comes from acceleration and deceleration. Set the number above 0 to bring the swing back. Cost: other players' bodies still arrive about 100 ms late, because they are drawn from network snapshots.

## 2026-10-17: Bots come to you between matches, and a first radar
On a Medium map the bots spawned spread across 1000 m and were never in sight, so it looked like there were none. Between matches they now wander within about 70 m of the nearest person and only go for people, not each other. During a match they fight everyone, as before. A small round radar (bottom right) shows mechs within 150 m (`data/hud.json`), bots red, people blue, with you in the middle, forward up, and the ring edge as blue dots. This is the first cut of the 5c radar: it has no noise pulses yet.

## 2026-10-17: Cutting delay without cutting smoothness
Others are drawn on the server's own clock, placed by the tick number on each snapshot, not by when the packet happened to arrive. Their delay is one snapshot interval plus a 15 ms buffer, and it grows only by three times the measured jitter, up to 200 ms. On a clean connection that is about 69 ms where it used to be a fixed 100 ms. Tested against steady jitter: no frame stands still or leaps. Hit checks used to rewind every target by a fixed 150 ms. Now each client reports how far behind its view is (ping plus that delay) with its inputs, and the server rewinds by that, capped by `lagCompensationMs` (250 ms), so a shot lands where it was aimed and a clean connection is not rewound further than it needs. Ping is measured from acknowledged inputs minus the time the server held them. The mouse is locked in raw mode where the browser allows it, so there is no operating system smoothing, and the renderer asks for the high performance graphics chip. Left alone on purpose: the 60 Hz fixed step with blended drawing (up to 16 ms, needed so client and server agree exactly), snapshots at 20 Hz (30 Hz would use half as much bandwidth again, and we are already over the 64 kbps budget until the binary packing at M8), and drawing our own mech slightly ahead (it would clip into walls). Cost: a client can claim any lag up to the cap, which is accepted for a casual game.

## 2026-10-17: Rooms remember their bots, and new rooms get 5 by default while testing
Rooms disappear when the server restarts, and reloading a `?room=CODE` link then quietly made a new empty room with no bots, which looked like bots had vanished. The page address now keeps the room's tier and bot count, and the server gives any new room 5 bots unless the link says `&bots=N` (`DEFAULT_BOTS` changes the default, `&bots=0` means none). The countdown is now 5 seconds (`data/match.json`). Cost: during testing every new room is crowded. Drop `DEFAULT_BOTS` to 0 before real players arrive.

## 2026-10-17: Damage works in the lobby too, with a quick respawn, so bots can be tested
Before, damage only counted in a running match, so shooting a bot in the lobby did nothing and looked broken. Now everything does damage except during the countdown. Outside a match a destroyed mech (a bot or a person) just comes back after 3 seconds with full health, with no knockout, no place, and no effect on the match. In a match nothing changes: out is out. Bots in the lobby shoot at people, so a person standing still will be hit and respawn too. Cost: the lobby is no longer a calm place to wait. Add a safe lobby mode later if friends find it annoying.

## 2026-10-17: Bots fight each other all the time
First I had bots in the lobby ignore each other so they would come to you. You wanted them fighting each other too, so every bot now targets whoever is nearest, person or bot, in every phase. They still wander toward the nearest person when nobody is in sight, so a room does not scatter out of view. Cost: a quiet lobby can turn into a bot brawl a little way off.

## 2026-10-17: Packed binary for snapshots, shots and inputs, and only what is near (pulled forward from M8)
With bots, every client was being sent every mech as readable text: 272 kbps on small, 673 on medium, 1279 on large, against a 64 kbps budget. Snapshots, shots and inputs now travel as packed numbers (`packages/shared/src/wire.ts`, tested round trip and against tampering), and the rare messages (room, results, welcome) stay text. Other mechs are rounded to 10 cm sideways and 5 cm up, and your own state keeps float precision so replaying your movement still lines up. The client rounds its aim to float precision before using it, so both sides run identical numbers. A client is sent only mechs within 250 m (staying in view until 288 m so the edge does not flicker) and only shots, grenades and blasts near it or caused by it. People watching, because they are knocked out or arrived late, get everyone. Cost: messages can no longer be read by eye. The measure script prints sizes instead.

## 2026-10-17: Bots get difficulty, routes, a cheap far mode, and rooms fill themselves
Bots come in easy, normal and hard in `data/bots.json` (50, 35 and 15 percent by default): the harder ones aim closer, wait less before firing, turn faster, see further and dash sideways to dodge. Shots are instant on the server, so there is no leading a target to model. Far goals are walked to along a planned route (A star on a coarse 8 m grid made from the navigation grid, capped at 6000 cells a search, straightened afterwards), and a bot that cannot find a route goes straight, so nothing is ever left without a heading. A bot with no person within 300 m thinks and moves four times a second, never looks for targets, and two such bots that meet fight on paper: the stronger tends to win. A room tops itself up to 12, 24 or 40 players on small, medium and large, counting people, makes room as people arrive in the lobby, and tops up again for each new match. A link with `&bots=N` overrides that. Cost: routes keep to open ground, so bots will not walk up stairs or into buildings, and the coarse grid occasionally closes a pocket a bot could really have left.

## 2026-10-17: Fixed mechs being lifted onto the top of walls
A mech pushed flush against a wall could read as a hair inside it from rounding, and the vertical step then set it on top of the wall. The overlap test now ignores touching within 0.1 mm. A test sends a sprinting mech at 300 walls with awkward numbers.

