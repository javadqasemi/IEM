import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  build: {
    // Two entries: the landing page, and the job advert that opens in its own
    // window (`stelle.html?id=…`, see `src/stelle.tsx`). The dev server picks
    // up any HTML in the project root by itself; the build has to be told, and
    // naming `index.html` here is required — listing only the second entry
    // would silently drop the site.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        stelle: resolve(__dirname, "stelle.html"),
      },
    },
  },
});
