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
