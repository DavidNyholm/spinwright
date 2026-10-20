import { parseArgs } from "node:util";
import { createRng, exactRtp, spin } from "../engine/index.ts";
import { games } from "../games/index.ts";
import { createStats, record, summarize, WIN_BANDS } from "./stats.ts";

const DEFAULTS = { game: "classic", spins: "1000000", seed: "spinwright-sim", lineBet: "1" } as const;
/** A simulated RTP further than this many standard errors from the exact value means a bug, not bad luck. */
const MAX_Z = 4;

const USAGE = `Usage: npm run sim -- [--game <id>] [--spins <n>] [--seed <text>] [--line-bet <n>]
  --game       one of: ${Object.keys(games).join(", ")} (default ${DEFAULTS.game})
  --spins      number of spins to simulate (default ${DEFAULTS.spins})
  --seed       RNG seed; the same seed gives the same run (default "${DEFAULTS.seed}")
  --line-bet   credits per payline; RTP does not depend on it (default ${DEFAULTS.lineBet})`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function parsePositiveInt(name: string, text: string, min: number): number {
  const value = Number(text.replaceAll("_", ""));
  if (!Number.isInteger(value) || value < min) fail(`--${name} must be an integer >= ${min}, got "${text}"`);
  return value;
}

const percent = (fraction: number, digits = 2): string => `${(fraction * 100).toFixed(digits)}%`;
const oneIn = (fraction: number): string => (fraction > 0 ? `1 in ${(1 / fraction).toFixed(1)}` : "never");

const { values } = parseArgs({
  options: {
    game: { type: "string", default: DEFAULTS.game },
    spins: { type: "string", default: DEFAULTS.spins },
    seed: { type: "string", default: DEFAULTS.seed },
    "line-bet": { type: "string", default: DEFAULTS.lineBet },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const game = games[values.game];
if (game === undefined) fail(`Unknown game "${values.game}"`);
const spins = parsePositiveInt("spins", values.spins, 2);
const lineBet = parsePositiveInt("line-bet", values["line-bet"], 1);

const rng = createRng(values.seed);
const stats = createStats();
const started = performance.now();
for (let i = 0; i < spins; i++) record(stats, spin(game, rng, lineBet));
const seconds = (performance.now() - started) / 1000;

const summary = summarize(stats);
const exact = exactRtp(game);
const z = (summary.rtp - exact.total) / summary.rtpStdError;
const agrees = Math.abs(z) <= MAX_Z;

const lines = [
  `${game.name} (${game.paylines.length} lines)`,
  `${spins.toLocaleString("en-US")} spins, seed "${values.seed}", ${lineBet} credit(s) per line, ` +
    `${seconds.toFixed(1)}s (${(spins / seconds / 1e6).toFixed(2)}M spins/s)`,
  "",
  `RTP            ${percent(summary.rtp)} +/- ${percent(summary.rtpCi95)} (95% CI)   exact ${percent(exact.total)}   ` +
    `z = ${z.toFixed(2)}  ${agrees ? "ok" : "MISMATCH"}`,
  `  lines        ${percent(summary.lineRtp)}   exact ${percent(exact.lines)}`,
  `  scatter      ${percent(summary.scatterRtp)}   exact ${percent(exact.scatter)}`,
  `Hit frequency  ${percent(summary.hitFrequency, 1)}  (${oneIn(summary.hitFrequency)})`,
  `Volatility     sd ${summary.volatility.toFixed(2)}x total bet per spin`,
  `Max win seen   ${stats.maxX.toFixed(1)}x total bet  (stops ${stats.maxStops.join(",")})`,
  "",
  "Win size (x total bet)      spins        frequency",
  ...WIN_BANDS.map((band, i) => {
    const count = stats.bandCounts[i]!;
    return `  ${band.label.padEnd(12)} ${count.toLocaleString("en-US").padStart(14)}   ${percent(count / spins, 3).padStart(9)}  ${oneIn(count / spins)}`;
  }),
  "",
  "Line RTP by symbol          simulated     exact",
  ...Object.keys(exact.lineBySymbol)
    .sort()
    .map((symbol) => {
      const simulated = (stats.lineWinBySymbol[symbol] ?? 0) / stats.totalBet;
      return `  ${symbol.padEnd(12)} ${percent(simulated).padStart(20)} ${percent(exact.lineBySymbol[symbol]!).padStart(9)}`;
    }),
];
console.log(lines.join("\n"));

if (!agrees) {
  console.error(`\nSimulated RTP is ${Math.abs(z).toFixed(1)} standard errors from the exact value: the engine and the exact calculator disagree.`);
  process.exit(1);
}
