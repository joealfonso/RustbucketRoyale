// Plays a whole match per tier as fast as possible and checks it. Run: npm run soak (all tiers) or npm run soak -- small
// A failure prints its seed. Play it again exactly with SEED=123 npm run soak -- small
// WEAPON=rivetGun starts everyone with that gun instead of going round the guns by seed.
import { runSoak } from "../packages/server/src/soak/runSoak";

const tiers = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["arena", "small", "medium", "large"];
let failed = false;
for (const tier of tiers) {
  const seed = process.env.SEED !== undefined ? Number(process.env.SEED) : Math.floor(Math.random() * 1_000_000_000);
  const started = Date.now();
  const r = await runSoak(tier, seed, process.env.WEAPON ? { startWeapon: process.env.WEAPON } : {});
  const verdict = r.problems.length === 0 ? "PASS" : "FAIL";
  console.log(
    `${verdict} ${tier} seed ${seed}: ${r.matchSeconds.toFixed(0)} s match, ${r.eliminations} knocked out, ` +
    `tick p99 ${r.tickP99Ms.toFixed(2)} ms (worst ${r.tickWorstMs.toFixed(1)}), ${r.kbpsPerPlayer.toFixed(0)} kbps per player, ` +
    `worst correction ${(r.worstCorrection * 100).toFixed(2)} cm, ${r.propsBroken} props broken, ` +
    `${r.titanHpLeft === null ? "no Titan" : r.titanHpLeft <= 0 ? "Titan down" : `Titan ${(r.titanHpLeft * 100).toFixed(0)}% left`}, took ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  const k = r.secondaryByKind, j = r.projectiles;
  console.log(
    `    start gun ${r.startWeapon}: ${r.secondaryShots} right-clicks (windup ${k.windup}, slug ${k.slug}, charge ${k.charge}, detonate ${k.detonate}), ` +
    `rivets ${j.rivetsStuck} stuck / ${j.rivetsPopped} popped`,
  );
  for (const p of r.problems) console.log(`    ${p}`);
  if (r.problems.length > 0) {
    failed = true;
    console.log(`    replay with: SEED=${seed} npm run soak -- ${tier}`);
  }
}
process.exit(failed ? 1 : 0);
