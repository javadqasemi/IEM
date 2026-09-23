import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { listenHost, proxyTrustSetting } from "./proxy-trust";

/**
 * `TRUST_PROXY`, checked against a **real Express instance** rather than as a
 * string: the property that matters is what `req.ip` becomes, which is
 * Express's decision, and the one thing worth proving is that the production
 * setting believes nginx and nobody else (SEC-R2).
 *
 * The request reaches the app over the loopback, exactly as nginx's
 * `proxy_pass http://127.0.0.1` does in production, and carries the header
 * the way nginx builds it — `$proxy_add_x_forwarded_for` *appends* the real
 * client address to whatever the client sent.
 */

function appWith(setting: ReturnType<typeof proxyTrustSetting>) {
  const app = express();
  if (setting !== null) app.set("trust proxy", setting);
  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

async function ipSeen(server: Server, forwardedFor?: string): Promise<string> {
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/ip`, {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });
  return ((await res.json()) as { ip: string }).ip;
}

describe("proxyTrustSetting", () => {
  it("is unset without a value — the header is then ignored", () => {
    expect(proxyTrustSetting(undefined)).toBeNull();
    expect(proxyTrustSetting("  ")).toBeNull();
  });

  it("reads a hop count", () => {
    expect(proxyTrustSetting("1")).toBe(1);
  });

  it("reads names and ranges as a list", () => {
    expect(proxyTrustSetting("loopback")).toEqual(["loopback"]);
    expect(proxyTrustSetting("10.0.0.0/8, 127.0.0.1")).toEqual(["10.0.0.0/8", "127.0.0.1"]);
  });
});

describe("req.ip behind nginx on the same host (TRUST_PROXY=loopback)", () => {
  let server: Server;

  beforeAll(async () => {
    server = appWith(proxyTrustSetting("loopback")).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("is the client address nginx appended", async () => {
    expect(await ipSeen(server, "203.0.113.7")).toBe("203.0.113.7");
  });

  it("ignores an address the client put in front of it", async () => {
    // A client sends `X-Forwarded-For: 1.2.3.4`; nginx appends the real one.
    // Only the right-most untrusted hop is believed.
    expect(await ipSeen(server, "1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("req.ip with TRUST_PROXY unset", () => {
  let server: Server;

  beforeAll(async () => {
    server = appWith(proxyTrustSetting(undefined)).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("is the socket address, whatever the header says", async () => {
    // The safe default — and, behind nginx, the SEC-R2 failure: every client
    // becomes 127.0.0.1, so every throttle is one bucket.
    expect(await ipSeen(server, "203.0.113.7")).toMatch(/127\.0\.0\.1$/);
  });
});

describe("listenHost", () => {
  it("binds dual-stack when unset", () => {
    expect(listenHost(undefined)).toBeUndefined();
    expect(listenHost("")).toBeUndefined();
  });

  it("binds the loopback when the installer says so", () => {
    expect(listenHost("127.0.0.1")).toBe("127.0.0.1");
  });
});
