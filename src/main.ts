import "@fontsource/big-shoulders-display/latin-600";
import "@fontsource/big-shoulders-display/latin-700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/ibm-plex-mono/latin-500";
import "@fontsource/ibm-plex-mono/latin-600";
import "./style.css";
import { Application } from "pixi.js";
import { BUILT_WITH } from "./app/about.ts";
import { loadPrefs, savePrefs } from "./app/prefs.ts";
import { SETTINGS } from "./app/settings.ts";
import { browserStore } from "./app/storage.ts";
import { Wallet } from "./app/wallet.ts";
import { buildGrid, createCryptoRng, createRng, randomSeed, spin, spinFromStops } from "./engine/index.ts";
import type { GameConfig, SpinResult } from "./engine/index.ts";
import { games } from "./games/index.ts";
import { createDebugPanel } from "./ui/debugPanel.ts";
import { formatCredits, Hud } from "./ui/hud.ts";
import { LAYOUT, stageSize } from "./ui/layout.ts";
import { SlotView } from "./ui/slotView.ts";
import type { WinStep } from "./ui/slotView.ts";
import { CLOCKWORK, createSymbolTextures } from "./ui/theme.ts";

const GAME_ID = "classic";
/** The win counter runs longer for bigger wins, within these limits. */
const WIN_COUNT = { minMs: 400, maxMs: 2_500, msPerBetMultiple: 120 };
const MAX_PIXEL_RATIO = 3;
/** Spacing between the reels' resting positions on first load, so the idle screen is not a flat row. */
const INITIAL_STOP_SPACING = 7;

function winCountDuration(win: number, totalBet: number): number {
  const ms = WIN_COUNT.minMs + (win / totalBet) * WIN_COUNT.msPerBetMultiple;
  return Math.min(WIN_COUNT.maxMs, ms);
}

