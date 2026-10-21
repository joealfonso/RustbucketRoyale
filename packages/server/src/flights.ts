// Rivets and harpoons between the trigger pull and what they do (gate 18b). Plain bookkeeping: the room decides what a
// shot hits when it is fired, files it here to land when the drawn projectile gets there, and does the effects.

// A shot on its way. What it hit was settled when it was fired, against where targets were then.
export interface Landing {
  kind: "rivet" | "harpoon";
  owner: number; // the shooter's id
  weapon: number; // the gun's index in weapons.json
  tick: number; // the room tick it lands on
  reel: boolean; // a harpoon fired with right-click
  hit: "mech" | "pickup" | "prop" | "world" | "none";
  target: number; // the mech's, pickup's or prop's id, 0 otherwise
  zone: number; // the mech's hit zone
  damage: number; // what it does to that mech (shield already counted)
  x: number; y: number; z: number; // where it struck, in the world
  nx: number; ny: number; nz: number; // the surface it struck faces this way
  lx: number; ly: number; lz: number; // on a mech: where, in the mech's own frame
}

// A rivet that has stuck and is waiting to pop. `on` is the mech it rides (0 for the world), with its spot in that
// mech's frame; x, y, z is where it stuck, kept for when the mech it rode has left the room.
export interface Rivet {
  id: number;
  owner: number;
  weapon: number;
  popTick: number;
  on: number;
  lx: number; ly: number; lz: number;
  x: number; y: number; z: number;
}

export class Flights {
  private landings: Landing[] = [];
  private stuck: Rivet[] = []; // oldest first
  private nextRivet = 1;

  launch(landing: Landing): void {
    this.landings.push(landing);
  }

  // Everything landing by `tick`, in the order it was fired, taken out of the air.
  landed(tick: number, out: Landing[]): Landing[] {
    out.length = 0;
    let kept = 0;
    for (const l of this.landings) {
      if (l.tick <= tick) out.push(l);
      else this.landings[kept++] = l;
    }
    this.landings.length = kept;
    return out;
  }

  stick(owner: number, weapon: number, popTick: number, on: number, lx: number, ly: number, lz: number, x: number, y: number, z: number): Rivet {
    const rivet = { id: this.nextRivet, owner, weapon, popTick, on, lx, ly, lz, x, y, z };
    // Ids wrap well before they could be mistaken for a live one: a rivet lives a couple of seconds.
    this.nextRivet = (this.nextRivet % 0xffff) + 1;
    this.stuck.push(rivet);
    return rivet;
  }

  stuckBy(owner: number): number {
    let count = 0;
    for (const r of this.stuck) if (r.owner === owner) count++;
    return count;
  }

  oldestOf(owner: number): Rivet | null {
    return this.stuck.find((r) => r.owner === owner) ?? null;
  }

  // Rivets whose fuse has run out by `tick`, or every one of `owner`'s when it is given, taken off.
  popping(tick: number, out: Rivet[], owner = 0): Rivet[] {
    out.length = 0;
    let kept = 0;
    for (const r of this.stuck) {
      if (owner !== 0 ? r.owner === owner : r.popTick <= tick) out.push(r);
      else this.stuck[kept++] = r;
    }
    this.stuck.length = kept;
    return out;
  }

  remove(rivet: Rivet): void {
    const index = this.stuck.indexOf(rivet);
    if (index >= 0) this.stuck.splice(index, 1);
  }

  get rivets(): readonly Rivet[] {
    return this.stuck;
  }

  get inFlight(): number {
    return this.landings.length;
  }

  clear(): void {
    this.landings.length = 0;
    this.stuck.length = 0;
  }
}
