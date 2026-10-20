/**
 * What the address bar may ask for. `?debug` and `?seed=...` put the game on a predictable random
 * generator, add a panel that forces exact reel stops, and hand the wallet to the console. They exist
 * for QA, and are honoured only where QA is allowed (the development server, or a build made with
 * `npm run build:qa`). The deployed site ignores them, so no link can put a visitor's game into a
 * rigged or predictable state.
 */
export interface Launch {
  /** Show the QA panel and expose the QA hooks on `window`. */
  readonly debug: boolean;
  /** A seed for a repeatable run, or null to draw from the system's cryptographic source. */
  readonly seed: string | null;
}

/** A seed is only ever shown and hashed; this keeps a pasted-in monster from being either. */
export const MAX_SEED_LENGTH = 200;

export function parseLaunch(search: string, qaAllowed: boolean): Launch {
  if (!qaAllowed) return { debug: false, seed: null };
  const params = new URLSearchParams(search);
  const seed = params.get("seed");
  return { debug: params.has("debug"), seed: seed === null ? null : seed.slice(0, MAX_SEED_LENGTH) };
}

/** Whether the run should use a repeatable generator rather than the system's cryptographic one. */
export const wantsRepeatableRng = (launch: Launch): boolean => launch.debug || launch.seed !== null;
