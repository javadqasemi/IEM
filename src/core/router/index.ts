export {
  Link,
  match,
  fillPattern,
  navigate,
  useMatch,
  useRoute,
  setNavigationBlocker,
  useScrollReset,
  type RouteLocation,
} from "./router";

export { buildTrail, type Crumb, type CrumbRoute } from "./breadcrumbs";

export {
  RouteMetaProvider,
  useRouteMeta,
  usePageTitle,
  usePageActions,
  useClearPageMeta,
  type PageAction,
} from "./RouteMeta";
