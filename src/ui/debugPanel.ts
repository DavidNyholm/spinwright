import type { GameConfig, SpinResult } from "../engine/index.ts";

export interface DebugPanel {
  /** The stops to force on the next spin, or null to spin normally. */
  forcedStops(): number[] | null;
  report(result: SpinResult): void;
}

/**
 * QA tools, shown only with `?debug` in the URL: force exact reel stops to reproduce a layout, and
 * see the raw result of the last spin. `?seed=...` makes a whole run repeatable.
 */
export function createDebugPanel(game: GameConfig, seed: string): DebugPanel {
  const panel = document.createElement("aside");
  panel.className = "debug";
  panel.setAttribute("aria-label", "QA tools");

  const heading = document.createElement("h2");
  heading.textContent = "QA tools";
  const seedLine = document.createElement("p");
  seedLine.textContent = `Seed: ${seed}`;

  const force = document.createElement("input");
  force.type = "checkbox";
  force.id = "debug-force";
  const forceLabel = document.createElement("label");
  forceLabel.append(force, " Force these stops on every spin");

  const inputs = game.strips.map((strip, reel) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(strip.length - 1);
    input.value = "0";
    input.setAttribute("aria-label", `Stop for reel ${reel + 1} (0 to ${strip.length - 1})`);
    return input;
  });
  const row = document.createElement("div");
  row.className = "debug-stops";
  row.append(...inputs);

  const output = document.createElement("pre");
  output.id = "debug-last";
  output.textContent = "No spin yet";

  panel.append(heading, seedLine, forceLabel, row, output);
  document.querySelector(".app")?.append(panel);

  return {
    forcedStops() {
      if (!force.checked) return null;
      const stops = inputs.map((input) => Number(input.value));
      const valid = stops.every((stop, reel) => Number.isInteger(stop) && stop >= 0 && stop < game.strips[reel]!.length);
      return valid ? stops : null;
    },
    report(result) {
      output.textContent = JSON.stringify(
        {
          stops: result.stops,
          grid: result.grid,
          lineWins: result.lineWins.map(({ line, symbol, count, win }) => ({ line, symbol, count, win })),
          scatterWin: result.scatterWin && { count: result.scatterWin.count, win: result.scatterWin.win },
          totalBet: result.totalBet,
          totalWin: result.totalWin,
        },
        null,
        1,
      );
    },
  };
}
