/**
 * Overlays — anything that renders above the page.
 *
 * Every one of them is a native `<dialog>` or a real popover, so the focus
 * trap, the top layer and Esc come from the platform rather than from a
 * hand-written key handler that will be subtly wrong.
 */
export { Modal, ConfirmDialog } from "./Modal";
export { ActionMenu, type ActionMenuItem } from "./ActionMenu";
export { RecordActions } from "./RecordActions";
export {
  StatusTransitionDialog,
  type TransitionReason,
  type TransitionState,
  type TransitionTarget,
} from "./StatusTransitionDialog";
export { ReauthenticationDialog } from "./ReauthenticationDialog";
export { Drawer } from "./Drawer";
