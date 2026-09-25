/**
 * Feedback — what the application says back.
 *
 * `ToastProvider` is for the person who just acted; anything owed to someone
 * who is *not* looking is a notification and belongs in its own domain
 * (`docs/data-model.md` §3.23), not here.
 */
export { ToastProvider, useToast, useToastClearance, type Toast, type ToastKind } from "./toast";
export { ErrorBoundary, RootErrorBoundary } from "./ErrorBoundary";
/**
 * `ModulePlaceholder` is feedback rather than a primitive: it tells the reader
 * something about the *state of the application*, which is what this family is
 * for. A primitive assumes nothing, and this one assumes there is a module.
 */
export { ModulePlaceholder, type ModuleStatus } from "./ModulePlaceholder";
export { ConflictNotice, CONFLICT_BLOCKS_SAVE } from "./ConflictNotice";
export { Callout, type CalloutTone } from "./Callout";
export { VerificationMotion, type VerificationMotionStatus } from "./VerificationMotion";
export {
  verificationState,
  prefersReducedMotion,
  SUCCESS_HOLD_MS,
  REDUCED_SUCCESS_HOLD_MS,
  type VerificationPhase,
  type VerificationState,
} from "./verification";
