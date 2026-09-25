import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * The second sign-in step's motion and states, in a real browser, against an
 * API that answers **when the test says so**.
 *
 * ---
 *
 * ## Why the API is fulfilled here rather than reached
 *
 * Everything this file asserts is about *timing*: that the loader appears
 * while the request is in flight, that nothing turns green until the server
 * has answered, that a refusal gives the keyboard back. Against the live API
 * the answer arrives in a few milliseconds, so "still verifying after a
 * second and a half with no answer" cannot be observed at all — and that is
 * the assertion that proves success is not faked with a timer.
 *
 * So every request under `/api/v1` is fulfilled by the handler below, and a
 * verification is held until the test releases it. `e2e/mfa.spec.ts` remains
 * the real journey: a real enrolment, a real TOTP, the real refusal message,
 * through this same screen. `login-budget.spec.ts` lists this file as exempt
 * from the sign-in pacing and checks that it lets no request through.
 *
 * ## Widths
 *
 * The widths are iterated **inside** the test rather than by the three
 * projects, because the brief's seven widths are not the suite's three, and
 * the check is layout arithmetic that needs no fresh page per width. Listed
 * in `RUN_ONCE`.
 */

const SHOTS = resolve(process.cwd(), "e2e", "shots", "otp");

const SESSION = {
  id: "u-otp",
  email: "otp@iem.test",
  name: "OTP Test",
  avatarUrl: null,
  locale: "de-CH",
  status: "ACTIVE",
  mfaEnabled: true,
  lastLoginAt: null,
  roles: [],
  permissions: [],
  isSuperAdmin: false,
};

type Answer = "accept" | "refuse";

/**
 * A fresh context whose API is this handler — never the shared, signed-in
 * one, and never the real server.
 */
async function stage(browser: Browser, options: { reducedMotion?: "reduce" | "no-preference" } = {}) {
  const context = await browser.newContext({ reducedMotion: options.reducedMotion ?? "no-preference" });
  const held: { answer: Answer; release: () => void }[] = [];
  const submitted: string[] = [];

  await context.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1\//, "");

    // No session to restore: the sign-in form.
    if (path === "auth/refresh") {
      return route.fulfill({ status: 401, json: { statusCode: 401, message: "Nicht angemeldet." } });
    }
    if (path === "auth/login") {
      return route.fulfill({
        json: { data: { mfaRequired: true, challenge: "c".repeat(48), expiresIn: 300 } },
      });
    }
    if (path === "auth/mfa/challenge") {
      const body = route.request().postDataJSON() as { code?: string; recoveryCode?: string };
      submitted.push(body.code ?? body.recoveryCode ?? "");
      // Held until the test decides what the server says.
      const answer = await new Promise<Answer>((resolve) => {
        const entry = { answer: "refuse" as Answer, release: () => resolve(entry.answer) };
        held.push(entry);
      });
      if (answer === "refuse") {
        return route.fulfill({
          status: 401,
          json: { statusCode: 401, message: "Dieser Code stimmt nicht." },
        });
      }
      return route.fulfill({
        json: { data: { accessToken: "t".repeat(40), expiresIn: 900, user: SESSION } },
      });
    }
    // Whatever the dashboard asks for once it is signed in.
    return route.fulfill({ json: { data: [] } });
  });

  const page = await context.newPage();

  /** Answers the verification that is currently held. */
  const answer = async (value: Answer) => {
    await expect.poll(() => held.length, { message: "no verification request is waiting" }).toBeGreaterThan(0);
    const entry = held.shift()!;
    entry.answer = value;
    entry.release();
  };

  return { context, page, answer, submitted };
}

/** From a cold page to the second step, through the real form. */
async function toSecondStep(page: Page): Promise<Locator> {
  await page.goto("/admin.html#/");
  await page.reload();
  await page.getByLabel(/E-Mail/i).fill("otp@iem.test");
  await page.getByLabel(/Passwort/i).first().fill("irrelevant-here");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Zwei-Faktor-Bestätigung" })).toBeVisible();
  return page.getByLabel("Code aus der App");
}

