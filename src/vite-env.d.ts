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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
