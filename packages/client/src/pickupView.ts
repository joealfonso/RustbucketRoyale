import * as THREE from "three";
import type { Toon } from "./toonMaterial";
import type { PickupLook } from "./pickupLook";
import { ITEM_GRENADE, itemArmorZone, itemUpgrade, itemWeapon, type PickupState } from "@rustbucket/shared";

const SPIN = 1.6; // radians a second
const BOB = 0.15; // metres up and down
// How quickly a pickup the server moved slides to its new spot (gate 18b: the magnet harpoon drags loot to the
// shooter): the share of the way left closed each second, eased so it starts fast and settles.
const SLIDE_RATE = 9;

interface Shown {
  mesh: THREE.Object3D;
  seen: boolean;
  baseY: number;
  x: number; z: number; // where it is drawn, sliding toward where the server says (tx, ty, tz)
  tx: number; ty: number; tz: number;
}

// Things to pick up: small floating shapes that turn slowly, coloured by what they are. They come and go with the
// snapshots. Health (an armour plate) is an upright white slab with a red cross through it, so it reads as health
// from any side and never looks like a gun bar or an upgrade cube. Art hook: a model per item kind at V2.
export class PickupView {
  private shown = new Map<number, Shown>();
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private materials = new Map<string, THREE.MeshStandardMaterial | THREE.MeshToonMaterial>();

  constructor(private scene: THREE.Scene, private colors: { grenade: string }, private weaponColors: string[], private upgradeColors: string[], private look: PickupLook["health"], private toon: Toon | null = null) {}

  // In the toon look a pickup still glows a little, so loot stands out from the scrap round it.
  private material(name: string, glow = 0.35): THREE.MeshStandardMaterial | THREE.MeshToonMaterial {
    let m = this.materials.get(name);
    if (!m) {
      if (this.toon) {
        m = this.toon.ownMaterial(name);
        m.emissive.set(name);
        m.emissiveIntensity = glow;
      } else {
        m = new THREE.MeshStandardMaterial({ color: name, emissive: name, emissiveIntensity: glow, roughness: 0.5 });
      }
      this.materials.set(name, m);
    }
    return m;
  }

  sync(pickups: readonly PickupState[]): void {
    for (const s of this.shown.values()) s.seen = false;
    for (const p of pickups) {
      let s = this.shown.get(p.id);
      if (!s) {
        const weapon = itemWeapon(p.item);
        const upgrade = itemUpgrade(p.item);
        let mesh: THREE.Object3D;
        if (itemArmorZone(p.item) >= 0) mesh = this.healthShape();
        else {
          const color = p.item === ITEM_GRENADE ? this.colors.grenade
            : upgrade >= 0 ? (this.upgradeColors[upgrade] ?? "#ffffff") : (this.weaponColors[weapon] ?? "#ffffff");
          const box = new THREE.Mesh(this.geometry, this.material(color));
          if (p.item === ITEM_GRENADE) box.scale.set(0.5, 0.5, 0.5);
          else if (weapon >= 0) box.scale.set(0.4, 0.35, 1.6);
          else { box.scale.set(0.7, 0.7, 0.7); box.rotation.x = Math.PI / 4; } // an upgrade: a tumbling cube, bigger than a grenade
          this.outline(box, color);
          mesh = box;
        }
        mesh.position.set(p.x, p.y, p.z);
        this.scene.add(mesh);
        s = { mesh, seen: true, baseY: p.y + 0.4, x: p.x, z: p.z, tx: p.x, ty: p.y, tz: p.z };
        this.shown.set(p.id, s);
      }
      s.seen = true;
      s.tx = p.x; s.ty = p.y; s.tz = p.z;
    }
    for (const [id, s] of this.shown) {
      if (!s.seen) { this.scene.remove(s.mesh); this.shown.delete(id); }
    }
  }

  // The slab, and the two bars of the cross running through it so the cross stands out of both faces.
  private healthShape(): THREE.Group {
    const { size, crossArm, crossDepth, glow } = this.look;
    const group = new THREE.Group();
    const slab = new THREE.Mesh(this.geometry, this.material(this.look.plate, glow));
    slab.scale.set(size[0], size[1], size[2]);
    const cross = this.material(this.look.cross, glow);
    const depth = size[2] + crossDepth * 2;
    const across = new THREE.Mesh(this.geometry, cross);
    across.scale.set(crossArm[0], crossArm[1], depth);
    const up = new THREE.Mesh(this.geometry, cross);
    up.scale.set(crossArm[1], crossArm[0], depth);
    this.outline(slab, this.look.plate);
    this.outline(across, this.look.cross);
    this.outline(up, this.look.cross);
    group.add(slab, across, up);
    return group;
  }

  // Outlined like every other box in the world. The grey-box look has no outlines.
  private outline(mesh: THREE.Mesh, color: string): void {
    this.toon?.outlineChild(mesh, color);
  }

  // `dt` in seconds, for the slide of a pickup that moved.
  update(nowMs: number, dt = 0): void {
    const t = nowMs / 1000;
    const k = 1 - Math.exp(-SLIDE_RATE * dt);
    for (const s of this.shown.values()) {
      s.x += (s.tx - s.x) * k; s.z += (s.tz - s.z) * k; s.baseY += (s.ty + 0.4 - s.baseY) * k;
      s.mesh.position.x = s.x; s.mesh.position.z = s.z;
      s.mesh.rotation.y = t * SPIN;
      // The bob is phased by the mesh id rather than its x, so a sliding pickup does not shimmy.
      s.mesh.position.y = s.baseY + Math.sin(t * 2 + s.mesh.id) * BOB;
    }
  }

  // Where a pickup is drawn now, for a harpoon latched onto it. False when it is not shown.
  positionOf(id: number, out: { x: number; y: number; z: number }): boolean {
    const s = this.shown.get(id);
    if (!s) return false;
    out.x = s.x; out.y = s.mesh.position.y; out.z = s.z;
    return true;
  }

  clear(): void {
    this.sync([]);
  }
}
