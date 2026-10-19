# Rustbucket Royale

3D mech battle royale, casual and fun first. Easy to pick up, a blast to play, runs in a browser tab with nothing to install. TypeScript, Three.js, a Node game server that is authoritative and runs the bots. Up to 8 humans plus many more bots, 8 minute matches, maps generated from a seed in three tiers (300 / 1000 / 2000 m). Third person over the shoulder, WASD plus mouse, desktop browsers first.

I am a solo developer and a professional product designer. I read code, but we write most of it together. Write it the way a careful human teammate would.

The first version was a Unity prototype. It lives on the `unity-prototype` branch for reference only. The web version replaced it because the game must be reachable by link and able to scale.

## Read these when the task touches them
Open these on demand. Do not import them.
- `docs/MILESTONES.md`: the current milestone and its gate. Read it first every session.
- `docs/GDD.md`: mechanics, world generation, bots, noise, part damage.
- `DESIGN.md`: palette, shading, damage states, HUD, asset intake. Read before any art, shader, VFX, or UI work.
- `docs/MECH_ROSTER.md`: the four launch mechs and the hangar. Read before any mech model work.
- `docs/DECISIONS.md`, `docs/PERF.md`, `docs/ASSETS.md`, `docs/MECHS.md`.
- `docs/DEPLOY.md`: hosting on Fly.io, before any deploy or server config work.

## How to work
- Do only the milestone named in `docs/MILESTONES.md` or by me. Do not build ahead.
- Before writing code, list the files you will touch and any assumption you are making. Then write it.
- If my request conflicts with these rules or has a flaw, say so before building it.
- If a system makes the game more complicated without making it more fun, say so.
- Do not add features I did not ask for. Do not leave placeholder comments that pretend to be finished work.
- Plain names, small files, one job per module, no speculative abstractions. Comments explain why, never what. If something is a guess, say so in a comment or in your reply.
- Every milestone ends with a playtest gate. Tell me when it is ready for the gate. Never start the next milestone on your own.

## Fun rules
- Game feel comes first: movement weight, jump jet response, hit feedback, screen shake, and sound hooks get tuned before later systems are built on top.
- Every system must create a good story or a good clip. If it only adds a rule, propose cutting it.
- Keep it simple to learn. Few systems, each obvious on screen. Teach by play, not by text.
- No dead time. Eliminated players spectate and can join the next match in one click.
- Prefer fun over fair. Slightly overpowered weapons and funny bots are welcome. Balance changes are data changes, never code changes.
- Damage must be readable on the mech itself, not only in the HUD. Every hit zone state exposes art hooks (sparks, smoke, bent metal, missing parts).
- Keep an in-game debug panel for changing tuning values live during playtests.

## Architecture
- npm workspaces: `packages/shared` (simulation rules, data types, seeded generation, message formats), `packages/client` (Three.js, input, HUD, audio), `packages/server` (rooms, bots, validation). Shared code has no DOM and no Node-only imports, so the client can predict with the exact code the server runs.
- Small modules, one job each. No global mutable gameplay state.
- All tuning values live in JSON files under `data/`, validated on load. No magic numbers in gameplay code.
- Visuals are separate from simulation: grey-box placeholders, with every art hook (model, VFX, audio) exposed through a named entry in a data file.
- Each non-obvious choice gets two or three lines in `docs/DECISIONS.md`.

## Networking and security
- The server is authoritative. It validates fire rate, ammo, fuel, cooldowns, and loot range. Never trust a client.
- Clients predict their own mech and reconcile against server snapshots. Basic lag handling for hits, nothing elaborate.
- One match is one room. Scaling means more rooms and more server processes, never a bigger room. Interest management: clients only receive nearby entities, and bots are never sent in full to far clients.
- Rate limit every message type. No anti-cheat in v1.
- No secrets or keys in the repo. Use environment variables and CI secrets. Logs never contain tokens or personal data.

## Performance
- Budgets live in `docs/PERF.md`. Client targets 60 fps on a mid-range laptop. Download size, server cost per room, and network rate are budgeted there too.
- Object pooling for projectiles and VFX. No allocations in the frame loop.
- Profile before optimizing. Record numbers in `docs/PERF.md`.

