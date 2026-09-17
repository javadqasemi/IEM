import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  server: {
    proxy: {
      /**
       * Uploaded media, forwarded to the API.
       *
       * `LocalStorageAdapter.url()` returns a *root-relative* `/media/<key>`,
       * and that is the right thing to store: the snapshot is a document that
       * outlives this machine, so baking `http://localhost:3100` into it would
       * be wrong the moment it is deployed. In production the site and the API
       * sit behind one origin and the path resolves by itself.
       *
       * In development they do not, so without this the browser asks the dev
       * server for `/media/…`, gets Vite's SPA fallback — `index.html`, status
       * 200, `text/html` — and every uploaded image renders as a broken one.
       * A 200 is why this looked like a failed upload rather than a missing
       * route.
       */
      "/media": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Three entries:
    //
    //   index   the landing page
    //   stelle  one job advert, opened in its own window (`stelle.html?id=…`)
    //   admin   the CMS dashboard (`src/admin/`)
    //
    // The dev server picks up any HTML in the project root by itself; the
    // build has to be told, and naming `index.html` here is required —
    // listing only the others would silently drop the site.
    //
    // The three do not share a stylesheet: `admin.html` pulls
    // `src/admin/admin.css`, which selects its own Tailwind config, so the
    // dashboard's utilities never land in the CSS a visitor downloads.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        stelle: resolve(__dirname, "stelle.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
