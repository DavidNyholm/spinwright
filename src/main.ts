import "@fontsource/big-shoulders-display/latin-600";
import "@fontsource/big-shoulders-display/latin-700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/ibm-plex-mono/latin-500";
import "@fontsource/ibm-plex-mono/latin-600";
import "./style.css";
import { BUILT_WITH } from "./app/about.ts";
import { CATALOG } from "./app/catalog.ts";
import { loadPrefs } from "./app/prefs.ts";
import { LOBBY, parseRoute, routeToHash, sameRoute } from "./app/router.ts";
import type { Route } from "./app/router.ts";
import { SETTINGS } from "./app/settings.ts";
import { browserStore } from "./app/storage.ts";
import { Wallet } from "./app/wallet.ts";
import { SoundPlayer } from "./audio/player.ts";
import { createCryptoRng, createRng, randomSeed } from "./engine/index.ts";
import { MACHINES } from "./machines/index.ts";
import { ForgePage } from "./pages/forgePage.ts";
import { buildLobby } from "./pages/lobbyPage.ts";
import { MachinePage } from "./pages/machinePage.ts";
import { Topbar } from "./pages/topbar.ts";
import { byId } from "./ui/dom.ts";

/**
 * The site around the games: the wallet and sound they share, the top bar, and the page for each
 * route (lobby, a slot machine, the Forge). A page is only built when it is visited and torn down
 * when the visitor leaves, so only one game is ever running.
 */
async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get("seed") ?? randomSeed();
  // Live play draws from the OS cryptographic source. A seeded, repeatable generator is only used
  // when QA asks for one (?seed=, or ?debug, which shows the seed so a run can be replayed).
  const debugMode = params.has("debug");
  const rng = params.has("seed") || debugMode ? createRng(seed) : createCryptoRng();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = browserStore();
  const wallet = new Wallet(store, SETTINGS.walletKey, SETTINGS.startingBalance);
  const prefs = loadPrefs(store, SETTINGS.prefsKey, SETTINGS.betLevels, {
    unitBet: SETTINGS.defaultUnitBet,
    turbo: false,
    sound: true,
    volume: SETTINGS.defaultVolume,
  });

  // Browsers only allow sound after the visitor has interacted with the page, so the player is
  // unlocked by the first click or key press; before that it is simply silent.
  const sfx = new SoundPlayer({ volume: prefs.volume, muted: !prefs.sound });
  for (const gesture of ["pointerdown", "keydown"] as const) document.addEventListener(gesture, () => sfx.unlock(), { capture: true });

  byId("built-with").textContent = `${BUILT_WITH.name} (${BUILT_WITH.modelId})`;

  const topbar = new Topbar({ wallet, sfx, prefs, store });
  buildLobby();
  const machinePage = new MachinePage({ wallet, store, prefs, sfx, rng, seed, debugMode, reduceMotion });
  const forgePage = new ForgePage({ wallet, store, sfx, rng, reduceMotion });

  // --- routes ---------------------------------------------------------------------------------

  const machineIds = MACHINES.map((entry) => entry.id);
  const views = { lobby: byId("view-lobby"), machine: byId("view-machine"), forge: byId("view-forge") } as const;
  const headings = { lobby: byId("lobby-title"), machine: byId("machine-title"), forge: byId("forge-title") } as const;

  let current: Route | null = null;
  /** The page being shown, so QA can wait for a navigation to finish. */
  let arriving: Promise<void> = Promise.resolve();

  function titleFor(route: Route): string {
    const entry = route.page === "lobby" ? null : CATALOG.find((candidate) => sameRoute(candidate.route, route));
    return entry === null || entry === undefined ? "Spinwright" : `${entry.name} · Spinwright`;
  }

  async function show(route: Route): Promise<void> {
    if (current !== null && sameRoute(current, route)) return;
    const previous = current;
    current = route;
    if (previous?.page === "machine") machinePage.leave();
    if (previous?.page === "forge") forgePage.leave();

    for (const [page, view] of Object.entries(views)) view.hidden = page !== route.page;
    document.body.dataset["view"] = route.page;
    document.title = titleFor(route);
    topbar.setRoute(route);
    window.scrollTo(0, 0);
    // Move focus to the new page's heading, so keyboard and screen-reader users start at its top.
    headings[route.page].focus({ preventScroll: true });

    if (route.page === "machine") await machinePage.enter(route.machine);
    else if (route.page === "forge") await forgePage.enter();
  }

  function followHash(): void {
    arriving = show(parseRoute(location.hash, machineIds)).catch(fail);
  }
  window.addEventListener("hashchange", followHash);

  // --- QA -----------------------------------------------------------------------------------

  if (debugMode) {
    const machine = (): Record<string, unknown> => machinePage.qa();
    /** Goes to a hash such as "#/play/crucible" and resolves once that page has finished loading. */
    const go = async (hash: string): Promise<void> => {
      location.hash = hash;
      // The hashchange event arrives on a later task; let it, then wait for the page it started.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await arriving;
    };
    Object.assign(window, {
      spinwright: {
        seed,
        wallet,
        get route() {
          return current === null ? routeToHash(LOBBY) : routeToHash(current);
        },
        go,
        switchTo: (id: string) => go(`#/play/${id}`),
        get game() {
          return machine()["game"];
        },
        get lastResult() {
          return machine()["lastResult"];
        },
        get planned() {
          return machine()["planned"];
        },
        get ticker() {
          return machine()["ticker"];
        },
        shownGrid: () => (machine()["shownGrid"] as () => unknown)(),
        readouts: () => (machine()["readouts"] as () => unknown)(),
        worstOverlap: () => (machine()["worstOverlap"] as () => number)(),
        pieceStates: () => (machine()["pieceStates"] as () => unknown)(),
        finishCounters: () => (machine()["finishCounters"] as () => void)(),
        /** The Forge's engine, state and a hand-cranked clock. Only meaningful while the Forge is open. */
        get forge() {
          return forgePage.qa();
        },
        sound: {
          /** How many times each sound was asked for, heard or not. */
          requests: sfx.requests,
          state: () => sfx.state,
        },
        /** Plays the current machine's round out by hand; see MachinePage.qa. Sounds are held back meanwhile. */
        async settle(maxMs = 10_000): Promise<number> {
          sfx.setSuspended(true);
          try {
            return await (machine()["settle"] as (maxMs: number) => Promise<number>)(maxMs);
          } finally {
            sfx.setSuspended(false);
          }
        },
      },
    });
  }

  followHash();
  await arriving;
}

/** Last resort: say so on the page, in words, instead of leaving it blank. */
function fail(error: unknown): void {
  console.error(error);
  const notice = document.getElementById("fatal");
  if (notice === null) return;
  notice.textContent = "Something went wrong while loading the game. Reloading the page may help.";
  notice.hidden = false;
}

main().catch(fail);
