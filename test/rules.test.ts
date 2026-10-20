import { describe, expect, it } from "vitest";
import { cascadeGameRules, forgeRules, lineGameRules } from "../src/app/rules.ts";
import type { RulesDoc, RulesFacts } from "../src/app/rules.ts";
import { lookupPay } from "../src/engine/index.ts";
import { FORGE, upgradeCost, UPGRADE_IDS } from "../src/forge/config.ts";
import { classic } from "../src/games/classic.ts";
import { crucible } from "../src/games/crucible.ts";
import { makeGame } from "./fixtures.ts";

const facts: RulesFacts = { title: "Test", name: (symbol) => `name-${symbol}`, returnPercent: 96.1, returnBasis: "by test" };
const symbolOf = (cell: string): string => cell.replace(/^name-/, "");

/** Every string on a page, in order. */
function strings(doc: RulesDoc): string[] {
  return [
    doc.title,
    doc.intro,
    ...doc.sections.flatMap((section) => [
      section.heading,
      ...(section.text ?? []),
      ...(section.list ?? []),
      ...(section.table === undefined ? [] : [...section.table.head, ...section.table.rows.flat(), section.table.note ?? ""]),
    ]),
  ];
}
const textOf = (doc: RulesDoc): string => strings(doc).join("\n");
const section = (doc: RulesDoc, heading: string) => {
  const found = doc.sections.find((candidate) => candidate.heading.startsWith(heading));
  if (found === undefined) throw new Error(`No section "${heading}" in ${doc.sections.map((s) => s.heading).join(", ")}`);
  return found;
};

describe("Clockwork's page", () => {
  const doc = lineGameRules(classic, facts);
  const text = textOf(doc);

  it("lists every paying symbol with the pays the engine uses, in every column", () => {
    const table = section(doc, "Paytable").table!;
    const paying = Object.entries(classic.pays).filter(([, pays]) => Object.keys(pays).length > 0);
    expect(table.rows).toHaveLength(paying.length);
    expect(table.head).toEqual(["Symbol", "3 in a row", "4 in a row", "5 in a row"]);
    for (const row of table.rows) {
      const symbol = symbolOf(row[0]!);
      for (const [column, run] of [3, 4, 5].entries()) {
        expect(row[column + 1]).toBe(`${new Intl.NumberFormat("en-US").format(lookupPay(classic.pays[symbol]!, run))}×`);
      }
    }
  });

  it("puts the richest symbol first", () => {
    const table = section(doc, "Paytable").table!;
    const fiveOfAKind = table.rows.map((row) => lookupPay(classic.pays[symbolOf(row[0]!)]!, 5));
    expect(fiveOfAKind).toEqual([...fiveOfAKind].sort((a, b) => b - a));
  });

  it("states the size of the game and how it is paid", () => {
    expect(text).toContain(`${classic.reels} reels, ${classic.rows} rows and ${classic.paylines.length} paylines`);
    expect(text).toContain(`times ${classic.paylines.length}`);
  });

  it("says which reels carry the wild", () => {
    const reels = classic.strips.flatMap((strip, index) => (strip.includes("W") ? [index + 1] : []));
    expect(reels).toEqual([2, 3, 4]);
    expect(section(doc, "name-W").text!.join(" ")).toContain("reels 2, 3 and 4");
  });

  it("gives the scatter table with what each count pays and starts", () => {
    const table = section(doc, "name-S").table!;
    expect(table.head).toEqual(["Scatters", "Pays", "Free spins"]);
    expect(table.rows).toEqual([
      ["3", "2×", "8"],
      ["4", "10×", "12"],
      ["5", "50×", "16"],
    ]);
  });

  it("describes the free spins from the feature's own numbers", () => {
    const feature = classic.feature!;
    const free = section(doc, "Free spins").list!.join("\n");
    expect(free).toContain("3 scatters start 8 free spins");
    expect(free).toContain("5 scatters start 16 free spins");
    expect(free).toContain(`add ${feature.retrigger[3]} more spins, up to ${feature.maxSpins} in all`);
    expect(free).toContain("5,000 times its size");
    expect(free).toMatch(/locked in place/);
    // The free spins' reels really do carry more scatters, so the page is right to say so.
    expect(free).toContain("so a retrigger is within reach");
  });

  it("gives the buy price as a multiple of the bet", () => {
    expect(section(doc, "Buying").text!.join(" ")).toContain(`for ${classic.feature!.buyCost} times your total bet`);
  });

  it("gives the return it was told, and says how it was found", () => {
    expect(section(doc, "Return").text!.join(" ")).toContain("about 96.1% of what is bet (by test)");
  });

  it("follows the configuration: change a number and the page changes with it", () => {
    const pricier = lineGameRules({ ...classic, feature: { ...classic.feature!, buyCost: 50 } }, facts);
    expect(textOf(pricier)).toContain("for 50 times your total bet");
    expect(textOf(pricier)).not.toContain("for 41 times");
    const richer = lineGameRules({ ...classic, pays: { ...classic.pays, H3: { 3: 100, 4: 500, 5: 2000 } } }, facts);
    expect(section(richer, "Paytable").table!.rows[0]).toEqual(["name-H3", "100×", "500×", "2,000×"]);
    const lowCap = lineGameRules({ ...classic, maxWinMultiple: 1000 }, facts);
    expect(textOf(lowCap)).toContain("1,000 times its size");
  });
});

