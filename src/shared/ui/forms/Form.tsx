import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils/cn";
import { Callout } from "@/shared/ui/feedback/Callout";

/**
 * Whether a `Field` is inside a `<Form>` — which is what decides that a field
 * without `optional` is *required* (P1C). A filter bar or a read-only panel
 * uses `Field` for its label too, and marking a search box "required" there
 * would be wrong; a form is the context in which the convention holds.
 */
const InForm = createContext(false);
export const useInForm = () => useContext(InForm);

/** Dispatched by `Modal` on its body's form when the footer's primary action is pressed. */
export const SUBMIT_ATTEMPT = "iem:submit-attempt";

/**
 * The frame around a form: the element, its sections, its actions.
 *
 * A real `<form>` with a submit handler rather than a `<div>` with a button,
 * and that is not pedantry: it is what makes Enter submit, what lets a browser
 * offer to save a password, and what a screen reader announces as a form. The
 * dashboard had none — every "form" was a `<div>` and every save was an
 * `onClick`, so Enter did nothing in fifteen places.
 *
 * ---
 *
 * **The interaction standard (P1C) in one place.** Three kinds of form, and the
 * difference is what happens after the submit:
 *
 * | Kind | Example | Frame | Save |
 * | --- | --- | --- | --- |
 * | Persistent page form | Unternehmen, Einstellungen | `Form` + `FormSection`s | sticky `SaveBar` (dirty · saving · saved · failed · conflict) + `useUnsavedGuard` |
 * | Dialog form | create, edit, one-shot change | `Modal` › `Form` | footer: `Abbrechen` (ghost) · primary verb, rightmost |
 * | Transient filter form | Audit-Log, lists | `FilterBar` / inputs | none — a query is not a record |
 *
 * Fields are required unless marked `optional`; the error that belongs to no
 * field is a `Callout` above the fields; after a failed submit, focus moves to
 * the first invalid field.
 */
export function Form({
  onSubmit,
  children,
  className,
  error,
  id,
}: {
  onSubmit: () => void | Promise<unknown>;
  children: ReactNode;
  className?: string;
  /** The message that belongs to no field. Rendered above the fields. */
  error?: string | null;
  /** So a button outside the element — a dialog footer — can submit it with `form=`. */
  id?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);

  /*
    Focus the first invalid field after a failed submit — once.

    Neither the validator nor the server answer synchronously, and the errors
    land in state owned by whoever renders this form (a `useForm`, or a
    dialog's own `useState`). So a submit *arms* the move and the first render
    that shows an invalid field *spends* it. Typing disarms it: the reader who
    has already started correcting a field must not be yanked to another one
    by a late server answer.
  */
  const pendingFocus = useRef(false);

  /*
    A dialog's primary button sits in the footer, outside this element, so
    pressing it fires no `submit` here. `Modal` dispatches this event on the
    form in its body instead — see `SUBMIT_ATTEMPT` there.
  */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const arm = () => {
      pendingFocus.current = true;
    };
    el.addEventListener(SUBMIT_ATTEMPT, arm);
    return () => el.removeEventListener(SUBMIT_ATTEMPT, arm);
  }, []);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!invalid) return;
    pendingFocus.current = false;
    invalid.focus();
  });

  const handle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    pendingFocus.current = true;
    void onSubmit();
  };

  return (
    <InForm.Provider value={true}>
      <form
        ref={ref}
        id={id}
        onSubmit={handle}
        onInput={() => {
          pendingFocus.current = false;
        }}
        noValidate
        className={cn("flex flex-col gap-6", className)}
      >
        {/*
          `noValidate` because the messages are ours.

          The browser's own validation bubbles are untranslatable, disappear on
          the next click, and are positioned by the browser — and the server's
          rules are the authoritative ones anyway, so a form that passed the
          browser's check and failed the server's would show two different kinds
          of error for the same field.
        */}
        {error ? (
          <Callout tone="danger" announce>
            <p className="font-medium text-ink">{error}</p>
          </Callout>
        ) : null}
        {children}
      </form>
    </InForm.Provider>
  );
}

/**
 * A titled group of fields.
 *
 * `<fieldset>` + `<legend>` when titled, so the group's name is announced with
 * each field inside it — "Adresse, Strasse" rather than a bare "Strasse". The
 * legend is styled as the section heading the page already used; `level`
 * decides whether it is also an `h2`/`h3` for the page outline, because a
 * section inside a dialog titled `h2` sits one level lower than a section on a
 * page titled `h1`.
 */
export function FormSection({
  title,
  description,
  children,
  className,
  level = 3,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", className)}>
      {title ? (
        <legend className="mb-4 flex flex-col gap-1 p-0">
          <Heading className="font-display text-[15px] font-semibold text-ink">{title}</Heading>
          {description ? (
            <span className="block text-[13px] font-normal leading-snug text-muted">{description}</span>
          ) : null}
        </legend>
      ) : null}
      <div className="flex flex-col gap-5">{children}</div>
    </fieldset>
  );
}

/**
 * The row of buttons at the foot of a form.
 *
 * Right-aligned, primary last — the platform convention on Windows, which is
 * what this office runs. The submit button must be `type="submit"` for Enter
 * to reach it, which is the one thing a caller can get wrong here.
 */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-1", className)}>
      {children}
    </div>
  );
}
