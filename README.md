# Spinwright

A play-money slot game built around a pure TypeScript math engine, with a Monte Carlo simulator to prove the maths and a PixiJS browser UI. Credits are virtual only. There are no payments, accounts or real-money features anywhere in this project.

**Status:** engine, simulator and the playable UI are done. A second game, bonus features and the GitHub Pages deploy are next.

## Play it locally

Needs Node 22.18 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints. Space or Enter spins, and pressing it mid-spin stops the reels quickly. Balance and bet are saved in the browser.

The look is a brass workshop machine, drawn entirely with code: engraved metal plates, a gear, a key, a pocket watch, a molten wild seal and a blueprint scatter, in a dark iron cabinet with amber displays. There are no image files. To review the artwork on its own, open `/symbols.html` on the dev server.

## How it works

- **The outcome is decided first, then animated.** `spin()` draws one stop per reel and returns the complete result (grid, every win, the total). The UI only plays back a result that already exists, the same split real slot software uses. The win is banked in the wallet the moment the outcome is drawn, so a page refresh mid-spin cannot lose it.
- **Games are data.** A game is a `GameConfig` (reel strips, paylines, paytable, wild, scatter). `defineGame()` validates it when the module loads and throws one error listing every problem. The engine knows nothing about art or themes.
- **Whole credits only.** Bets and wins are integers, so there is no floating-point drift in anyone's balance.
- **Reproducible.** Every run takes a seed, and the same seed gives the same spins.
- **The engine has no browser code.** A second TypeScript config type-checks `src/engine` and `src/games` without the DOM library, so it stays runnable in Node and could move to a server.
- **Reel motion is a pure state machine.** `ReelMotion` takes the time as an argument and draws nothing, so landing exactly on the chosen stop is unit-tested. The Pixi view only displays what it computes.
- **Symbols are drawn with vector shapes**, so there are no art files to license. A different theme is a different set of textures.

## How random is it?

Honest answer: it is pseudo-random, not hardware-random, like every software slot, and it comes from the right source for the job.

- **Live play** draws every reel stop straight from the operating system's cryptographic random source (the browser's Web Crypto API). There is no seed to leak and no internal state to work out from past results, so the next spin cannot be predicted.
- **Simulation and QA** use a seeded generator (sfc32) on purpose, so a run can be repeated exactly. It is used for live play only if you add `?seed=` or `?debug` to the address.
- **Uniformity** is tested: chi-square tests on both generators, and an explicit test that mapping a random number onto a reel position adds no bias. The 10-million-spin simulation matching the exact return is a further end-to-end check.
- **What it can't be:** a client-side game can never be provably fair, because the player controls the code in their own browser. Real casinos run the draw on a server and have the generator certified by a testing lab. This project is play money, so it makes no such claim. The engine is deliberately free of browser code so it could move to a server.

## Simulator

```bash
npm run sim -- --spins 10_000_000
```

Classic 5x3, 20 lines, 10,000,000 spins (21 s):

```
RTP            95.96% +/- 0.15% (95% CI)   exact 95.94%   z = 0.26  ok
  lines        85.67%   exact 85.65%
  scatter      10.29%   exact 10.29%
Hit frequency  39.1%  (1 in 2.6)
Volatility     sd 2.45x total bet per spin
```

It also prints a win-size distribution and the return per symbol, and exits non-zero if the simulated return is more than four standard errors from the exact one.

## QA tools

Add `?debug` to the page address to get a QA panel: force exact reel stops to reproduce a layout, and see the raw result of the last spin. `?seed=anything` makes a whole run repeatable, so a bug report can be replayed exactly. With `?debug`, the page also exposes `window.spinwright`, which QA scripts use to read what the reels actually show and to step the animation at a fixed frame rate regardless of how fast the browser is running.

## How it is checked

- **Exact return to player, no sampling.** `exactRtp()` computes the return analytically. Tests compare it against full enumeration of every possible stop combination on a small game (agreement to 12 decimal places) and against a 1M-spin simulation of the real game. This cross-checks the sampling, the reel window, the payline wiring and the bet arithmetic. It reuses the same line-evaluation function for payout rules, so those rules are covered by their own unit tests instead.
- **Rule tests.** Wild substitution, scatter behaviour, runs that must start on the first reel and bet scaling each have explicit cases. Config validation has a case per rule.
- **RNG tests.** Uniformity (chi-square) of both generators and modulo bias are tested, plus a regression value so saved seeds do not silently change meaning.
- **Reel landing.** For every stop of strips of several lengths, the reel motion is simulated from rest and must land exactly on the stop, including after a quick stop at any moment and with long frames.
- **In the browser.** 60 real spins (normal and turbo, 12 with a quick stop) were checked: the picture read back from the reels equals the engine's grid every time, cells sit exactly on their positions, the wallet and on-screen numbers match, and there were no page errors. The production build was also played from a `/spinwright/` subpath, the way GitHub Pages serves it.
- **Tests were tried against deliberate bugs.** Nine injected bugs (modulo bias, a non-wrapping reel window, wilds not extending runs, a wrong RTP divisor, scatter paid on the wrong bet, a wrong landing offset, landing on the wrong position, a landing jolt, a quick stop that does nothing) were each caught by the suite.

## Layout

```
src/engine/   pure game logic: config + validation, RNG, spin, line/scatter evaluation, exact RTP
src/games/    game definitions (data)
src/sim/      Monte Carlo simulator CLI
src/app/      wallet, saved preferences, settings (no browser drawing code)
src/ui/       PixiJS reels, reel motion, HUD, QA panel
src/ui/art/   the Clockwork artwork: palette, metal and bevel helpers, symbols, reel bed
test/         Vitest suite
```

## Built with

Written by Claude (**Sonnet 5.5**, model id `claude-sonnet-5-5`, run at extra effort) in Claude Code. Directed and tested by David. Commits carry a `Co-Authored-By` trailer naming the model, so the history shows which model made each change.

## License

All rights reserved. The source is public to read and evaluate, not to reuse. See [LICENSE](LICENSE).

## Roadmap

1. ~~Engine, simulator, tests~~
2. ~~Playable UI with PixiJS reels and a play-money wallet~~
3. Bonus features (free spins and more), plus a way to earn credits
4. Deploy to GitHub Pages
