/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the application form POSTs its `multipart/form-data`.
   *
   * Unset in this repo on purpose — it is a redesign sketch with no backend.
   * The upload option in `BewerbungDialog` stays visibly unavailable until a
   * real endpoint is configured, rather than pretending to accept a dossier and
   * dropping it. Set it in `.env.local`, e.g.
   *
   *   VITE_BEWERBUNG_ENDPOINT=https://formspree.io/f/xxxxxxx
   */
  readonly VITE_BEWERBUNG_ENDPOINT?: string;

  /**
   * Origin of the CMS API — e.g. `https://cms.iem.ch` or `http://localhost:3000`.
   *
   * Unset means **no hydration at all**: the site renders the content snapshot
   * embedded in the bundle and never makes a request. That is the correct
   * behaviour for a static preview build, and it is why adding the CMS did not
   * change what a visitor sees on a deployment without one.
   *
   * Set it in `.env.local`. Every `VITE_*` value is public in the bundle, so
   * this must be an origin, never a key.
   */
  readonly VITE_CMS_API?: string;

  /**
   * Access code for the preview gate in front of the site.
   *
   * **Unset means no gate**, which is what a production build wants. Set it to
   * a digit string to put the barrier back for a staging preview.
   *
   * It is a display barrier, not security: the value ends up in the bundle.
   * Anything that must actually be private needs HTTP Basic Auth at the web
   * server.
   */
  readonly VITE_ACCESS_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
