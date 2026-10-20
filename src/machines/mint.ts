import { Application } from "pixi.js";
import { MINT_RTP_PERCENT } from "../app/catalog.ts";
import type { Machine, PlannedRound, RoundHooks } from "../app/machine.ts";
import { holdGameRules } from "../app/rules.ts";
import type { RulesDoc } from "../app/rules.ts";
import { winCountDuration } from "../app/winCount.ts";
import { winSound } from "../audio/sfx.ts";
import type { Sfx } from "../audio/sfx.ts";
import { buyHold, holdPrice, playHoldRound, playHoldRoundFromStops } from "../engine/hold/index.ts";
import type { Coin, HoldGameConfig, HoldResult, HoldRoundResult, BoughtHold } from "../engine/hold/index.ts";
import { buildGrid } from "../engine/index.ts";
import type { Position, Rng, SpinResult } from "../engine/index.ts";
import { HoldLayer } from "../ui/holdLayer.ts";
import { planHold, prizeLadder } from "../ui/holdPlan.ts";
import { formatCredits } from "../ui/hud.ts";
import { LAYOUT, stageSize } from "../ui/layout.ts";
import { planSpin } from "../ui/spinPlan.ts";
import { SlotView } from "../ui/slotView.ts";
import type { WinStep } from "../ui/slotView.ts";
import { createSymbolTextures, MINT } from "../ui/theme.ts";

const MAX_PIXEL_RATIO = 3;
/** Spacing between the reels' resting positions on first load, so the idle screen is not a flat row. */
const INITIAL_STOP_SPACING = 7;
/** The band under the reels, which shows the respins, the prizes and the total. */
const BAND_HEIGHT = 112;

/** How long each beat of the hold and win is held, in milliseconds at normal speed. Turbo and stop shorten all of them. */
const BEAT_MS = {
  /** The coins that started the feature, outlined before the banner. */
  trigger: 1000,
  startBanner: 1300,
  /** Between one coin turning over and the next. */
  revealStagger: 150,
  afterReveal: 500,
  /** How long the empty cells spin before a respin shows what filled. */
  respinSpin: 700,
  /** Between one coin landing and the next, when a respin fills several cells. */
  landStagger: 170,
  afterRespin: 420,
  endBanner: 1900,
  fullBoardBanner: 2800,
} as const;

const describeGrid = (grid: readonly (readonly string[])[]): string =>
  grid.map((column, reel) => `Reel ${reel + 1}: ${column.map(MINT.name).join(", ")}`).join(". ");

function describeStep(step: WinStep, result: SpinResult): string {
  switch (step.kind) {
    case "all":
      return `You won ${formatCredits(result.totalWin)} credits`;
    case "line":
      return `Line ${step.win.line + 1}: ${step.win.count} × ${MINT.name(step.win.symbol)} on reels 1-${step.win.count} pays ${formatCredits(step.win.win)}`;
    case "scatter":
      return `${step.win.count} × ${MINT.name(step.win.symbol)} pays ${formatCredits(step.win.win)}`;
  }
}

const winCells = (result: SpinResult): Position[] => result.lineWins.flatMap((win) => win.positions);

function cellsShowing(grid: readonly (readonly string[])[], symbol: string): Position[] {
  const cells: Position[] = [];
  grid.forEach((column, reel) => column.forEach((cell, row) => cell === symbol && cells.push([reel, row])));
  return cells;
}

/** What the feature sequence needs: the feature, what the round won in all, and the opening spin that started it (none if it was bought). */
interface FeaturePlay {
  readonly base: SpinResult | null;
  readonly feature: HoldResult;
  readonly totalBet: number;
  readonly totalWin: number;
}

/**
 * Machine No. 3: a five-reel, twenty-line machine whose bonus is hold and win, in the Mint theme.
 * Six coins lock in place and start the respins; every new coin sets the respins back to three.
 */
