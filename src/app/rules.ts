import { lookupPay } from "../engine/config.ts";
import type { CascadeConfig } from "../engine/cascade/index.ts";
import { smallestWinMultiple } from "../engine/analytic.ts";
import { smallestTrigger, spinsAwarded } from "../engine/feature.ts";
import type { GameConfig, PayTable, SymbolId } from "../engine/index.ts";
import { FORGE, UPGRADE_IDS, upgradeCost } from "../forge/config.ts";
import { formatAmount, UPGRADE_BLURBS } from "../forge/describe.ts";

/**
 * The text of each game's "how it works" page, written from the game's own configuration: every
 * number in it is read from the same data the rules run on, so what it says cannot drift from
 * what the game does. It is plain data; src/ui/infoDialog.ts draws it.
 */

export interface RulesTable {
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Said under the table: what its numbers are multiples of. */
  readonly note?: string;
  /** True when the cells are sentences rather than numbers, so they read left to right instead of lining up on the right. */
  readonly textual?: boolean;
}

export interface RulesSection {
  readonly heading: string;
  readonly text?: readonly string[];
  readonly list?: readonly string[];
  readonly table?: RulesTable;
}

export interface RulesDoc {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly RulesSection[];
}

/** What the reader needs to be told about a game that is not in its configuration. */
export interface RulesFacts {
  /** What the page is titled: the machine's name as the player knows it. */
  readonly title: string;
  /** What a symbol is called on the screen. */
  readonly name: (symbol: SymbolId) => string;
  /** The return shown in the lobby, as a percentage, and how it was found. */
  readonly returnPercent: number;
  readonly returnBasis: string;
}

const n = formatAmount;

const FAIRNESS =
  "Every outcome is drawn from your browser's cryptographic random source before anything moves. The animation only shows a result that already exists.";

