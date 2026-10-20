/**
 * Whether QA features may exist at all: the development server, or a build made with
 * `npm run build:qa`. Bundlers replace both sides with constants, so in a normal production build
 * this is the literal `false` and every `if (QA_ALLOWED && ...)` branch (the QA panel that forces
 * reel stops, the `window.spinwright` hooks) is removed from the shipped code, not merely switched off.
 * scripts/verifyBuild.ts checks that they really are gone.
 */
export const QA_ALLOWED: boolean = import.meta.env.DEV || import.meta.env.MODE === "qa";
