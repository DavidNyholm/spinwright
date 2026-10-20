import { createRng, exactRtp, openingScatterProbabilities, playFeatureSession, playRound, spinsAwarded, triggerProbability } from "../engine/index.ts";
import type { ExactRtp, GameConfig } from "../engine/index.ts";
import { Running } from "./running.ts";
import { createStats, record, WIN_BANDS } from "./stats.ts";

/** A simulated total further than this many standard errors from the other estimate means a bug, not bad luck. */
const MAX_Z = 4;

const percent = (fraction: number, digits = 2): string => `${(fraction * 100).toFixed(digits)}%`;
const oneIn = (fraction: number): string => (fraction > 0 ? `1 in ${(1 / fraction).toFixed(1)}` : "never");
const count = (n: number): string => n.toLocaleString("en-US");

export interface ReturnEstimate {
  /** The opening spin, worked out exactly. */
  readonly base: ExactRtp;
  /** The exact chance that the opening spin starts the feature. */
  readonly trigger: number;
  /** For each number of scatters that starts it: the exact chance, the spins it awards, and the simulated value of the feature. */
  readonly perCount: readonly { readonly scatters: number; readonly probability: number; readonly spins: number; readonly value: Running }[];
  /** Return from the feature: each count's chance times its simulated value, as a fraction of the bet. */
  readonly featureRtp: number;
  readonly featureStdError: number;
  readonly total: number;
}

/**
 * The game's return, built from parts: the opening spin exactly, plus for each number of scatters
 * that starts the feature, its exact chance times the average of `sessions` features simulated on
 * their own. Only the feature part carries sampling error.
 */
export function estimateReturn(config: GameConfig, sessions: number, seed: string, lineBet = 1): ReturnEstimate {
  const base = exactRtp(config);
  const rng = createRng(seed);
  const totalBet = lineBet * config.paylines.length;
  const perCount: { scatters: number; probability: number; spins: number; value: Running }[] = [];
  let featureRtp = 0;
  let variance = 0;
  openingScatterProbabilities(config).forEach((probability, scatters) => {
    const spins = spinsAwarded(config, scatters);
    if (spins === 0 || probability === 0) return;
    const value = new Running();
    for (let i = 0; i < sessions; i++) value.add(playFeatureSession(config, rng, lineBet, scatters) / totalBet);
    perCount.push({ scatters, probability, spins, value });
    featureRtp += probability * value.mean;
    variance += (probability * value.standardError) ** 2;
  });
  return { base, trigger: triggerProbability(config), perCount, featureRtp, featureStdError: Math.sqrt(variance), total: base.total + featureRtp };
}

export interface LineSimOptions {
  readonly rounds: number;
  /** Features simulated on their own, for each number of scatters, for the by-parts estimate. */
  readonly sessions: number;
  readonly seed: string;
  readonly lineBet: number;
}

/**
 * Simulates a line game and prints a report. The return is estimated end to end, by playing whole
 * bets, and by parts (see estimateReturn); the two must agree, or the feature logic and its exact
 * trigger chance are inconsistent. Returns true if they agree.
 */