export class MintMachine implements Machine {
  readonly id: string;
  readonly number = 3;
  readonly name = "Mint";
  readonly units: number;
  readonly unitName = "line";
  readonly forcedStopLimits: readonly number[];
  readonly idleMessage: string;
  readonly bonusName: string | null;

  readonly #game: HoldGameConfig;
  #app: Application | null = null;
  #view: SlotView | null = null;
  #layer: HoldLayer | null = null;
  #reduceMotion = false;
  #sfx: Sfx | null = null;
  #lastResult: HoldRoundResult | BoughtHold | null = null;

  constructor(game: HoldGameConfig) {
    this.#game = game;
    this.id = game.base.id;
    this.units = game.base.paylines.length;
    this.forcedStopLimits = game.base.strips.map((strip) => strip.length);
    this.bonusName = game.hold.buyCost === null ? null : "hold and win";
    this.idleMessage = `Press spin, or hit Space. ${game.hold.minCoins} coins start the hold and win, where every new coin resets the respins.`;
  }

  async mount(host: HTMLElement, options: { reduceMotion: boolean; sfx: Sfx }): Promise<{ width: number; height: number }> {
    this.#reduceMotion = options.reduceMotion;
    this.#sfx = options.sfx;
    const { base, hold } = this.#game;
    const reelsSize = stageSize(base.reels, base.rows);
    const size = { width: reelsSize.width, height: reelsSize.height + BAND_HEIGHT };
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

    const textures = createSymbolTextures(app.renderer, MINT, new Set(base.strips.flat()), LAYOUT.cellWidth, LAYOUT.cellHeight);
    const view = new SlotView(app, base, textures, { reduceMotion: options.reduceMotion, sfx: options.sfx });
    this.#view = view;
    const layer = new HoldLayer(view.animator, {
      ...size,
      reelsHeight: reelsSize.height,
      reels: base.reels,
      rows: base.rows,
      respins: hold.respins,
      minCoins: hold.minCoins,
      ladder: prizeLadder(this.#game),
      reduceMotion: options.reduceMotion,
    });
    this.#layer = layer;
    app.stage.addChild(layer.view, layer.banners);
    app.ticker.add((ticker) => layer.update(ticker.lastTime));

    const initialStops = base.strips.map((strip, reel) => (reel * INITIAL_STOP_SPACING) % strip.length);
    view.showStops(initialStops);
    app.canvas.setAttribute("aria-label", describeGrid(buildGrid(base, initialStops)));
    return size;
  }

  plan(unitBet: number, rng: Rng, forcedStops: readonly number[] | null): PlannedRound {
    const game = this.#game;
    const round = forcedStops !== null ? playHoldRoundFromStops(game, rng, forcedStops, unitBet) : playHoldRound(game, rng, unitBet);
    const { base, feature } = round;
    return {
      totalBet: round.totalBet,
      totalWin: round.totalWin,
      summary: {
        stops: base.stops,
        grid: base.grid,
        lineWins: base.lineWins.map(({ line, symbol, count, win }) => ({ line, symbol, count, win })),
        feature: feature && summarize(feature),
        totalBet: round.totalBet,
        totalWin: round.totalWin,
      },
      present: (hooks, options) => this.#present(round, hooks, options.turbo),
    };
  }

  rules(): RulesDoc {
    return holdGameRules(this.#game, {
      title: this.name,
      name: MINT.name,
      returnPercent: MINT_RTP_PERCENT,
      returnBasis: "worked out exactly, and checked by simulation",
    });
  }

