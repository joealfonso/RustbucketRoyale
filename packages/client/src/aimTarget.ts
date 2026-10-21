import * as THREE from "three";
import { createRayHit, type MechInput, type World } from "@rustbucket/shared";

const hit = createRayHit();
const position = new THREE.Vector3();
const direction = new THREE.Vector3();

// Finds the point under the crosshair, on a mech or the map, and writes it into the input. The shot leaves from the
// barrel, off to the side of the camera, so it must aim at the thing the crosshair is on: aiming at the map behind
// a mech sends the shot a metre or so wide by the time it reaches the mech, past an arm and into the torso.
// `mechs` returns the distance to the nearest mech along the ray, or -1. True if the crosshair is on the map or a
// mech, false if it is on the sky (the point is then `range` along the view).
export function setAimTarget(
  camera: THREE.Camera, world: World, range: number, input: MechInput,
  mechs?: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => number,
): boolean {
  camera.getWorldPosition(position);
  camera.getWorldDirection(direction);
  let distance = range;
  const onMap = world.raycast(position.x, position.y, position.z, direction.x, direction.y, direction.z, range, hit);
  if (onMap) distance = hit.distance;
  const onMech = mechs?.(position.x, position.y, position.z, direction.x, direction.y, direction.z, distance) ?? -1;
  if (onMech >= 0) distance = onMech;
  input.targetX = position.x + direction.x * distance;
  input.targetY = position.y + direction.y * distance;
  input.targetZ = position.z + direction.z * distance;
  return onMap || onMech >= 0;
}
