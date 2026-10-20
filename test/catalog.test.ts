import { describe, expect, it } from "vitest";
import { CATALOG, CLOCKWORK_RTP_PERCENT, SLOT_ENTRIES } from "../src/app/catalog.ts";
import { parseRoute, routeToHash } from "../src/app/router.ts";
import { exactRtp } from "../src/engine/index.ts";
import { classic } from "../src/games/classic.ts";
import { crucible } from "../src/games/crucible.ts";

describe("catalog", () => {
  const machineIds = SLOT_ENTRIES.map((entry) => entry.id);

  it("lists each machine once, with the id of the game it plays", () => {
    expect(machineIds).toEqual([classic.id, crucible.id]);
    expect(new Set(CATALOG.map((entry) => entry.id)).size).toBe(CATALOG.length);
  });

  it("gives every entry a route the router finds again", () => {
    for (const entry of CATALOG) expect(parseRoute(routeToHash(entry.route), machineIds)).toEqual(entry.route);
  });

  it("numbers the machines in order and nothing else", () => {
    expect(SLOT_ENTRIES.map((entry) => entry.number)).toEqual([1, 2]);
    expect(CATALOG.filter((entry) => entry.kind !== "slot").every((entry) => entry.number === null)).toBe(true);
  });

  it("shows Clockwork's return as it really is, to two places", () => {
    expect(CLOCKWORK_RTP_PERCENT).toBe(Math.round(exactRtp(classic).total * 10_000) / 100);
    const clockwork = CATALOG.find((entry) => entry.id === classic.id)!;
    expect(clockwork.facts.join(" ")).toContain("95.94%");
  });

  it("says what each game is made of, from its own configuration", () => {
    expect(CATALOG.find((entry) => entry.id === classic.id)!.facts[0]).toBe(`${classic.reels} reels, ${classic.paylines.length} lines`);
    expect(CATALOG.find((entry) => entry.id === crucible.id)!.facts[0]).toContain(`${crucible.columns} × ${crucible.rows}`);
  });
});
