import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
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
