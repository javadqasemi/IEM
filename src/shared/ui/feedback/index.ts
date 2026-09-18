/**
 * Feedback — what the application says back.
 *
 * `ToastProvider` is for the person who just acted; anything owed to someone
 * who is *not* looking is a notification and belongs in its own domain
 * (`docs/data-model.md` §3.23), not here.
 */
export { ToastProvider, useToast, type Toast, type ToastKind } from "./toast";
export { ErrorBoundary, RootErrorBoundary } from "./ErrorBoundary";
