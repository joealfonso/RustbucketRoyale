// Builds the recorded game sounds (gate S1) from the free packs downloaded outside the repo, so they can be rebuilt
// and every source file is on record. Each sound is a few recorded layers: a real gunshot or blast for the crack, the
// same or another pitched down for a mech-sized body. Layers are mixed to mono, trimmed, faded and peak-normalised,
// then written as MP3 (every desktop browser decodes it) into assets/audio/, which data/audio.json points at.
// Sources (both CC0, see docs/ASSETS.md):
//   firearm/  The Free Firearm Sound Library, "Prepared SFX Library" (OpenGameArt)
//   shmup/    Action Game / SHMUP SFX Pack by RUOK, "SFXPack" (OpenGameArt)
// Run: npx tsx scripts/audio/make-sounds.ts [sources folder]   (default ~/Downloads/rustbucket-sound-sources)
// Needs ffmpeg and ffprobe on the path.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const sources = process.argv[2] ?? join(homedir(), "Downloads/rustbucket-sound-sources");
const FIREARM = join(sources, "firearm-x/Prepared SFX Library");
const SHMUP = join(sources, "shmup-x/SFXPack");
const out = join(new URL("../..", import.meta.url).pathname, "assets/audio");

interface Layer {
  file: string;
  shot?: number; // which hit in the file, counting from 0: the firearm recordings hold two to four shots each
  pitch: number; // playback rate: below 1 is deeper and longer
  db: number; // level of this layer in the mix
  decay?: number; // seconds for this layer to die away from its start, so a body thumps instead of droning
  delayMs?: number;
}
interface Recipe {
  name: string; // output file, without .mp3
  seconds: number; // trimmed to this long, the last `fade` seconds fading out
  fade: number;
  layers: Layer[];
}

const gun = (dir: string, file: string) => join(FIREARM, dir, file);
const shmup = (file: string) => join(SHMUP, file);
const AK = gun("AK-47", "C_28P.wav"), MODEL12 = gun("Model 12", "K_22P.wav"), NOVA = gun("Nova", "O_21P.wav");
const MOSSBERG = gun("Mossberg", "N_30P.wav"), MOSIN = gun("Mosin Nagant", "M_21P.wav"), TIKKA = gun("Tikka", "W_29P.wav");

// Autocannon: one rifle's shots a little deeper, each over a shotgun slowed into a short heavy thump.
const autocannon = (name: string, shot: number): Recipe => ({
  name, seconds: 0.5, fade: 0.3,
  layers: [{ file: AK, shot, pitch: 0.85, db: 0 }, { file: MOSSBERG, shot: 0, pitch: 0.45, db: -6, decay: 0.25 }],
});
// Scattergun: 12 gauge shotguns pitched down, a bigger, longer thump.
const scattergun = (name: string, file: string, shot: number): Recipe => ({
  name, seconds: 0.9, fade: 0.5,
  layers: [{ file, shot, pitch: 0.8, db: 0 }, { file: NOVA, shot: 1, pitch: 0.4, db: -4, decay: 0.5 }],
});
// Spike driver: heavy bolt-action rifles taken well down, the slow shove of a big gun.
const spikeDriver = (name: string, file: string): Recipe => ({
  name, seconds: 1.2, fade: 0.7,
  layers: [{ file, shot: 0, pitch: 0.65, db: 0 }, { file: MOSIN, shot: 1, pitch: 0.35, db: -3, decay: 0.8 }],
});
// Blasts: a shotgun slowed into a deep boom, with the pack's blast noise over it ringing on longer.
const blast = (name: string, boom: string, noise: string, seconds: number, pitch: number): Recipe => ({
  name, seconds, fade: seconds * 0.4,
  layers: [{ file: boom, shot: 0, pitch: pitch * 0.28, db: 0, decay: seconds * 0.35 }, { file: shmup(noise), pitch, db: 9, decay: seconds * 0.9 }],
});