describe("Crucible's page", () => {
  const doc = cascadeGameRules(crucible, facts);
  const text = textOf(doc);
  const nf = new Intl.NumberFormat("en-US");

  it("lists every gem with the pays the engine uses, for every size", () => {
    const table = section(doc, "Paytable").table!;
    const sizes = table.head.slice(1).map(Number);
    expect(sizes.length).toBeGreaterThan(5);
    expect(table.rows).toHaveLength(Object.keys(crucible.pays).length);
    for (const row of table.rows) {
      const gem = symbolOf(row[0]!);
      sizes.forEach((size, column) => expect(row[column + 1]).toBe(`${nf.format(lookupPay(crucible.pays[gem]!, size))}×`));
    }
  });

  it("explains the heat multiplier with the configured numbers", () => {
    const heat = section(doc, "Heat").text!.join("\n");
    expect(heat).toContain(`starts at ×${crucible.heat.start}`);
    expect(heat).toContain(`raises it by ${crucible.heat.step}`);
    expect(heat).toContain(`top of ×${crucible.heat.max}`);
    expect(heat).toContain("×1, ×2, ×3, ×4");
  });

  it("works its example through correctly", () => {
    const [gem, pays] = Object.entries(crucible.pays)[0]!;
    const size = crucible.minCluster + 1;
    const units = lookupPay(pays, size);
    const second = crucible.heat.start + crucible.heat.step;
    expect(section(doc, "Heat").text!.join(" ")).toContain(
      `a group of ${size} name-${gem} pays ${units} units. If it is the second winning step, heat is ×${second}, so it pays ${units * second} units.`,
    );
  });

  it("describes the furnace: what lights it, how heat climbs there, how it retriggers", () => {
    const furnace = section(doc, "name-E").list!.join("\n");
    const feature = crucible.feature!;
    expect(furnace).toContain(`${feature.trigger} or more name-e`);
    expect(furnace).toContain(`${feature.spins} free spins`);
    expect(furnace).toContain(`climbs ${feature.heatStep} a winning step instead of ${crucible.heat.step}`);
    expect(furnace).toContain("×1, ×5, ×9, ×13");
    expect(furnace).toContain(`${feature.retrigger!.count} or more`);
    expect(furnace).toContain(`add ${feature.retrigger!.spins} more spins, up to ${feature.maxSpins} in all`);
    expect(furnace).toContain("5,000 times its size");
  });

  it("gives the size of the grid, the group size and the buy price", () => {
    expect(text).toContain(`${crucible.columns} by ${crucible.rows} grid`);
    expect(text).toContain(`Groups of ${crucible.minCluster} or more`);
    expect(text).toContain(`for ${crucible.feature!.buyCost} times your total bet`);
  });

  it("follows the configuration", () => {
    const hotter = cascadeGameRules({ ...crucible, heat: { ...crucible.heat, step: 2 } }, facts);
    expect(section(hotter, "Heat").text!.join(" ")).toContain("×1, ×3, ×5, ×7");
  });
});

