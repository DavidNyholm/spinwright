export interface DebugPanel {
  /** The stops to force on the next spin, or null to spin normally. */
  forcedStops(): number[] | null;
  /** Shows a plain description of the last round. */
  report(summary: unknown): void;
  dispose(): void;
}

export interface DebugPanelOptions {
  readonly seed: string;
  /** How many stops each reel has, if the machine can force an outcome; otherwise null. */
  readonly stopLimits: readonly number[] | null;
}

/**
 * QA tools, shown only with `?debug` in the URL: force exact reel stops to reproduce a layout (on
 * machines that have reels), and see the raw outcome of the last round. `?seed=...` makes a whole
 * run repeatable.
 */
export function createDebugPanel(options: DebugPanelOptions): DebugPanel {
  const panel = document.createElement("aside");
  panel.className = "debug";
  panel.setAttribute("aria-label", "QA tools");

  const heading = document.createElement("h2");
  heading.textContent = "QA tools";
  const seedLine = document.createElement("p");
  seedLine.textContent = `Seed: ${options.seed}`;
  panel.append(heading, seedLine);

  const inputs: HTMLInputElement[] = [];
  const force = document.createElement("input");
  force.type = "checkbox";
  force.id = "debug-force";
  if (options.stopLimits !== null) {
    const forceLabel = document.createElement("label");
    forceLabel.append(force, " Force these stops on every spin");
    const row = document.createElement("div");
    row.className = "debug-stops";
    options.stopLimits.forEach((limit, reel) => {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = String(limit - 1);
      input.value = "0";
      input.setAttribute("aria-label", `Stop for reel ${reel + 1} (0 to ${limit - 1})`);
      inputs.push(input);
      row.append(input);
    });
    panel.append(forceLabel, row);
  }

  const output = document.createElement("pre");
  output.id = "debug-last";
  output.textContent = "No round yet";
  panel.append(output);
  document.querySelector(".machine")?.append(panel);

  return {
    forcedStops() {
      if (options.stopLimits === null || !force.checked) return null;
      const stops = inputs.map((input) => Number(input.value));
      const valid = stops.every((stop, reel) => Number.isInteger(stop) && stop >= 0 && stop < options.stopLimits![reel]!);
      return valid ? stops : null;
    },
    report(summary) {
      output.textContent = JSON.stringify(summary, null, 1);
    },
    dispose() {
      panel.remove();
    },
  };
}
