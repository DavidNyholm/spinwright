import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs, so the built site works from any path (GitHub Pages serves it under /<repo>/).
  base: "./",
  build: { target: "es2022" },
});
