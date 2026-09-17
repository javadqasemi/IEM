import type { EntryRow } from "./api";

/**
 * Finding the content entry behind a spot on the live site.
 *
 * The preview is the real website in an iframe. Nothing in it knows it is
 * being edited — the site carries no `data-cms` markers, and adding them would
 * mean touching every component of the public build for the benefit of a
 * dashboard feature. So the link is rebuilt here, from the entries the
 * dashboard already fetches.
 *
 * **Match on `publishedData`, not `data`.** The frame shows the published
 * site, so the words on the page are the published ones. Indexing drafts would
 * mean looking up text that is not there — and an entry edited but not yet
 * released would silently stop being findable, which is the worst kind of
 * failure for a switch whose whole point is to be quick.
 *
 * **A string claimed by two entries is dropped.** "Colin Tschudin" is both a
 * team member and a sponsored athlete; switching off the wrong one is worse
 * than the hover finding nothing, so ambiguity resolves to nothing at all.
 *
 * This half is a pure function of data, which is what makes it testable
 * against the real document without a browser.
 */

export type EntryHit = {
  entryId: string;
  typeKey: string;
  /** What to call it on the switch — the entry's own title, else its slug. */
  label: string;
};

/** Strings shorter than this identify nothing — "41", "2", "Ja". */
const MIN_INDEXED = 4;

/** Trim and collapse runs of whitespace, which is all the DOM adds. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The first field that reads like a title, falling back to the slug. */
function labelFor(entry: EntryRow): string {
  const data = (entry.publishedData ?? entry.data) as Record<string, unknown>;
  for (const field of ["title", "name", "label", "objekt", "heading", "headline"]) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return entry.key;
}

/**
 * Every string the published entries contain, mapped to the entry that owns it.
 *
 * Only collection members are indexed. A singleton has no meaningful switch —
 * hiding the hero would take the headline off the front page and leave a
 * section with nothing in it, and `assertComplete` would refuse the publish
 * anyway. Callers pass the collection entries; this trusts them.
 */
export function buildEntryIndex(entries: EntryRow[]): Map<string, EntryHit> {
  const found = new Map<string, EntryHit | null>();

  const walk = (node: unknown, hit: EntryHit) => {
    if (typeof node === "string") {
      const key = normalise(node);
      if (key.length < MIN_INDEXED) return;
      const seen = found.get(key);
      if (seen === undefined) {
        found.set(key, hit);
      } else if (seen && seen.entryId !== hit.entryId) {
        // Claimed twice. `null` is a tombstone, so a third sighting cannot
        // resurrect it.
        found.set(key, null);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, hit);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) walk(value, hit);
    }
  };

  for (const entry of entries) {
    if (entry.deletedAt) continue;
    // Published content only: see the note at the top on why drafts would make
    // the switch disappear exactly when someone reaches for it.
    const content = entry.publishedData;
    if (!content) continue;
    walk(content, { entryId: entry.id, typeKey: entry.typeKey, label: labelFor(entry) });
  }

  const index = new Map<string, EntryHit>();
  for (const [key, value] of found) if (value) index.set(key, value);
  return index;
}

/** The entry whose published content contains exactly this text, if one does. */
export function resolveFromText(index: Map<string, EntryHit>, text: string): EntryHit | null {
  return index.get(normalise(text)) ?? null;
}

/**
 * The entry behind one element of the live page.
 *
 * Walks up from the element: the exact text under the cursor first, then its
 * parents'. That order matters — a project card's title resolves to the
 * project, and so does the card around it, but starting at the leaf means the
 * switch lands on the smallest thing that is still a whole entry.
 *
 * `MAX_CLIMB` stops before the containers whose text is half the page. Those
 * never match the index anyway, and walking the full ancestor chain on every
 * `mouseover` is work for nothing.
 */
const MAX_CLIMB = 6;

