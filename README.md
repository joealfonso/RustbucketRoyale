# Rustbucket Royale

A casual 3D mech battle royale that runs in the browser. TypeScript, Three.js, and a Node game server that is authoritative and runs the bots.

The first Unity prototype is on the `unity-prototype` branch, kept for reference.

## Where things are
- `CLAUDE.md`: the short always-loaded brief for Claude Code.
- `docs/MILESTONES.md`: the current milestone and its playtest gate.
- `docs/GDD.md`, `DESIGN.md`: game design and visual design.
- `docs/DECISIONS.md`: why things are the way they are.
- `docs/PERF.md`: budgets and measurements.

## Run it
```
npm install
npm run dev
```
Open http://localhost:5173, click the page, play. F1 opens the tuning panel.

To play online, start the server in a second terminal and open two tabs:
```
npm run server
```
http://localhost:5173/?online

## Status
M1 passed. M2 (authoritative server, two browsers, prediction) is built and waiting for its playtest gate.
