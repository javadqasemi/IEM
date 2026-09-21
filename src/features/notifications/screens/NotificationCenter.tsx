import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui/primitives";
import { Select } from "@/shared/ui/forms";
import { Pagination } from "@/shared/ui/navigation";
import { useToast } from "@/shared/ui/feedback";
import { cn } from "@/shared/utils/cn";
import { Link, navigate, useRoute } from "@/core/router";
import {
  useNotificationMutations,
  useNotifications,
} from "../hooks/useNotifications";
import { SEVERITY_OPTIONS } from "../service";
import { NotificationItem } from "./NotificationItem";
import { NotificationPreferences } from "./NotificationPreferences";
import type { Notification } from "../types";

/**
 * The notification centre.
 *
 * ---
 *
 * **Two tabs, and the second is the personal preferences** rather than a
 * separate page under Einstellungen. That is where somebody goes when they
 * want *fewer* of these — from the thing that is bothering them, not from a
 * settings workspace two clicks away in another part of the rail. The firm's
 * configuration is the other screen and lives in Einstellungen, because it is
 * administration rather than a personal choice; the brief is explicit that
 * the two must not be merged, and this is what keeping them apart looks like
 * in navigation rather than only in the API.
 *
 * **Unread / Alle as tabs, not a filter chip.** "What is waiting for me" is
 * the question this page exists to answer and it deserves to be the default
 * view, not a state somebody has to select. The severity and type filters are
 * a `Select` pair because they are refinements of whichever tab is open.
 *
 * The tab is in the URL — `/benachrichtigungen/einstellungen` — so it is a
 * link somebody can send and a place a reload returns to, which is the same
 * argument `/projekte/:id/:tab` makes.
 */
export function NotificationCenter() {
  const route = useRoute();
  const tab = route.path.endsWith("/einstellungen") ? "settings" : "inbox";

  return (
    <>
      <PageHeader
        eyebrow="Benachrichtigungen"
        title="Benachrichtigungen"
        description="Was Ihr Konto und Ihre Arbeit betrifft — Freigaben, Bewerbungen, Sicherheitsänderungen. Was hier steht, hat jemand oder etwas anderes ausgelöst."
      />

      {/*
        Anchors in a `<nav>`, deliberately **not** `role="tab"`.

        They change the route rather than swapping a panel, and telling a
        screen reader otherwise would describe something that does not
        happen — the rule `Tabs` states for itself and `MeetingDetail`
        follows.
      */}
      <nav aria-label="Bereiche" className="-mx-1 flex gap-1 border-b border-line px-1">
        {(
          [
            { slug: "", label: "Posteingang", id: "inbox" },
            { slug: "/einstellungen", label: "Einstellungen", id: "settings" },
          ] as const
        ).map((entry) => (
          <Link
            key={entry.id}
            to={`/benachrichtigungen${entry.slug}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
              tab === entry.id
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "settings" ? <NotificationPreferences /> : <Inbox />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Inbox() {
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);

  const list = useNotifications({ unread: unreadOnly, severity, page, perPage: 20 });
  const { markRead, markAllRead } = useNotificationMutations();

  function open(notification: Notification) {
    if (!notification.read) void markRead(notification.id, true);
    if (notification.link) navigate(notification.link.replace(/^#/, ""));
  }

  if (list.error) return <ErrorState message={list.error} onRetry={list.refetch} />;

  const items = list.data?.items ?? [];
  const unread = list.data?.unread ?? 0;

  return (
    <Card
      title={unreadOnly ? "Ungelesen" : "Alle Benachrichtigungen"}
      description={
        unread > 0
          ? `${unread} ungelesen. Was Sie öffnen, wird als gelesen markiert.`
          : "Nichts Ungelesenes."
      }
      action={
        unread > 0 ? (
          <Button
            variant="secondary"
            onClick={async () => {
              const marked = await markAllRead();
              toast.success(
                "Als gelesen markiert",
                `${marked} Benachrichtigung(en).`,
              );
            }}
          >
            Alle als gelesen
          </Button>
        ) : null
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {/*
          Two buttons rather than a `Select`: there are exactly two states,
          one of them is the default, and a dropdown to choose between two
          things is a click more than a toggle for no information gained.
        */}
        <div className="flex gap-1" role="group" aria-label="Filter">
          <Button
            size="sm"
            variant={unreadOnly ? "subtle" : "ghost"}
            aria-pressed={unreadOnly}
            onClick={() => {
              setUnreadOnly(true);
              setPage(1);
            }}
          >
            Ungelesen
          </Button>
          <Button
            size="sm"
            variant={!unreadOnly ? "subtle" : "ghost"}
            aria-pressed={!unreadOnly}
            onClick={() => {
              setUnreadOnly(false);
              setPage(1);
            }}
          >
            Alle
          </Button>
        </div>

        <Select
          aria-label="Nach Dringlichkeit filtern"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(1);
          }}
          placeholder="Alle Dringlichkeiten"
          options={SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          className="w-auto"
        />
      </div>

      {list.loading && !list.data ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : !items.length ? (
        <div className="p-6">
          <EmptyState
            title={unreadOnly ? "Nichts Ungelesenes" : "Noch keine Benachrichtigungen"}
            description={
              unreadOnly
                ? "Alles gelesen. Unter „Alle“ steht, was vorher da war."
                : "Sobald etwas Ihr Konto oder Ihre Arbeit betrifft, erscheint es hier."
            }
          />
        </div>
      ) : (
        <>
          {/*
            Labelled, because a list is announced as "list, 20 items" with
            no indication of what the items are — and because the severity
            filter above it renders `<option>` elements with the same words
            the badges use, so an unlabelled list is ambiguous to a test
            locator for the same reason it is to a reader tabbing through.
          */}
          <ul aria-label="Benachrichtigungen" className="divide-y divide-line">
            {items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onOpen={open}
                onToggleRead={(n) => void markRead(n.id, !n.read)}
              />
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3">
            <Pagination
              page={list.data?.page ?? 1}
              pages={list.data?.pages ?? 1}
              total={list.data?.total ?? 0}
              perPage={20}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </Card>
  );
}
