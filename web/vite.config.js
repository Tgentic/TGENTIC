import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Dua halaman: landing (HTML biasa) dan dapp (React). Dev: /app dialihkan ke app.html (clean URL seperti di produksi).
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
  build: { minify: "esbuild", rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), app: resolve(import.meta.dirname, "app.html") } } },
});
