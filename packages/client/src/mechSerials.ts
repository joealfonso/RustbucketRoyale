import * as THREE from "three";
// The decal face, here as well as in hud.css, so pages without the HUD (style.html) paint the numbers in it too.
import "@fontsource/big-shoulders-stencil/latin-700.css";

// A roster mech's serial number (docs/MECH_ROSTER.md), painted in the decal font (Big Shoulders Stencil, DESIGN.md).
// The data names the side of the mech the number is on, a spot on that side and a height; the outermost surface there
// is found once per kit by casting a ray at the model, so a rebuilt mech keeps its numbers on. The number belongs to
// the part it lands on: it rusts with that part's zone and goes when the part does.
export interface SerialData {
  text: string;
  facing: "front" | "back" | "left" | "right"; // forward is -z
  at: number[]; // across that side, in metres: x and y for front and back, z and y for left and right
  height: number; // of the painted area, in metres
  paint: string; // a colour name from the kit's scheme
}

export interface PlacedSerial {
  text: string;
  zone: number;
  color: string;
  point: THREE.Vector3; // on the part's surface, in the model's frame
  turn: THREE.Quaternion; // faces the plane out along the surface, letters upright
  geometry: THREE.PlaneGeometry;
}

export const FACINGS = ["front", "back", "left", "right"] as const;
const PROUD = 0.015; // metres off the surface, so the paint never fights the hull for the same pixels
const FONT = '700 112px "Big Shoulders Stencil"';
const CANVAS_WIDTH = 256, CANVAS_HEIGHT = 128; // two to three letters fit; the plane has the same shape

const rayFrom: Record<SerialData["facing"], (a: number, b: number) => [THREE.Vector3, THREE.Vector3]> = {
  front: (x, y) => [new THREE.Vector3(x, y, -50), new THREE.Vector3(0, 0, 1)],
  back: (x, y) => [new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1)],
  left: (z, y) => [new THREE.Vector3(-50, y, z), new THREE.Vector3(1, 0, 0)],
  right: (z, y) => [new THREE.Vector3(50, y, z), new THREE.Vector3(-1, 0, 0)],
};

// Where each serial sits on the intact model, given each part's nearest geometry and zone. A serial whose ray misses
// the mech is left off, with a warning.
export function placeSerials(serials: readonly SerialData[], parts: readonly { geometry: THREE.BufferGeometry; zone: number }[], colorOf: (paint: string) => string): PlacedSerial[] {
  const placed: PlacedSerial[] = [];
  const raycaster = new THREE.Raycaster();
  const up = new THREE.Vector3(0, 1, 0);
  const surface = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = parts.map((p) => Object.assign(new THREE.Mesh(p.geometry, surface), { userData: { zone: p.zone } }));
  for (const s of serials) {
    const [origin, direction] = rayFrom[s.facing](s.at[0]!, s.at[1]!);
    raycaster.set(origin, direction);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit?.face) { console.warn(`Serial ${s.text}: nothing of the mech at ${s.at.join(", ")} from the ${s.facing}`); continue; }
    const normal = hit.face.normal.clone();
    if (normal.dot(direction) > 0) normal.negate(); // the side the ray came from
    // An object's lookAt points its +z at the target; the plane's front is +z.
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(normal, new THREE.Vector3(), up));
    placed.push({
      text: s.text, zone: hit.object.userData.zone as number, color: colorOf(s.paint),
      point: hit.point.clone().addScaledVector(normal, PROUD), turn,
      geometry: new THREE.PlaneGeometry(s.height * (CANVAS_WIDTH / CANVAS_HEIGHT), s.height),
    });
  }
  return placed;
}

const textures = new Map<string, THREE.Texture>();

// White letters on a clear canvas, shared by every mech with that serial. Drawn at once in whatever face the browser
// has, then again once the decal font has loaded, so the number is never missing and ends up in the right face.
export function serialTexture(text: string): THREE.Texture {
  let texture = textures.get(text);
  if (texture) return texture;
  // Without a page (tests, tools) there is nothing to draw on; the mech is still built, with blank numbers.
  if (typeof document === "undefined") return new THREE.Texture();
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const made = new THREE.CanvasTexture(canvas);
  made.colorSpace = THREE.SRGBColorSpace;
  made.anisotropy = 4;
  const draw = () => {
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.font = FONT;
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH * 0.92);
    made.needsUpdate = true;
  };
  draw();
  document.fonts?.load(FONT).then(draw, () => {});
  textures.set(text, made);
  return made;
}
