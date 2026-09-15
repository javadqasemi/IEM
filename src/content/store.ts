/**
 * The live content store.
 *
 * The public site used to import its data as module constants. It now reads
 * from here, and this is the only place that decides *which* version of the
 * content is current.
 *
 * **Why an external store rather than a React context.** Three things need the
 * content and only one of them is inside a component tree: the page itself,
 * the search index in `@/lib/search` (built at module scope), and the job
 * advert at `stelle.html`, which mounts a second React root. A context would
 * have to be threaded through all three and would still not help the search
 * index. `useSyncExternalStore` gives the components a subscription and
 * `getContent()` gives everything else a plain read, off one source of truth.
 *
 * **Why the first paint never waits.** The store starts already full, seeded
 * with `defaultContent` — the copy the static build shipped. So the first
 * frame is byte-for-byte what it was before the CMS existed: no skeleton, no
 * spinner, no layout shift. `hydrate()` then fetches the published snapshot in
 * the background and, only if it is newer, swaps it in. If the API is slow,
 * down, or not deployed at all, the page simply keeps rendering the snapshot
 * and says nothing about it.
 */

import { useSyncExternalStore } from "react";
import { defaultContent } from "./defaults";
import type { PublishedSnapshot, SiteContent } from "./schema";

/** `0` is the build-time seed; the server assigns 1, 2, 3 … on publish. */
const SEED_VERSION = 0;

type State = {
  content: SiteContent;
  version: number;
  /** Set once a hydrate attempt has finished, either way. */
  hydrated: boolean;
};

let state: State = {
  content: defaultContent,
  version: SEED_VERSION,
  hydrated: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The current content, for code that is not a React component. */
export function getContent(): SiteContent {
  return state.content;
}

export function getVersion(): number {
  return state.version;
}

function getState(): State {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The content, as a hook. Re-renders the calling component when a newer
 * snapshot arrives.
 *
 * `getState` returns the same object identity until something actually
 * changes, which is what `useSyncExternalStore` needs to avoid an infinite
 * render loop — don't be tempted to build the state object inline.
 */
export function useContent(): SiteContent {
  return useSyncExternalStore(subscribe, getState, getState).content;
}

/** Whether a hydrate attempt has completed. Only the dashboard preview uses it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getState, getState).hydrated;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Replaces the content.
 *
 * Used by `hydrate()` and by the dashboard's live preview, which renders the
 * real page components against unpublished draft content.
 */
export function setContent(content: SiteContent, version = state.version + 1) {
  state = { content, version, hydrated: true };
  emit();
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

/**
 * The published-content endpoint. Empty by default, which disables hydration
 * entirely — that is the correct behaviour for a build with no API behind it,
 * and it is why the static site keeps working unchanged.
 */
const API = import.meta.env.VITE_CMS_API ?? "";

/**
 * Fetches the published snapshot and swaps it in if it is newer than what is
 * already showing.
 *
 * Deliberately quiet: a failure here is not something the visitor can act on,
 * and the page is already rendering valid content. It is logged at `debug` so
 * it can be found in a console session without shouting in production.
 *
 * Called after first paint (see `main.tsx`), never during it.
 */
export async function hydrate(signal?: AbortSignal): Promise<void> {
  if (!API) {
    state = { ...state, hydrated: true };
    emit();
    return;
  }

  try {
    const res = await fetch(`${API}/api/v1/content/published`, {
      signal,
      headers: { accept: "application/json" },
      // The snapshot is small and changes on publish; let the CDN hold it but
      // always revalidate, so a publish is live on the next navigation.
      cache: "no-cache",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const snapshot = (await res.json()) as PublishedSnapshot;
    if (!snapshot?.content || typeof snapshot.version !== "number") {
      throw new Error("malformed snapshot");
    }
    // Strictly newer. An equal version means the build already embeds it, and
    // re-setting would re-render the page for nothing.
    if (snapshot.version > state.version) {
      setContent(snapshot.content, snapshot.version);
      return;
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    console.debug("[iem] content hydrate skipped:", err);
  }

  state = { ...state, hydrated: true };
  emit();
}
