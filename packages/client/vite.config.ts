import { defineConfig } from "vite";

// The client reads tuning files from the repo's data/ folder, which sits outside the package.
// style.html is the V1 style test page, built alongside the game.
export default defineConfig({
  server: { port: 5173, fs: { allow: ["../.."] } },
  build: { target: "es2022", rollupOptions: { input: { main: "index.html", style: "style.html" } } },
});
