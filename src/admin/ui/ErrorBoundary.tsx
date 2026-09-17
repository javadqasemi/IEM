import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ErrorState } from "./primitives";

/**
 * Catches a render-time exception and shows it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which is how a single bad property reference turns into a blank white page
 * with no console context for whoever reports it. That is exactly what
 * happened here: the API's envelope handed the content editor an entry payload
 * instead of an entry, `entry.versions` was `undefined`, and the dashboard
 * disappeared. The data bug is fixed; this makes sure the *class* of failure
 * can never again present as "the page is empty".
 *
 * Deliberately not a retry loop. A render that threw once will throw again on
 * the same input, so the primary action is navigating away — which is why this
 * sits *inside* the shell in `App.tsx`, keyed on the route, leaving the rail
 * usable. Remounting on a key change is also what clears the error: there is no
 * reset method to call and forget.
 *
 * It does not catch what React cannot see from render: event handlers, async
 * callbacks and effects that reject. Those surface through `useAsync` and the
 * toast layer instead.
 */

type Props = {
  children: ReactNode;
  /** Shown above the message. Defaults to the generic wording. */
  title?: string;
  /** Rendered instead of the reload button — a link back, usually. */
  action?: ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the part that says *where*, and React only offers
    // it here. Without it the console shows a minified frame and nothing else.
    console.error("[admin] Render abgebrochen:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ErrorState
        title={this.props.title ?? "Diese Ansicht konnte nicht dargestellt werden."}
        // The raw message, not a paraphrase: whoever reports this needs
        // something a developer can search for.
        message={`${error.message} — Die übrigen Bereiche funktionieren weiterhin. Bitte melden Sie diese Meldung.`}
      />
    );
  }
}

/**
 * The same boundary for the outermost mount, where there is no shell to fall
 * back into and a reload is genuinely the only move.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] Anwendung abgebrochen:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-10">
        <ErrorState
          title="Das Dashboard konnte nicht geladen werden."
          message={error.message}
          onRetry={() => window.location.reload()}
        />
        <div className="pt-4">
          <Button variant="ghost" size="sm" href="#/">
            Zur Übersicht
          </Button>
        </div>
      </div>
    );
  }
}
