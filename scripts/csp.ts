/**
 * The page's Content Security Policy: the browser's own enforcement of "this page runs only the code
 * it shipped with and talks to nobody". It is the second line of defence behind the code never
 * writing untrusted text into the page as markup (see test/security.test.ts).
 *
 * Why each part holds:
 *  - Everything is closed by default. The app makes no network requests at all: no fonts from a CDN,
 *    no analytics, no API. So `connect-src` is 'none', and nothing external can be loaded.
 *  - Scripts and styles come from this site's own files only. There is no inline script or style, no
 *    `eval`, and no `new Function` (Pixi's shader code uses its no-eval build, `pixi.js/unsafe-eval`),
 *    so neither `'unsafe-inline'` nor `'unsafe-eval'` is needed, and an injected script could not run.
 *  - `data:` images are allowed only because the page's film-grain background is an inline SVG in the CSS.
 *  - Trusted Types are required for script sinks: even a future `innerHTML` of a plain string would throw
 *    instead of running. (Chromium enforces this; other browsers rely on the rest of the policy.)
 *
 * GitHub Pages cannot send HTTP headers, so the policy is delivered as a <meta> tag, which the browser
 * honours for everything except `frame-ancestors`, `report-uri` and `sandbox`.
 */
export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'none'"],
  "frame-src": ["'none'"],
  "object-src": ["'none'"],
  "worker-src": ["'none'"],
  "manifest-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "require-trusted-types-for": ["'script'"],
};

/** The policy as the string a browser reads. */
export function cspPolicy(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/** The tags put at the top of the built page, before any script or stylesheet the policy has to govern. */
export function securityMetaTags(): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${cspPolicy()}" />`,
    // Nothing the page links to needs to know where the visitor came from.
    `<meta name="referrer" content="no-referrer" />`,
  ].join("\n    ");
}
