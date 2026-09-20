import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { EncryptionService, digestsMatch, readKey, sha256 } from "./encryption.service";

/**
 * The encryption seam, and the four ways a value fails to come back.
 *
 * `EncryptionService` is constructed directly with a stub `ConfigService`
 * rather than through a testing module. That is not a shortcut: a Nest
 * `Test.createTestingModule` cannot resolve any provider under vitest at all,
 * because esbuild does not emit `emitDecoratorMetadata` — see the toolchain
 * table in CLAUDE.md. What is tested here is the arithmetic, which is the
 * same under both toolchains; the wiring is proved by `node dist/main.js` and
 * by the e2e suite.
 */

const config = (value?: string) =>
  ({ get: () => value }) as unknown as ConfigService;

/** 32 bytes, fixed, so a failure is reproducible. */
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KEY_HEX = Buffer.alloc(32, 9).toString("hex");

describe("the key", () => {
  it("is absent when the variable is unset", () => {
    expect(readKey(undefined, () => {})).toBeNull();
    expect(readKey("", () => {})).toBeNull();
    expect(readKey("   ", () => {})).toBeNull();
  });

  it("reads 32 bytes of base64", () => {
    expect(readKey(KEY_B64, () => {})).toEqual(Buffer.alloc(32, 7));
  });

  it("reads 64 characters of hex", () => {
    // The branch that matters: 64 hex characters are also valid base64 input,
    // and decoding them that way yields 48 bytes rather than 32 — so an
    // operator following `openssl rand -hex 32` would get a rejected key.
    expect(readKey(KEY_HEX, () => {})).toEqual(Buffer.alloc(32, 9));
  });

  it("refuses a key of the wrong length, and says how long it was", () => {
    const onError = vi.fn();
    expect(readKey(Buffer.alloc(16, 1).toString("base64"), onError)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("16 Byte");
  });
});

describe("a value that was encrypted", () => {
  const service = new EncryptionService(config(KEY_B64));

  it("comes back", () => {
    expect(service.decrypt(service.encrypt("JBSWY3DPEHPK3PXP"))).toBe("JBSWY3DPEHPK3PXP");
  });

  it("survives a secret with every byte value in it", () => {
    const value = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("");
    expect(service.decrypt(service.encrypt(value))).toBe(value);
  });

  it("is a different ciphertext every time", () => {
    // A fresh IV per value. Without it, two people enrolling with the same
    // secret would be visibly the same row, and GCM with a reused IV leaks
    // the plaintext difference outright.
    const a = service.encrypt("same");
    const b = service.encrypt("same");
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe(service.decrypt(b));
  });

  it("carries its version, so a rotation is a migration rather than a loss", () => {
    expect(service.encrypt("x").startsWith("v1.")).toBe(true);
  });
});

describe("a value that cannot be read", () => {
  const service = new EncryptionService(config(KEY_B64));

  it("refuses a ciphertext whose tag does not match", () => {
    /*
      The property authentication buys, and the reason GCM rather than CBC.

      An attacker who can write the column but cannot read the key must not be
      able to substitute a TOTP secret they know. Flipping one byte of the
      ciphertext has to fail loudly rather than decrypt to something else.
    */
    const [v, iv, tag, ct] = service.encrypt("JBSWY3DPEHPK3PXP").split(".");
    const bytes = Buffer.from(ct, "base64url");
    bytes[0] ^= 0xff;
    expect(() => service.decrypt([v, iv, tag, bytes.toString("base64url")].join("."))).toThrow();
  });

  it("refuses a ciphertext written under a different key", () => {
    const other = new EncryptionService(config(KEY_HEX));
    expect(() => other.decrypt(service.encrypt("JBSWY3DPEHPK3PXP"))).toThrow();
  });

  it("refuses an envelope it does not recognise", () => {
    expect(() => service.decrypt("v2.a.b.c")).toThrow(/envelope/);
    expect(() => service.decrypt("not-an-envelope")).toThrow(/envelope/);
    expect(() => service.decrypt("")).toThrow(/envelope/);
  });
});

describe("with no key configured", () => {
  const service = new EncryptionService(config(undefined));

  it("reports itself unavailable rather than pretending", () => {
    expect(service.available).toBe(false);
  });

  it("refuses with a message naming the variable", () => {
    // 503 and an operator-readable reason. The alternative — failing the
    // bootstrap — takes an installation that has never used MFA offline over
    // a feature it does not use.
    expect(() => service.assertAvailable()).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => service.encrypt("x")).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => service.decrypt("v1.a.b.c")).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});

describe("digestsMatch", () => {
  it("compares equal digests", () => {
    const digest = sha256("abc");
    expect(digestsMatch(digest, digest)).toBe(true);
  });

  it("rejects different digests of the same length", () => {
    expect(digestsMatch(sha256("abc"), sha256("abd"))).toBe(false);
  });

  it("rejects a length mismatch instead of throwing", () => {
    // `timingSafeEqual` throws on unequal lengths, so the naive call site is
    // the one that crashes on input an attacker chooses.
    expect(digestsMatch(sha256("abc"), "short")).toBe(false);
    expect(digestsMatch("", sha256("abc"))).toBe(false);
  });
});

describe("sha256", () => {
  it("is the well-known digest, not a local invention", () => {
    // A fixed vector: if this ever changes, every stored recovery code and
    // every live challenge stops resolving, and the failure would otherwise
    // look like "the codes do not work".
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable across inputs of random length", () => {
    const value = randomBytes(64).toString("hex");
    expect(sha256(value)).toBe(sha256(value));
  });
});
