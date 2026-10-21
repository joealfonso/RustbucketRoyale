import * as THREE from "three";
import { World, mechStatsFor, parseMechStats, parseZones, type MechStats, type Roster } from "@rustbucket/shared";
import hangarJson from "../../../../data/hangar.json";
import lookJson from "../../../../data/look.json";
import paletteJson from "../../../../data/palette.json";
import mechKitsJson from "../../../../data/mechKits.json";
import mechJson from "../../../../data/mech.json";
import zonesJson from "../../../../data/zones.json";
import gaitJson from "../../../../data/gait.json";
import groundJson from "../../../../data/ground.json";
import { ContactShadows, parseShadowLook } from "../contactShadows";
import { toGeometry } from "../dressing/dressing";
import { box } from "../dressing/shapes";
import { freeze } from "../freeze";
import { parseGait, type GaitInput } from "../gait";
import { loadRoster, parseKits } from "../mechKit";
import { createMechModel, type MechModel } from "../mechModel";
import { walkMech } from "../mechWalk";
import { moveMechParts } from "../mechMotion";
import { Toon, parseLook, parsePalette } from "../toonMaterial";
import { aegisMark, decalFontReady, textDecal } from "./decals";
import { HangarFraming } from "./framing";
import { GantryArms, buildGantries } from "./gantry";
import { buildHall, lampSpots, mergedPieces } from "./hall";
import { HangarLife } from "./life";
import { HangarLighting, parseStageLight } from "./lighting";
import { bayCentres, bayOfMech, loadingBayClear, parseHangar, stepToward, type HangarConfig, type Step } from "./layout";
import { HangarProps } from "./props";
import { Screen, schematicOf } from "./screens";
import { WelderSparks } from "./sparks";

// The title screen's background: you are standing in the Aegis Dynamics hangar where pilots load up. The four roster
// mechs wait in their gantries; the one picked on the cards walks out into the lit loading bay, and the one it
// replaces walks back in. Built only for the title screen and thrown away with the page when a match starts.

interface BayMech {
  model: MechModel;
  stats: MechStats;
  bay: number;
  home: { x: number; z: number };
  x: number; z: number;
  arms: GantryArms;
}

const step: Step = { x: 0, z: 0, vx: 0, vz: 0 };
const others: { x: number; z: number }[] = [];
const gaitInput: GaitInput = { vx: 0, vz: 0, yaw: Math.PI, grounded: true, dashing: false, limping: false, braced: false, walkSpeed: 0, runSpeed: 0 };

