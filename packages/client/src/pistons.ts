import * as THREE from "three";

// A leg piston (gate V9b) is two pieces: the sleeve on one bone and the rod on the next, each turning about its own
// mount. Every frame each is aimed at the other's mount, so the rod slides in and out of the sleeve as the joint
// bends and neither end ever leaves its mount (the classic look-at piston rig).

const now = new THREE.Vector3();

// The turn that points an end, built pointing along `rest` (a unit vector), from its mount `from` at the other end's
// mount `to`, both in the frame of the bone it rides. Allocates nothing.
export function aimEnd(out: THREE.Quaternion, rest: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  now.subVectors(to, from);
  const length = now.length();
  if (length < 1e-6) return out.identity();
  return out.setFromUnitVectors(rest, now.divideScalar(length));
}
