import GUI from "lil-gui";
import { TUNABLE_FILES, secondsToCross, type CameraStats, type MechStats, type TunableFile, type TuningRaws } from "@rustbucket/shared";
import type { FeatureCost } from "./featureCost";
import type { FrameTimes } from "./frameTimes";
import type { GpuTimer } from "./gpuTimer";

export interface Readouts {
  speed: number;
  grounded: boolean;
  fps: number;
  players: number;
  correction: number;
  ping: number;
  viewDelay: number;
}

const CROSS_METERS = 2000;

// Hand-picked sliders for the numbers that matter most to feel. Everything else is under "Data files".
const FEEL: { folder: string; keys: [string, number, number, string?][] }[] = [
  { folder: "Speed", keys: [["walkSpeed", 1, 30], ["runSpeed", 1, 60], ["crawlSpeedMultiplier", 0, 1], ["acceleration", 1, 150], ["deceleration", 1, 150], ["airControl", 0, 1], ["turnSpeedDegrees", 0, 720, "body turn speed (0 = instant)"], ["gravity", 5, 80]] },
  { folder: "Dash (Shift)", keys: [["dashSpeed", 10, 80], ["dashSeconds", 0.05, 0.6], ["dashCooldown", 0.1, 4], ["dashStaminaCost", 0, 100]] },
  { folder: "Jump jets", keys: [["jetLift", 5, 150], ["jetMaxRiseSpeed", 2, 40], ["fuelMax", 10, 300], ["fuelDrainPerSecond", 1, 150], ["fuelRegenPerSecond", 1, 150]] },
  { folder: "Sprint stamina (double-press W)", keys: [["sprintDoubleTapSeconds", 0.1, 0.6, "double-tap window (s)"], ["staminaMax", 10, 300], ["runDrainPerSecond", 1, 150], ["staminaRegenPerSecond", 1, 150]] },
];

// Live tuning for playtests. F1 opens it. Every gameplay number goes through `onTune`: offline it changes at once,
// online the server checks it, applies it for the whole room and sends it back (only when the server was started
// with DEV_TUNING=1). "Copy ... JSON" puts a file's current values on the clipboard, ready to paste into data/.
export class DebugPanel {
  readonly gui = new GUI({ title: "Tuning (F1)" });
  readonly readouts: Readouts = { speed: 0, grounded: false, fps: 0, players: 1, correction: 0, ping: 0, viewDelay: 0 };
  private crossReadout = { seconds: 0 };
  private render = { frameMedian: 0, frameWorst: 0, workMedian: 0, workWorst: 0, gpuMedian: 0, gpuWorst: 0, drawCalls: 0, triangles: 0, pixelRatio: 0 };
  private costs = { progress: "not run", result: "" };
  private frame = { median: 0, worst: 0 };
  private status = { note: "offline: changes apply at once" };
  private gameplay: GUI[] = [];
  private perf: GUI;

  constructor(
    private mech: MechStats,
    private raws: TuningRaws,
    private cameraStats: CameraStats,
    private onTune: (file: TunableFile, path: string, value: number) => void,
  ) {
    const info = this.gui.addFolder("Readouts");
    info.add(this.readouts, "speed").name("Speed m/s").listen().disable();
    info.add(this.readouts, "grounded").listen().disable();
    info.add(this.readouts, "fps").name("FPS").listen().disable();
    info.add(this.readouts, "players").listen().disable();
    info.add(this.readouts, "correction").name("Correction m").listen().disable();
    info.add(this.readouts, "ping").name("Ping ms").listen().disable();
    info.add(this.readouts, "viewDelay").name("Others shown behind (ms)").listen().disable();
    info.add(this.crossReadout, "seconds").name(`Cross ${CROSS_METERS} m (s)`).listen().disable();
    const perf = (this.perf = this.gui.addFolder("Performance"));
    perf.add(this.render, "frameMedian").name("Frame ms, median (4 s)").listen().disable();
    perf.add(this.render, "frameWorst").name("Frame ms, worst (4 s)").listen().disable();
    perf.add(this.render, "workMedian").name("Work ms, median").listen().disable();
    perf.add(this.render, "workWorst").name("Work ms, worst").listen().disable();
    perf.add(this.render, "gpuMedian").name("GPU ms, median").listen().disable();
    perf.add(this.render, "gpuWorst").name("GPU ms, worst").listen().disable();
    perf.add(this.render, "pixelRatio").name("Render scale (pixel ratio)").listen().disable();
    perf.add(this.render, "drawCalls").name("Draw calls").listen().disable();
    perf.add(this.render, "triangles").name("Triangles").listen().disable();
    this.gui.add(this.status, "note").name("Tuning").disable();

    const rawMech = raws.mech as Record<string, number>;
    for (const { folder, keys } of FEEL) {
      const f = this.gui.addFolder(folder);
      for (const [key, min, max, label] of keys) {
        const c = f.add(rawMech, key, min, max).onChange((v: number) => this.onTune("mech", key, v));
        if (label) c.name(label);
      }
      this.gameplay.push(f);
    }

    // The camera is yours alone, so it changes at once and never goes to the server.
    const look = this.gui.addFolder("Look and camera");
    look.add(rawMech, "mouseSensitivity", 0.02, 0.5).onChange((v: number) => this.onTune("mech", "mouseSensitivity", v));
    look.add(cameraStats, "distance", 2, 15);
    look.add(cameraStats, "shoulderX", -2, 2);
    look.add(cameraStats, "fov", 40, 110);
    look.add(cameraStats, "dashFovKick", 0, 30);
    look.add(cameraStats, "walkBob", 0, 1).name("walkBob (camera)");
    look.add({ copy: () => this.copy(cameraStats) }, "copy").name("Copy camera.json");

    const files = this.gui.addFolder("Data files");
    for (const file of TUNABLE_FILES) {
      const f = files.addFolder(`${file}.json`).close();
      this.addNumbers(f, file, raws[file], "");
      f.add({ copy: () => this.copy(raws[file]) }, "copy").name(`Copy ${file}.json`);
      this.gameplay.push(f);
    }
    files.close();
    this.gui.hide();
  }

