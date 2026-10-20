import { describe, expect, it } from "vitest";
import { STEP, World, aimCar, boxFromData, createGrenade, parseTitanConfig, stepGrenade } from "@rustbucket/shared";
import titanJson from "../../../data/titan.json";
import { carFuseSeconds, carLanding } from "./thrownCars";

const config = parseTitanConfig(titanJson);
const ground = new World([boxFromData({ name: "ground", center: [0, -1, 0], size: [600, 2, 600], color: "#fff" })]);

describe("thrown cars", () => {
  it("fly for exactly the fuse the server aims them with", () => {
    const car = createGrenade();
    aimCar(0, 11, 0, 40, 1, 10, config.throw.flightSeconds, config.car, STEP, car);
    expect(carFuseSeconds(config.throw.flightSeconds, STEP)).toBeCloseTo(car.timeLeft, 9);
  });

  it("come down where the server's car does, flown by the same grenade step", () => {
    const server = createGrenade();
    aimCar(0, 11, 0, 40, 1.2, 10, config.throw.flightSeconds, config.car, STEP, server);
    const { x, y, z, vx, vy, vz } = server;
    while (!stepGrenade(server, config.car, STEP, ground));
    const lands = { x: 0, y: 0, z: 0 };
    carLanding(x, y, z, vx, vy, vz, config.car, carFuseSeconds(config.throw.flightSeconds, STEP), STEP, ground, lands);
    expect(lands).toEqual({ x: server.x, y: server.y, z: server.z });
    expect(lands.x).toBeCloseTo(40, 1);
    expect(lands.z).toBeCloseTo(10, 1);
  });
});
