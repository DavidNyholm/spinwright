# Spinwright

Two play-money slot machines built around pure TypeScript math engines, with Monte Carlo simulators that prove the maths, and a PixiJS browser front end. Credits are virtual only. There are no payments, accounts or real-money features anywhere in this project.

**Status:** both machines, the simulators and the UI are done. The GitHub Pages deploy and further features are next.

## Play it locally

Needs Node 22.18 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints. Space or Enter spins, and pressing it mid-spin plays the rest of the round quickly. Balance, bet, turbo and the machine you last played are saved in the browser. Switch machines with the plates in the nameplate.

The look is a brass workshop, drawn entirely with code: engraved metal plates, gears, gems, a dark iron cabinet with amber displays. There are no image files. To review the artwork on its own, open `/symbols.html` on the dev server.

## The machines

**No. 1 Clockwork** is a five-reel, three-row, twenty-line machine with a wild and a scatter. Its return is **95.94%**, computed exactly rather than estimated, with a win on about 39% of spins.

**No. 2 Crucible** is a six-by-five cascade machine. Groups of five or more connected gems pay and vanish, the gems above fall, and new ones drop in. Every winning step in a spin heats the furnace, and **heat multiplies the next win**: x1, x2, x3 and on up until the cascade runs dry. Four embers on the opening grid light the furnace feature: ten free spins in which heat is never reset and climbs four times as fast, with a retrigger and a hard cap of 5,000 times the bet.

Measured over 4 million plays (see the simulator below):

| | Crucible |
|---|---|
| Return to player | 95.54% +/- 0.16% (95% CI) |
| Of which base spins / feature | about 28% / about 68% |
| Feature triggers | 1 in 111 spins, exactly |
| Average feature | 75x the bet over 13 spins (sd 78x) |
| Hit frequency | 62% |
| Volatility | sd about 10x the bet per play |

## How it works

- **The outcome is decided first, then animated.** A round is resolved completely (every grid, every win, the total) before anything moves. The UI only plays back a result that already exists, the same split real slot software uses. The win is banked in the wallet the moment the outcome is drawn, so a page refresh mid-spin cannot lose it.
- **Two engines, one page.** The line engine and the cascade engine are separate, pure, DOM-free modules. A small `Machine` interface (plan a round, show it, quick-stop it) is all the page knows, so the wallet, bet, spin button and readouts are shared and a new machine is a new `Machine`.
- **Games are data.** A game is a validated config (reel strips and paylines, or gem weights and cluster pays). `defineGame` and `defineCascadeGame` throw one error listing every problem when the module loads.
- **Whole credits only.** Bets and wins are integers, so there is no floating-point drift in anyone's balance.
- **Reproducible.** Every simulation and QA run takes a seed, and the same seed gives the same spins.
- **The engines have no browser code.** A second TypeScript config type-checks `src/engine` and `src/games` without the DOM library, so they stay runnable in Node and could move to a server.
- **Animation is plain numbers first.** Reel motion and the cascade's falling pieces are pure plans driven by an explicit clock; the Pixi view only displays them. That is what makes them testable.
- **Symbols are drawn with vector shapes**, so there are no art files to license. A different theme is a different set of textures.

## How random is it?

Honest answer: it is pseudo-random, not hardware-random, like every software slot, and it comes from the right source for the job.

- **Live play** draws every reel stop and every gem straight from the operating system's cryptographic random source (the browser's Web Crypto API). There is no seed to leak and no internal state to work out from past results, so the next spin cannot be predicted.
- **Simulation and QA** use a seeded generator (sfc32) on purpose, so a run can be repeated exactly. It is used for live play only if you add `?seed=` or `?debug` to the address.
- **Uniformity** is tested: chi-square tests on both generators, and an explicit test that mapping a random number onto a reel position or a gem weight adds no bias. The simulators matching the exact return is a further end-to-end check.
- **What it can't be:** a client-side game can never be provably fair, because the player controls the code in their own browser. Real casinos run the draw on a server and have the generator certified by a testing lab. This project is play money, so it makes no such claim.

## Simulator

```bash
npm run sim -- --spins 10_000_000                       # Clockwork
npm run sim -- --game crucible --spins 4_000_000        # Crucible
```

Clockwork has an exact answer, so the simulator compares against it:

```
RTP            95.96% +/- 0.15% (95% CI)   exact 95.94%   z = 0.26  ok
Hit frequency  39.1%  (1 in 2.6)
```

