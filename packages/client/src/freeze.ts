import type * as THREE from "three";

// For things placed once that never move: the map, its dressing, the edge wall, the backdrop. Left alone, three
// rebuilds every object's matrix from its position, turn and scale each frame, and its world matrix from its
// parent's, whether or not anything changed. Frozen, each is worked out once here and once in the next render.
// Call it again after adding children or moving the object.
export function freeze<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return root;
}
