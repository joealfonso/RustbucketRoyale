import { defineConfig } from "vite";

// The client reads tuning files from the repo's data/ folder, which sits outside the package.
export default defineConfig({
  server: { port: 5173, fs: { allow: ["../.."] } },
  build: { target: "es2022" },
});
