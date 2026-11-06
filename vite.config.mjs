import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: "ui",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: "../dist/ui", emptyOutDir: true },
});
