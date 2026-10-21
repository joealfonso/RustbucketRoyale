// How pickups look on the ground and what floats up when you take one (data/pickupLook.json).

export interface PickupLook {
  health: {
    plate: string; // palette name or hex, the slab
    cross: string; // the cross on both faces
    size: [number, number, number]; // slab width, height, thickness in metres
    crossArm: [number, number]; // length and width of each arm of the cross
    crossDepth: number; // how far the cross stands off each face
    glow: number; // emissive share, so loot stands out from the scrap round it
  };
  text: PickupTextLook;
}

// "{n}" is the amount, "{zone}" the part a plate went on, "{name}" a weapon's or upgrade's name.
export interface PickupTextLook {
  seconds: number;
  risePx: number;
  health: string;
  grenade: string;
  grenades: string;
  weapon: string;
  upgrade: string;
  healthColor: string;
  otherColor: string;
}

export function parsePickupLook(raw: unknown): PickupLook {
  const d = raw as PickupLook;
  const h = d?.health;
  if (!h || typeof h.plate !== "string" || typeof h.cross !== "string") throw new Error("pickupLook.json: health needs plate and cross colours");
  if (!Array.isArray(h.size) || h.size.length !== 3 || !h.size.every((v) => v > 0)) throw new Error("pickupLook.json: health.size needs three sizes above 0");
  if (!Array.isArray(h.crossArm) || h.crossArm.length !== 2 || !h.crossArm.every((v) => v > 0)) throw new Error("pickupLook.json: health.crossArm needs a length and a width above 0");
  if (!(h.crossDepth > 0) || !(h.glow >= 0)) throw new Error("pickupLook.json: health needs crossDepth above 0 and glow of 0 or more");
  const t = d.text;
  if (!(t?.seconds > 0) || !(t.risePx >= 0)) throw new Error("pickupLook.json: text needs seconds above 0 and risePx");
  for (const key of ["health", "grenade", "grenades", "weapon", "upgrade", "healthColor", "otherColor"] as const) {
    if (typeof t[key] !== "string" || t[key].length === 0) throw new Error(`pickupLook.json: text.${key} must be a string`);
  }
  return d;
}
