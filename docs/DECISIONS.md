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
