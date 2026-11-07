import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
export default defineConfig(({ mode }) => ({
  root: "ui",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    sourcemap: mode === "coverage",
    minify: mode === "coverage" ? false : "oxc",
    rolldownOptions: {
      output: {
        sourcemapPathTransform: (source, map) => resolve(dirname(map), source),
      },
    },
  },
}));
