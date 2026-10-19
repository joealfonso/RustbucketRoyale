// One shape for every driver. Humans fill it from the keyboard, bots will fill it later,
// so the sim never knows who is controlling the mech. Aim is absolute so the server can replay it.
export interface MechInput {
  moveX: number; // right is +1
  moveY: number; // forward is +1
  aimYaw: number; // radians, 0 faces -Z, positive turns left
  aimPitch: number; // radians, positive looks up
  run: boolean;
  jet: boolean;
  dash: boolean; // true for the one step on which Shift was pressed
  fire: boolean;
  grenade: boolean;
  slot: number; // which weapon slot is wanted in hand, 0 or 1
  interact: boolean; // E held: a press takes the weapon in front of you, holding loots a wreck
  repair: boolean; // F held: repair the worst part, standing still
  ability: boolean; // Q held: use this mech's ability (abilities.json) whenever it is ready
  // World point under the crosshair. Used when firing, and as the landing spot of a pounce. The server shoots from the barrel toward it.
  targetX: number;
  targetY: number;
  targetZ: number;
}

export function createMechInput(): MechInput {
  return { moveX: 0, moveY: 0, aimYaw: 0, aimPitch: 0, run: false, jet: false, dash: false, fire: false, grenade: false, slot: 0, interact: false, repair: false, ability: false, targetX: 0, targetY: 0, targetZ: 0 };
}
