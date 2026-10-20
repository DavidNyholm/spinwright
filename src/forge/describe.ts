import { FORGE, frenzyDurationMs, heatDrainPerSecond, heatGain, ingotWaitScale, springStats, strikeBase, windfallStrikes } from "./config.ts";
import type { UpgradeId } from "./config.ts";

const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A credit amount for display: whole numbers with separators, part-credits to two places at most. */
export const formatAmount = (amount: number): string => amountFormat.format(amount);

export interface UpgradeText {
  /** What the upgrade does at this level. */
  readonly now: string;
  /** What the next level would do, or null at the top level. */
  readonly next: string | null;
}

const seconds = (ms: number): string => `${amountFormat.format(Math.round(ms / 100) / 10)} s`;

/** Average wait between ingots at a luck level, in milliseconds. */
const averageIngotWaitMs = (luck: number): number =>
  ((FORGE.ingot.minIntervalMs + FORGE.ingot.maxIntervalMs) / 2) * ingotWaitScale(luck);

const EFFECTS: Readonly<Record<UpgradeId, (level: number) => string>> = {
  hammer: (level) => `Each strike pays ${formatAmount(strikeBase(level))}.`,
  tongs: (level) => `Heat builds ${formatAmount(heatGain(level))} per strike and cools ${formatAmount(heatDrainPerSecond(level))} a second.`,
  mainspring: (level) => {
    if (level === 0) return "Not fitted yet.";
    const spring = springStats(level);
    return `Holds ${spring.capacity} turns. Each strike winds ${formatAmount(spring.windPerStrike)}; it then strikes ${formatAmount(spring.rate)} times a second.`;
  },
  luck: (level) =>
    `An ingot about every ${seconds(averageIngotWaitMs(level))}. A windfall pays ${formatAmount(windfallStrikes(level))} strikes; a frenzy lasts ${seconds(frenzyDurationMs(level))}.`,
};

/** What a card says about an upgrade at `level`, written from the same numbers the Forge plays by. */
export function describeUpgrade(id: UpgradeId, level: number): UpgradeText {
  const rules = FORGE.upgrades[id];
  return {
    now: EFFECTS[id](level),
    next: level >= rules.maxLevel ? null : EFFECTS[id](level + 1),
  };
}

/** One line on what an upgrade is for, which does not change with its level. */
export const UPGRADE_BLURBS: Readonly<Record<UpgradeId, string>> = {
  hammer: "Every strike is worth more.",
  tongs: "Heat is a combo: it builds with each strike and multiplies the next ones.",
  mainspring: `Your strikes wind a spring. Pause and it strikes for you, at ${Math.round(FORGE.mainspring.autoValue * 100)}% of a base strike, until it runs down. It never earns while you are away.`,
  luck: "Ingots flash across the forge now and then. Catch one for a windfall or a frenzy.",
};
