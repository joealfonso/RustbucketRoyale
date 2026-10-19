import { defineConfig, type Plugin } from "vite";

// Fontsource lists a .woff fallback after each .woff2. Every browser that can run the game (WebGL2, ES2022) reads
// woff2 and never fetches the woff, so the fallbacks were only dead weight in the build (93 kB, docs/PERF.md). The
// fonts arrive through @import in hud.css, which Vite inlines, so this edits the finished CSS rather than each import.
const woff2Only: Plugin = {
  name: "woff2-only",
  apply: "build",
  generateBundle(_options, bundle) {
    for (const [name, item] of Object.entries(bundle)) {
      if (item.type === "asset" && name.endsWith(".css")) {
        item.source = String(item.source).replace(/\s*,\s*url\([^)]*\.woff\)\s*format\(\s*["']woff["']\s*\)/g, "");
      }
    }
    for (const name of Object.keys(bundle)) if (name.endsWith(".woff")) delete bundle[name];
  },
};

// The client reads tuning files from the repo's data/ folder, which sits outside the package.
// style.html is the V1 style test page, built alongside the game. The repo's assets/ folder is served as-is (models
// at /models/...), and copied into the build.
export default defineConfig({
  plugins: [woff2Only],
  publicDir: "../../assets",
  server: { port: 5173, fs: { allow: ["../.."] } },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { main: "index.html", style: "style.html" },
      // Three.js in a file of its own: it is most of the download and changes only on an upgrade, so a browser keeps
      // it cached across game updates instead of fetching it again with every change to the game code.
      output: { manualChunks: (id: string) => (id.includes("/node_modules/three/") ? "three" : undefined) },
    },
    // Three alone is about 600 kB minified (180 kB gzipped) and cannot be split further, so warn only above that.
    chunkSizeWarningLimit: 700,
  },
});
