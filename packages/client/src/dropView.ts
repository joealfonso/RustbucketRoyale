import * as THREE from "three";
import { dropHeight, dropPhase, type DropPhase, type DropsConfig, type SupplyDrop } from "@rustbucket/shared";
import { FRAMES } from "./fx/spriteArt";
import type { FxSprites } from "./fx/fxSprites";
import { castShadows } from "./sunShadows";
import type { Toon } from "./toonMaterial";

// What the supply drops look like (gate 13a): a yellow beacon of light stands on the landing spot from the moment
// the drop is announced, so it reads from across the map; the crate comes down burning, trailing fire and black
// smoke; it lies sealed and smoking; then the lid blows off and the smoke column lingers over the husk. Everything is
// worked out from the match clock and the plan the server sent, so it needs no messages of its own. The landing's
// blast and the loot are the server's ordinary explosion and pickups. Art hook: `crate.model` in data/drops.json.

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const beam = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true);
const LID_FLIGHT_SECONDS = 1.2;

interface Shown {
  drop: SupplyDrop;
  group: THREE.Group;
  lid: THREE.Object3D;
  beacon: THREE.Mesh;
  phase: DropPhase;
  smokeIn: number;
  fireIn: number;
}

export class DropView {
  readonly group = new THREE.Group();
  private shown: Shown[] = [];
  private beaconMaterial: THREE.MeshBasicMaterial;
  // Set when a drop changes phase this frame, for the HUD to announce: "announced" or "open", or null.
  news: DropPhase | null = null;
  landed: { x: number; z: number } | null = null; // a crate that hit the ground this frame, for its sound

  constructor(private toon: Toon, private sprites: FxSprites, private config: DropsConfig) {
    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: toon.color(config.crate.paint), transparent: true, opacity: config.beacon.opacity, depthWrite: false, fog: false });
  }

  setDrops(drops: SupplyDrop[] | null): void {
    for (const s of this.shown) this.group.remove(s.group, s.beacon);
    this.shown = (drops ?? []).map((drop) => this.build(drop));
  }

  // The drops worth a radar mark now: announced and not yet opened.
  forEachMarked(time: number, visit: (x: number, z: number) => void): void {
    for (const s of this.shown) {
      const phase = dropPhase(s.drop, this.config, time);
      if (phase === "announced" || phase === "falling" || phase === "landed") visit(s.drop.x, s.drop.z);
    }
  }

  // `time` is match seconds, or null outside a running match (nothing shows).
  update(time: number | null, dt: number): void {
    this.news = null;
    this.landed = null;
    for (const s of this.shown) {
      const phase = time === null ? "none" : dropPhase(s.drop, this.config, time);
      if (phase !== s.phase) {
        if (phase === "announced" || phase === "open") this.news = phase;
        if (phase === "landed" && s.phase === "falling") this.landed = { x: s.drop.x, z: s.drop.z };
        s.phase = phase;
      }
      const d = s.drop;
      s.beacon.visible = phase === "announced" || phase === "falling" || phase === "landed";
      s.group.visible = phase === "falling" || phase === "landed" || phase === "open";
      if (time === null || !s.group.visible) continue;
      const size = this.config.crate.size;
      s.group.position.set(d.x, d.y + dropHeight(d, this.config, time), d.z);
      // It tumbles a little on the way down and settles flat.
      const spin = phase === "falling" ? (d.landAt - time) * 0.35 : 0;
      s.group.rotation.set(spin * 0.4, spin, spin * 0.25);
      if (phase === "open") {
        const t = time - d.landAt - this.config.openSeconds;
        s.lid.visible = t < LID_FLIGHT_SECONDS;
        s.lid.position.set(t * 1.5, size[1]! + 0.15 + t * 9 - t * t * 6, 0);
        s.lid.rotation.z = -t * 4;
      } else {
        s.lid.visible = true;
        s.lid.position.set(0, size[1]! + 0.15, 0);
        s.lid.rotation.z = 0;
      }
      this.emit(s, phase, time, dt);
    }
  }

  private emit(s: Shown, phase: DropPhase, time: number, dt: number): void {
    const { smoke } = this.config;
    const top = s.group.position.y + this.config.crate.size[1]!;
    if (phase === "falling" && (s.fireIn -= dt) <= 0) {
      s.fireIn = smoke.fireEverySeconds;
      const f = this.sprites.fire.spawn();
      if (f) {
        f.x = s.drop.x + (Math.random() - 0.5); f.y = top; f.z = s.drop.z + (Math.random() - 0.5);
        f.vy = 4; f.life = 0.5; f.size0 = 2.6; f.size1 = 1.2;
        f.frame0 = FRAMES.flame.first; f.frames = FRAMES.flame.count; f.fps = 12;
      }
    }
    const lingering = phase !== "open" || time - s.drop.landAt - this.config.openSeconds < smoke.lingerSeconds;
    if (lingering && (s.smokeIn -= dt) <= 0) {
      s.smokeIn = smoke.everySeconds;
      const p = this.sprites.smoke.spawn();
      if (p) {
        p.x = s.drop.x + (Math.random() - 0.5) * 1.2; p.y = top; p.z = s.drop.z + (Math.random() - 0.5) * 1.2;
        p.vx = (Math.random() - 0.5) * 0.6; p.vy = phase === "falling" ? 2 : 3.2; p.vz = (Math.random() - 0.5) * 0.6;
        p.drag = 0.1; p.life = 7; p.size0 = 2; p.size1 = 7;
        p.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
        p.shade0 = 1; p.shade1 = 2; p.fadeShare = 0.4;
        p.spin = Math.random() * Math.PI * 2; p.spinRate = (Math.random() - 0.5) * 0.5;
      }
    }
  }

  // The crate: a painted body, dark straps round it, and a lid of its own that can fly off.
  private build(drop: SupplyDrop): Shown {
    const { size, paint, trim } = this.config.crate;
    const [w, h, l] = size as [number, number, number];
    const group = new THREE.Group();
    const part = (parent: THREE.Object3D, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const mesh = new THREE.Mesh(unitBox, this.toon.world(color, "metal", true));
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      parent.add(mesh);
      this.toon.outlineChild(mesh, color);
    };
    part(group, paint, 0, h / 2, 0, w, h, l);
    for (const x of [-w * 0.3, w * 0.3]) part(group, trim, x, h / 2, 0, 0.22, h + 0.04, l + 0.06);
    part(group, trim, 0, 0.12, 0, w + 0.06, 0.24, l + 0.06);
    const lid = new THREE.Group();
    part(lid, trim, 0, 0, 0, w + 0.1, 0.3, l + 0.1);
    group.add(lid);
    castShadows(group);
    group.visible = false;
    const beacon = new THREE.Mesh(beam, this.beaconMaterial);
    const { width, height } = this.config.beacon;
    beacon.scale.set(width, height, width);
    beacon.position.set(drop.x, drop.y + height / 2, drop.z);
    beacon.visible = false;
    this.group.add(group, beacon);
    return { drop, group, lid, beacon, phase: "none", smokeIn: 0, fireIn: 0 };
  }
}