export function runLineSim(config: GameConfig, options: LineSimOptions): { report: string; agrees: boolean } {
  const { rounds, sessions, seed, lineBet } = options;
  const totalBet = lineBet * config.paylines.length;

  const rng = createRng(seed);
  const stats = createStats();
  const started = performance.now();
  for (let i = 0; i < rounds; i++) record(stats, playRound(config, rng, lineBet));
  const seconds = (performance.now() - started) / 1000;

  const estimate = estimateReturn(config, sessions, `${seed}:sessions`, lineBet);
  const exactBase = estimate.base.total;
  const simulatedBase = stats.opening.mean;
  const baseZ = (simulatedBase - exactBase) / stats.opening.standardError;
  let agrees = Math.abs(baseZ) <= MAX_Z;

  const lines: string[] = [
    `${config.name} (${config.paylines.length} lines${config.feature !== null ? ", free spins with locked wilds" : ""})`,
    `${count(rounds)} rounds, seed "${seed}", ${lineBet} credit(s) per line (${totalBet} total bet), ${seconds.toFixed(1)}s (${(rounds / seconds / 1e3).toFixed(0)}k rounds/s)`,
    "",
    `RTP            ${percent(stats.total.mean)} +/- ${percent(1.96 * stats.total.standardError)} (95% CI, end to end)`,
    `  lines        ${percent(stats.lines.mean)}   exact ${percent(estimate.base.lines)}`,
    `  scatter      ${percent(stats.scatter.mean)}   exact ${percent(estimate.base.scatter)}`,
  ];
  lines.push(
    `  opening spin ${percent(simulatedBase)}   exact ${percent(exactBase)}   z = ${baseZ.toFixed(2)}  ${Math.abs(baseZ) <= MAX_Z ? "ok" : "MISMATCH"}`,
  );

  if (config.feature !== null) {
    const featureZ =
      (stats.freeSpins.mean - estimate.featureRtp) / Math.sqrt(stats.freeSpins.standardError ** 2 + estimate.featureStdError ** 2);
    const featureAgrees = Math.abs(featureZ) <= MAX_Z;
    agrees &&= featureAgrees;
    const triggers = Math.max(1, stats.triggers);
    lines.push(
      `  free spins   ${percent(stats.freeSpins.mean)}`,
      `RTP by parts   ${percent(estimate.total)} +/- ${percent(1.96 * estimate.featureStdError)} (exact opening spin + exact trigger chances x ${count(sessions)} simulated features each)`,
      `  free spins   end to end ${percent(stats.freeSpins.mean)}   by parts ${percent(estimate.featureRtp)}   z = ${featureZ.toFixed(2)}  ${featureAgrees ? "ok" : "MISMATCH"}`,
      `Trigger        ${oneIn(stats.triggers / rounds)} simulated, ${oneIn(estimate.trigger)} exact`,
      ...estimate.perCount.map(
        (part) =>
          `  ${part.scatters} scatters   ${oneIn(part.probability)} exact, ${part.spins} spins, worth ${part.value.mean.toFixed(1)}x total bet on average (sd ${Math.sqrt(part.value.variance).toFixed(1)}x)`,
      ),
      `Free spins     ${stats.perFeature.mean.toFixed(1)}x total bet per feature (sd ${Math.sqrt(stats.perFeature.variance).toFixed(1)}x), ${(stats.freeSpinsPlayed / triggers).toFixed(1)} spins played, ` +
        `retriggered in ${percent(stats.retriggers / triggers, 1)} of features, ${(stats.lockedAtEnd / triggers).toFixed(1)} wilds locked at the end`,
    );
  }

  lines.push(
    `Hit frequency  ${percent(stats.hits / rounds, 1)}  (${oneIn(stats.hits / rounds)})`,
    `Volatility     sd ${Math.sqrt(stats.total.variance).toFixed(2)}x total bet per round`,
    `Max win seen   ${stats.maxX.toFixed(1)}x total bet` +
      (config.maxWinMultiple === null ? "" : ` (cap ${count(config.maxWinMultiple)}x; ${count(stats.capped)} rounds hit it)`) +
      `  (opening stops ${stats.maxStops.join(",")})`,
    "",
    "Win size (x total bet)      rounds        frequency",
    ...WIN_BANDS.map((band, i) => {
      const n = stats.bandCounts[i]!;
      return `  ${band.label.padEnd(13)} ${count(n).padStart(13)}   ${percent(n / rounds, 3).padStart(9)}  ${oneIn(n / rounds)}`;
    }),
    "",
    "Line RTP by symbol, opening spin   simulated     exact",
    ...Object.keys(estimate.base.lineBySymbol)
      .sort()
      .map((symbol) => {
        const simulated = (stats.lineBySymbol[symbol] ?? 0) / rounds;
        return `  ${symbol.padEnd(12)} ${percent(simulated).padStart(26)} ${percent(estimate.base.lineBySymbol[symbol]!).padStart(9)}`;
      }),
  );
  return { report: lines.join("\n"), agrees };
}
