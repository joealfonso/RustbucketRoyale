import * as THREE from "three";
import { ITEM_GRENADE, itemArmorZone, itemUpgrade, itemWeapon, type PickupState } from "@rustbucket/shared";

const SPIN = 1.6; // radians a second
const BOB = 0.15; // metres up and down

interface Shown {
  mesh: THREE.Mesh;
  seen: boolean;
  baseY: number;
}

// Things to pick up: small floating boxes that turn slowly, coloured by what they are. They come and go with the
// snapshots. Art hook: a model per item kind at V2.
export class PickupView {
  private shown = new Map<number, Shown>();
  private geometry = new THREE.BoxGeometry(1, 1, 1);
  private materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private scene: THREE.Scene, private colors: { grenade: string; armor: string }, private weaponColors: string[], private upgradeColors: string[]) {}

  private material(color: string): THREE.MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
      this.materials.set(color, m);
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
        const color = p.item === ITEM_GRENADE ? this.colors.grenade : itemArmorZone(p.item) >= 0 ? this.colors.armor
          : upgrade >= 0 ? (this.upgradeColors[upgrade] ?? "#ffffff") : (this.weaponColors[weapon] ?? "#ffffff");
        const mesh = new THREE.Mesh(this.geometry, this.material(color));
        if (p.item === ITEM_GRENADE) mesh.scale.set(0.5, 0.5, 0.5);
        else if (weapon >= 0) mesh.scale.set(0.4, 0.35, 1.6);
        else if (upgrade >= 0) { mesh.scale.set(0.7, 0.7, 0.7); mesh.rotation.x = Math.PI / 4; } // a tumbling cube, bigger than a grenade
        else mesh.scale.set(0.9, 0.15, 0.9);
        mesh.position.set(p.x, p.y, p.z);
        this.scene.add(mesh);
        s = { mesh, seen: true, baseY: p.y + 0.4 };
        this.shown.set(p.id, s);
      }
      s.seen = true;
    }
    for (const [id, s] of this.shown) {
      if (!s.seen) { this.scene.remove(s.mesh); this.shown.delete(id); }
    }
  }

  update(nowMs: number): void {
    const t = nowMs / 1000;
    for (const s of this.shown.values()) {
      s.mesh.rotation.y = t * SPIN;
      s.mesh.position.y = s.baseY + Math.sin(t * 2 + s.mesh.position.x) * BOB;
    }
  }

  clear(): void {
    this.sync([]);
  }
}
