// Starts the game server as the public host runs it (NODE_ENV=production, serving the build from
// packages/client/dist) and checks it answers: health, the page, and a mech model compressed. Run after the build;
// the gauntlet does. Run: npx tsx scripts/check-production.ts
import { spawn } from "node:child_process";

// One process (node with the tsx loader, not the tsx wrapper), so stopping it stops everything it started.
const server = spawn(process.execPath, ["--import", "tsx", "packages/server/src/main.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: "0", MAP_WORKERS: "1", DEV_TUNING: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const failed = (why: string) => { console.error(`FAIL ${why}\n${output}`); server.kill(); process.exit(1); };
const timeout = setTimeout(() => failed("the server did not start within 30 s"), 30_000);
server.stderr.on("data", (d: Buffer) => { output += d; });
server.on("exit", (code) => { if (code !== null && code !== 0) failed(`the server exited with ${code}`); });
const port = await new Promise<number>((resolve) => {
  server.stdout.on("data", (d: Buffer) => {
    output += d;
    const found = /listening on http:\/\/localhost:(\d+)/.exec(output);
    if (found) resolve(Number(found[1]));
  });
});
clearTimeout(timeout);

const base = `http://localhost:${port}`;
const health = await (await fetch(`${base}/health`)).json() as { ok?: boolean };
if (health.ok !== true) failed("/health did not say ok");
const page = await fetch(`${base}/`);
if (!page.ok || !(await page.text()).includes("<title>")) failed("/ did not serve the game page");
const model = await fetch(`${base}/models/mechs/ironclad/Mech_Ironclad.glb`, { headers: { "Accept-Encoding": "br" } });
if (!model.ok || model.headers.get("content-encoding") !== "br") failed("the Ironclad model was not served brotli compressed");
server.kill();
console.log(`production server on port ${port}: health, page and compressed models OK`);