describe("the Forge's page", () => {
  const doc = forgeRules();

  it("lists every heat tier with its multiplier", () => {
    const table = section(doc, "Heat").table!;
    expect(table.rows).toEqual(FORGE.heat.tiers.map((tier) => [tier.name, String(tier.at), `×${tier.multiplier}`]));
  });

  it("states the mainspring's timing and payout from the configuration", () => {
    const text = section(doc, "The mainspring").text!.join(" ");
    expect(text).toContain(`${FORGE.mainspring.idleMs / 1000} seconds`);
    expect(text).toContain(`${FORGE.mainspring.autoValue * 100}% of a base strike`);
    expect(text).toContain("never earn while you are away");
  });

  it("states the ingot's timing and prizes", () => {
    const text = section(doc, "Ingots").text!.join(" ");
    expect(text).toContain(`every ${FORGE.ingot.minIntervalMs / 1000} to ${FORGE.ingot.maxIntervalMs / 1000} seconds`);
    expect(text).toContain(`stays for ${FORGE.ingot.lifetimeMs / 1000} seconds`);
    expect(text).toContain(`worth ${FORGE.ingot.windfallStrikes} strikes`);
    expect(text).toContain(`${FORGE.ingot.frenzyMs / 1000}-second frenzy`);
    expect(text).toContain(`${FORGE.ingot.frenzyMultiplier} times as much`);
  });

  it("lists every upgrade with its real first price and its top level", () => {
    const table = section(doc, "Upgrades").table!;
    expect(table.rows.map((row) => row[0])).toEqual(UPGRADE_IDS.map((id) => FORGE.upgrades[id].name));
    UPGRADE_IDS.forEach((id, index) => {
      expect(table.rows[index]![2]).toBe(`${new Intl.NumberFormat("en-US").format(upgradeCost(id, 0))}, then ×${FORGE.upgrades[id].growth} each level`);
      expect(table.rows[index]![3]).toBe(String(FORGE.upgrades[id].maxLevel));
    });
    expect(table.textual).toBe(true);
  });
});

describe("every page", () => {
  const docs: [string, RulesDoc][] = [
    ["Clockwork", lineGameRules(classic, facts)],
    ["Crucible", cascadeGameRules(crucible, facts)],
    ["the Forge", forgeRules()],
  ];

  it.each(docs)("%s has no unfilled blanks and no empty parts", (_name, doc) => {
    for (const line of strings(doc)) expect(line).not.toMatch(/undefined|NaN|\[object|Infinity/);
    expect(doc.title.length).toBeGreaterThan(0);
    expect(doc.intro.length).toBeGreaterThan(20);
    for (const part of doc.sections) {
      const content = (part.text?.length ?? 0) + (part.list?.length ?? 0) + (part.table === undefined ? 0 : 1);
      expect(content, part.heading).toBeGreaterThan(0);
      for (const line of [...(part.text ?? []), ...(part.list ?? [])]) expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(docs)("%s has tables whose rows are as wide as their heads", (_name, doc) => {
    for (const part of doc.sections) {
      if (part.table === undefined) continue;
      expect(part.table.rows.length).toBeGreaterThan(0);
      for (const row of part.table.rows) expect(row).toHaveLength(part.table.head.length);
    }
  });

  it("copes with a game that has no feature, no wild and no scatter", () => {
    const plain = makeGame({ wild: null, scatter: null, pays: { A: { 3: 5, 4: 20, 5: 100 }, B: { 3: 2, 4: 8, 5: 30 }, C: { 3: 1 } } });
    const doc = lineGameRules(plain, facts);
    const headings = doc.sections.map((part) => part.heading);
    expect(headings).toEqual(["Winning", "Paytable", "Return"]);
    expect(textOf(doc)).not.toMatch(/free spins|scatter|undefined/i);
  });

  it("says nothing about a bonus buy where there is none to buy", () => {
    const unbuyable = lineGameRules({ ...classic, feature: { ...classic.feature!, buyCost: null } }, facts);
    expect(unbuyable.sections.some((part) => part.heading.startsWith("Buying"))).toBe(false);
    const cascadeUnbuyable = cascadeGameRules({ ...crucible, feature: { ...crucible.feature!, buyCost: null } }, facts);
    expect(cascadeUnbuyable.sections.some((part) => part.heading.startsWith("Buying"))).toBe(false);
  });
});