const RECIPES: Recipe[] = [
  autocannon("shot-autocannon-1", 0),
  autocannon("shot-autocannon-2", 1),
  autocannon("shot-autocannon-3", 2),
  scattergun("shot-scattergun-1", MODEL12, 0),
  scattergun("shot-scattergun-2", NOVA, 0),
  scattergun("shot-scattergun-3", MOSSBERG, 1),
  spikeDriver("shot-spike-driver-1", MOSIN),
  spikeDriver("shot-spike-driver-2", TIKKA),
  // Rail Shot: a rifle crack with an electric snap and a laser tail over it.
  { name: "rail-shot", seconds: 1.5, fade: 0.9, layers: [
    { file: gun("Savage 10 .300 Blackout", "T_27P.wav"), shot: 0, pitch: 0.8, db: 0 },
    { file: shmup("Laser/LaserShot3.wav"), pitch: 0.7, db: -5, decay: 0.6 },
    { file: shmup("Laser/LaserBeam2.wav"), pitch: 0.6, db: -12, decay: 1.2, delayMs: 40 },
  ] },
  blast("explosion-1", MOSSBERG, "Explosions/Explosion2.wav", 2.4, 0.9),
  blast("explosion-2", MODEL12, "Explosions/Explosion3.wav", 2.4, 1.0),
  blast("explosion-3", NOVA, "Explosions/Explosion4.wav", 2.4, 0.95),
  // The Titan going down: the biggest boom, slowed right down.
  blast("titan-fall", MOSIN, "Explosions/Explosion4.wav", 3.6, 0.6),
];

const ffmpegLog = (args: string[]) => spawnSync("ffmpeg", ["-v", "info", ...args, "-f", "null", "-"]).stderr.toString();
const peakOf = (file: string) => Number(/max_volume: (-?[\d.]+) dB/.exec(ffmpegLog(["-i", file, "-af", "volumedetect"]))?.[1] ?? 0);

// Where each hit in a file starts: the ends of the quiet stretches, quiet meaning 30 dB under the file's loudest.
function onsets(file: string): number[] {
  const log = ffmpegLog(["-i", file, "-af", `silencedetect=noise=${peakOf(file) - 30}dB:d=0.15`]);
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return (starts.length === 0 || starts[0]! > 0.02 ? [0, ...ends] : ends).map((t) => Math.max(0, t - 0.01));
}

const rate = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", file]).toString().trim());

function build(r: Recipe): void {
  const inputs = r.layers.flatMap((l) => ["-i", l.file]);
  const chains = r.layers.map((l, i) => {
    // Each layer starts on its hit, so the layers land together.
    const at = onsets(l.file)[l.shot ?? 0];
    if (at === undefined) throw new Error(`${l.file} has no hit ${l.shot}`);
    const steps = [
      `atrim=start=${at.toFixed(3)}:duration=${(r.seconds / l.pitch + 0.1).toFixed(3)}`,
      "asetpts=PTS-STARTPTS",
      "aformat=channel_layouts=stereo",
      "pan=mono|c0=0.5*c0+0.5*c1",
      `asetrate=${Math.round(rate(l.file) * l.pitch)}`,
      "aresample=48000",
      ...(l.decay ? [`afade=t=out:st=0:d=${l.decay}:curve=exp`] : []),
      `volume=${l.db}dB`,
      ...(l.delayMs ? [`adelay=${l.delayMs}`] : []),
    ];
    return `[${i}:a]${steps.join(",")}[l${i}]`;
  });
  const mix = `${r.layers.map((_, i) => `[l${i}]`).join("")}amix=inputs=${r.layers.length}:normalize=0:duration=longest,highpass=f=45,acompressor=threshold=-30dB:ratio=8:attack=5:release=150:makeup=8,alimiter=limit=0.9,atrim=0:${r.seconds},afade=t=out:st=${(r.seconds - r.fade).toFixed(3)}:d=${r.fade}[m]`;
  const wav = join(tmpdir(), `rustbucket-${r.name}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", [...chains, mix].join(";"), "-map", "[m]", "-ar", "48000", wav]);
  // Peak-normalise to -1 dB, so a file plays about as loud as the synthesised sound it replaces at the same volume.
  const peak = peakOf(wav);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", `volume=${(-1 - peak).toFixed(2)}dB`, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", join(out, `${r.name}.mp3`)]);
  rmSync(wav);
}

mkdirSync(out, { recursive: true });
for (const r of RECIPES) {
  build(r);
  console.log(`${r.name}.mp3 from ${r.layers.map((l) => `${l.file.slice(sources.length + 1)}${l.shot ? ` (hit ${l.shot + 1})` : ""}`).join(" + ")}`);
}
