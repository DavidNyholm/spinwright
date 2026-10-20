# Spinwright

A play-money slot game built around a pure TypeScript math engine, with a Monte Carlo simulator to prove the maths. Credits are virtual only. There are no payments, accounts or real-money features anywhere in this project.

**Status:** engine, simulator and tests are done (milestone 1). The playable browser UI (PixiJS), bonus features and the GitHub Pages deploy are next.

## How it works

- **The outcome is decided first, then animated.** `spin()` draws one stop per reel and returns the complete result (grid, every win, the total). A UI only plays back a result that already exists, the same split real slot software uses.
- **Games are data.** A game is a `GameConfig` (reel strips, paylines, paytable, wild, scatter). `defineGame()` validates it when the module loads and throws one error listing every problem. The engine knows nothing about art or themes.
- **Whole credits only.** Bets and wins are integers, so there is no floating-point drift in anyone's balance.
- **Reproducible.** Every run takes a seed. The same seed gives the same spins, so any odd result can be replayed exactly, and `spinFromStops()` lets a tester force an exact outcome.

## Quick start

Needs Node 22.18 or newer (it runs TypeScript directly, so there is no build step for the simulator).

```bash
npm install
npm test
npm run sim -- --spins 10_000_000
```

## Simulator output

Classic 5x3, 20 lines, 10,000,000 spins (21 s):

```
RTP            95.96% +/- 0.15% (95% CI)   exact 95.94%   z = 0.26  ok
  lines        85.67%   exact 85.65%
  scatter      10.29%   exact 10.29%
Hit frequency  39.1%  (1 in 2.6)
Volatility     sd 2.45x total bet per spin
```

The simulator also prints a win-size distribution and the return per symbol. It exits non-zero if the simulated return is more than four standard errors from the exact one.

## How it is checked

- **Exact return to player, no sampling.** `exactRtp()` computes the return analytically. Tests compare it against full enumeration of every possible stop combination on a small game (agreement to 12 decimal places) and against a 1M-spin simulation of the real game. This cross-checks the sampling, the reel window, the payline wiring and the bet arithmetic. It reuses the same line-evaluation function for payout rules, so those rules are covered by their own unit tests instead.
- **Rule tests.** Wild substitution, scatter behaviour, runs that must start on the first reel and bet scaling each have explicit cases. Config validation has a case per rule.
- **RNG tests.** Uniformity (chi-square) and modulo bias are tested, plus a regression value so saved seeds do not silently change meaning.
- **Tests were tried against deliberate bugs.** Five injected bugs (modulo bias, a non-wrapping reel window, wilds not extending runs, a wrong RTP divisor, scatter paid on the wrong bet) were each caught by the suite.

The random generator (sfc32) is chosen for reproducibility and speed. It is not certified for real-money use, and this project does not do real money.

## Layout

```
src/engine/   pure game logic: config + validation, RNG, spin, line/scatter evaluation, exact RTP
src/games/    game definitions (data)
src/sim/      Monte Carlo simulator CLI
test/         Vitest suite
```

## Built with

Written by Claude (**Sonnet 5.5**, model id `claude-sonnet-5-5`, run at extra effort) in Claude Code. Directed and tested by David. Commits carry a `Co-Authored-By` trailer naming the model, so the history shows which model made each change.

## License

All rights reserved. The source is public to read and evaluate, not to reuse. See [LICENSE](LICENSE).

## Roadmap

1. ~~Engine, simulator, tests~~
2. Playable UI with PixiJS reels and a play-money wallet
3. Bonus features (free spins and more), plus a way to earn credits
4. Deploy to GitHub Pages
