# Rustbucket Royale

3D mech battle royale, casual and fun first. Easy to pick up, a blast to play. Unity 6 (C#, URP), Photon Fusion 2 in host mode (one player hosts and is authoritative, bots run on the host). Up to 8 humans plus many more bots, 8 minute matches, maps generated from a seed in three tiers (300 / 1000 / 2000 m). Third person over the shoulder, WASD plus mouse, PC (Windows, Mac, Linux).

I am a solo developer and a professional product designer. I read code, but we write most of it together. Write it the way a careful human teammate would.

## Read these when the task touches them
Open these on demand. Do not import them.
- `docs/MILESTONES.md`: the current milestone and its gate. Read it first every session.
- `docs/GDD.md`: mechanics, world generation, bots, noise, part damage.
- `DESIGN.md`: palette, shading, damage states, HUD, asset intake. Read before any art, shader, VFX, or UI work.
- `docs/DECISIONS.md`, `docs/PERF.md`, `docs/ASSETS.md`, `docs/MECHS.md`.

## How to work
- Do only the milestone named in `docs/MILESTONES.md` or by me. Do not build ahead.
- Before writing code, list the files you will touch and any assumption you are making. Then write it.
- If my request conflicts with these rules or has a flaw, say so before building it.
- If a system makes the game more complicated without making it more fun, say so.
- Do not add features I did not ask for. Do not leave placeholder comments that pretend to be finished work.
- Plain names, small files, one job per component, no speculative abstractions. Comments explain why, never what. If something is a guess, say so in a comment or in your reply.
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
- Small components, one job each. No singletons for gameplay state.
- All tuning values live in ScriptableObjects or data files. No magic numbers in gameplay code.
- Visuals are separate: use grey-box placeholders and expose every art hook (mesh, VFX, audio) through a clearly named prefab or ScriptableObject slot.
- Folder layout: `Assets/Scripts/{Core,Net,Mech,Combat,Zone,Bots,Generation,UI}`, editor tools in `Assets/Editor/`.
- Each non-obvious choice gets two or three lines in `docs/DECISIONS.md`.

## Networking and security
- The host is authoritative. Validate fire rate, ammo, fuel, cooldowns, and loot range on the host. Never trust a client.
- Basic lag handling for hits, nothing elaborate. Interest management: clients only receive nearby data, and bots are never replicated as full players to far clients.
- Rate limit all RPCs. No anti-cheat in v1.
- No secrets or keys in the repo. Use environment variables and CI secrets. Logs never contain tokens or personal data.

## Performance
- Budgets: 60 fps on a mid-range GPU for clients, host holds 60 fps on a mid-range PC with its bots on the large tier, 30 Hz network send rate, under 64 kbps per client, map generation under 3 seconds on small and medium.
- Object pooling for projectiles and VFX. No allocations in Update loops.
- Profile before optimizing. Record numbers in `docs/PERF.md`.

## Unity rules
- Never hand-edit `.unity` or `.prefab` files (edits are denied in settings). Create or change scenes and prefabs with editor scripts in `Assets/Editor/`, or tell me what to do in the editor.
- Never delete or regenerate `.meta` files. Moving a file means moving its `.meta`.
- `.asset` files (ScriptableObjects): prefer `[CreateAssetMenu]` plus editor scripts that create defaults. If you must edit one by hand, change values only, never GUIDs or fileIDs.
- Ask before touching `ProjectSettings/` or `Packages/manifest.json`.
- Code only compiles when the editor or batchmode runs. After changes, run the test script and read `artifacts/` results. Do not assume it compiles.
- Close the Unity editor before running scripts. Batchmode cannot open a project the editor has open.
- One working checkout. Do not use worktrees: each needs its own `Library` folder and a full reimport.
- Generation code uses `SeededRng` only. Never `UnityEngine.Random`, `System.Random`, or anything time based. A hook flags violations.

## Commands
- `./scripts/test.sh editmode` or `playmode` or `all`: run Unity tests headless, results in `artifacts/`.
- `./scripts/build-server.sh`: Linux dedicated server build for CI and soak tests, output in `Builds/LinuxServer/`.
- Set `UNITY_PATH` if Unity is not at the default Hub location for the version in `ProjectSettings/ProjectVersion.txt`.

## Testing and CI
- Edit mode tests for pure logic: damage zones, ring math, upgrade stats, noise radius, bot LOD switching.
- A determinism test generates 1000 seeds twice and compares output.
- A headless bot-only match per tier runs the full 8 minutes on a random seed and fails on crash, desync, or blown budget. Log the seed on failure.
- CI (GitHub Actions with GameCI) runs on every PR. Block merges on red. See `.github/workflows/`.
- Git: small commits with plain messages, one concern per PR, branch per feature. Binary assets go through Git LFS.
