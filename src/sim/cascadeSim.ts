import { createRng } from "../engine/index.ts";
import { playCascade, playFeatureSession, triggerProbability } from "../engine/cascade/index.ts";
import type { CascadeConfig } from "../engine/cascade/index.ts";
import { CASCADE_WIN_BANDS, createCascadeStats, recordCascade, Running, STEP_BUCKETS } from "./cascadeStats.ts";

/** A simulated total further than this many standard errors from the other estimate means a bug, not bad luck. */
const MAX_Z = 4;

export interface CascadeSimOptions {
  readonly plays: number;
  /** Feature sessions to simulate directly for the decomposed estimate. */
  readonly sessions: number;
  readonly seed: string;
  readonly unitBet: number;
}

const percent = (fraction: number, digits = 2): string => `${(fraction * 100).toFixed(digits)}%`;
const oneIn = (fraction: number): string => (fraction > 0 ? `1 in ${(1 / fraction).toFixed(1)}` : "never");
const count = (n: number): string => n.toLocaleString("en-US");

/**
 * Simulates a cascade game and prints a report. The return is estimated two ways: by playing whole
 * bets end to end, and by combining the exact chance of the feature with the value of feature
 * sessions simulated on their own. They must agree; if they do not, the feature logic is wrong.
 * Returns true if they agree.
 */
export function runCascadeSim(config: CascadeConfig, options: CascadeSimOptions): { report: string; agrees: boolean } {
  const { plays, sessions, seed, unitBet } = options;
  const totalBet = unitBet * config.units;

  const rng = createRng(seed);
  const stats = createCascadeStats();
  const started = performance.now();
  for (let i = 0; i < plays; i++) recordCascade(stats, playCascade(config, rng, unitBet));
  const seconds = (performance.now() - started) / 1000;

  const lines: string[] = [];
  const rtp = stats.total.mean;
  lines.push(
    `${config.name} (${config.columns}x${config.rows}, clusters of ${config.minCluster}+)`,
    `${count(plays)} plays, seed "${seed}", ${unitBet} credit(s) per unit (${totalBet} total bet), ${seconds.toFixed(1)}s (${(plays / seconds / 1e3).toFixed(0)}k plays/s)`,
    "",
    `RTP            ${percent(rtp)} +/- ${percent(1.96 * stats.total.standardError)} (95% CI, end to end)`,
    `  base spins   ${percent(stats.base.mean)}`,
    `  feature      ${percent(stats.feature.mean)}`,
  );

  let agrees = true;
  if (config.feature !== null) {
    const trigger = triggerProbability(config);
    const sessionRng = createRng(`${seed}:sessions`);
    const session = new Running();
    for (let i = 0; i < sessions; i++) session.add(playFeatureSession(config, sessionRng, unitBet) / totalBet);

    const featureByParts = trigger * session.mean;
    const standardError = Math.sqrt(stats.feature.standardError ** 2 + (trigger * session.standardError) ** 2);
    const z = (stats.feature.mean - featureByParts) / standardError;
    agrees = Math.abs(z) <= MAX_Z;
    const decomposedSe = Math.sqrt(stats.base.standardError ** 2 + (trigger * session.standardError) ** 2);
    lines.push(
      `RTP by parts   ${percent(stats.base.mean + featureByParts)} +/- ${percent(1.96 * decomposedSe)} (base + exact trigger chance x ${count(sessions)} simulated features)`,
      `  feature      end to end ${percent(stats.feature.mean)}   by parts ${percent(featureByParts)}   z = ${z.toFixed(2)}  ${agrees ? "ok" : "MISMATCH"}`,
      `Trigger        ${oneIn(stats.triggers / plays)} simulated, ${oneIn(trigger)} exact`,
      `Feature        ${session.mean.toFixed(1)}x total bet on average (sd ${Math.sqrt(session.variance).toFixed(1)}x), ${(stats.featureSpins / Math.max(1, stats.triggers)).toFixed(1)} spins each`,
    );
  }

  lines.push(
    `Hit frequency  ${percent(stats.hits / plays, 1)}  (${oneIn(stats.hits / plays)})`,
    `Volatility     sd ${Math.sqrt(stats.total.variance).toFixed(2)}x total bet per play`,
    `Max win seen   ${stats.maxX.toFixed(1)}x total bet (cap ${count(config.maxWinMultiple)}x; ${count(stats.capped)} plays hit it); highest heat ${stats.maxHeat}`,
    "",
    "Win size (x total bet)      plays        frequency",
    ...CASCADE_WIN_BANDS.map((band, i) => {
      const n = stats.bandCounts[i]!;
      return `  ${band.label.padEnd(13)} ${count(n).padStart(13)}   ${percent(n / plays, 3).padStart(9)}  ${oneIn(n / plays)}`;
    }),
    "",
    "Winning steps in a base spin",
    ...Array.from({ length: STEP_BUCKETS }, (_, i) => {
      const n = stats.baseStepCounts[i]!;
      const label = i === STEP_BUCKETS - 1 ? `${i}+` : String(i);
      return `  ${label.padEnd(3)} ${count(n).padStart(13)}   ${percent(n / plays, 2).padStart(8)}`;
    }),
  );
  return { report: lines.join("\n"), agrees };
}
