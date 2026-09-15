import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Transient feedback.
 *
 * The public site deliberately has none — every message there is inline, next
 * to the thing it is about. The dashboard needs them for a different reason:
 * an action confirmed here ("Veröffentlicht — Version 12") often has no place
 * on screen to be inline *with*, because the thing it acted on is a whole
 * site.
 *
 * Errors do not auto-dismiss. A success the reader missed costs nothing; a
 * failure they missed means they believe something saved that did not.
 */

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Extra lines — the publish warnings use this. */
  details?: string[];
};

type ToastApi = {
  push: (toast: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...toast, id }]);
      // Errors stay until dismissed — see the note above.
      if (toast.kind !== "error") {
        timers.current.set(id, window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ kind: "success", title, description }),
      error: (title, description) => push({ kind: "error", title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* `aria-live="polite"` and not `assertive`, even for errors: an error
          here follows an action the reader just took, so it is expected rather
          than an interruption, and assertive would cut off whatever a screen
          reader was mid-sentence on. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const accents: Record<ToastKind, string> = {
    success: "ring-disc-energy/40",
    error: "ring-brand-bronze/50",
    info: "ring-line",
  };
  const dots: Record<ToastKind, string> = {
    success: "bg-disc-energy",
    error: "bg-brand-bronze",
    info: "bg-brand-blue",
  };

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg bg-surface p-4 shadow-card ring-1",
        accents[toast.kind],
      )}
    >
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dots[toast.kind])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[14px] font-medium leading-tight text-ink">{toast.title}</p>
        {toast.description ? (
          <p className="text-[13px] leading-snug text-muted">{toast.description}</p>
        ) : null}
        {toast.details?.length ? (
          <ul className="mt-1 flex flex-col gap-1">
            {toast.details.map((d) => (
              <li key={d} className="flex gap-2 text-[12px] leading-snug text-muted">
                <span aria-hidden className="mt-[0.55em] h-px w-2 shrink-0 bg-line-strong" />
                <span className="min-w-0">{d}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Meldung schliessen"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="M4 4 L12 12 M12 4 L4 12" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast muss innerhalb von <ToastProvider> verwendet werden.");
  return ctx;
}