  // One number box per number in the file, nested the way the file is. Lists of named things are labelled by name.
  private addNumbers(folder: GUI, file: TunableFile, node: unknown, path: string): void {
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (typeof value === "number") {
        folder.add(node as Record<string, number>, key).onChange((v: number) => this.onTune(file, here, v));
      } else if (typeof value === "object" && value !== null && hasNumber(value)) {
        const label = (value as { name?: unknown; id?: unknown }).name ?? (value as { id?: unknown }).id ?? key;
        this.addNumbers(folder.addFolder(String(label)).close(), file, value, here);
      }
    }
  }

  // Online, says whether the server takes changes. Without it the gameplay sliders are switched off, since
  // changing them only here would make your own mech disagree with the server.
  setServerTuning(on: boolean): void {
    this.status.note = on ? "on: changes go to everyone in the room" : "off (start the server with DEV_TUNING=1)";
    for (const f of this.gameplay) for (const c of f.controllersRecursive()) c.enable(on);
    this.refresh();
  }

  // Shows values that changed from elsewhere, such as another playtester's tuning.
  refresh(): void {
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
  }

  update(speed: number, grounded: boolean, fps: number, players: number, correction: number, ping: number, viewDelay: number): void {
    this.readouts.speed = Math.round(speed * 10) / 10;
    this.readouts.grounded = grounded;
    this.readouts.fps = Math.round(fps);
    this.readouts.players = players;
    this.readouts.ping = Math.round(ping);
    this.readouts.viewDelay = Math.round(viewDelay);
    this.readouts.correction = Math.round(correction * 1000) / 1000;
    this.crossReadout.seconds = Math.round(secondsToCross(this.mech, CROSS_METERS));
  }

  // Switches for the costly look features, and a button that measures what each costs here. Without the GPU timer
  // (some browsers do not offer it) the button says so instead.
  addFeatures(features: { name: string; on?: boolean; set(on: boolean): void }[], cost: FeatureCost, gpu: GpuTimer): void {
    const f = this.perf.addFolder("Look features");
    const state: Record<string, boolean> = {};
    for (const feature of features) {
      state[feature.name] = feature.on ?? true;
      f.add(state, feature.name).listen().onChange((on: boolean) => feature.set(on));
    }
    const measure = () => {
      if (!gpu.available) { this.costs.progress = "no GPU timer in this browser"; return; }
      cost.start();
    };
    f.add({ measure }, "measure").name("Measure feature costs (about 20 s)");
    f.add(this.costs, "progress").name("Measuring").listen().disable();
    f.add(this.costs, "result").name("GPU ms each saves").listen().disable();
    this.featureCost = cost;
  }
  private featureCost: FeatureCost | null = null;

  updateRender(frames: FrameTimes, work: FrameTimes, drawCalls: number, triangles: number, gpu: FrameTimes, pixelRatio: number): void {
    this.render.pixelRatio = pixelRatio;
    frames.summary(this.frame);
    this.render.frameMedian = Math.round(this.frame.median * 10) / 10;
    this.render.frameWorst = Math.round(this.frame.worst * 10) / 10;
    work.summary(this.frame);
    this.render.workMedian = Math.round(this.frame.median * 10) / 10;
    this.render.workWorst = Math.round(this.frame.worst * 10) / 10;
    gpu.summary(this.frame);
    this.render.gpuMedian = Math.round(this.frame.median * 10) / 10;
    this.render.gpuWorst = Math.round(this.frame.worst * 10) / 10;
    if (this.featureCost) {
      if (this.featureCost.running || this.costs.progress !== "no GPU timer in this browser") this.costs.progress = this.featureCost.progress;
      this.costs.result = this.featureCost.summary();
    }
    this.render.drawCalls = drawCalls;
    this.render.triangles = triangles;
  }

  get visible(): boolean {
    return !this.gui._hidden;
  }

  // Walking looks (data/gait.json): yours alone like the camera, since nothing about it reaches the server.
  addGait(gait: object): void {
    const f = this.gui.addFolder("Walking (gait.json)").close();
    const add = (folder: GUI, node: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "number") folder.add(node, key);
        else if (typeof value === "object" && value !== null) add(folder.addFolder(key).close(), value as Record<string, unknown>);
      }
    };
    add(f, gait as Record<string, unknown>);
    f.add({ copy: () => this.copy(gait) }, "copy").name("Copy gait.json");
    f.close();
  }

  // The CRT look on the HUD (crt.ts): yours alone like the camera, and remembered in this browser.
  addHud(crt: { intensity: number }, onIntensity: (v: number) => void): void {
    const f = this.gui.addFolder("HUD");
    f.add(crt, "intensity", 0, 1, 0.05).name("CRT intensity").onChange(onIntensity);
  }

  toggle(): boolean {
    this.gui.show(this.gui._hidden);
    return !this.gui._hidden;
  }

  private copy(data: unknown): void {
    void navigator.clipboard.writeText(`${JSON.stringify(data, null, 2)}\n`);
  }
}

// Folders only for parts of a file that have something to tune (not lists of colours, for instance).
const hasNumber = (v: unknown): boolean =>
  typeof v === "number" || (typeof v === "object" && v !== null && Object.values(v).some(hasNumber));
