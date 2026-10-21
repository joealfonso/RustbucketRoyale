import { describe, expect, it } from "vitest";
import * as THREE from "three";
import weaponFxJson from "../../../data/weaponFx.json";
import { RivetView } from "./rivetView";
import { parseWeaponFx } from "./weaponFxData";

const look = parseWeaponFx(weaponFxJson).weapons.rivetGun!.rivet!;

function view(): { rivets: RivetView; pops: number[] } {
  const rivets = new RivetView(new THREE.Scene(), look, new THREE.MeshBasicMaterial(), () => "#ffffff", () => null, () => 3);
  const pops: number[] = [];
  rivets.onPop = (x) => pops.push(x);
  return { rivets, pops };
}
const camera = new THREE.Vector3();
const stick = (rivets: RivetView, id: number, owner = 7) =>
  rivets.stick({ owner, id, x: id, y: 0, z: 0, outX: 0, outY: 1, outZ: 0, mech: -1, fuseSeconds: 1.5 });

describe("rivets", () => {
  it("detonates one owner's rivets in a ripple, oldest first, and leaves the rest", () => {
    const { rivets, pops } = view();
    stick(rivets, 1); stick(rivets, 2); stick(rivets, 3, 9);
    expect(rivets.countOf(7)).toBe(2);
    expect(rivets.detonate(7)).toBe(2);
    expect(rivets.countOf(7)).toBe(0);
    rivets.update(0.001, camera);
    expect(pops).toEqual([1]);
    rivets.update(look.rippleSeconds, camera);
    expect(pops).toEqual([1, 2]);
    expect(rivets.countOf(9)).toBe(1);
  });

  it("takes the server's blast for a rivet already drawn popping, so it is not drawn twice", () => {
    const { rivets, pops } = view();
    stick(rivets, 4);
    rivets.detonate(7);
    rivets.update(0.001, camera);
    expect(pops).toEqual([4]);
    expect(rivets.popById(4)).toBe(true); // swallowed
    expect(rivets.popById(4)).toBe(false); // but only once
    expect(rivets.popById(99)).toBe(false); // never seen: the caller draws it
  });

  it("online, waits for the server to pop it; offline, pops it at the end of its fuse", () => {
    const { rivets, pops } = view();
    stick(rivets, 5);
    rivets.update(1.6, camera);
    expect(pops).toEqual([]);
    expect(rivets.popById(5)).toBe(true);
    rivets.update(0.001, camera);
    expect(pops).toEqual([5]);
    rivets.popOwnFuses = true;
    stick(rivets, 6);
    rivets.update(1.6, camera);
    expect(pops).toEqual([5, 6]);
  });
});
