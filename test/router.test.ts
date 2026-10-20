import { describe, expect, it } from "vitest";
import { FORGE, LOBBY, machineRoute, parseRoute, routeToHash, sameRoute } from "../src/app/router.ts";

const MACHINES = ["classic", "crucible"];

describe("parseRoute", () => {
  it.each(["", "#", "#/", "#//", "#/lobby", "#/anything-else", "#/play", "#/play/", "#/forge/extra"])("sends %j to the lobby", (hash) => {
    expect(parseRoute(hash, MACHINES)).toEqual(LOBBY);
  });

  it("finds the forge", () => {
    expect(parseRoute("#/forge", MACHINES)).toEqual(FORGE);
    expect(parseRoute("#/forge/", MACHINES)).toEqual(FORGE);
  });

  it("finds each machine", () => {
    expect(parseRoute("#/play/classic", MACHINES)).toEqual(machineRoute("classic"));
    expect(parseRoute("#/play/crucible/", MACHINES)).toEqual(machineRoute("crucible"));
  });

  it("sends an unknown machine to the lobby rather than a broken page", () => {
    expect(parseRoute("#/play/retired", MACHINES)).toEqual(LOBBY);
  });

  it("ignores a query inside the hash", () => {
    expect(parseRoute("#/play/classic?x=1", MACHINES)).toEqual(machineRoute("classic"));
    expect(parseRoute("#/forge?x=1", MACHINES)).toEqual(FORGE);
  });
});

describe("routeToHash", () => {
  it("round-trips every route through parseRoute", () => {
    for (const route of [LOBBY, FORGE, machineRoute("classic"), machineRoute("crucible")]) {
      expect(parseRoute(routeToHash(route), MACHINES)).toEqual(route);
    }
  });

  it("writes the hashes the site uses", () => {
    expect(routeToHash(LOBBY)).toBe("#/");
    expect(routeToHash(FORGE)).toBe("#/forge");
    expect(routeToHash(machineRoute("crucible"))).toBe("#/play/crucible");
  });

  it("compares routes by where they lead", () => {
    expect(sameRoute(machineRoute("classic"), machineRoute("classic"))).toBe(true);
    expect(sameRoute(machineRoute("classic"), machineRoute("crucible"))).toBe(false);
    expect(sameRoute(LOBBY, FORGE)).toBe(false);
  });
});
