import { defineConfig } from "vite";

// The client reads tuning files from the repo's data/ folder, which sits outside the package.
// style.html is the V1 style test page, built alongside the game. The repo's assets/ folder is served as-is (models
// at /models/...), and copied into the build.
export default defineConfig({
  publicDir: "../../assets",
  server: { port: 5173, fs: { allow: ["../.."] } },
  build: { target: "es2022", rollupOptions: { input: { main: "index.html", style: "style.html" } } },
});