  bonusPrice(unitBet: number): number | null {
    return holdPrice(this.#game, unitBet);
  }

  planBonus(unitBet: number, rng: Rng): PlannedRound {
    const bought = buyHold(this.#game, rng, unitBet);
    return {
      totalBet: bought.price,
      totalWin: bought.totalWin,
      summary: { bought: true, price: bought.price, feature: summarize(bought.feature), totalWin: bought.totalWin },
      present: async (hooks, options) => {
        this.#lastResult = bought;
        await this.#presentFeature({ base: null, feature: bought.feature, totalBet: bought.totalBet, totalWin: bought.totalWin }, hooks);
      },
    };
  }

  quickStop(): void {
    this.#view?.quickStop();
  }

  clear(): void {
    this.#view?.clearRound();
    this.#layer?.reset();
  }

  qa(): Record<string, unknown> {
    return {
      game: this.#game,
      lastResult: this.#lastResult,
      shownGrid: () => this.#view!.shownGrid(),
      /** The coins the screen shows, in their cells, and what each says. */
      coinCells: () => this.#layer!.coinCells(),
      /** The prizes lit on the ladder. */
      litPrizes: () => this.#layer!.litPrizes(),
      /** The respin pips lit, and the count and total the band shows. */
      readouts: () => this.#layer!.readouts(),
      ticker: this.#app!.ticker,
    };
  }

  dispose(): void {
    this.#app?.destroy({ removeView: true }, { children: true, texture: true });
    this.#app = null;
    this.#view = null;
    this.#layer = null;
  }

  // --- showing a round --------------------------------------------------------------------------

  async #present(round: HoldRoundResult, hooks: RoundHooks, turbo: boolean): Promise<void> {
    const game = this.#game;
    const view = this.#view!;
    const { base } = round;

    await view.spin(base.stops, turbo, planSpin(base.grid, game.hold.coin, game.hold.minCoins));
    this.#lastResult = round;
    this.#app!.canvas.setAttribute("aria-label", describeGrid(base.grid));

    if (round.feature !== null) {
      await this.#presentFeature({ base, feature: round.feature, totalBet: round.totalBet, totalWin: round.totalWin }, hooks);
      return;
    }
    if (round.totalWin === 0) {
      const coins = cellsShowing(base.grid, game.hold.coin).length;
      hooks.setMessage(coins >= 3 ? `${coins} coins: it takes ${game.hold.minCoins} to start the hold and win.` : "No win this spin.");
      return;
    }
    const jingle = winSound(round.totalWin, round.totalBet);
    if (jingle !== null) this.#sfx?.play(jingle);
    hooks.setWin(round.totalWin, this.#reduceMotion ? 0 : winCountDuration(round.totalWin, round.totalBet));
    view.presentWins(base, (step) => hooks.setMessage(describeStep(step, base)));
  }

  /** The opening spin's win and its coins (if there was an opening spin), then the banner, the coins turning over, and each respin in turn. */
  async #presentFeature(play: FeaturePlay, hooks: RoundHooks): Promise<void> {
    const game = this.#game;
    const view = this.#view!;
    const layer = this.#layer!;
    const sfx = this.#sfx!;
    const { base, feature, totalBet } = play;
    const cells = game.base.reels * game.base.rows;
    const plan = planHold(game, feature);
    const baseWin = base?.totalWin ?? 0;
    const countUp = (win: number): number => (this.#reduceMotion ? 0 : winCountDuration(win, totalBet));
    const plural = (count: number): string => `${count} coin${count === 1 ? "" : "s"}`;
    const jackpot = (coin: Coin): void => {
      if (coin.jackpot === null) return;
      layer.lightPrize(coin.jackpot);
      sfx.play("jackpot");
    };

    if (base !== null && baseWin > 0) {
      const jingle = winSound(baseWin, totalBet);
      if (jingle !== null) sfx.play(jingle);
      hooks.setWin(baseWin, countUp(baseWin));
    }
    sfx.play("featureStart");
    hooks.setMessage(`Hold and win! ${plural(feature.start.length)} lock in place.`);
    if (base !== null) await view.flashCells([...winCells(base), ...cellsShowing(base.grid, game.hold.coin)], BEAT_MS.trigger);

    await layer.begin();
    await layer.banner("HOLD & WIN", `${plural(feature.start.length)} · ${game.hold.respins} respins`, BEAT_MS.startBanner);

    let revealed = 0;
    let revealedWorth = 0;
    await layer.reveal(feature.start, {
      stagger: BEAT_MS.revealStagger,
      onEach: (coin, index) => {
        sfx.play("coinReveal", { rate: 1 + 0.05 * index });
        jackpot(coin);
        revealed++;
        revealedWorth += coin.win;
        layer.setCount(revealed, cells);
        void layer.setTotal(revealedWorth);
      },
    });
    hooks.setWin(baseWin + plan.reveal.total, countUp(plan.reveal.total));
    hooks.setMessage(`${plural(plan.reveal.coinCount)} in, worth ${formatCredits(plan.reveal.total)}.`);
    await view.wait(BEAT_MS.afterReveal);

    for (const beat of plan.respins) {
      const label = `Respin ${beat.number}`;
      hooks.setMessage(`${label}…`);
      const spinning = sfx.loop("reelLoop", { gain: 0.45 });
      await layer.spinEmpty(beat.empty, BEAT_MS.respinSpin);
      spinning.stop(0.1);

      await Promise.all(
        beat.landed.map(async (coin, index) => {
          if (index > 0) await view.wait(BEAT_MS.landStagger * index);
          sfx.play("coinLand", { rate: 1 + 0.06 * index });
          jackpot(coin);
          await layer.land(coin);
        }),
      );
      layer.setRespins(beat.respinsLeft);
      layer.setCount(beat.coinCount, cells);
      void layer.setTotal(beat.total);
      if (beat.refilled) {
        const gained = beat.landed.reduce((sum, coin) => sum + coin.win, 0);
        hooks.setWin(baseWin + beat.total, countUp(gained));
      }
      hooks.setMessage(
        beat.refilled
          ? `${label}: ${plural(beat.landed.length)} landed, and the respins are back to ${game.hold.respins}.`
          : beat.respinsLeft > 0
            ? `${label}: nothing landed. ${beat.respinsLeft} left.`
            : `${label}: nothing landed, and that was the last.`,
      );
      await view.wait(BEAT_MS.afterRespin);
    }

    if (feature.full) {
      layer.lightPrize(game.hold.fullBoard.name);
      sfx.play("jackpot");
      hooks.setWin(baseWin + feature.win, countUp(feature.fullBoardWin));
      void layer.setTotal(feature.win);
      await layer.banner(game.hold.fullBoard.name.toUpperCase(), `Board full · +${formatCredits(feature.fullBoardWin)}`, BEAT_MS.fullBoardBanner);
    }
    const jingle = winSound(feature.win, totalBet);
    if (jingle !== null) sfx.play(jingle);
    await layer.banner(formatCredits(feature.win), "HOLD & WIN", BEAT_MS.endBanner);
    await layer.settle();
    hooks.setWin(play.totalWin, 0);
    this.#app!.canvas.setAttribute("aria-label", `Hold and win: ${plural(feature.coins.length)} on the board, worth ${formatCredits(feature.win)}.`);
    hooks.setMessage(
      feature.full
        ? `Full board! The ${game.hold.fullBoard.name} and the coins paid ${formatCredits(feature.win)}.`
        : baseWin === 0
          ? `Hold and win paid ${formatCredits(feature.win)}.`
          : `Hold and win paid ${formatCredits(feature.win)}; ${formatCredits(play.totalWin)} in all.`,
    );
  }
}

/** A feature for the QA panel: what started it, what happened and what it paid. */
function summarize(feature: HoldResult): Record<string, unknown> {
  return {
    startCoins: feature.start.length,
    respins: feature.respins.map(({ landed, respinsLeft, coinCount }) => ({ landed: landed.length, respinsLeft, coinCount })),
    coins: feature.coins.length,
    full: feature.full,
    coinWin: feature.coinWin,
    fullBoardWin: feature.fullBoardWin,
    win: feature.win,
  };
}
