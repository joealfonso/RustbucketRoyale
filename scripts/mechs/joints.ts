import type { NodeData } from "../assets/glbWrite";
import type { V3 } from "../../packages/client/src/dressing/shapes";

// Marker nodes for one leg's joints, so the game can walk the mech (packages/client/src/legRig.ts). The game cuts the
// leg's shapes into thigh (hip to knee), shin (knee to ankle) and foot (ankle to toe) by which line each shape sits
// nearest, and bends them at these points. `ankle` is where the two-bone chain ends and the foot begins: on a bird
// leg that is the hock. `toe` is the far end of the foot; left out, the foot runs straight down to the ground.
// `side` is L or R, or FL, FR, BL, BR on four legs.
export function legJoints(side: string, hip: V3, knee: V3, ankle: V3, toe?: V3): NodeData[] {
  return [
    { name: `Joint_Hip_${side}`, translation: hip },
    { name: `Joint_Knee_${side}`, translation: knee },
    { name: `Joint_Ankle_${side}`, translation: ankle },
    ...(toe ? [{ name: `Joint_Toe_${side}`, translation: toe }] : []),
  ];
}

export const mirrorX = (p: V3): V3 => [-p[0], p[1], p[2]];
export const mirrorZ = (p: V3): V3 => [p[0], p[1], -p[2]];

// Both legs of a two-legged mech from the right leg's joints.
export function bothLegs(hip: V3, knee: V3, ankle: V3, toe?: V3): NodeData[] {
  return [...legJoints("R", hip, knee, ankle, toe), ...legJoints("L", mirrorX(hip), mirrorX(knee), mirrorX(ankle), toe && mirrorX(toe))];
}
