# Rustbucket Royale starter pack

Drop-in setup for building the game with Claude Code. Nothing here is a Unity project yet.

## Setup

1. In Unity Hub, create a new Unity 6 project with the URP template. Put it in an empty folder.
2. Copy everything from this pack into that folder. Keep the hidden folders (`.claude`, `.github`).
3. In the folder run `git init`, then `git lfs install`, then make a first commit.
4. Make the scripts runnable: `chmod +x scripts/*.sh .claude/hooks/*.sh`.
5. If Unity is not in the default Hub location, export `UNITY_PATH` pointing at the editor binary. Install the Linux Dedicated Server build module for your editor version.
6. Add three GitHub repo secrets for CI: `UNITY_LICENSE`, `UNITY_EMAIL`, `UNITY_PASSWORD`. Check the activation steps against the GameCI docs at game.ci before the first run, since the license flow changes.
7. Run `claude` in the project folder, switch to plan mode, and run `/context` to confirm `CLAUDE.md` loaded.
8. Start with milestone M1 in `docs/MILESTONES.md`.

## What is in here

`CLAUDE.md` is the short always-loaded brief. Everything bigger lives in `docs/` and `DESIGN.md` and gets read only when a task needs it. The three files in `.claude/rules/` load themselves when Claude touches matching folders. `.claude/settings.json` blocks hand edits to scenes and prefabs, asks before touching project settings or the package manifest, and runs a determinism check on generation code after every edit.

## Things to know

- `Assets/Editor/Build/BuildScript.cs` was written without a Unity install to compile against. Expect to fix a line or two.
- The nightly soak step stays skipped until `scripts/soak.sh` exists (milestone M5).
- Batch mode cannot open a project that the editor has open. Close the editor before running scripts.
- Dependabot covers the GitHub Actions only. Check Unity packages yourself now and then.
- Float math can differ between Mac ARM and Windows x64. That is why generation placement uses integers.
