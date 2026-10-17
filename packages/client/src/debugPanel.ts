import GUI from "lil-gui";
import { secondsToCross, type CameraStats, type MechStats, type WeaponStats } from "@rustbucket/shared";

export interface Readouts {
  speed: number;
  grounded: boolean;
  fps: number;
  players: number;
  correction: number;
}

const CROSS_METERS = 2000;

// Live tuning for playtests. F1 opens it. Edits change the running values only;
// "Copy tuning JSON" puts them on the clipboard so good values can be saved into data/*.json.
export class DebugPanel {
  readonly gui = new GUI({ title: "Tuning (F1)" });
  readonly readouts: Readouts = { speed: 0, grounded: false, fps: 0, players: 1, correction: 0 };
  private crossReadout = { seconds: 0 };

  constructor(private mech: MechStats, private weapon: WeaponStats, private cameraStats: CameraStats) {
    const info = this.gui.addFolder("Readouts");
    info.add(this.readouts, "speed").name("Speed m/s").listen().disable();
    info.add(this.readouts, "grounded").listen().disable();
    info.add(this.readouts, "fps").name("FPS").listen().disable();
    info.add(this.readouts, "players").listen().disable();
    info.add(this.readouts, "correction").name("Correction m").listen().disable();
    info.add(this.crossReadout, "seconds").name(`Cross ${CROSS_METERS} m (s)`).listen().disable();

    const speed = this.gui.addFolder("Speed");
    speed.add(mech, "walkSpeed", 1, 30);
    speed.add(mech, "runSpeed", 1, 60);
    speed.add(mech, "acceleration", 1, 150);
    speed.add(mech, "deceleration", 1, 150);
    speed.add(mech, "airControl", 0, 1);
    speed.add(mech, "turnSpeedDegrees", 30, 720).name("body turn speed");
    speed.add(mech, "gravity", 5, 80);

    const jets = this.gui.addFolder("Jump jets");
    jets.add(mech, "jetLift", 5, 150);
    jets.add(mech, "jetMaxRiseSpeed", 2, 40);
    jets.add(mech, "fuelMax", 10, 300);
    jets.add(mech, "fuelDrainPerSecond", 1, 150);
    jets.add(mech, "fuelRegenPerSecond", 1, 150);

    const stamina = this.gui.addFolder("Run stamina");
    stamina.add(mech, "staminaMax", 10, 300);
    stamina.add(mech, "runDrainPerSecond", 1, 150);
    stamina.add(mech, "staminaRegenPerSecond", 1, 150);

    const look = this.gui.addFolder("Look and camera");
    look.add(mech, "mouseSensitivity", 0.02, 0.5);
    look.add(cameraStats, "distance", 2, 15);
    look.add(cameraStats, "shoulderX", -2, 2);
    look.add(cameraStats, "fov", 40, 110).onChange((value: number) => this.onFov?.(value));

    const gun = this.gui.addFolder("Weapon");
    gun.add(weapon, "shotsPerSecond", 0.5, 30);
    gun.add(weapon, "projectileSpeed", 10, 400);
    gun.add(weapon, "spreadDegrees", 0, 10);
    gun.add(weapon, "shakeForce", 0, 1).name("shot shake");

    this.gui.add({ copy: () => this.copyJson() }, "copy").name("Copy tuning JSON");
    this.gui.hide();
  }

  onFov?: (fov: number) => void;

  update(speed: number, grounded: boolean, fps: number, players: number, correction: number): void {
    this.readouts.speed = Math.round(speed * 10) / 10;
    this.readouts.grounded = grounded;
    this.readouts.fps = Math.round(fps);
    this.readouts.players = players;
    this.readouts.correction = Math.round(correction * 1000) / 1000;
    this.crossReadout.seconds = Math.round(secondsToCross(this.mech, CROSS_METERS));
  }

  get visible(): boolean {
    return !this.gui._hidden;
  }

  toggle(): boolean {
    this.gui.show(this.gui._hidden);
    return !this.gui._hidden;
  }

  private copyJson(): void {
    const text = JSON.stringify({ mech: this.mech, weapon: this.weapon, camera: this.cameraStats }, null, 2);
    void navigator.clipboard.writeText(text);
  }
}
