import { Application } from "pixi.js";
import type { Machine, PlannedRound, RoundHooks } from "../app/machine.ts";
import type { Sfx } from "../audio/sfx.ts";
import { buyFeature, featurePrice, playCascade } from "../engine/cascade/index.ts";
import type { BoughtFeature, CascadeConfig, CascadeResult } from "../engine/cascade/index.ts";
import { createRng } from "../engine/index.ts";
import type { Rng } from "../engine/index.ts";
import { CASCADE_LAYOUT, cascadeStageSize, CascadeView } from "../ui/cascadeView.ts";
import { formatCredits } from "../ui/hud.ts";
import { createSymbolTextures, FOUNDRY } from "../ui/theme.ts";

const MAX_PIXEL_RATIO = 3;

const describeGrid = (grid: readonly (readonly string[])[]): string =>
  grid.map((column, index) => `Column ${index + 1}: ${column.map(FOUNDRY.name).join(", ")}`).join(". ");

/** Machine No. 2: a six-by-five cascade machine where groups of gems pay, vanish and are replaced. */
export class CrucibleMachine implements Machine {
  readonly id: string;
  readonly number = 2;
  readonly name = "Crucible";
  readonly units: number;
  readonly unitName = "unit";
  readonly forcedStopLimits = null;
  readonly idleMessage: string;
  readonly bonusName: string | null;

  readonly #config: CascadeConfig;
  #app: Application | null = null;
  #view: CascadeView | null = null;
  #lastResult: CascadeResult | BoughtFeature | null = null;
  #planned: CascadeResult | BoughtFeature | null = null;

  constructor(config: CascadeConfig) {
    this.#config = config;
    this.id = config.id;
    this.units = config.units;
    this.bonusName = config.feature?.buyCost == null ? null : "furnace";
    this.idleMessage = `Groups of ${config.minCluster}+ gems pay. Every win heats the furnace and multiplies the next.`;
  }

  async mount(host: HTMLElement, options: { reduceMotion: boolean; sfx: Sfx }): Promise<{ width: number; height: number }> {
    const config = this.#config;
    const size = cascadeStageSize(config.columns, config.rows);
    const app = new Application();
    await app.init({
      ...size,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      autoDensity: true,
    });
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.setAttribute("role", "img");
    host.append(app.canvas);
    this.#app = app;

    const pieces = new Set(config.weights.flatMap((column) => Object.keys(column)));
    const textures = createSymbolTextures(app.renderer, FOUNDRY, pieces, CASCADE_LAYOUT.cell, CASCADE_LAYOUT.cell);
    this.#view = new CascadeView(app, config, textures, { reduceMotion: options.reduceMotion, sfx: options.sfx });

    // The first picture is a settled board with nothing to win, from a fixed seed so it is always the same.
    const idle = playCascade(config, createRng("crucible-idle"), 1, { record: true }).base.finalGrid!;
    this.#view.showGrid(idle);
    app.canvas.setAttribute("aria-label", describeGrid(idle));
    return size;
  }

  plan(unitBet: number, rng: Rng): PlannedRound {
    const result = playCascade(this.#config, rng, unitBet, { record: true });
    this.#planned = result;
    return {
      totalBet: result.totalBet,
      totalWin: result.totalWin,
      summary: {
        totalBet: result.totalBet,
        totalWin: result.totalWin,
        baseSteps: result.base.stepCount,
        baseWin: result.base.win,
        openingScatters: result.base.scatters,
        feature: result.feature && {
          spins: result.feature.length,
          win: result.feature.reduce((sum, round) => sum + round.win, 0),
          endHeat: result.feature[result.feature.length - 1]?.endHeat,
        },
        capped: result.capped,
      },
      present: async (hooks: RoundHooks, options: { turbo: boolean }) => {
        await this.#view!.present(result, hooks, options);
        this.#lastResult = result;
        const finalGrid = (result.feature?.[result.feature.length - 1] ?? result.base).finalGrid!;
        this.#app!.canvas.setAttribute("aria-label", describeGrid(finalGrid));
        if (result.totalWin === 0) hooks.setMessage("No groups this spin.");
        else if (result.feature !== null) hooks.setMessage(`Won ${formatCredits(result.totalWin)} in total, furnace included.`);
        else hooks.setMessage(`Won ${formatCredits(result.totalWin)} over ${result.base.stepCount} ${result.base.stepCount === 1 ? "step" : "steps"}.`);
      },
    };
  }

  bonusPrice(unitBet: number): number | null {
    return featurePrice(this.#config, unitBet);
  }

  planBonus(unitBet: number, rng: Rng): PlannedRound {
    const bought = buyFeature(this.#config, rng, unitBet, { record: true });
    this.#planned = bought;
    return {
      totalBet: bought.price,
      totalWin: bought.totalWin,
      summary: {
        bought: true,
        price: bought.price,
        spins: bought.feature.length,
        win: bought.totalWin,
        endHeat: bought.feature.at(-1)?.endHeat,
        capped: bought.capped,
      },
      present: async (hooks: RoundHooks, options: { turbo: boolean }) => {
        await this.#view!.presentBought(bought, hooks, options);
        this.#lastResult = bought;
        const finalGrid = bought.feature.at(-1)?.finalGrid;
        if (finalGrid) this.#app!.canvas.setAttribute("aria-label", describeGrid(finalGrid));
        hooks.setMessage(`The furnace won ${formatCredits(bought.totalWin)}.`);
      },
    };
  }

  quickStop(): void {
    this.#view?.quickStop();
  }

  clear(): void {
    this.#view?.clear();
  }

  qa(): Record<string, unknown> {
    return {
      game: this.#config,
      lastResult: this.#lastResult,
      /** The round that was decided last, even if it is still being shown. */
      planned: this.#planned,
      shownGrid: () => this.#view!.shownGrid(),
      readouts: () => this.#view!.readouts(),
      worstOverlap: () => this.#view!.worstOverlap(),
      pieceStates: () => this.#view!.pieceStates(),
      ticker: this.#app!.ticker,
    };
  }

  dispose(): void {
    this.#app?.destroy({ removeView: true }, { children: true, texture: true });
    this.#app = null;
    this.#view = null;
  }
}
