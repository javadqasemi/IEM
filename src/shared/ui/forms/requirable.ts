/**
 * Which controls may carry `aria-required` (P1C).
 *
 * `Field` marks the control inside a `<Form>` as required unless the field says
 * `optional` — the convention this dashboard has always *displayed* ("(optional)"
 * on the exceptions) finally reaching assistive technology. But `aria-required`
 * is only allowed on form controls: stamped on a component that renders a
 * `<div>`, it is an axe violation (`aria-allowed-attr`, serious) on a screen
 * nobody changed. So the attribute goes only to elements that are known to
 * pass it to a real input — native tags by name, and components that register
 * themselves here beside their definition.
 */
const REQUIRABLE_COMPONENTS = new WeakSet<object>();
const REQUIRABLE_TAGS = new Set(["input", "select", "textarea"]);

export function markRequirable<T extends object>(component: T): T {
  REQUIRABLE_COMPONENTS.add(component);
  return component;
}

export function isRequirable(type: unknown): boolean {
  if (typeof type === "string") return REQUIRABLE_TAGS.has(type);
  return typeof type === "object" || typeof type === "function"
    ? REQUIRABLE_COMPONENTS.has(type as object)
    : false;
}