export function resolveElement(
  el: Element,
  index: Map<string, EntryHit>,
): { hit: EntryHit; element: Element } | null {
  let node: Element | null = el;
  for (let i = 0; node && i < MAX_CLIMB; i++, node = node.parentElement) {
    const text = node.textContent ?? "";
    if (!text.trim()) continue;
    const hit = resolveFromText(index, text);
    if (hit) return { hit, element: node };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The switch inside the frame                                         */
/* ------------------------------------------------------------------ */

const STYLE_ID = "iem-visibility-switch";

/**
 * Where the switch sits, in viewport coordinates.
 *
 * Pure, because this is the part that was wrong: the first version anchored
 * the control at the element's own `left` with no bound at all, so a long
 * entry name on a narrow frame pushed it clean out of the viewport and gave
 * the page a horizontal scrollbar on the way.
 *
 * Three rules. **Above the element when there is room, inside its top edge
 * when there is not** — an element at the very top of the document would
 * otherwise land at a negative offset, drawn off screen. **Then clamped to the
 * top anyway**, because tucking inside is not enough on its own: an element
 * scrolled halfway out of view has a negative `top` of its own, and
 * `top + pad` is still above the fold. That case only showed up under a sweep
 * of inputs, which is why the sweep is in the tests. **Never outside the
 * viewport horizontally**, and when the control is wider than the viewport
 * itself the left pad wins, so it is clipped on the right rather than starting
 * off screen on the left.
 */
export function switchPosition(
  rect: { top: number; left: number },
  size: { width: number; height: number },
  viewport: { width: number },
  pad = 8,
): { top: number; left: number } {
  const above = rect.top - size.height - 6;
  const top = Math.max(pad, above < pad ? rect.top + pad : above);
  const right = viewport.width - size.width - pad;
  const left = Math.max(pad, Math.min(rect.left, right));
  return { top, left };
}

/**
 * Puts an on/off switch on whatever the cursor is over.
 *
 * Same-origin, so the dashboard reaches into `contentDocument` directly — no
 * `postMessage` channel and nothing added to the public build.
 *
 * **The site stays usable.** Only the injected button takes clicks; every
 * other event passes through untouched, so links still navigate and the
 * Bewerbung dialog still opens. That is why there is no mode to switch on
 * first: the overlay costs nothing when it is ignored.
 *
 * The switch is positioned from the element's rect in page coordinates, so it
 * travels with the content when the frame scrolls rather than floating over
 * whatever happens to be underneath.
 */
export function attachVisibilitySwitches(
  doc: Document,
  opts: {
    index: Map<string, EntryHit>;
    isHidden: (entryId: string) => boolean;
    onToggle: (hit: EntryHit, hidden: boolean) => void;
  },
): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .iem-vis-on { outline: 2px solid #CBB87F !important; outline-offset: 2px; }
    .iem-vis-off {
      outline: 2px dashed #A2542A !important; outline-offset: 2px; opacity: .45;
    }

    #${STYLE_ID}-btn {
      position: absolute; z-index: 2147483647;
      display: inline-flex; align-items: center; gap: 8px;
      margin: 0; padding: 6px 10px 6px 8px;
      border: 1px solid rgba(255,255,255,.14); border-radius: 999px;
      background: #00224F; color: #fff; cursor: pointer;
      font: 500 12px/1 "IBM Plex Sans", system-ui, sans-serif;
      box-shadow: 0 4px 14px -4px rgba(0,17,40,.55);
    }
    #${STYLE_ID}-btn[hidden] { display: none; }
    #${STYLE_ID}-btn:focus-visible { outline: 2px solid #CBB87F; outline-offset: 2px; }

    /* A real switch: a track the knob travels along, so the control says what
       a click will do instead of only what the state is. */
    #${STYLE_ID}-btn .track {
      position: relative; flex: 0 0 auto;
      width: 26px; height: 15px; border-radius: 999px;
      background: #CBB87F; transition: background 140ms ease;
    }
    #${STYLE_ID}-btn .knob {
      position: absolute; top: 2px; left: 13px;
      width: 11px; height: 11px; border-radius: 999px; background: #00224F;
      transition: left 140ms ease, background 140ms ease;
    }
    #${STYLE_ID}-btn[data-off] { background: #7A3B1C; }
    #${STYLE_ID}-btn[data-off] .track { background: rgba(255,255,255,.3); }
    #${STYLE_ID}-btn[data-off] .knob { left: 2px; background: #fff; }

    /* The name confirms *which* entry is about to change — entries nest, and
       a bare switch over a project card could plausibly mean the card, the
       grid or the section. It is the first thing to go when there is no room
       for it; the accessible name carries it either way. */
    #${STYLE_ID}-btn .name {
      max-width: min(15rem, calc(100vw - 7rem));
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    @media (max-width: 30rem) {
      #${STYLE_ID}-btn .name { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      #${STYLE_ID}-btn .track, #${STYLE_ID}-btn .knob { transition: none; }
    }
  `;
  doc.head.appendChild(style);

  const btn = doc.createElement("button");
  btn.id = `${STYLE_ID}-btn`;
  btn.type = "button";
  btn.setAttribute("role", "switch");
  btn.hidden = true;
  const track = doc.createElement("span");
  track.className = "track";
  const knob = doc.createElement("span");
  knob.className = "knob";
  track.appendChild(knob);
  const name = doc.createElement("span");
  name.className = "name";
  btn.append(track, name);
  doc.body.appendChild(btn);

  let current: { hit: EntryHit; element: Element } | null = null;

  const paint = () => {
    if (!current) return;
    const off = opts.isHidden(current.hit.entryId);
    name.textContent = current.hit.label;
    btn.toggleAttribute("data-off", off);
    btn.setAttribute("aria-checked", String(!off));
    // The accessible name says what the control does, not what it currently
    // is — a switch labelled "Ein" reads as an instruction to turn it on.
    btn.setAttribute(
      "aria-label",
      off
        ? `${current.hit.label} wieder auf der Website zeigen`
        : `${current.hit.label} von der Website nehmen`,
    );
    btn.title = btn.getAttribute("aria-label")!;
    current.element.classList.toggle("iem-vis-on", !off);
    current.element.classList.toggle("iem-vis-off", off);
  };

  const place = () => {
    if (!current) return;
    btn.hidden = false;
    const r = current.element.getBoundingClientRect();
    const at = switchPosition(
      { top: r.top, left: r.left },
      { width: btn.offsetWidth, height: btn.offsetHeight },
      { width: win.innerWidth },
    );
    // Page coordinates, so it travels with the content on scroll.
    btn.style.top = `${at.top + win.scrollY}px`;
    btn.style.left = `${at.left + win.scrollX}px`;
  };

  const clear = () => {
    current?.element.classList.remove("iem-vis-on", "iem-vis-off");
    current = null;
    btn.hidden = true;
  };

  /**
   * A grace period before it disappears.
   *
   * The control sits just outside the element it belongs to, so reaching for
   * it means leaving that element — and the `mouseover` that follows would
   * tear it down before the cursor arrives. Anything that re-enters the
   * element or the control itself cancels the countdown.
   */
  let timer: number | undefined;
  const cancelHide = () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  };
  const scheduleHide = () => {
    cancelHide();
    timer = win.setTimeout(clear, 220);
  };

  const onOver = (e: Event) => {
    const el = e.target;
    if (!(el instanceof win.Element)) return;
    if (el === btn || btn.contains(el)) {
      cancelHide();
      return;
    }
    const found = resolveElement(el, opts.index);
    if (!found) {
      scheduleHide();
      return;
    }
    cancelHide();
    if (found.element === current?.element) return;
    clear();
    current = found;
    paint();
    place();
  };

  const onClick = (e: MouseEvent) => {
    if (!current) return;
    e.preventDefault();
    e.stopPropagation();
    const next = !opts.isHidden(current.hit.entryId);
    opts.onToggle(current.hit, next);
    // Repaint from the caller's state on the next frame, so the switch shows
    // the result rather than the intent — a rejected call flips it back.
    win.requestAnimationFrame(() => {
      paint();
      place();
    });
  };

  btn.addEventListener("click", onClick);
  btn.addEventListener("mouseenter", cancelHide);
  btn.addEventListener("mouseleave", scheduleHide);
  doc.addEventListener("mouseover", onOver, true);
  win.addEventListener("scroll", place, true);
  win.addEventListener("resize", place);

  return () => {
    btn.removeEventListener("click", onClick);
    btn.removeEventListener("mouseenter", cancelHide);
    btn.removeEventListener("mouseleave", scheduleHide);
    doc.removeEventListener("mouseover", onOver, true);
    win.removeEventListener("scroll", place, true);
    win.removeEventListener("resize", place);
    cancelHide();
    clear();
    style.remove();
    btn.remove();
  };
}
