# Spinwright

A small workshop of play-money games: two slot machines built around pure TypeScript math engines (with Monte Carlo simulators that prove the maths), and a clicker, the Forge, that earns the credits to play them. A PixiJS browser front end ties them together behind a lobby. Credits are virtual only. There are no payments, accounts or real-money features anywhere in this project.

**Status:** the lobby, both machines, the Forge, sound, the "how it works" pages, the security hardening and the simulators are done. A third machine (hold and win) is next; the GitHub Pages deploy is held back until the project is judged ready. See the [roadmap](#roadmap).

## Play it locally

Needs Node 22.18 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints: it opens on the lobby, with a card for each game. Pages are addresses in the URL hash (`#/`, `#/play/classic`, `#/play/crucible`, `#/forge`), so the back button works and a page can be linked to. On a machine, Space or Enter spins, and pressing it mid-spin plays the rest of the round quickly. Balance, bet, turbo, sound and the Forge's upgrades are saved in the browser. There is no free refill: when the credits run out, the machines point you to the Forge. Every game has a **How it works** button beside its name that opens its rules: the paytable, how the multiplier climbs, what the scatters and features do, the win cap, the price of the bonus and the return.

The look is a brass workshop, drawn entirely with code: engraved metal plates, gears, gems, a dark iron cabinet with amber displays. There are no image files. To review the artwork on its own, open `/symbols.html` on the dev server.

Sound is on by default and starts at your first click or key press (browsers keep a page silent until then). The **Sound** switch and volume slider are in the bar across the top of every page, and both are remembered. To audition every sound, open `/sounds.html` on the dev server.

## The machines

**No. 1 Clockwork** is a five-reel, three-row, twenty-line machine with a wild and a scatter, and a free-spins feature. Three or more scatters (blueprints) on the opening spin start it: eight free spins (twelve for four scatters, sixteen for five) in which **every wild that lands is locked in place until the feature ends**, so the board fills up spin by spin and the wins grow with it. The free spins have their own reels, which carry more scatters, and three scatters on a free spin add four more spins (to at most forty). One bet can win at most 5,000 times its size. When two scatters have landed and one more would start the feature, the remaining reels hold on, spinning, inside an amber outline: the wait is the tension. (That is staged from the grid the reels are about to land on, which is already decided, so it changes nothing about the outcome.)

Measured (the return from 1,000,000 simulated features for each number of scatters, the rest over 3 million rounds):

| | Clockwork |
|---|---|
| Return to player | 96.04% +/- 0.07% (95% CI) |
| Of which opening-spin lines / scatters / free spins | 61.4% (exact) / 1.95% (exact) / 32.7% |
| Free spins start | 1 in 125 spins, exactly |
| Average feature | 38.0x the bet over 8 spins for three scatters, 93x over 12 for four, 178x over 16 for five |
| Across every trigger | 41.3x the bet (sd 54x), 9.1 spins played, retriggered in 23% of features, 3.6 wilds locked at the end |
| Hit frequency | 28.8% of rounds win something, and every win pays more than the bet (at least 1.1x) |
| Volatility | sd about 6.4x the bet per round |
| Biggest win in 3 million rounds | 1,348x the bet |

The opening spin is still computed exactly. The free spins are not: locked wilds make every spin depend on the ones before, so they are measured by simulation (below).

**Every win is a profit.** The base game used to pay many small "wins" that returned less than the bet: more than one round in five won something and still lost money. That is gone. Nine and Ten now pay only from four in a row, every other symbol's smallest pay is 22 times the bet per line (1.1 times the total bet, as the bet is spread over twenty lines), and the longer runs and the high symbols were scaled up to hold the return at 96%. The cost is that wins come less often (28.8% of rounds, down from 38.5%); the big ones are still there (one round in 90 pays ten times the bet or more). A test works the smallest pay out from the paytable and plays 120,000 rounds, free spins included, to confirm that every winning spin, opening or free, pays more than its bet. The lobby card and the rules page state the promise only because that calculation says it holds, so a game whose table breaks it stops saying so.

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

## Buying the bonus

Both machines let you skip the wait and **buy their feature** with play-money credits: a bar under the controls shows the price, and a confirmation (a real dialog, so Escape cancels) comes first, because a buy costs many times a spin.

- **What you get:** the feature at once, with no opening spin, exactly as if the fewest scatters that start it had landed: Clockwork's eight free spins, or Crucible's ten furnace spins from a fresh heat. The small scatter pay a natural trigger carries is not included.
- **The price** is a multiple of your total bet, so it grows with the bet: **40 times** the bet on Clockwork, **79 times** on Crucible. Each was set from the feature's measured average value (38.0 times the bet on Clockwork, 75.3 times on Crucible), so a buy returns **94.9% and 95.3% of its price** on average: a little under what a spin on the same machine returns.
- **It is a gamble like any other.** Most buys pay less than they cost (Crucible's median feature is worth 50 times the bet, against a price of 79), and a few pay far more. The dialog says so.
- **It goes through the same wallet rules as a spin:** the price is taken and the outcome banked the moment you confirm, before anything is animated, so leaving the page or refreshing mid-feature loses nothing. The buy is disabled while a round is playing or when the balance cannot cover it.

## The Forge

A clicker that earns the credits the machines spend. Strike the anvil by clicking it, tapping it, pressing the Strike button, or pressing Space or Enter.

- **Strikes** pay credits. **Heat** is a combo meter: it builds as you keep striking and multiplies the next strikes (Cold x1, Warm x1.5, Hot x2, White-hot x3), then drains when you pause.
- **Four upgrades**, bought with credits and kept between visits: a heavier hammer (each strike pays more), tongs (heat builds faster and cools slower), the mainspring, and lucky ingots. Costs grow steeply, and a pacing test in the suite keeps them there: a scripted player who strikes steadily, catches every ingot and always buys the cheapest upgrade gets a first upgrade inside 45 seconds at five strikes a second, and has maxed nothing after ten minutes at two, five or eight. (That guards the pacing; whether it is fun is for a human to judge.)
- **The mainspring** is the automation, built so that it is not idle income. Your strikes *wind* it; once you pause for about 0.8 seconds it *unwinds into automatic strikes* (each worth 60% of a base strike) until it runs down. It stores your effort rather than making any, so it can only pay out what you put in, it never earns while you are away, and the Forge's clock stops when the tab is hidden. Higher levels hold more turns, take more from each strike and unwind faster. In the picture the gear turns back as you wind it and forward as it strikes.
- **Ingots** flash across the forge now and then (every 25 to 55 seconds, only while the Forge is open). Click one before it cools for a windfall (30 strikes' worth) or a ten-second frenzy in which every strike, the mainspring's too, pays five times as much. Luck shortens the wait and raises both prizes.
- **Credits go straight into the shared wallet**, whole credits only: a strike worth a part-credit carries the rest forward, so over time exactly what was earned is paid.

Every number that sets how the Forge plays is in `src/forge/config.ts`, and the upgrade cards describe themselves from the same functions the rules run on, so what a card says is what the Forge does.

## How it works

- **The outcome is decided first, then animated.** A round is resolved completely (every grid, every win, the total) before anything moves. The UI only plays back a result that already exists, the same split real slot software uses. The win is banked in the wallet the moment the outcome is drawn, so a page refresh mid-spin cannot lose it.
- **Two engines, one page.** The line engine and the cascade engine are separate, pure, DOM-free modules. A small `Machine` interface (plan a round, show it, quick-stop it) is all the page knows, so the wallet, bet, spin button and readouts are shared and a new machine is a new `Machine`.
- **The Forge is a rules engine with a clock you hand it.** `ForgeEngine` only moves when `tick(ms)` is called and only draws randomness from the generator it is given, so a whole session can be played in a test. The Pixi scene draws what it reports (events and state) and decides nothing.
- **One game at a time.** Each page is built when you visit it and torn down when you leave, so leaving a machine mid-spin (the win is already in the wallet) or the Forge (progress is saved) leaves nothing running.
- **Games are data.** A game is a validated config (reel strips and paylines, or gem weights and cluster pays). `defineGame` and `defineCascadeGame` throw one error listing every problem when the module loads.
- **Whole credits only.** Bets and wins are integers, so there is no floating-point drift in anyone's balance.
- **Reproducible.** Every simulation and QA run takes a seed, and the same seed gives the same spins.
- **The engines have no browser code.** A second TypeScript config type-checks `src/engine`, `src/games`, the Forge's rules (`src/forge`), the router and the catalog without the DOM library, so they stay runnable in Node and could move to a server.
- **Animation is plain numbers first.** Reel motion and the cascade's falling pieces are pure plans driven by an explicit clock; the Pixi view only displays them. That is what makes them testable.
- **Symbols are drawn with vector shapes**, so there are no art files to license. A different theme is a different set of textures.

## Sound

Every sound is synthesised by code (`src/audio`), the way the artwork is drawn by code: oscillators, filtered noise and struck bells, mixed into plain sample arrays. There are no recordings, so there is no licence to track and no attribution to give, and the whole set is built in a few milliseconds at start-up.

- **Reels:** a pull as they start, a ratchet while they spin, and a thump as each one lands, a little higher in pitch than the last and panned from the left speaker to the right.
- **Crucible:** the new fill lands as a rolling arpeggio, one note per column. Each step of a cascade plays a note one rung higher on a pentatonic ladder as the heat climbs, then a glass-shattering burst. Embers crackle, and the furnace lights with a rising roar and settles into a low rumble for the feature.
- **Wins:** four tiers of bell jingle by size, coin ticks while the counter rolls up.
- **Clockwork's free spins:** each scatter chimes a step higher as it lands, a rising shimmer (as long as the hold itself) plays while the reels hold on for the third, and a cog seats with a thunk, a tick and a ring as each wild locks.
- **Forge:** a hammer on iron (a low thump under an inharmonic ring, so it sounds like metal and not a bell) that rings brighter at each heat tier, a lighter higher tap for the mainspring's hammer, gears and a chime for an upgrade, a dull thunk for a purchase you cannot afford, and bells for an ingot and a frenzy.
- **Safety:** a limiter sits before the speakers so many sounds at once cannot clip, and the voice count is capped.

`npm run sounds` writes every sound to `sounds-out/` as a WAV file. `/sounds.html` plays each one, the heat and win ladders, and whole sequences as the game plays them.

**What is and is not verified.** The levels, clipping, pitch, decay, loop seams and which sound plays at which moment are all tested (below). Whether the set sounds *good* is a matter of ears, and has not been judged by anyone yet.

## Security

A static, client-only, play-money site has a small attack surface, and it has been kept small and checked. [SECURITY.md](SECURITY.md) has the full threat model; in short:

- **Nothing can be injected into the page.** Everything shown is written as text, never as markup (no `innerHTML`, no `eval`, no string-to-code anywhere, enforced by a test that scans the source), and a strict **Content Security Policy** backs it up: scripts and styles only from the site's own files, no inline code, no `eval`, **no network access at all**, and Trusted Types required. In a real browser every injection attempt (markup, inline script, external script, `fetch`, WebSocket, beacon, outside image, `setTimeout("code")`) was refused.
- **No link can rig the game.** `?debug` and `?seed=` (which gave a predictable generator, forced reel stops and a wallet in the console) work only in development and QA builds; the QA code is removed from the real site, and `npm run check:build` fails if it ever comes back.
- **Saved data and the address are untrusted.** Everything read back is validated and thrown away if it is not valid; fuzz tests feed each reader thousands of hostile values.
- **Two tabs cannot duplicate credits.** (They could: spending everything in one tab and earning in another brought the credits back.) The saved balance is now the truth, re-read before every bet and spend.
- **Basic anti-auto-clicker checks on the Forge:** strikes made by a script earn nothing, there is a pace limit no hand can pass, a run of machine-even strikes puts the anvil to rest (for twice as long each time it repeats), and an ingot cannot be caught faster than a person can react.
- **Honest limits.** The game runs in the visitor's browser, so the balance cannot be made tamper-proof against someone with the developer tools, and the click checks stop the common tools, not a determined or randomising one. Only a server could, and this is play money. SECURITY.md says exactly what is and is not promised.

## How random is it?

Honest answer: it is pseudo-random, not hardware-random, like every software slot, and it comes from the right source for the job.

- **Live play** draws every reel stop and every gem straight from the operating system's cryptographic random source (the browser's Web Crypto API). There is no seed to leak and no internal state to work out from past results, so the next spin cannot be predicted.
- **Simulation and QA** use a seeded generator (sfc32) on purpose, so a run can be repeated exactly. The deployed site cannot be switched into it: `?seed=` and `?debug` are honoured only by the development server and a QA build, and are ignored (and compiled out) everywhere else.
- **Uniformity** is tested: chi-square tests on both generators, and an explicit test that mapping a random number onto a reel position or a gem weight adds no bias. The simulators matching the exact return is a further end-to-end check.
- **What it can't be:** a client-side game can never be provably fair, because the player controls the code in their own browser. Real casinos run the draw on a server and have the generator certified by a testing lab. This project is play money, so it makes no such claim.

## Simulator

```bash
npm run sim -- --spins 3_000_000                        # Clockwork
npm run sim -- --game crucible --spins 4_000_000        # Crucible
```

Clockwork's opening spin has an exact answer, so the simulator checks it directly; its free spins have none (the locked wilds make each spin depend on the last), so it reports the return two ways and requires them to agree: end to end, and as the exact chance of each trigger times the value of features simulated on their own.

```
RTP            96.46% +/- 0.73% (95% CI, end to end)
  opening spin 63.31%   exact 63.38%   z = -0.69  ok
  free spins   33.15%
RTP by parts   96.20% +/- 0.16% (exact opening spin + exact trigger chances x 200,000 simulated features each)
  free spins   end to end 33.15%   by parts 32.83%   z = 0.89  ok
Trigger        1 in 124.7 simulated, 1 in 124.9 exact
```

(The table above used five times as many simulated features, hence its narrower interval.) The report also prints a win-size table: in 3 million rounds the "less than 1x" row is empty, which is the promise above seen from the other side.

Crucible has no closed form (refills make every outcome a random tree), so it reports the return two ways and requires them to agree: end to end, and as the exact chance of the feature times the value of feature sessions simulated on their own.

```
RTP            96.23% +/- 1.01% (95% CI, end to end)
RTP by parts   95.54% +/- 0.16% (base + exact trigger chance x 800,000 simulated features)
  feature      end to end 68.39%   by parts 67.71%   z = 1.31  ok
Trigger        1 in 110.6 simulated, 1 in 111.2 exact
```

Both print a win-size distribution, and exit non-zero if the two estimates disagree by more than four standard errors.

## QA tools

QA tools exist only in the development server (`npm run dev`) and in a QA build (`npm run build:qa`, written to `dist-qa/`, which must never be deployed); the deployed site ignores every parameter below. Add `?debug` to the page address to get a QA panel: force exact reel stops on Clockwork to reproduce a layout, and see the raw outcome of the last round on either machine. `?seed=anything` makes a whole run repeatable, so a bug report can be replayed exactly. With `?debug` the page also exposes `window.spinwright`, which QA scripts use to read what is actually drawn, to move between pages (`go('#/forge')`), and to step the animation at a fixed frame rate regardless of how fast the browser is running. On the Forge, `window.spinwright.forge` gives the engine, its state and `advance(ms)`, which cranks the clock by hand.

## How it is checked

**Line engine.** The exact return of an opening spin is computed analytically and tested against full enumeration of every stop combination on a small game (agreement to 12 decimal places) and against a 1M-round simulation of the real game. Wild substitution, scatter behaviour, runs that must start on the first reel and bet scaling each have explicit cases.

**The "how it works" pages.** Each page is written from the game's own configuration (`src/app/rules.ts`), never typed by hand, so it cannot drift from the rules: every paytable cell is read from the same table the engine pays from, and the multiplier ladder, the trigger counts, the spins, the cap and the buy price are all read from the config. Tests require each cell to equal the real pay, the numbers in the text to equal the config's, a worked example to come out right, a changed config to change the page, and a game with no feature or no scatter to say nothing about one. The sentence that no win pays less than the bet is worked out from the pays, and a table with one small pay makes it vanish. The pages were opened in a real browser on all three games: Escape and the Got it button close them and return focus to the button, and at phone width a wide paytable scrolls inside its own box while the page does not.

**Security.**
- A test scans every source file for the calls that write markup into a page, turn a string into code, load code at run time or touch the network (`fetch`, WebSocket, beacon, workers, dynamic imports), and has its own scanner checked against samples of each. The page is checked for inline script, style and handlers, and the policy for anything that weakens it.
- `npm run check:build` builds the site and a QA build and inspects both: the policy comes first in the page, nothing is inline or external, no `eval` is in the bundle, the normal build holds no QA panel and no QA hooks, and the QA build holds them.
- Hostile input: every reader of saved data and of the address is fed thousands of wrong types, forged `__proto__` keys, huge numbers and monster strings, and must come out valid, never throw and never touch `Object.prototype`. The wallet is tested for two tabs, with one test per way in, each on a tab that has not looked at the balance.
- The click guard is tested with people at four tempos (never flagged over 600 strikes each), drummers, slow even clickers, short bursts, and machines with and without timing noise, and for the doubling rest, forgiveness, the pace limit and odd input. Its limits are tested too: noise of about twice a hand's wander, from a drifting pointer, is not caught, and the test says so.
- In a real browser, on the production build: `?debug&seed=...` did nothing (no QA panel, nothing on `window`); normal use of all three games and every dialog produced no policy violations; and each attack above was refused. On the Forge, thirty script-made strikes earned nothing and real clicks earned. The resting behaviour was checked on the development server, because its QA hook can deliver strikes with timing of my choosing, which no browser tool can do with real clicks: a machine-even run was stopped on its 21st strike (the button greyed with the seconds left), the second flag rested for 16 seconds, and real clicks during the rest were refused. The real-click timing of an actual auto-clicker was not tested; the guard's tests use simulated timelines.

**Bonus buy.**
- Each price is tied to measurement: tests simulate 100,000 features per machine and require that the average value divided by the price falls between 93% and 97.5%, and that most buys pay less than they cost. Change a feature, and its price fails the suite until it is set again from `npm run sim`, which prints what a buy returns.
- A bought feature is the same feature the simulator measures: bought and simulated features played from the same random numbers win exactly the same. The win cap, the price's scaling with the bet and the rejection of a game with nothing to buy each have cases.
- Driven in a real browser on both machines: the price follows the bet (checked again after the Clockwork rebalance: 800 at the smallest bet and 1,600 at the next), cancelling from the button and with the Escape key buys nothing, an unaffordable buy is disabled, and a confirmed buy of each machine charged the price at once, played the feature, and left the on-screen win, balance and wallet in agreement with the result that was decided.

**Clockwork's base game.**
- The paytable is pinned: a longer run never pays less than a shorter one, a poorer symbol never pays more than a richer one at any run, Nine and Ten need four in a row (a wild can carry three to four), and every other symbol's three-in-a-row pays 22.
- The smallest-win calculation is tested on the real game (22 per line, 1.1 times the bet), on a one-payline game (exactly the bet, which is not "more than" it), a three-payline game with a pay of 5, a scatter pay of 1, and a game that pays nothing.
- In play: 120,000 rounds on the real game at random bets, every opening and free spin checked, and every winning spin pays more than its bet. The hit rate (between 27% and 31%) and the share of spins paying five times the bet or more (between 1.5% and 3%) are held to bands over 400,000 spins, so a later change cannot quietly turn the base game stingy or flat again.

**Free spins.**
- Played by hand with a scripted random source: a wild locks where it lands, stays through later spins and is paid in wins; a wild is never locked twice; retriggers add spins up to the limit and no further; the win cap cuts the spin that reaches it and ends the feature.
- Over 12,000 random rounds on the real game, every free spin is checked: the grid shown is what the feature's own reels landed with the locked wilds on top, its wins are those of that grid, new locks are exactly the wilds that landed in unlocked cells, locks only ever accumulate, the spin count is awarded plus retriggered and never over the limit, and a round is its opening spin plus its free spins within the cap.
- A small game's feature is solved **exactly** by a calculation written independently of the engine (every stop on every spin, carrying locked cells, spins played and spins left), with two rows so the numbering of cells is exercised; the engine's simulated average must match it within sampling error, and a second check confirms that the answer would be far off if wilds did not lock.
- The exact chance of a trigger is checked against enumeration of every opening grid. Which reels hold on for a scatter is a plain function with its own tests.

**Cascade engine.**
- The cluster finder is compared against a deliberately naive, independent finder (label spreading instead of flood fill) on thousands of random grids of several sizes.
- The refill's documented draw order is replayed by hand and must match exactly.
- Rules that must hold for every play (pieces are conserved, heat follows its rule, a finished spin leaves nothing to win, the cap is never exceeded, the feature's spin count adds up) are checked over thousands of recorded plays.
- A tiny game is solved **exactly** as a Markov chain, feature and carried heat included, by a solver written independently of the engine. The engine's simulated average must match it within sampling error.
- The exact scatter-trigger probability is checked against brute-force enumeration.

**Animation.** Landing a reel exactly on its stop is tested for every stop, including quick stops at any moment. The fall choreography is tested against itself: across thousands of random boards, no falling piece may sink into the one above it at any moment of the animation, and a test confirms the checker would catch a bounce that grows with the fall (the bug this test was added for).

**Sound.** Every sound is built deterministically and tested: samples are finite and never clip, start and end at silence, ring at the pitch asked for (measured by spectral energy), and die away rather than being cut off. Each loop must join its end to its start without a click, and a hum can only enter a loop if it makes a whole number of cycles, which the code enforces. In the browser, the sounds the views *ask for* were compared against the engine's decided result: across 98 Crucible rounds (two full furnace features) and 61 Clockwork spins (before its free spins were added), every heat note, burst, column landing, reel stop, feature sound and win jingle matched what the result called for, exactly. That one-for-one comparison has not been repeated for Clockwork's free spins: those sounds are unit-tested for what they contain, and the request counts were looked at in a few rounds, nothing more. The Crucible's retrigger sound is still untested, because a retrigger did not occur.

**In the browser.** Before the free spins existed, sixty real spins on Clockwork and four hundred on Crucible (including two full furnace features) were checked, normal and turbo, with quick stops: the picture read back from the screen equals the engine's result every time, the wallet and on-screen numbers match, and there were no page errors. The free spins were checked the same way over 66 rounds of Clockwork (27 with free spins, 103 locked wilds and 6 retriggers among them, in turbo and at normal speed, plus a stop pressed mid-feature): after each round the reels showed exactly the window the engine landed, the cogs on screen were exactly the cells it locked, and the win readout, balance and wallet reconciled. The cascade animation was measured frame by frame over 120 spins (7,785 frames): the worst overlap between falling pieces is 0.1 pixel. The production build was also played from a `/spinwright/` subpath, the way GitHub Pages serves it. (That was before the Content Security Policy; the policy was then checked on the production build served from its own root, not from a subpath.) After the base-game rebalance the browser check was repeated on the new paytable, on the development server: 800 real spins (251 wins, the smallest paying 1.1 times the bet, 7 of them with free spins) and 6 bought features. After each one the reels showed the window the engine landed (the locked wilds, which are drawn as cogs, were compared with the engine's locked cells instead), and the win readout and balance matched the decided result, with no page errors. The lobby card and the rules page were read in the browser, and the lobby was checked at phone width for sideways scrolling, and the rules page's wording on where each symbol starts to pay was changed after reading it there.

**The Forge.** The rules engine is played in tests with an explicit clock and a seeded generator: heat tiers and draining, the mainspring's winding, idle delay, run-down and capacity, the carry that makes part-credits pay out exactly, ingot timing, windfall and frenzy (including that the mainspring's strikes are multiplied too), purchases, refusals when short of credits, and saving and loading (including damaged saves). The upgrade cards are tested against the engine, so a card cannot describe a number the Forge does not use. The hammer's swing (one impact per strike, no jump when strikes come faster than it lifts), the sparks, the floating numbers and the colour of hot iron are plain functions with their own tests. The router and the lobby's catalog are tested too, including that the return figures the lobby quotes match the engines (each within sampling error of a fresh simulation). The Forge's pages were driven in a real browser: real clicks on the ingot, the anvil and the buttons (an ingot click does not also strike), purchases, the mainspring running down, ingots appearing, saved progress surviving a reload, the out-of-credits banner, and leaving a machine mid-spin; it was also checked at phone width.

**Tests against deliberate bugs.** One hundred and forty injected bugs across both engines, the free spins, the Forge, the motion code and the sound code (a loop crossfade run backwards, a hum that does not fit its loop, a sound normalised past clipping, a bell on the wrong note, modulo bias, a non-wrapping reel window, wilds not extending runs, a wrong RTP divisor, scatter paid on the wrong bet, a wrong landing offset, heat that never rises, a reversed refill order, a cluster finder that ignores one neighbour, a feature that needs one scatter too many, heat that resets between feature spins, a missing win cap, a hammer that never reaches the iron, sparks thrown downward, floating numbers that never fade, a card quoting the next level's value, a wallet that lets credits go negative, a router that opens unknown machines, wilds that do not lock, a locked cell drawn in the wrong place, a retrigger that ignores the spin limit, a win cap that does not cap, free spins played on the base reels, a reel that never holds on for a scatter, a buy priced without the bet, a bought feature that ignores the cap, a buy that starts one scatter too generous, a paytable column that reads the wrong run, a heat example that adds instead of multiplies, a rules page that still talks of scatters in a game without any, a click guard that accepts script-made events or never doubles its rest, a wallet that spends from a stale balance, a policy that allows inline styles, a stray `innerHTML` or `fetch` added to the source, QA tools left in the real site, a Nine that pays on three again, a Jack that pays less than the bet, a longer run that pays less than a shorter one, a smallest-win calculation that forgets the scatter or the number of lines, a rules page or a lobby card that promises "every win pays more than your bet" when the table does not keep it, a bonus buy priced far under its feature's worth, and more) were each caught by the suite. (Three more changed nothing: two exposed dead code in the click guard and one a redundant line in the router, and all three were removed. Two showed gaps in tests, which were filled: one in a wallet test, and one in the lobby card's promise, which could not be reached through the catalog because only Clockwork uses it, so the function is now tested directly; testing it also showed that it would have promised "at least Infinity" for a game that pays nothing, which is fixed.)

## Layout

```
src/engine/            the line engine: config + validation, RNG, spin, evaluation, exact RTP
src/engine/cascade/    the cascade engine: grid, clusters, refill, heat, feature, exact trigger chance
src/games/             game definitions (data)
src/sim/               Monte Carlo simulators (CLI)
src/forge/            the Forge's rules (config, engine, card text, click guard): no drawing code
src/app/               wallet, saved preferences, routes, the lobby catalog, the rules pages, the Machine interface (no drawing code)
src/pages/             the pages: top bar, lobby, slot machine, Forge
src/machines/          Clockwork and Crucible: a game plus its look and motion
src/ui/                PixiJS reels, locked-wild layer, cascade view, forge scene, animator, HUD, rules dialog, QA panel
src/ui/art/            the artwork: palette, metal helpers, both symbol sets, reel bed
src/audio/             sound synthesis, the recipes for every sound, and the Web Audio player
scripts/               sound export, the Content Security Policy, the build verifier
test/                  Vitest suite
SECURITY.md            the threat model: what is protected, how it is checked, what cannot be promised
```

## Built with

Written by Claude (**Sonnet 5.5**, model id `claude-sonnet-5-5`, run at extra effort) in Claude Code. Directed and tested by David. Commits carry a `Co-Authored-By` trailer naming the model, so the history shows which model made each change.

## License

All rights reserved. The source is public to read and evaluate, not to reuse. See [LICENSE](LICENSE).

## Roadmap

Done:

1. ~~Line engine, exact return, simulator, tests~~
2. ~~Playable UI with PixiJS reels and a play-money wallet~~
3. ~~Second machine: cascade engine, heat multiplier, furnace feature~~
4. ~~Sound~~ (built in code and tested; no one has listened to it yet)
5. ~~A way to earn credits: the Forge, behind a lobby~~
6. ~~Clockwork's free spins with locked wilds, retrigger and a win cap~~
7. ~~Bonus buy on both machines, priced from the measured feature value~~
8. ~~"How it works" pages written from each game's own configuration~~
9. ~~Security pass: strict policy, no rigging links, two-tab wallet fix, anti-auto-clicker checks~~
10. ~~Clockwork's base game rebalanced so that every win pays more than the bet~~

Next, roughly in order:

11. A third machine: **hold and win** (symbols that lock and respin, with fixed prizes and a jackpot), as its own engine with its own exact or simulated return, like the other two.
12. Listen to the sound set and tune it. This needs a person's ears: the tests only cover what can be measured.
13. Judge the Forge's pacing by feel (the test only guards against it being trivially fast or slow), and tune `src/forge/config.ts`.
14. Deploy to GitHub Pages. The build is already made for it and was played from a subpath, but it is held back until the project is judged ready.

Not planned: real money, accounts, or anything server-side.
