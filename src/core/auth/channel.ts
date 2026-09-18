/**
 * Sign-in and sign-out, told to the other tabs.
 *
 * The session is **one thing in a browser, rendered in several places.** The
 * refresh cookie is shared by every tab on the origin, so signing out in one of
 * them revokes the credential the others are relying on — but nothing told them,
 * so they carried on drawing a dashboard for a session that no longer existed
 * until their in-memory access token expired, up to fifteen minutes later. The
 * first thing the reader did then failed. The same in reverse: signing in as
 * somebody else in a second tab left the first one showing the previous user's
 * name over the *new* user's data, because the data comes from the cookie and
 * the name came from a fetch made before the switch.
 *
 * `BroadcastChannel` is the whole mechanism, and it carries no credential — only
 * the fact that something changed. Each tab then asks the server what it should
 * now be showing, which keeps the token exchange where it already is.
 *
 * It is absent in old browsers and in the server-render smoke test, so every
 * call here is guarded and a missing channel degrades to what the dashboard did
 * before: each tab discovers the change on its next request.
 */

export type AuthBroadcast =
  /** Somebody signed in on this origin. Re-read the session, whoever you were. */
  | { type: "signed-in" }
  /** Somebody signed out. The shared cookie is gone; stop pretending. */
  | { type: "signed-out" };

const CHANNEL = "iem.auth";

function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    // Some privacy modes throw on construction rather than omitting the API.
    return null;
  }
}

/**
 * Tells the other tabs, and never this one.
 *
 * `BroadcastChannel` does not deliver a message to the context that posted it,
 * which is what keeps the subscriber below from having to recognise its own
 * echo — and is why publishing is safe to do inside the very handler that
 * changed the state.
 */
export function publishAuthChange(message: AuthBroadcast): void {
  const channel = open();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
}

/** Returns an unsubscribe function, or a no-op where there is no channel. */
export function subscribeAuthChanges(handler: (message: AuthBroadcast) => void): () => void {
  const channel = open();
  if (!channel) return () => {};

  const listener = (event: MessageEvent<AuthBroadcast>) => {
    const message = event.data;
    // Anything else on this channel is not ours to act on. The check is cheap
    // and the alternative is an extension or a future feature signing the user
    // out by posting a string.
    if (message?.type === "signed-in" || message?.type === "signed-out") handler(message);
  };

  channel.addEventListener("message", listener);
  return () => {
    channel.removeEventListener("message", listener);
    channel.close();
  };
}
