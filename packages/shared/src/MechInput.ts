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
  // World point under the crosshair. Only used when firing. The server shoots from the barrel toward it.
  targetX: number;
  targetY: number;
  targetZ: number;
}

export function createMechInput(): MechInput {
  return { moveX: 0, moveY: 0, aimYaw: 0, aimPitch: 0, run: false, jet: false, dash: false, fire: false, grenade: false, targetX: 0, targetY: 0, targetZ: 0 };
}