## Determinism
- Generation code uses `SeededRng` only. Never `Math.random`, `Date.now`, or anything time based. The gauntlet scans `packages/shared/src/generation/` for banned calls (`scripts/check-determinism.ts`), because the TypeScript lint tools do not support our TypeScript version yet.
- Placement decisions use integer math. Floats only appear after decisions, for visuals.

## Commands
- `npm install`: once after cloning.
- `npm run dev`: client dev server at http://localhost:5173. Opens a start menu: create a room, join by code, or practice offline.
- Rooms top themselves up with bots to the tier size. `?create&tier=small&bots=5` fixes the count instead, `&bots=0` means none.
- `npm run server`: the game server on ws://localhost:8080. Set `PORT`, `TIER` (default tier for new rooms), `DEFAULT_BOTS` (a number for every new room instead of filling to the tier size) and `MAX_ROOMS`. Rooms are made on demand from `?create` or `?room=CODE` links.
- `npm run build` then `npm start`: production mode, as on the public host: one address serves the page and the game (PORT, default 8080), compressed, game connections only from its own pages (or `ALLOWED_ORIGINS`), `/health` for the host. `Dockerfile` builds the same as an image.
- `DEV_TUNING=1 npm run server`: the same, with live tuning: the F1 panel changes gameplay numbers for everyone in the room. Never on a public host.
- Offline practice: `?offline&tier=small|medium|large|range&seed=123`. Add `&overview` to look down on the whole map.
- `npm test`: Vitest. `npm run typecheck`: TypeScript. `npm run build`: production client build.
- `npm run gauntlet`: typecheck, the determinism scan, the asset checker (`scripts/check-assets.ts`: models in `assets/models` against `data/assetRules.json`), tests (including a real two-client server test and a full small-tier soak match), and build in one pass or fail verdict. Results in `artifacts/`.
- http://localhost:5173/style.html with `npm run dev`: the V1 style test, keys 1 / 2 / 3 for 10, 50 and 150 m.
- `npx tsx scripts/make-standin-mech.ts`: rewrites the stand-in mech kit in `assets/models/mechs/standin/`. Add `&kit=standin` (or `&kit=standin-one`, the one-file form) to a game link to draw mechs from a kit (`data/mechKits.json`), The roster is the default: each player is dealt a roster mech by player number; `&kit=grey` draws grey boxes.
- `npx tsx scripts/mechs/<name>.ts`: rebuilds one roster mech (ironclad, stiletto, cataclysm, arbiter) from its script, using the shapes in `scripts/assets/shapes.ts`. Then `npx tsx scripts/merge-mech-kits.ts` (copies its parts and paint scheme into `data/mechKits.json`) and `npx tsx scripts/make-hitboxes.ts` (measures its hit boxes).
- `npm run soak`: a whole match per tier as fast as possible, with checks and budgets. `npm run soak -- large` for one tier, `SEED=123` to replay a failure. Runs nightly in CI.
- `npx tsx scripts/measure-bandwidth.ts` and `npx tsx scripts/measure-rooms.ts`: bandwidth, tick cost and rooms per process. Record results in `docs/PERF.md`.
- `npx tsx scripts/load-test.ts [tier] [rooms]`: rooms per process with the real server and real WebSocket clients. `npx tsx scripts/measure-bots.ts [seeds] [tiers]` (with `FILL=medium:28`): how lonely and how fast matches are at a bot count. Record results in `docs/PERF.md`.

## Testing and CI
- Vitest for pure logic: damage zones, ring math, upgrade stats, noise radius, bot level of detail, movement and reconciliation.
- A determinism test generates 1000 seeds twice and compares output.
- A headless bot-only match per tier runs the full 8 minutes on a random seed and fails on crash, desync, or blown budget. Log the seed on failure.
- `npm run gauntlet` runs every check and prints one pass or fail verdict, for loop-driven work. It covers tests, never fun.
- CI (GitHub Actions) runs on every PR. Block merges on red.
- Git: small commits with plain messages, one concern per PR, branch per feature. Binary assets go through Git LFS.
