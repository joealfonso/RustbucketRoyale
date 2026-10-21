import * as THREE from "three";
import { describe, expect, it } from "vitest";
import paintJson from "../../../../data/paint.json";
import paletteJson from "../../../../data/palette.json";
import lookJson from "../../../../data/look.json";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { addGroundDetail, groundDetail } from "./groundDetail";
import { parseGroundDetailLook, parseGroundTileLook } from "./groundDetailLook";
import type { ShaderParts } from "./paintChunk";
import { parsePaintLook } from "./paintLook";

const look = parsePaintLook(paintJson);
const atlas = new THREE.DataArrayTexture(new Uint8Array(4 * 4), 1, 1, 4);
const toonLib = THREE.ShaderLib.toon!;
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const copy = () => JSON.parse(JSON.stringify(paintJson)) as typeof paintJson;

// The ground material's shader after its own patch, the way addGroundDetail always meets it.
function groundShader(): ShaderParts {
  const shader = { vertexShader: toonLib.vertexShader, fragmentShader: toonLib.fragmentShader, uniforms: {} };
  const material = toon.ground("moss");
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe("ground detail chunk", () => {
  it("goes on the Toon's ground material after its own patches, reading the ground layer before the emissive step", () => {
    const material = toon.ground("moss");
    const shader = groundShader();
    expect(shader.fragmentShader).toContain("groundDarkMoss");
    expect(shader.uniforms.detailLayer!.value).toBe(3);
    expect(shader.vertexShader).toContain("vDetailPos = (modelMatrix * detailPos).xyz;");
    const code = shader.fragmentShader;
    expect(code.indexOf("detailRead(")).toBeLessThan(code.indexOf("#include <emissivemap_fragment>"));
    expect(material.customProgramCacheKey()).toBe("toon-ground-ground-detail");
  });

  it("reads the tile at two sizes, each with one more read only near a cell edge: 2 reads a pixel, 4 at most", () => {
    const code = groundShader().fragmentShader;
    expect(code.match(/textureGrad\(detailAtlas/g)).toHaveLength(1); // inside detailCell
    expect(code.match(/detailCell\(uv/g)).toHaveLength(2); // the cell's own read, and the second grid's
    expect(code).toMatch(/if \(a < 1\.0\) \{[^}]*detailCell/); // the second grid only near an edge
    expect(code.match(/= detailRead\(/g)).toHaveLength(2); // two sizes
    expect(code).not.toContain("sin(dot"); // a hash must not depend on how a graphics card does sin()
  });

  it("picks grass, dirt and rock from the ground's own patches, not from the colour", () => {
    const code = groundShader().fragmentShader;
    expect(code.indexOf("groundDetailMeters =")).toBeLessThan(code.indexOf("groundDetailMeters * detailBlend.x"));
    expect(code).not.toMatch(/c\.g >= c\.r/);
  });

  it("refuses a shader with no ground patch to read the patches from", () => {
    const plain = { vertexShader: toonLib.vertexShader, fragmentShader: toonLib.fragmentShader, uniforms: {} };
    expect(() => addGroundDetail(plain, groundDetail(look, atlas))).toThrow(/groundDetailMeters/);
  });

  it("hands the blend width over as its inverse and the strengths in grass, dirt, rock order", () => {
    const d = groundDetail(look, atlas);
    const blend = d.uniforms.detailBlend!.value as THREE.Vector3;
    expect(blend.x).toBeCloseTo(1 / look.ground.blend.meters);
    expect(blend.z).toBe(look.ground.tiling.band);
    expect((d.uniforms.detailStrength!.value as THREE.Vector3).toArray()).toEqual([look.ground.strength.grass, look.ground.strength.dirt, look.ground.strength.rock]);
  });
});

describe("ground detail settings", () => {
  it("loads the data file, with the detail fading out no nearer than 40 m", () => {
    expect(look.ground.fade.endMeters).toBeGreaterThanOrEqual(40);
  });

  it("rejects bad settings", () => {
    const fade = copy();
    fade.ground.fade = { startMeters: 45, endMeters: 10 };
    expect(() => parseGroundDetailLook(fade.ground)).toThrow(/fade/);
    const strength = copy();
    strength.ground.strength.rock = 2;
    expect(() => parseGroundDetailLook(strength.ground)).toThrow(/rock/);
    const blend = copy();
    blend.ground.blend.meters = 0;
    expect(() => parseGroundDetailLook(blend.ground)).toThrow(/blend/);
    const band = copy();
    band.ground.tiling.band = 0.8;
    expect(() => parseGroundDetailLook(band.ground)).toThrow(/band/);
    const counts = copy();
    counts.groundTile.tufts = 2.5;
    expect(() => parseGroundTileLook(counts.groundTile)).toThrow(/tufts/);
    const cells = copy();
    cells.groundTile.blendFineCells = cells.groundTile.blendCoarseCells;
    expect(() => parseGroundTileLook(cells.groundTile)).toThrow(/blendFineCells/);
    expect(() => parsePaintLook(cells)).toThrow(/blendFineCells/);
  });
});
