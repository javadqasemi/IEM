import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MfaChallengeDto, ReauthenticateDto } from "./auth.controller";
import { ReauthenticatedDto, VerifyEnrolmentDto } from "./mfa.controller";
import { ResetMfaDto } from "../users/users.controller";

/**
 * The MFA DTOs through the **real pipe with the real options**.
 *
 * Copied deliberately from `settings.dto.test.ts`, which says why: the global
 * pipe runs with `whitelist: true`, so a property carrying no decorator is
 * not rejected — it is **removed**, silently, and the service receives a body
 * that is missing the thing the caller sent. This codebase has sprung that
 * trap twice already (the content DTOs blanked the editor; `SettingUpdate.value`
 * made every save a no-op that answered 200), and the note there says to copy
 * this test rather than trust a review.
 *
 * It matters more here than anywhere it has mattered before. A stripped
 * `reauthToken` would turn "prove it again" into an empty string that
 * `ReauthService.require` refuses — which fails *safe*, and is therefore the
 * good case. A stripped `recoveryCode` is the other direction: the body still
 * validates, the service sees neither a code nor a recovery code, and the
 * person holding a piece of paper with ten valid codes on it is told each of
 * them is wrong while they are locked out of the system.
 *
 * Asserting that the decorators are *present* would not catch either. What
 * the callers depend on is that the value survives the pipe.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const through = async <T>(metatype: new () => T, body: unknown): Promise<T> =>
  (await pipe.transform(body, { type: "body", metatype })) as T;

describe("MfaChallengeDto", () => {
  it("keeps the challenge and the code", async () => {
    const out = await through(MfaChallengeDto, { challenge: "abc", code: "123456" });
    expect(out.challenge).toBe("abc");
    expect(out.code).toBe("123456");
  });

  it("keeps a recovery code when that is what was sent", async () => {
    /*
      The failure this guards is the expensive one: the DTO still validates
      without the field, so the request succeeds in reaching the service with
      nothing to check — and the person is told their recovery code is wrong
      at the exact moment they have no other way in.
    */
    const out = await through(MfaChallengeDto, { challenge: "abc", recoveryCode: "AB12C-D34EF" });
    expect(out.recoveryCode).toBe("AB12C-D34EF");
    expect(out.code).toBeUndefined();
  });

  it("refuses a body with no challenge at all", async () => {
    await expect(through(MfaChallengeDto, { code: "123456" })).rejects.toThrow();
    await expect(through(MfaChallengeDto, { challenge: "" })).rejects.toThrow();
  });

  it("bounds every string, so a kilobyte never reaches an HMAC", async () => {
    await expect(
      through(MfaChallengeDto, { challenge: "a".repeat(513), code: "123456" }),
    ).rejects.toThrow();
    await expect(
      through(MfaChallengeDto, { challenge: "abc", code: "1".repeat(17) }),
    ).rejects.toThrow();
    await expect(
      through(MfaChallengeDto, { challenge: "abc", recoveryCode: "A".repeat(33) }),
    ).rejects.toThrow();
  });

  it("strips anything the caller invented", async () => {
    // `whitelist: true` working as intended, and the reason the tests above
    // exist: the same mechanism that drops `userId` here drops a field whose
    // decorator somebody forgot.
    const out = await through(MfaChallengeDto, {
      challenge: "abc",
      code: "123456",
      userId: "somebody-else",
    });
    expect(out).not.toHaveProperty("userId");
  });
});

describe("ReauthenticateDto", () => {
  it("keeps the password and an optional second factor", async () => {
    const out = await through(ReauthenticateDto, {
      password: "ein sehr langes passwort",
      code: "123456",
    });
    expect(out.password).toBe("ein sehr langes passwort");
    expect(out.code).toBe("123456");
  });

  it("keeps a recovery code, which is how somebody without their phone gets in", async () => {
    const out = await through(ReauthenticateDto, {
      password: "ein sehr langes passwort",
      recoveryCode: "AB12CD34EF",
    });
    expect(out.recoveryCode).toBe("AB12CD34EF");
  });

  it("requires a password", async () => {
    await expect(through(ReauthenticateDto, { code: "123456" })).rejects.toThrow();
    await expect(through(ReauthenticateDto, { password: "" })).rejects.toThrow();
  });
});

describe("VerifyEnrolmentDto", () => {
  it("keeps the code", async () => {
    expect((await through(VerifyEnrolmentDto, { code: "123456" })).code).toBe("123456");
  });

  it("keeps the spacing an authenticator app displays", async () => {
    // Normalisation is `mfa.rules.ts`'s job, so the DTO must not refuse the
    // string a paste produces before the rules ever see it.
    expect((await through(VerifyEnrolmentDto, { code: "123 456" })).code).toBe("123 456");
  });

  it("requires one", async () => {
    await expect(through(VerifyEnrolmentDto, {})).rejects.toThrow();
    await expect(through(VerifyEnrolmentDto, { code: "" })).rejects.toThrow();
  });
});

describe("the re-authentication proof", () => {
  /*
    Two classes with the same field, on purpose.

    `ReauthenticatedDto` guards the caller's own account and `ResetMfaDto`
    guards somebody else's, and each lives beside the routes it belongs to
    with a message written for that screen. Sharing one class would put a
    users-module import into the auth controller for the sake of one string.
    They are tested together because what has to be true of them is identical.
  */
  it.each([
    ["ReauthenticatedDto", ReauthenticatedDto],
    ["ResetMfaDto", ResetMfaDto],
  ] as const)("%s keeps the token through the pipe", async (_name, dto) => {
    const out = await through(dto, { reauthToken: "opaque-token-value" });
    expect(out.reauthToken).toBe("opaque-token-value");
  });

  it.each([
    ["ReauthenticatedDto", ReauthenticatedDto],
    ["ResetMfaDto", ResetMfaDto],
  ] as const)("%s refuses an empty or missing token", async (_name, dto) => {
    await expect(through(dto, {})).rejects.toThrow();
    await expect(through(dto, { reauthToken: "" })).rejects.toThrow();
  });
});
