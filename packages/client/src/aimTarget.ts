import * as THREE from "three";
import { createRayHit, type MechInput, type World } from "@rustbucket/shared";

const hit = createRayHit();
const position = new THREE.Vector3();
const direction = new THREE.Vector3();

// Finds the world point under the crosshair and writes it into the input.
export function setAimTarget(camera: THREE.Camera, world: World, range: number, input: MechInput): void {
  camera.getWorldPosition(position);
  camera.getWorldDirection(direction);
  let distance = range;
  if (world.raycast(position.x, position.y, position.z, direction.x, direction.y, direction.z, range, hit)) {
    distance = hit.distance;
  }
  input.targetX = position.x + direction.x * distance;
  input.targetY = position.y + direction.y * distance;
  input.targetZ = position.z + direction.z * distance;
}