Crucible has no closed form (refills make every outcome a random tree), so it reports the return two ways and requires them to agree: end to end, and as the exact chance of the feature times the value of feature sessions simulated on their own.

```
RTP            96.23% +/- 1.01% (95% CI, end to end)
RTP by parts   95.54% +/- 0.16% (base + exact trigger chance x 800,000 simulated features)
  feature      end to end 68.39%   by parts 67.71%   z = 1.31  ok
Trigger        1 in 110.6 simulated, 1 in 111.2 exact
```

Both print a win-size distribution, and exit non-zero if the two estimates disagree by more than four standard errors.

## QA tools

Add `?debug` to the page address to get a QA panel: force exact reel stops on Clockwork to reproduce a layout, and see the raw outcome of the last round on either machine. `?seed=anything` makes a whole run repeatable, so a bug report can be replayed exactly. With `?debug` the page also exposes `window.spinwright`, which QA scripts use to read what is actually drawn and to step the animation at a fixed frame rate regardless of how fast the browser is running.

## How it is checked

**Line engine.** The exact return is computed analytically and tested against full enumeration of every stop combination on a small game (agreement to 12 decimal places) and against a 1M-spin simulation of the real game. Wild substitution, scatter behaviour, runs that must start on the first reel and bet scaling each have explicit cases.

**Cascade engine.**
- The cluster finder is compared against a deliberately naive, independent finder (label spreading instead of flood fill) on thousands of random grids of several sizes.
- The refill's documented draw order is replayed by hand and must match exactly.
- Rules that must hold for every play (pieces are conserved, heat follows its rule, a finished spin leaves nothing to win, the cap is never exceeded, the feature's spin count adds up) are checked over thousands of recorded plays.
- A tiny game is solved **exactly** as a Markov chain, feature and carried heat included, by a solver written independently of the engine. The engine's simulated average must match it within sampling error.
- The exact scatter-trigger probability is checked against brute-force enumeration.

**Animation.** Landing a reel exactly on its stop is tested for every stop, including quick stops at any moment. The fall choreography is tested against itself: across thousands of random boards, no falling piece may sink into the one above it at any moment of the animation, and a test confirms the checker would catch a bounce that grows with the fall (the bug this test was added for).

**In the browser.** Sixty real spins on Clockwork and four hundred on Crucible (including two full furnace features) were checked, normal and turbo, with quick stops: the picture read back from the screen equals the engine's result every time, the wallet and on-screen numbers match, and there were no page errors. The cascade animation was measured frame by frame over 120 spins (7,785 frames): the worst overlap between falling pieces is 0.1 pixel. The production build was also played from a `/spinwright/` subpath, the way GitHub Pages serves it.

**Tests against deliberate bugs.** Sixteen injected bugs across both engines and the motion code (modulo bias, a non-wrapping reel window, wilds not extending runs, a wrong RTP divisor, scatter paid on the wrong bet, a wrong landing offset, heat that never rises, a reversed refill order, a cluster finder that ignores one neighbour, a feature that needs one scatter too many, heat that resets between feature spins, a missing win cap, and more) were each caught by the suite.

## Layout

```
src/engine/            the line engine: config + validation, RNG, spin, evaluation, exact RTP
src/engine/cascade/    the cascade engine: grid, clusters, refill, heat, feature, exact trigger chance
src/games/             game definitions (data)
src/sim/               Monte Carlo simulators (CLI)
src/app/               wallet, saved preferences, the Machine interface (no drawing code)
src/machines/          Clockwork and Crucible: a game plus its look and motion
src/ui/                PixiJS reels, cascade view, animator, HUD, QA panel
src/ui/art/            the artwork: palette, metal helpers, both symbol sets, reel bed
test/                  Vitest suite
```

## Built with

Written by Claude (**Sonnet 5.5**, model id `claude-sonnet-5-5`, run at extra effort) in Claude Code. Directed and tested by David. Commits carry a `Co-Authored-By` trailer naming the model, so the history shows which model made each change.

## License

All rights reserved. The source is public to read and evaluate, not to reuse. See [LICENSE](LICENSE).

## Roadmap

1. ~~Line engine, simulator, tests~~
2. ~~Playable UI with PixiJS reels and a play-money wallet~~
3. ~~Second machine: cascade engine, heat multiplier, furnace feature~~
4. A way to earn credits (a mini-game)
5. Deploy to GitHub Pages
