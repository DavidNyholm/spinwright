import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { securityMetaTags } from "./scripts/csp.ts";

/**
 * Puts the Content Security Policy at the very top of the built page. It is not added in the dev server,
 * whose hot reloading needs inline scripts; `npm run build` and `npm run build:qa` both include it.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "spinwright-content-security-policy",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace("<head>", `<head>\n    ${securityMetaTags()}`),
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the built site works from any path (GitHub Pages serves it under /<repo>/).
  base: "./",
  build: { target: "es2022" },
  plugins: [contentSecurityPolicy()],
});
