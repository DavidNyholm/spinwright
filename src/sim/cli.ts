import { parseArgs } from "node:util";
import { games } from "../games/index.ts";
import { runCascadeSim } from "./cascadeSim.ts";
import { runLineSim } from "./lineSim.ts";

const DEFAULTS = { game: "classic", spins: "1000000", seed: "spinwright-sim", lineBet: "1", sessions: "200000" } as const;
/** A simulated RTP further than this many standard errors from the exact value means a bug, not bad luck. */
const MAX_Z = 4;

const USAGE = `Usage: npm run sim -- [--game <id>] [--spins <n>] [--seed <text>] [--line-bet <n>] [--sessions <n>]
  --game       one of: ${Object.keys(games).join(", ")} (default ${DEFAULTS.game})
  --spins      number of rounds (a spin and any free spins it starts) to simulate (default ${DEFAULTS.spins})
  --seed       RNG seed; the same seed gives the same run (default "${DEFAULTS.seed}")
  --line-bet   credits per bet unit, which is per payline in a line game; RTP does not depend on it (default ${DEFAULTS.lineBet})
  --sessions   feature sessions to simulate on their own, for the by-parts estimate (default ${DEFAULTS.sessions})`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function parsePositiveInt(name: string, text: string, min: number): number {
  const value = Number(text.replaceAll("_", ""));
  if (!Number.isInteger(value) || value < min) fail(`--${name} must be an integer >= ${min}, got "${text}"`);
  return value;
}

const { values } = parseArgs({
  options: {
    game: { type: "string", default: DEFAULTS.game },
    spins: { type: "string", default: DEFAULTS.spins },
    seed: { type: "string", default: DEFAULTS.seed },
    "line-bet": { type: "string", default: DEFAULTS.lineBet },
    sessions: { type: "string", default: DEFAULTS.sessions },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const entry = games[values.game];
if (entry === undefined) fail(`Unknown game "${values.game}"`);
const spins = parsePositiveInt("spins", values.spins, 2);
const lineBet = parsePositiveInt("line-bet", values["line-bet"], 1);

if (entry.kind === "cascade") {
  const sessions = parsePositiveInt("sessions", values.sessions, 2);
  const { report, agrees } = runCascadeSim(entry.config, { plays: spins, sessions, seed: values.seed, unitBet: lineBet });
  console.log(report);
  if (!agrees) {
    console.error("\nThe end-to-end feature return and the by-parts estimate disagree: the feature logic and its exact trigger chance are inconsistent.");
    process.exit(1);
  }
  process.exit(0);
}
const { report, agrees } = runLineSim(entry.config, { rounds: spins, sessions: parsePositiveInt("sessions", values.sessions, 2), seed: values.seed, lineBet });
console.log(report);
if (!agrees) {
  console.error("\nThe end-to-end results and the exact or by-parts estimates disagree: the engine, the feature logic and the exact calculations are inconsistent.");
  process.exit(1);
}
