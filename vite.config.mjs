import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const devPort = Number(process.env.SCREENS_DEV_PORT || 5170);
const apiOrigin = `http://127.0.0.1:${process.env.SCREENS_API_PORT || 4801}`;
const proxy = () => ({
  target: apiOrigin,
  changeOrigin: true,
  configure(server) {
    server.on("proxyReq", (request, incoming) => {
      if ([`http://127.0.0.1:${devPort}`, `http://localhost:${devPort}`].includes(incoming.headers.origin)) {
        request.setHeader("Origin", apiOrigin);
      }
    });
  },
});
export default defineConfig(({ mode }) => ({
  root: "ui",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
    proxy: {
      "/api": proxy(),
      "/mcp": proxy(),
      "/speculation-rules.json": proxy(),
    },
  },
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