export class Hangar {
  private config: HangarConfig = parseHangar(hangarJson);
  private toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private mechs: BayMech[] = [];
  private screens: Screen[] = [];
  private schematics: (THREE.BufferGeometry | null)[] = [];
  private sparks: WelderSparks;
  private shadows: ContactShadows;
  private gait = parseGait(gaitJson);
  private seconds = 0;
  private last = 0;
  private stage: HangarLighting;
  private framing: HangarFraming;
  private props: HangarProps;
  private life: HangarLife;
  // Reduced motion holds the camera and the hangar's own movement still; mechs still walk to the loading bay.
  private still = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(canvas: HTMLCanvasElement, private roster: Roster, private selected: number) {
    const c = this.config;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(c.camera.fov, 1, c.camera.near, c.camera.far);
    this.light();
    this.buildShell();
    this.stage = new HangarLighting(c, this.toon, parseStageLight(hangarJson.light));
    this.scene.add(this.stage.group);
    this.framing = new HangarFraming(c, this.toon);
    this.props = new HangarProps(c, this.toon);
    this.life = new HangarLife(c, this.toon);
    this.scene.add(this.framing.group, this.props.group, this.life.group);
    this.sparks = new WelderSparks(c.welder, (name) => this.toon.color(name));
    this.scene.add(this.sparks.mesh, this.sparks.tip);
    const look = parseShadowLook(groundJson.shadows);
    this.shadows = new ContactShadows(this.scene, look, this.toon.color(look.color));
    this.shadows.setMap([], new World([])); // a flat floor: every patch lies at y = 0
    // Added on top of the pane, so the lines read as light rather than paint.
    const hologram = { fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const lines = new THREE.LineBasicMaterial({ color: c.screen.line, ...hologram });
    const dim = new THREE.LineBasicMaterial({ color: c.screen.dim, ...hologram });
    for (const spot of c.screens) {
      const screen = new Screen(spot, c.screen, this.toon, lines, dim);
      this.screens.push(screen);
      this.scene.add(screen.group);
    }
    this.resize();
    window.addEventListener("resize", () => this.resize());
    void this.paintDecals();
    void this.loadMechs();
    requestAnimationFrame(this.frame);
  }

  // The mech whose card the pointer is on lights up in its bay; -1 for none. The picked one is out in the loading bay,
  // so its empty bay stays as it is.
  hover(mech: number): void {
    this.stage.hoverBay(mech >= 0 && mech !== this.selected ? this.mechs[mech]?.bay ?? -1 : -1);
  }

  // The picked mech walks out; whoever is in the loading bay walks home first.
  select(mech: number): void {
    this.selected = mech;
    this.showSchematics();
  }

  private light(): void {
    const { light } = this.config;
    const color = (name: string) => this.toon.color(name);
    this.scene.add(new THREE.HemisphereLight(color(light.fillSky), color(light.fillGround), light.fillIntensity));
    const key = new THREE.DirectionalLight(color(light.key.color), light.key.intensity);
    key.position.set(...light.key.direction).multiplyScalar(50);
    this.scene.add(key);
    // The work light over the loading bay, from the lamp that hangs there.
    const { loadingBay: bay } = this.config;
    const w = light.work;
    const work = new THREE.SpotLight(color(w.color), w.intensity, w.distance, THREE.MathUtils.degToRad(w.angleDegrees), w.penumbra);
    work.position.set(bay.x, w.height, bay.z);
    work.target.position.set(bay.x, 0, bay.z);
    this.scene.add(work, work.target);
    this.scene.fog = new THREE.Fog(color(light.fog.color), light.fog.near, light.fog.far);
    this.scene.background = new THREE.Color(color(light.fog.color));
  }

  // The hall and gantry frames, one mesh and one outline per paint; the lamps' lit faces as flat light.
  private buildShell(): void {
    const c = this.config;
    const pieces = buildHall(c);
    buildGantries(c, pieces);
    const [hx, hy, hz] = c.lamps.housing;
    pieces.set("lamp", lampSpots(c).map(([x, y, z]) => box([x, y - 0.02, z], [hx * 0.85, hy, hz * 0.8])));
    for (const [key, mesh] of mergedPieces(pieces)) {
      const paint = key === "light" ? c.hexGrid.color : c.paints[key]!;
      const geometry = toGeometry([mesh]);
      if (key === "lamp" || key === "light") {
        this.scene.add(freeze(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: this.toon.color(paint), fog: false }))));
        continue;
      }
      this.scene.add(freeze(new THREE.Mesh(geometry, this.toon.material(paint))), freeze(new THREE.Mesh(geometry, this.toon.shellOutline(paint))));
    }
  }

  private async paintDecals(): Promise<void> {
    const { decals, loadingBay, bays } = this.config;
    await decalFontReady(decals.font);
    // The Aegis Dynamics name and mark as a hologram on the back wall: a see-through pane with both projected on it.
    const b = decals.brand;
    const brand = textDecal(this.toon, b.text, decals.font, b.height, b.color, true);
    brand.position.set(...b.center);
    const width = (brand.geometry as THREE.PlaneGeometry).parameters.width;
    const projected = { color: this.toon.color(b.color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false };
    const mark = new THREE.Mesh(toGeometry([aegisMark(decals.markSize)]), new THREE.MeshBasicMaterial(projected));
    const markX = b.center[0] - width / 2 - decals.markSize * 0.75;
    mark.position.set(markX, b.center[1] - decals.markSize / 2, b.center[2]);
    const paneWidth = width + decals.markSize * 2.2;
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(paneWidth, decals.markSize * 1.5),
      new THREE.MeshBasicMaterial({ color: this.toon.color(b.panel), transparent: true, opacity: b.panelOpacity, depthWrite: false, fog: false }),
    );
    pane.position.set((markX - decals.markSize * 0.6 + b.center[0] + width / 2 + 0.4) / 2, b.center[1], b.center[2] - 0.02);
    this.scene.add(freeze(pane), freeze(mark), freeze(brand));
    // Painted on the deck, read from where you stand.
    const onFloor = (mesh: THREE.Mesh, x: number, z: number) => {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.015, z);
      this.scene.add(freeze(mesh));
    };
    bayCentres(this.config).forEach((bay, i) => {
      const number = textDecal(this.toon, String(i + 1).padStart(2, "0"), decals.font, decals.bayNumber.height, decals.bayNumber.color);
      onFloor(number, bay.x, bay.z + bays.halfDepth + decals.bayNumber.inFront);
    });
    const labelZ = loadingBay.z + loadingBay.halfDepth + this.config.hazard.width + decals.loadingBay.inFront;
    const label = textDecal(this.toon, decals.loadingBay.text, decals.font, decals.loadingBay.height, decals.loadingBay.color);
    onFloor(label, loadingBay.x + decals.floorMark.size * 0.6, labelZ);
    // The maker's mark painted on the deck beside it, flat, pointing away from you like the text.
    const labelWidth = (label.geometry as THREE.PlaneGeometry).parameters.width;
    const floorMark = new THREE.Mesh(toGeometry([aegisMark(decals.floorMark.size)]), this.toon.material(decals.floorMark.color));
    floorMark.rotation.x = -Math.PI / 2;
    floorMark.scale.z = 0.2; // the raised wall plate, flattened to paint
    floorMark.position.set(label.position.x - labelWidth / 2 - decals.floorMark.size * 0.7, 0.012, labelZ + decals.floorMark.size / 2);
    this.scene.add(freeze(floorMark));
  }

  private async loadMechs(): Promise<void> {
    const c = this.config;
    const palette = parsePalette(paletteJson);
    const kitFor = await loadRoster(parseKits(mechKitsJson));
    const zoneMaxHp = parseZones(zonesJson).zones.map((z) => z.hp);
    const statsFor = mechStatsFor(parseMechStats(mechJson), this.roster);
    const bayOf = bayOfMech(c, this.roster.mechs.map((m) => m.id));
    const centres = bayCentres(c);
    this.mechs = this.roster.mechs.map((_, i) => {
      const model = createMechModel(palette.mech.youAccent, zoneMaxHp, this.toon, palette.mech.body, kitFor(i), palette.mech.trim);
      model.group.rotation.y = Math.PI; // facing out of the bay, toward you
      model.group.updateMatrixWorld(true);
      // Each arm reaches in from its column to just short of this mech's widest point.
      const bounds = new THREE.Box3().setFromObject(model.group);
      const halfWidth = Math.max(-bounds.min.x, bounds.max.x);
      const home = centres[bayOf[i]!]!;
      const reach = Math.max(0.5, Math.min(c.gantry.armLength, c.bays.halfWidth - c.gantry.column / 2 - halfWidth - 0.1));
      const arms = new GantryArms(c, this.toon, home, reach);
      this.scene.add(model.group, arms.group);
      const out = i === this.selected;
      if (out) arms.openNow();
      const at = out ? { x: c.loadingBay.x, z: c.loadingBay.z } : home;
      model.group.position.set(at.x, 0, at.z);
      return { model, stats: statsFor(i), bay: bayOf[i]!, home, x: at.x, z: at.z, arms };
    });
    this.schematics = this.roster.mechs.map((_, i) => schematicOf(kitFor(i)));
    this.showSchematics();
  }

  private showSchematics(): void {
    if (this.schematics.length === 0) return;
    const mechInBay = (bay: number) => this.mechs.findIndex((m) => m.bay === bay);
    for (const screen of this.screens) {
      const mech = screen.spot.show === "selected" ? this.selected : mechInBay(screen.spot.bay!);
      screen.show(this.schematics[mech] ?? null);
    }
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.last === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.seconds += dt;
    this.moveCamera();
    this.moveMechs(dt);
    this.sparks.update(dt);
    for (const screen of this.screens) screen.update(this.seconds);
    const still = this.still.matches;
    this.stage.update(dt, still);
    this.framing.update(this.seconds, dt, still);
    this.props.update(this.seconds, dt, still);
    this.life.update(this.seconds, dt, still);
    this.renderer.render(this.scene, this.camera);
  };

  // A slow drift round the resting spot, each axis on its own period so it never visibly repeats.
  private moveCamera(): void {
    const { position, target, driftMeters, driftSeconds } = this.config.camera;
    const wave = (i: number) => this.still.matches ? 0 : Math.sin((this.seconds / driftSeconds[i]!) * Math.PI * 2) * driftMeters[i]!;
    this.camera.position.set(position[0] + wave(0), position[1] + wave(1), position[2] + wave(2));
    this.camera.lookAt(target[0], target[1], target[2]);
  }

  // The rules of the loading bay: a mech's arms open before it moves and close once it is home, and the picked
  // mech only walks out once the loading bay is clear of the one going back.
  private moveMechs(dt: number): void {
    const c = this.config;
    const bay = c.loadingBay;
    this.shadows.beginMoving();
    this.mechs.forEach((m, i) => {
      const out = i === this.selected;
      const home = Math.hypot(m.x - m.home.x, m.z - m.home.z) < c.walk.arriveMeters;
      const armsOpen = m.arms.swing(out || !home, dt);
      others.length = 0;
      for (const o of this.mechs) if (o !== m) others.push(o);
      const free = armsOpen && (!out || loadingBayClear(c, others));
      const goal = out ? bay : m.home;
      stepToward(m.x, m.z, goal.x, goal.z, free ? c.walk.metersPerSecond : 0, dt, step);
      m.x = step.x; m.z = step.z;
      m.model.group.position.set(m.x, 0, m.z);
      gaitInput.vx = step.vx; gaitInput.vz = step.vz;
      gaitInput.walkSpeed = m.stats.walkSpeed; gaitInput.runSpeed = m.stats.runSpeed;
      walkMech(m.model, this.gait, gaitInput, dt);
      moveMechParts(m.model, dt);
      this.shadows.addObject(m.model.group);
    });
    this.shadows.endMoving();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