async function main(): Promise<void> {
  const entry = games[GAME_ID];
  if (entry?.kind !== "lines") throw new Error(`"${GAME_ID}" is not a line game`);
  // Re-bound with its own type so the check above still holds inside the closures below.
  const game: GameConfig = entry.config;

  const params = new URLSearchParams(location.search);
  const seed = params.get("seed") ?? randomSeed();
  // Live play draws from the OS cryptographic source. A seeded, repeatable generator is only used
  // when QA asks for one (?seed=, or ?debug, which shows the seed so a run can be replayed).
  const repeatable = params.has("seed") || params.has("debug");
  const rng = repeatable ? createRng(seed) : createCryptoRng();
  const debug = params.has("debug") ? createDebugPanel(game, seed) : null;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = browserStore();
  const wallet = new Wallet(store, SETTINGS.walletKey, SETTINGS.startingBalance);
  const prefs = loadPrefs(store, SETTINGS.prefsKey, SETTINGS.lineBetLevels, {
    lineBet: SETTINGS.defaultLineBet,
    turbo: false,
  });
  const levels = SETTINGS.lineBetLevels;
  const lines = game.paylines.length;
  const cheapestBet = levels[0]! * lines;

  document.getElementById("built-with")!.textContent = `${BUILT_WITH.name} (${BUILT_WITH.modelId})`;

  const hud = new Hud({
    onSpin: () => handleSpin(),
    onBetStep: (direction) => stepBet(direction),
    onTurbo: (on) => {
      prefs.turbo = on;
      savePrefs(store, SETTINGS.prefsKey, prefs);
    },
    onRefill: () => {
      wallet.reset();
      hud.setBalance(wallet.balance);
      refreshBroke();
      hud.setMessage("Credits topped up. Good luck!");
    },
  });
  hud.setMessage("Loading…");

  const app = new Application();
  let view: SlotView;
  try {
    const { width, height } = stageSize(game.reels, game.rows);
    await app.init({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
      autoDensity: true,
    });
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.setAttribute("role", "img");
    document.getElementById("stage")!.append(app.canvas);

    // The symbol art uses the display font; draw it only once the font is ready.
    await document.fonts.load('800 48px "Big Shoulders Display"');
    const textures = createSymbolTextures(app.renderer, CLOCKWORK, new Set(game.strips.flat()), LAYOUT.cellWidth, LAYOUT.cellHeight);
    view = new SlotView(app, game, textures, { reduceMotion });
  } catch (error) {
    console.error(error);
    hud.setMessage("Couldn't start the graphics engine. Try another browser, or enable hardware acceleration.");
    return;
  }

  // With ?debug, expose state for QA scripts: the last result, and what the reels actually show.
  const qa = {
    seed,
    game,
    wallet,
    lastResult: null as SpinResult | null,
    shownGrid: () => view.shownGrid(),
    finishCounters: () => hud.finishCounters(),
    ticker: app.ticker,
    /**
     * Steps the real animation by hand, at 60 fps of simulated time, until the round is over. It
     * does not depend on the browser's frame rate, so QA scripts stay fast and repeatable even in a
     * throttled background tab. Returns the simulated milliseconds it took.
     */
    async settle(maxMs = 10_000): Promise<number> {
      const frameMs = 1000 / 60;
      let simulated = 0;
      app.ticker.stop();
      try {
        let time = app.ticker.lastTime;
        while (document.body.dataset.state !== "idle" && simulated < maxMs) {
          time += frameMs;
          simulated += frameMs;
          app.ticker.update(time);
          await Promise.resolve();
        }
      } finally {
        app.ticker.start();
      }
      return simulated;
    },
  };
  if (debug !== null) Object.assign(window, { spinwright: qa });

  let busy = false;

  function describeGrid(grid: readonly (readonly string[])[]): string {
    return grid.map((column, reel) => `Reel ${reel + 1}: ${column.map(CLOCKWORK.name).join(", ")}`).join(". ");
  }

  function describeStep(step: WinStep, result: SpinResult): string {
    switch (step.kind) {
      case "all":
        return `You won ${formatCredits(result.totalWin)} credits`;
      case "line":
        return `Line ${step.win.line + 1}: ${step.win.count} × ${CLOCKWORK.name(step.win.symbol)} on reels 1-${step.win.count} pays ${formatCredits(step.win.win)}`;
      case "scatter":
        return `${step.win.count} × ${CLOCKWORK.name(step.win.symbol)} pays ${formatCredits(step.win.win)}`;
    }
  }

  function refreshBet(): void {
    const index = levels.indexOf(prefs.lineBet);
    hud.setBet(
      prefs.lineBet * lines,
      `${formatCredits(prefs.lineBet)} per line × ${lines} lines`,
      index > 0,
      index < levels.length - 1,
    );
  }

  function refreshBroke(): void {
    hud.setBroke(!wallet.canAfford(cheapestBet));
  }

  function stepBet(direction: -1 | 1): void {
    if (busy) return;
    const index = Math.min(levels.length - 1, Math.max(0, levels.indexOf(prefs.lineBet) + direction));
    prefs.lineBet = levels[index]!;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    refreshBet();
  }

  function handleSpin(): void {
    if (busy) {
      view.quickStop();
      return;
    }
    void playRound();
  }

  /** Called when the chosen bet is more than the balance: lower it to the best affordable one. */
  function lowerBetToFit(): void {
    const best = levels.filter((level) => wallet.canAfford(level * lines)).at(-1);
    if (best === undefined) {
      hud.setMessage("Out of credits.");
      return;
    }
    prefs.lineBet = best;
    savePrefs(store, SETTINGS.prefsKey, prefs);
    refreshBet();
    hud.setMessage(`Not enough credits for that bet. Lowered to ${formatCredits(best * lines)}; press spin to play.`);
  }

  function reveal(result: SpinResult, totalBet: number): void {
    qa.lastResult = result;
    app.canvas.setAttribute("aria-label", describeGrid(result.grid));
    debug?.report(result);

    if (result.totalWin === 0) {
      hud.setMessage("No win this spin.");
      return;
    }
    const countMs = reduceMotion ? 0 : winCountDuration(result.totalWin, totalBet);
    hud.setWin(result.totalWin, countMs);
    hud.setBalance(wallet.balance, countMs);
    view.presentWins(result, (step) => hud.setMessage(describeStep(step, result)));
  }

  async function playRound(): Promise<void> {
    busy = true;
    document.body.dataset.state = "spinning";
    try {
      hud.finishCounters();
      view.clearHighlights();
      const totalBet = prefs.lineBet * lines;
      if (!wallet.canAfford(totalBet)) {
        lowerBetToFit();
        return;
      }

      const forced = debug?.forcedStops() ?? null;
      const result = forced !== null ? spinFromStops(game, forced, prefs.lineBet) : spin(game, rng, prefs.lineBet);
      // The outcome is final here: bank it now, and only reveal it once the reels stop.
      wallet.settle(totalBet, result.totalWin);
      hud.setBalance(wallet.balance - result.totalWin);
      hud.setWin(0);
      hud.setMessage("Spinning…");
      hud.setSpinning(true);
      await view.spin(result.stops, prefs.turbo);
      reveal(result, totalBet);
    } catch (error) {
      console.error(error);
      hud.setBalance(wallet.balance);
      hud.setMessage("Something went wrong. Your balance is safe; try again.");
    } finally {
      busy = false;
      hud.setSpinning(false);
      refreshBroke();
      document.body.dataset.state = "idle";
    }
  }

  const initialStops = game.strips.map((strip, reel) => (reel * INITIAL_STOP_SPACING) % strip.length);
  view.showStops(initialStops);
  app.canvas.setAttribute("aria-label", describeGrid(buildGrid(game, initialStops)));
  hud.setBalance(wallet.balance);
  hud.setWin(0);
  hud.setTurbo(prefs.turbo);
  refreshBet();
  refreshBroke();
  hud.setMessage("Press spin, or hit Space, to play.");
  hud.setReady();
  document.body.dataset.state = "idle";
}

main().catch((error: unknown) => {
  console.error(error);
  document.getElementById("message")!.textContent = "Something went wrong while loading the game.";
});
