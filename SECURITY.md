# Security

Spinwright is a static site that runs entirely in the visitor's browser. It has no accounts, no passwords, no payments, no personal data and no server, and it **makes no network requests at all** once loaded. The only thing it stores is the visitor's own play-money balance, settings and Forge progress, in their browser's local storage. This page says what was done to keep it safe, how each part is checked, and, just as important, what cannot be promised.

## What was considered, what was done, how it is checked

### 1. Injection into the page (cross-site scripting)

- **The page is only ever written as text.** Everything shown comes through `textContent` and `createElement`; the lobby's drawings are built with `createElementNS`. There is no `innerHTML`, no `insertAdjacentHTML`, no `document.write`, no `DOMParser`, no `eval`, no `new Function`, no string passed to `setTimeout`. So a string that reaches the page (a seed in the address, a name, anything) is displayed, never parsed.
- **A Content Security Policy backs that up** (`scripts/csp.ts`). Everything is denied by default; scripts and styles may come only from the site's own files; there is no `'unsafe-inline'` and no `'unsafe-eval'`; `connect-src` is `'none'`, so nothing can be sent out or fetched in; `object-src`, `frame-src`, `base-uri` and `form-action` are `'none'`; and **Trusted Types are required** for script sinks, so even a future `innerHTML` of a plain string would throw. Pixi's shader code normally builds functions from strings, which the policy would forbid, so the app uses Pixi's no-eval build (`pixi.js/unsafe-eval`).
- **Checked by:** `test/security.test.ts` scans every source file for the dangerous calls above and for any network API (`fetch`, `WebSocket`, `sendBeacon`, dynamic `import()`, workers), checks that the page has no inline script, style or handler, and checks the policy's contents. `npm run check:build` builds the site and verifies the result: the policy is the first thing in the page, nothing is inline, nothing is external, the bundle holds no `eval`. In a real browser, with the production build, an attempt to write markup, inject an inline or external script, run `setTimeout("code")`, `fetch`, open a WebSocket, send a beacon or load an outside image was refused every time, and normal use (all three games, every dialog) produced no violations.

### 2. A link that rigs the game

`?debug` and `?seed=` used to put the game on a predictable random generator, show a panel that forces exact reel stops, and expose the wallet to the console. Anyone could have sent a link with them.

- **Now they exist only for QA.** They are honoured in the development server and in a build made with `npm run build:qa`, and the deployed site ignores them (`src/app/launch.ts`). The QA code is *removed* from a normal production build, not merely switched off.
- **Live play always draws from the browser's cryptographic random source** (Web Crypto) and cannot be switched to a seeded generator from the address bar.
- **Checked by:** `test/launch.test.ts` (the deployed site ignores every spelling of the parameters); `npm run check:build` fails if a normal build still contains the QA panel or the QA hooks, and if a QA build is missing them.

### 3. Forged or damaged saved data

Anyone can edit what the site saved in their browser. Everything read back (balance, preferences, Forge progress) and everything in the address is treated as untrusted: a balance must be a whole, non-negative, safe integer; a bet must be one of the allowed levels; volume must be between 0 and 1; upgrade levels are capped at their top level; routes only ever lead to pages that exist. Nothing is copied over with `Object.assign` or spread from parsed data, so a forged `__proto__` or `constructor` key cannot change how the program behaves.

- **Checked by:** `test/hostileInput.test.ts` feeds each parser thousands of hostile values (wrong types, huge numbers, `__proto__` keys, 100,000-character strings, markup, non-JSON) and requires a valid result every time, no exception, and an untouched `Object.prototype`.

### 4. The same player in two tabs

Each tab had its own copy of the balance, so credits could be duplicated: spend everything on an upgrade in one tab, earn a little in another, and the credits came back (1,000 credits appeared out of nothing in a test). Now the saved balance is the truth: the wallet re-reads it before every bet, spend, earn and affordability check, and picks up another tab's change as it happens. The Forge's saved progress keeps the larger of each count, so a stale tab cannot overwrite a newer one.

- **Checked by:** `test/wallet.test.ts` (one test per way in, each on a tab that has not looked at the balance) and `test/forge.test.ts`.

### 5. Auto-clickers (the Forge)

The Forge is the only place where clicking earns anything, so that is where the checks are (`src/forge/guard.ts`):

1. **Events made by a script earn nothing.** The browser marks them untrusted (`dispatchEvent`, `element.click()`, synthetic key events), for strikes and for ingots.
2. **A pace limit** of about fourteen strikes a second, which is more than a hand can sustain.
3. **A regularity check.** A run of fast strikes whose timing is machine-even (or even and always on the very same pixel, which a real hand never manages) puts the anvil to rest for 8 seconds, and every repeat doubles the rest, up to two minutes. A machine that starts again the moment it may is never forgiven; a person who is wrongly flagged is forgiven after two minutes of quiet. In a half-hour simulation a fixed-interval clicker earns under 5% of what the same clicks would.
4. **An ingot cannot be caught sooner than 150 ms after it appears**, faster than a person can react.

The mainspring is *meant* to strike automatically (it only spends effort you put in), so the rest does not stop it.

- **Checked by:** `test/guard.test.ts` (people at four tempos, drummers, slow even clickers, bursts, machines with and without noise, escalation, forgiveness, odd input) and the engine tests for the ingot. In a real browser: thirty script-made strikes earned nothing, real clicks earned, a machine-even run was stopped on its 21st strike with the button greyed out and the message shown, and real clicks during the rest were refused.

### 6. Dependencies and secrets

Three runtime dependencies (Pixi and two self-hosted fonts), 97 packages in the lockfile in all, and `npm audit` reported **0 known vulnerabilities** when this was written (2026-10-20). The only install script is the optional macOS `fsevents`. Nothing is loaded from a CDN. The repository holds no keys, tokens or `.env` files. Run `npm audit` yourself for today's answer.

## What cannot be promised

- **A browser belongs to its visitor.** Anyone can open the developer tools, edit the saved balance, edit the code they were sent, or call functions directly. So the balance and the Forge's progress **cannot be made tamper-proof** in a site like this. The checks above stop mistakes, links, scripts and common tools; they do not stop a determined person, and a client-side program cannot. Only a server that owns the balance and rolls the dice could, and that would be a different project. Because it is play money, the only game that tampering can spoil is the visitor's own.
- **The auto-clicker checks are basic.** A clicker with randomised timing, a hardware macro, or one that pauses every few seconds looks like a person to them. Raising the bar further means false alarms for real players. They make the cheap tools useless; they are not a wall.
- **Some headers cannot be sent.** GitHub Pages cannot set HTTP headers, so the policy is a `<meta>` tag, which browsers honour for everything except `frame-ancestors` (framing the site inside another page). With nothing sensitive on the page to click, that costs little here. Trusted Types are enforced by Chromium-based browsers; the rest of the policy applies everywhere.

## Checking it yourself

```bash
npm test                 # includes the security, hostile-input, wallet and guard tests
npm run check:build      # builds the site and a QA build, and verifies both
npm audit                # known vulnerabilities in the dependencies
```

Never deploy `dist-qa/`: it is the QA build, with the rigging tools in it. `dist/` is the real site.

## Reporting a problem

Open an issue on the repository, with the steps to reproduce it. There is no real money here, so there is no bounty, but a real hole will be fixed.
