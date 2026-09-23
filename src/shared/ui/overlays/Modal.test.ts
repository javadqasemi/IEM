import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { pressPrimaryOnEnter } from "./Modal";

/**
 * UX-12: Enter did nothing in twenty-five dialogs, because their buttons sit in
 * a footer outside the `<form>`. `pressPrimaryOnEnter` is the whole fix, so it
 * is tested as a rule: which key, which field, which button — and, as much as
 * anything, which buttons it must **never** press.
 *
 * Plain objects rather than a DOM: the function reads a handful of properties
 * (`tagName`, `type`, `dataset.variant`, `disabled`, `aria-disabled`) and the
 * test builds exactly those. The browser half — that the event really reaches
 * the dialog and the click really submits — is `e2e/p1a-ux.spec.ts`.
 */

type FakeButton = {
  dataset: { variant: string };
  disabled: boolean;
  ariaDisabled?: boolean;
  click: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getAttribute: (name: string) => string | null;
};

function button(variant: string, opts: { disabled?: boolean; ariaDisabled?: boolean } = {}): FakeButton {
  return {
    dataset: { variant },
    disabled: Boolean(opts.disabled),
    ariaDisabled: opts.ariaDisabled,
    click: vi.fn(),
    focus: vi.fn(),
    getAttribute(name) {
      return name === "aria-disabled" && this.ariaDisabled ? "true" : null;
    },
  };
}

function footer(...buttons: FakeButton[]) {
  return {
    // The real selector excludes `ghost`; the fake does the same.
    querySelectorAll: () => buttons.filter((b) => b.dataset.variant !== "ghost"),
  } as unknown as HTMLElement;
}

function enter(
  target: Partial<{ tagName: string; type: string; expanded: boolean; form: unknown }>,
  mods: Partial<{ shiftKey: boolean; key: string; isComposing: boolean }> = {},
) {
  const event = {
    key: mods.key ?? "Enter",
    shiftKey: Boolean(mods.shiftKey),
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: Boolean(mods.isComposing) },
    target: {
      tagName: target.tagName ?? "INPUT",
      type: target.type ?? "text",
      form: target.form ?? null,
      getAttribute: (name: string) =>
        name === "aria-expanded" && target.expanded ? "true" : null,
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  return event as unknown as KeyboardEvent<HTMLElement> & { defaultPrevented: boolean };
}

describe("Enter in a dialog presses its primary action", () => {
  it("clicks the last non-ghost button — the default-variant save most dialogs use", () => {
    const cancel = button("ghost");
    const save = button("secondary");
    const e = enter({});
    pressPrimaryOnEnter(e, footer(cancel, save));
    expect(save.click).toHaveBeenCalledOnce();
    expect(cancel.click).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("works from a date or number field too", () => {
    for (const type of ["email", "number", "date", "datetime-local", "password"]) {
      const save = button("primary");
      pressPrimaryOnEnter(enter({ type }), footer(save));
      expect(save.click).toHaveBeenCalledOnce();
    }
  });
});

describe("and never where it should not", () => {
  it("never presses a destructive action — not even by falling back to an earlier button", () => {
    const back = button("secondary");
    const remove = button("danger");
    pressPrimaryOnEnter(enter({}), footer(back, remove));
    expect(remove.click).not.toHaveBeenCalled();
    expect(back.click).not.toHaveBeenCalled();
  });

  it("leaves a textarea its new line", () => {
    const save = button("primary");
    pressPrimaryOnEnter(enter({ tagName: "TEXTAREA", type: "textarea" }), footer(save));
    expect(save.click).not.toHaveBeenCalled();
  });

  it("leaves a checkbox, a select and an open listbox alone", () => {
    const save = button("primary");
    pressPrimaryOnEnter(enter({ type: "checkbox" }), footer(save));
    pressPrimaryOnEnter(enter({ tagName: "SELECT", type: "select-one" }), footer(save));
    pressPrimaryOnEnter(enter({ expanded: true }), footer(save));
    expect(save.click).not.toHaveBeenCalled();
  });

  it("ignores Shift+Enter and an IME composition", () => {
    const save = button("primary");
    pressPrimaryOnEnter(enter({}, { shiftKey: true }), footer(save));
    pressPrimaryOnEnter(enter({}, { isComposing: true }), footer(save));
    expect(save.click).not.toHaveBeenCalled();
  });

  it("leaves a form with its own submit button to the browser", () => {
    const save = button("primary");
    const form = { elements: [{ tagName: "BUTTON", type: "submit" }] };
    pressPrimaryOnEnter(enter({ form }), footer(save));
    expect(save.click).not.toHaveBeenCalled();
  });

  it("does not press a disabled button", () => {
    const save = button("primary", { disabled: true });
    const e = enter({});
    pressPrimaryOnEnter(e, footer(save));
    expect(save.click).not.toHaveBeenCalled();
    // …and still swallows the Enter, so the browser does not submit behind it.
    expect(e.defaultPrevented).toBe(true);
  });

  it("moves focus to a button blocked with a reason, where the reason is announced", () => {
    const save = button("primary", { ariaDisabled: true });
    pressPrimaryOnEnter(enter({}), footer(save));
    expect(save.click).not.toHaveBeenCalled();
    expect(save.focus).toHaveBeenCalledOnce();
  });
});
