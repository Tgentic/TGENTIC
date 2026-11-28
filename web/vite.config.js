import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two pages: landing (plain HTML) and dapp (React). Dev: /app is rewritten to app.html, matching the clean URLs in production.
const cleanUrls = {
  name: "clean-urls",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.split("?")[0] === "/app") req.url = "/app.html" + req.url.slice(4);
      next();
    });
  },
};
export default defineConfig({
  plugins: [react(), cleanUrls],
  build: { minify: "esbuild", rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), app: resolve(import.meta.dirname, "app.html"), mcp: resolve(import.meta.dirname, "mcp.html"), audit: resolve(import.meta.dirname, "audit.html") } } },
});
