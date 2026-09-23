/**
 * What Express's `trust proxy` should be set to, from `TRUST_PROXY`.
 *
 * Pure so it can be tested against a real Express app without booting Nest
 * (`proxy-trust.test.ts`), which is how the claim "a client-sent
 * X-Forwarded-For is ignored behind nginx" is checked rather than asserted.
 *
 * `null` means *do not set it*: no proxy, `req.ip` is the socket address and
 * the header is ignored — the right default, because believing the header
 * without a proxy is the bug `main.ts`'s `configureProxyTrust` records.
 *
 * Otherwise what Express takes: a hop count (`1`), a comma-separated list of
 * addresses or CIDR ranges, or `loopback` / `linklocal` / `uniquelocal`. The
 * production installer writes **`loopback`** — nginx on the same host is the
 * one hop, and trusting exactly it makes `req.ip` the address nginx appended,
 * whatever the client put in front of it.
 */
export function proxyTrustSetting(raw: string | undefined): number | string[] | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The address to bind, from `HOST`.
 *
 * `undefined` when unset, so Node binds dual-stack — the development default,
 * argued in `main.ts`. The installer sets `127.0.0.1`: nginx is the API's only
 * client, and this used to be written to the environment and read by nothing,
 * so the API listened on every interface with the firewall as its only
 * barrier (SEC-R22).
 */
export function listenHost(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  return value || undefined;
}