const form = (page: Page) => page.locator("form.vm-stage");
const slots = (page: Page) => page.locator(".otp-slot");

async function activeSlot(page: Page): Promise<number> {
  return slots(page).evaluateAll((els) => els.findIndex((el) => el.hasAttribute("data-active")));
}

test.describe("the one-time code step", () => {
  test("typing, paste, Backspace and the keyboard move one caret across six slots", async ({ browser }) => {
    const { context, page } = await stage(browser);
    try {
      const input = await toSecondStep(page);

      // autoFocus, the number pad and the autofill hint — on the real element.
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("inputmode", "numeric");
      await expect(input).toHaveAttribute("autocomplete", "one-time-code");
      await expect(slots(page)).toHaveCount(6);
      expect(await activeSlot(page)).toBe(0);

      // Automatic progression: each digit moves the active slot on.
      await page.keyboard.type("12");
      await expect(input).toHaveValue("12");
      expect(await activeSlot(page)).toBe(2);

      // Letters are dropped on the way in, not shown as an error.
      await page.keyboard.type("a");
      await expect(input).toHaveValue("12");

      // Backspace goes back one slot.
      await page.keyboard.press("Backspace");
      await expect(input).toHaveValue("1");
      expect(await activeSlot(page)).toBe(1);

      // A pasted code with a space in it lands whole.
      await page.keyboard.press("Backspace");
      await input.evaluate((el) => {
        const data = new DataTransfer();
        data.setData("text", "123 456");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await expect(input).toHaveValue("123456");
      await expect(page.locator(".otp-slot[data-filled]")).toHaveCount(6);

      // Arrow keys move between slots.
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      expect(await activeSlot(page)).toBe(4);

      // Clicking a filled slot selects its digit, so typing replaces it.
      // A click where the slot is drawn — which lands on the transparent
      // input above it, as a person's click does.
      const target = (await slots(page).nth(2).boundingBox())!;
      await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
      expect(await activeSlot(page)).toBe(2);
      await page.keyboard.type("9");
      await expect(input).toHaveValue("129456");

      // The active slot is the focus indicator: gold, and gone on blur.
      const ring = await slots(page).nth(await activeSlot(page)).evaluate((el) => getComputedStyle(el).boxShadow);
      expect(ring).not.toBe("none");
      await page.keyboard.press("Tab");
      expect(await activeSlot(page)).toBe(-1);
    } finally {
      await context.close();
    }
  });

  test("verifying holds until the server answers; a refusal restores the form; a retry succeeds", async ({
    browser,
  }) => {
    const { context, page, answer, submitted } = await stage(browser);
    try {
      mkdirSync(SHOTS, { recursive: true });
      const input = await toSecondStep(page);
      await expect(form(page)).toHaveAttribute("data-state", "idle");
      await page.screenshot({ path: resolve(SHOTS, "01-empty.png") });

      await page.keyboard.type("111111");
      await expect(form(page)).toHaveAttribute("data-state", "typing");
      await page.waitForTimeout(300); // the slots' 200 ms transitions
      await page.screenshot({ path: resolve(SHOTS, "02-typed.png") });

      /* ---- verifying ------------------------------------------------ */
      await page.keyboard.press("Enter");
      await expect(form(page)).toHaveAttribute("data-state", "verifying");
      await expect(form(page)).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".vm[data-status='verifying']")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Code wird geprüft." })).toHaveCount(1);
      await expect(input).toBeDisabled();
      // The dimmed form cannot be reached by the keyboard either.
      expect(await page.locator(".vm-content").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(SHOTS, "03-verifying.png") });

      // The dim is the one the brief asks for, not an unreadable one.
      const dim = await page.locator(".vm-content").evaluate((el) => {
        const s = getComputedStyle(el);
        return { opacity: Number(s.opacity), filter: s.filter };
      });
      expect(dim.opacity).toBeCloseTo(0.35, 2);
      expect(dim.filter).toContain("blur(3px)");

      /*
        **The assertion that proves success is not a timer.** A second and a
        half with no answer from the server, and nothing has turned green.
      */
      await page.waitForTimeout(1500);
      await expect(form(page)).toHaveAttribute("data-state", "verifying");
      await expect(page.locator(".vm-check")).toHaveCount(0);
      expect(submitted).toEqual(["111111"]);

      /* ---- refused -------------------------------------------------- */
      await answer("refuse");
      await expect(form(page)).toHaveAttribute("data-state", "error");
      // Visible, not its wording: the sentence is `toFailure`'s, not this
      // screen's, and the motion must not depend on it.
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.locator(".vm-overlay")).toHaveCount(0);
      await expect(page.locator(".otp")).toHaveAttribute("data-state", "error");
      // The code is spent either way, so the field is cleared — and the
      // keyboard is back in it for the next one.
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      expect(await page.locator(".vm-content").evaluate((el) => (el as HTMLElement).inert)).toBe(false);
      await page.waitForTimeout(400); // the un-blur and the nudge
      await page.screenshot({ path: resolve(SHOTS, "04-error.png") });

      /* ---- retry, accepted ------------------------------------------ */
      await page.keyboard.type("222222");
      await page.getByRole("button", { name: "Bestätigen" }).click();
      await expect(form(page)).toHaveAttribute("data-state", "verifying");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await answer("accept");

      await expect(form(page)).toHaveAttribute("data-state", "success");
      await expect(page.locator(".vm[data-status='success']")).toBeVisible();
      await expect(page.locator(".vm-check")).toBeVisible();
      await expect(page.locator(".otp")).toHaveAttribute("data-state", "success");
      await expect(page.getByRole("status").filter({ hasText: "Code bestätigt." })).toHaveCount(1);
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(SHOTS, "05-burst.png") });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(SHOTS, "06-success.png") });
      expect(submitted).toEqual(["111111", "222222"]);

      // And then the session is adopted and the step is gone.
      await expect(page.getByRole("heading", { name: "Zwei-Faktor-Bestätigung" })).toHaveCount(0, {
        timeout: 5_000,
      });
    } finally {
      await context.close();
    }
  });

  test("the recovery-code path goes through the same verification", async ({ browser }) => {
    const { context, page, answer, submitted } = await stage(browser);
    try {
      await toSecondStep(page);
      await page.getByRole("button", { name: "Wiederherstellungscode verwenden" }).click();
      await page.getByLabel("Wiederherstellungscode").fill("abcde-12345");
      await page.keyboard.press("Enter");
      await expect(form(page)).toHaveAttribute("data-state", "verifying");
      await answer("refuse");
      await expect(form(page)).toHaveAttribute("data-state", "error");
      await expect(page.getByLabel("Wiederherstellungscode")).toBeFocused();
      expect(submitted).toEqual(["ABCDE-12345"]);
    } finally {
      await context.close();
    }
  });

  test("reduced motion: nothing orbits, bursts or scales, and the states still read", async ({ browser }) => {
    const { context, page, answer } = await stage(browser, { reducedMotion: "reduce" });
    try {
      await toSecondStep(page);
      await page.keyboard.type("333333");
      await page.keyboard.press("Enter");
      await expect(form(page)).toHaveAttribute("data-state", "verifying");

      await expect(page.locator(".vm-particle")).toBeHidden();
      const still = await page.evaluate(() => {
        const orbit = getComputedStyle(document.querySelector(".vm-orbit")!);
        const content = getComputedStyle(document.querySelector(".vm-content")!);
        return { orbit: orbit.animationName, filter: content.filter, transform: content.transform };
      });
      expect(still.orbit).toBe("none");
      expect(still.filter).toBe("none");
      expect(still.transform).toBe("none");
      // The words carry the state.
      await expect(page.getByText("Code wird geprüft …")).toBeVisible();

      await answer("accept");
      await expect(form(page)).toHaveAttribute("data-state", "success");
      await expect(page.locator(".vm-burst")).toBeHidden();
      await expect(page.locator(".vm-check")).toBeVisible();
      await expect(page.locator(".vm-message").getByText("Bestätigt", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("axe finds nothing in the idle, error, verifying and success states, in both themes", async ({
    browser,
  }) => {
    const { context, page, answer } = await stage(browser);
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        label,
      ).toEqual([]);
    };
    try {
      await toSecondStep(page);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        await page.keyboard.type("555555");
        await scan(`${theme}: typed`);

        await page.keyboard.press("Enter");
        await expect(form(page)).toHaveAttribute("data-state", "verifying");
        await scan(`${theme}: verifying`);

        await answer("refuse");
        await expect(form(page)).toHaveAttribute("data-state", "error");
        await page.waitForTimeout(400);
        await scan(`${theme}: error`);
      }

      await page.keyboard.type("666666");
      await page.keyboard.press("Enter");
      await answer("accept");
      await expect(form(page)).toHaveAttribute("data-state", "success");
      await scan("dark: success");
    } finally {
      await context.close();
    }
  });

  test("the loader stays centred and nothing overflows, from 320 to 1440 px", async ({ browser }) => {
    const { context, page, answer } = await stage(browser);
    try {
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await toSecondStep(page);
      await page.keyboard.type("444444");
      await page.keyboard.press("Enter");
      await expect(form(page)).toHaveAttribute("data-state", "verifying");

      for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
        const layout = await page.evaluate(() => {
          const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
          const slotBoxes = [...document.querySelectorAll(".otp-slot")].map((el) => el.getBoundingClientRect());
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            form: box("form.vm-stage").toJSON() as DOMRect,
            loader: box(".vm").toJSON() as DOMRect,
            glow: box(".vm-ambient").toJSON() as DOMRect,
            slotsOverlap: slotBoxes.some((b, i) => i > 0 && b.left < slotBoxes[i - 1].right - 0.5),
            narrowestSlot: Math.min(...slotBoxes.map((b) => b.width)),
          };
        });

        expect(layout.scrollWidth, `${width}px: horizontal overflow`).toBeLessThanOrEqual(layout.innerWidth);
        expect(layout.slotsOverlap, `${width}px: slots overlap`).toBe(false);
        expect(layout.narrowestSlot, `${width}px: a slot too narrow for a digit`).toBeGreaterThanOrEqual(24);
        // Centred on the card, horizontally and vertically, to the pixel.
        const formCentre = { x: layout.form.x + layout.form.width / 2, y: layout.form.y + layout.form.height / 2 };
        const loaderCentre = {
          x: layout.loader.x + layout.loader.width / 2,
          y: layout.loader.y + layout.loader.height / 2,
        };
        expect(Math.abs(formCentre.x - loaderCentre.x), `${width}px: off-centre`).toBeLessThan(1.5);
        // Vertically the message sits under the loader, so the pair is centred.
        expect(loaderCentre.y, `${width}px: loader outside the card`).toBeGreaterThan(layout.form.y);
        expect(loaderCentre.y).toBeLessThan(formCentre.y);
        // The glow is not clipped by the viewport.
        expect(layout.glow.x, `${width}px: glow clipped`).toBeGreaterThanOrEqual(0);
        expect(layout.glow.x + layout.glow.width).toBeLessThanOrEqual(width);

        await page.screenshot({ path: resolve(SHOTS, `verifying-${width}.png`) });
      }

      // The success state at the narrowest width, in the dark theme too.
      await page.setViewportSize({ width: 320, height: 740 });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await answer("accept");
      await expect(form(page)).toHaveAttribute("data-state", "success");
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "the burst must not widen the page").toBeLessThanOrEqual(0);
      await page.screenshot({ path: resolve(SHOTS, "success-320-dark.png") });
    } finally {
      await context.close();
    }
  });
});
