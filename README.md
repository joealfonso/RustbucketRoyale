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
Open http://localhost:5173 and pick "Create room", "Join room" or "Practice offline". Click the page to lock the mouse. WASD move, double-press W to sprint, Shift dashes, Space jets, click fires, G throws a grenade, F1 opens the tuning panel.

To play with friends, start the server in a second terminal, create a room, and send them the invite link (the room code is in the address):
```
npm run server
```

## Status
M5 passed: rooms by link, full matches with the shrinking ring, bots that fill the room, radar with sound, and a soak test. M6 (destructible props, loot, looting wrecks) is next.