/** "2", "2 and 3", "2, 3 and 4". */
function joinList(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const keys = (table: PayTable): number[] => Object.keys(table).map(Number).sort((a, b) => a - b);

const times = (value: number): string => `${n(value)}×`;

/** How many times `symbol` appears on a set of strips, all reels together. */
const countOn = (symbol: SymbolId, strips: readonly (readonly SymbolId[])[]): number => strips.reduce((sum, strip) => sum + strip.filter((s) => s === symbol).length, 0);

/** Which reels (counting from 1) carry `symbol` on any of the given strips. */
function reelsWith(symbol: SymbolId, ...strips: readonly (readonly (readonly SymbolId[])[])[]): number[] {
  const reels = new Set<number>();
  for (const set of strips) set.forEach((strip, index) => strip.includes(symbol) && reels.add(index + 1));
  return [...reels].sort((a, b) => a - b);
}

// --- a line game ----------------------------------------------------------------------------------------

export function lineGameRules(config: GameConfig, facts: RulesFacts): RulesDoc {
  const { name } = facts;
  const lines = config.paylines.length;
  const lineSymbols = Object.entries(config.pays).filter(([, table]) => keys(table).length > 0);
  const smallestRun = Math.min(...lineSymbols.flatMap(([, table]) => keys(table)));
  // Symbols may start paying at different run lengths (the lowest may need four), and the page says so rather than claiming one rule.
  const startsAt = new Set(lineSymbols.map(([, table]) => keys(table)[0]));
  const smallestWin = smallestWinMultiple(config);
  const runs = Array.from({ length: config.reels - smallestRun + 1 }, (_, i) => smallestRun + i);
  const feature = config.feature;

  const sections: RulesSection[] = [
    {
      heading: "Winning",
      text: [
        `${config.reels} reels, ${config.rows} rows and ${lines} paylines. ${
          startsAt.size === 1
            ? `A win needs ${smallestRun} or more matching symbols in a row along a payline, starting on the first reel and running unbroken to the right.`
            : `Matching symbols in a row along a payline win from ${smallestRun}, and the paytable shows where each symbol starts to pay. A row must start on the first reel and run unbroken to the right.`
        }`,
        `Your total bet is the bet per line times ${lines}. A line win pays its multiple of the bet per line${config.scatter === null ? "" : "; scatter wins pay a multiple of the total bet"}. Every line that wins is paid.`,
        ...(smallestWin > 1 ? [`The smallest win in this game pays ${n(Number(smallestWin.toFixed(2)))} times your total bet, so no win ever pays less than your stake.`] : []),
      ],
    },
    {
      heading: "Paytable",
      table: {
        head: ["Symbol", ...runs.map((run) => `${run} in a row`)],
        rows: [...lineSymbols]
          .sort(([, a], [, b]) => lookupPay(b, config.reels) - lookupPay(a, config.reels))
          .map(([symbol, table]) => [name(symbol), ...runs.map((run) => (lookupPay(table, run) > 0 ? times(lookupPay(table, run)) : "–"))]),
        note: "Multiples of the bet per line.",
      },
    },
  ];

  if (config.wild !== null) {
    const reels = reelsWith(config.wild, config.strips);
    sections.push({
      heading: `${name(config.wild)}`,
      text: [
        `The ${name(config.wild).toLowerCase()} stands in for every symbol except the ${config.scatter === null ? "scatter" : name(config.scatter.symbol).toLowerCase()}. It lands on reel${reels.length === 1 ? "" : "s"} ${joinList(reels)} only${
          feature === null ? "" : `, and it is what locks in place during the free spins`
        }.`,
      ],
    });
  }

  if (config.scatter !== null) {
    const scatter = config.scatter;
    const counts = [...new Set([...keys(scatter.pays), ...(feature === null ? [] : keys(feature.spins))])].sort((a, b) => a - b);
    sections.push({
      heading: name(scatter.symbol),
      text: [
        `${name(scatter.symbol)}s pay anywhere on the reels, in any position, and never form a line.${
          feature === null ? "" : ` ${smallestTrigger(config)} or more of them on the opening spin start the free spins.`
        }`,
      ],
      table: {
        head: feature === null ? ["Scatters", "Pays"] : ["Scatters", "Pays", "Free spins"],
        rows: counts.map((count) => {
          const pay = lookupPay(scatter.pays, count);
          const row = [String(count), pay > 0 ? times(pay) : "–"];
          return feature === null ? row : [...row, spinsAwarded(config, count) > 0 ? String(spinsAwarded(config, count)) : "–"];
        }),
        note: "Scatter pays are multiples of your total bet.",
      },
    });
  }

  if (feature !== null) {
    const retriggerAt = Math.min(...keys(feature.retrigger));
    const retriggerSpins = lookupPay(feature.retrigger, retriggerAt);
    const scatterSymbol = config.scatter?.symbol ?? null;
    const onFeatureReels = scatterSymbol === null ? 0 : countOn(scatterSymbol, feature.strips);
    const onBaseReels = scatterSymbol === null ? 0 : countOn(scatterSymbol, config.strips);
    const richer = onFeatureReels > onBaseReels ? ` They carry ${onFeatureReels} scatters in all, against ${onBaseReels} on the base game's reels, so a retrigger is within reach.` : "";
    sections.push({
      heading: "Free spins",
      list: [
        `${joinList(keys(feature.spins).map((count) => `${count} scatters start ${feature.spins[count]} free spins`))}.`,
        `Every ${config.wild === null ? "wild" : name(config.wild).toLowerCase()} that lands during the free spins is locked in place until the feature ends, so the board fills up as it goes and later spins win more.`,
        `The free spins play on their own reels.${richer} ${retriggerAt} or more scatters on a free spin add ${retriggerSpins} more spins, up to ${feature.maxSpins} in all.`,
        ...(config.maxWinMultiple === null ? [] : [`One bet can win at most ${n(config.maxWinMultiple)} times its size; the feature ends the moment that is reached.`]),
      ],
    });
    if (feature.buyCost !== null) {
      sections.push({
        heading: "Buying the bonus",
        text: [
          `The buy bar skips the wait: for ${n(feature.buyCost)} times your total bet the free spins start at once, with no opening spin, exactly as if ${smallestTrigger(config)} scatters had landed.`,
          "The price is set from the feature's measured average value, so a buy returns a little under what a spin does. Most buys pay less than they cost and a few pay far more.",
        ],
      });
    }
  }

  sections.push({
    heading: "Return",
    text: [`Over time the machine returns about ${n(facts.returnPercent)}% of what is bet (${facts.returnBasis}). Any single session can be far above or below that.`, FAIRNESS],
  });

  return {
    title: facts.title,
    intro:
      feature !== null
        ? `Line up matching symbols from the left. ${smallestTrigger(config)} scatters start free spins in which wilds lock in place.`
        : `Line up matching symbols from the left.${
            config.wild !== null && config.scatter !== null
              ? " Wilds fill in and scatters pay anywhere."
              : config.wild !== null
                ? " Wilds fill in."
                : config.scatter !== null
                  ? " Scatters pay anywhere."
                  : ""
          }`,
    sections,
  };
}

// --- a cascade game -----------------------------------------------------------------------------------------

/** The multipliers the first few winning steps pay at, as text: "×1, ×2, ×3, ×4 and on". */
function heatLadder(start: number, step: number, max: number): string {
  const rungs = Array.from({ length: 4 }, (_, i) => start + i * step).filter((heat) => heat <= max);
  return `${rungs.map((heat) => `×${n(heat)}`).join(", ")} and on up`;
}

export function cascadeGameRules(config: CascadeConfig, facts: RulesFacts): RulesDoc {
  const { name } = facts;
  const gems = Object.entries(config.pays);
  const sizes = [...new Set(gems.flatMap(([, table]) => keys(table)))].sort((a, b) => a - b);
  const feature = config.feature;
  const scatterName = config.scatter === null ? null : name(config.scatter);
  const { heat } = config;

  // One worked example, from the first gem's table: a group a little over the minimum, at the second winning step.
  const [exampleGem, exampleTable] = gems[0]!;
  const exampleSize = config.minCluster + 1;
  const exampleUnits = lookupPay(exampleTable, exampleSize);
  const exampleHeat = heat.start + heat.step;

  const sections: RulesSection[] = [
    {
      heading: "Winning",
      text: [
        `A ${config.columns} by ${config.rows} grid of gems. Groups of ${config.minCluster} or more of the same gem that touch (up, down, left or right) pay. Winning groups vanish, the gems above fall, new gems drop in, and any new group pays too, until nothing more pays. That is one spin.`,
        `Your total bet is the bet per unit times ${config.units}. A group pays its number of units times your bet per unit, times the heat.`,
      ],
    },
    {
      heading: "Heat: the multiplier",
      text: [
        `Heat multiplies every win. A spin starts at ×${n(heat.start)}, and each winning step raises it by ${n(heat.step)}: ${heatLadder(heat.start, heat.step, heat.max)}, to a top of ×${n(heat.max)}. The heat is back to ×${n(heat.start)} on the next spin.`,
        `For example, a group of ${exampleSize} ${name(exampleGem)} pays ${n(exampleUnits)} units. If it is the second winning step, heat is ×${n(exampleHeat)}, so it pays ${n(exampleUnits * exampleHeat)} units.`,
      ],
    },
    {
      heading: "Paytable",
      table: {
        head: ["Gem", ...sizes.map(String)],
        rows: [...gems]
          .sort(([, a], [, b]) => lookupPay(b, sizes.at(-1)!) - lookupPay(a, sizes.at(-1)!))
          .map(([gem, table]) => [name(gem), ...sizes.map((size) => times(lookupPay(table, size)))]),
        note: `Columns are the size of the group; units are multiples of your bet per unit, before the heat. A group between two sizes pays as the smaller; ${n(sizes.at(-1)!)} or more pays as ${n(sizes.at(-1)!)}.`,
      },
    },
  ];

  if (feature !== null && scatterName !== null) {
    const extra = feature.heatStep ?? heat.step;
    sections.push({
      heading: `${scatterName}s and the furnace`,
      list: [
        `${scatterName}s pay nothing and never join a group.`,
        `${feature.trigger} or more ${scatterName.toLowerCase()}s on the opening grid of a spin light the furnace: ${feature.spins} free spins.`,
        `In the furnace the heat is never reset between spins, and it climbs ${n(extra)} a winning step instead of ${n(heat.step)}: ${heatLadder(heat.start, extra, heat.max)}. It climbs all the way to the last spin.`,
        ...(feature.retrigger === null
          ? []
          : [`${feature.retrigger.count} or more ${scatterName.toLowerCase()}s on a furnace spin add ${feature.retrigger.spins} more spins, up to ${feature.maxSpins} in all.`]),
        `One bet can win at most ${n(config.maxWinMultiple)} times its size; the spin ends the moment that is reached.`,
      ],
    });
    if (feature.buyCost !== null) {
      sections.push({
        heading: "Buying the bonus",
        text: [
          `The buy bar skips the wait: for ${n(feature.buyCost)} times your total bet the furnace is lit at once, with no base spin.`,
          "The price is set from the feature's measured average value, so a buy returns a little under what a spin does. Most buys pay less than they cost and a few pay far more.",
        ],
      });
    }
  }

  sections.push({
    heading: "Return",
    text: [`Over time the machine returns about ${n(facts.returnPercent)}% of what is bet (${facts.returnBasis}). Any single session can be far above or below that.`, FAIRNESS],
  });

  return {
    title: facts.title,
    intro: "Groups of gems pay and vanish. Every win in a spin heats the furnace, and heat multiplies the next win.",
    sections,
  };
}

// --- the Forge -------------------------------------------------------------------------------------------------

export function forgeRules(): RulesDoc {
  const { heat, mainspring, ingot } = FORGE;
  const seconds = (ms: number): string => `${n(ms / 1000)} seconds`;
  const secs = (ms: number): string => n(ms / 1000);
  return {
    title: "The Forge",
    intro: "Strike the anvil to earn credits for the machines. It costs nothing to play, and it is the way to earn more when you run low.",
    sections: [
      {
        heading: "Striking",
        text: [
          "Click or tap the anvil, press the Strike button, or press Space or Enter. Each strike pays credits, and every credit goes straight into your balance.",
        ],
      },
      {
        heading: "Heat: the multiplier",
        text: [
          `Heat builds as you keep striking and drains when you pause (it holds for ${seconds(heat.graceMs)} first). Its tier multiplies every strike.`,
        ],
        table: {
          head: ["Tier", "From heat", "Strikes pay"],
          rows: heat.tiers.map((tier) => [tier.name, String(tier.at), `×${n(tier.multiplier)}`]),
          note: `Heat tops out at ${heat.max}. Tongs make it build faster and drain slower.`,
        },
      },
      {
        heading: "The mainspring",
        text: [
          `Your strikes wind it. Once you pause for ${seconds(mainspring.idleMs)}, it unwinds into automatic strikes worth ${n(mainspring.autoValue * 100)}% of a base strike each, until it runs down.`,
          "It only stores effort you already put in, so it can never earn while you are away: the Forge stops when the page is hidden. More levels hold more turns, take more from each strike and unwind faster.",
        ],
      },
      {
        heading: "Ingots",
        text: [
          `Now and then (every ${secs(ingot.minIntervalMs)} to ${secs(ingot.maxIntervalMs)} seconds, while the Forge is open) an ingot flashes across the forge and stays for ${seconds(ingot.lifetimeMs)}. Click it in time for a windfall worth ${n(ingot.windfallStrikes)} strikes, or a ${secs(ingot.frenzyMs)}-second frenzy in which every strike, the mainspring's too, pays ${n(ingot.frenzyMultiplier)} times as much. Lucky ingots shorten the wait and raise both prizes.`,
        ],
      },
      {
        heading: "Upgrades",
        table: {
          head: ["Upgrade", "What it does", "Price", "Levels"],
          rows: UPGRADE_IDS.map((id) => [
            FORGE.upgrades[id].name,
            UPGRADE_BLURBS[id],
            `${n(upgradeCost(id, 0))}, then ×${n(FORGE.upgrades[id].growth)} each level`,
            String(FORGE.upgrades[id].maxLevel),
          ]),
          note: "Upgrades are bought with credits and kept between visits. Each card on the page shows exactly what its next level changes.",
          textual: true,
        },
      },
    ],
  };
}
