/**
 * Primitives — the components that assume nothing.
 *
 * A primitive takes props and renders. It does not fetch, does not know what a
 * project or a content entry is, and does not compose other families. Anything
 * that assumes a *shape* of data is a composition and lives in `../data`;
 * anything that assumes a *meaning* is domain and lives in `entities/`.
 */
export { Button, Spinner } from "./Button";
export { Skeleton, SkeletonTable, EmptyState, ErrorState } from "./states";
export { Card, PageHeader } from "./Card";
export { Badge, type BadgeTone } from "./Badge";
