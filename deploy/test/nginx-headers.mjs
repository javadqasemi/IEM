// Verifies the security headers of the production nginx configuration.
//
//   node deploy/test/nginx-headers.mjs              static checks only
//   NGINX_BIN=/usr/sbin/nginx node deploy/test/nginx-headers.mjs
//                                                   + serve it and read the
//                                                     real response headers
//
// `npm run deploy:test` runs it. BASH may point at a bash executable when
// `bash` on PATH is not one (Windows: Git's usr/bin/sh.exe works).
//
// ---------------------------------------------------------------------------
// Why this exists (SEC-R5 in docs/COMPLETE_APPLICATION_AUDIT.md)
//
// nginx inherits `add_header` from the enclosing block only when the inner
// block declares none of its own. The three HTML documents each had a
// location with a `Cache-Control` add_header, so they were served with no CSP,
// no frame protection, no nosniff and no referrer policy — while the
// server-level block read as though they had all of them. Nothing failed and
// the installer's own check looked only at `/`.
//
// The rule the configuration now follows is "every block that says add_header
// also includes a header snippet". The static half checks that rule over every
// block; the live half proves the result on the wire for each document, an
// asset, an uploaded image, an uploaded SVG and a dossier path.

import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const ROOT = resolve(import.meta.dirname, "..", "..");
const slash = (p) => p.replace(/\\/g, "/");

// NGINX_WORK_DIR for machines whose temp path nginx cannot use: the rendered
// configuration names paths unquoted, as the installer's do (/opt/iem has no
// spaces), and nginx for Windows cannot open 8.3 short paths.
const work = mkdtempSync(join(process.env.NGINX_WORK_DIR || tmpdir(), "iem-nginx-"));
const out = join(work, "conf");
const appDir = join(work, "app");
const dataDir = join(work, "data");
for (const d of [out, join(out, "snippets"), join(out, "logs"), join(appDir, "dist", "assets"),
  join(dataDir, "media", "2026"), join(dataDir, "media", "bewerbungen", "2026")]) {
  mkdirSync(d, { recursive: true });
}

const failures = [];
const fail = (msg) => failures.push(msg);

/* ---- Render with the installer's own functions ---------------------- */

const bash = process.env.BASH || "bash";
const rendered = spawnSync(
  bash,
  [slash(join(ROOT, "deploy", "test", "render-nginx.sh")), slash(out), slash(appDir), slash(dataDir)],
  { encoding: "utf8" },
);
if (rendered.status !== 0) {
  console.error(rendered.stdout, rendered.stderr);
  throw new Error(`render-nginx.sh failed with ${rendered.status}`);
}

const site = readFileSync(join(out, "site.conf"), "utf8");
const snippet = (name) => readFileSync(join(out, "snippets", name), "utf8");

/* ---- Static: the rule, over every block ----------------------------- */

/** Every `{ … }` block with its header (the text before the brace). */
function blocks(text) {
  const found = [];
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      const lineStart = text.lastIndexOf("\n", i) + 1;
      stack.push({ head: text.slice(lineStart, i).trim(), start: i + 1 });
    } else if (text[i] === "}") {
      const open = stack.pop();
      if (!open) continue;
      // The block's own body, with nested blocks removed.
      let body = text.slice(open.start, i);
      let prev;
      do {
        prev = body;
        body = body.replace(/\{[^{}]*\}/g, "");
      } while (body !== prev);
      found.push({ head: open.head, body });
    }
  }
  return found;
}

const stripComments = (t) => t.replace(/#[^\n]*/g, "");
for (const block of blocks(stripComments(site))) {
  if (!/\badd_header\b/.test(block.body)) continue;
  if (!/include\s+\S*iem-headers-(site|media)\.conf/.test(block.body)) {
    fail(`block "${block.head}" sets add_header without including a header snippet`);
  }
}

const serverBody = blocks(stripComments(site)).find((b) => b.head.startsWith("server"))?.body ?? "";
if (!/include\s+\S*iem-headers-site\.conf/.test(serverBody)) {
  fail("the server block does not include iem-headers-site.conf");
}
if (!/location \^~ \/media\//.test(site)) {
  fail("/media/ is not a ^~ location — the image regex would shadow it");
}

const base = snippet("iem-headers-base.conf");
const siteSnippet = snippet("iem-headers-site.conf");
const media = snippet("iem-headers-media.conf");
for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
  if (!base.includes(h)) fail(`iem-headers-base.conf lacks ${h}`);
}
if (!/frame-ancestors 'self'/.test(siteSnippet)) fail("site CSP lacks frame-ancestors 'self'");
if (!/sandbox/.test(media)) fail("media CSP lacks sandbox");
if (!existsSync(join(out, "snippets", "iem-hsts.conf"))) fail("iem-hsts.conf was not written");

/* ---- Live: serve it and read the headers ---------------------------- */

const observed = {};
const nginxBin = process.env.NGINX_BIN;

async function freePort() {
  return new Promise((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

if (nginxBin) {
  const port = await freePort();
  // The rendered server block, bound to a free loopback port instead of :80.
  const live = site
    .replace(/listen 80;/, `listen 127.0.0.1:${port};`)
    .replace(/\s*listen \[::\]:80;/, "")
    .replace(/access_log [^;]+;/g, "access_log off;")
    .replace(/error_log [^;]+;/, `error_log ${slash(join(out, "logs", "error.log"))} warn;`)
    // The ACME location points at /var/www/html, which does not exist here.
    .replace(/root \/var\/www\/html;/, `root ${slash(appDir)};`);
  writeFileSync(join(out, "live.conf"), live);

  const nginxDir = resolve(nginxBin, "..");
  // Copied beside the config so no path in it depends on where nginx lives.
  writeFileSync(join(out, "mime.types"), readFileSync(join(nginxDir, "conf", "mime.types")));
  mkdirSync(join(out, "temp"), { recursive: true });
  writeFileSync(
    join(out, "nginx.conf"),
    [
      "worker_processes 1;",
      `pid ${slash(join(out, "nginx.pid"))};`,
      `error_log ${slash(join(out, "logs", "main-error.log"))} warn;`,
      "events { worker_connections 64; }",
      "http {",
      `  include ${slash(join(out, "mime.types"))};`,
      `  client_body_temp_path ${slash(join(out, "temp"))};`,
      "  default_type application/octet-stream;",
      // The zones the site config uses, from 10-iem-global.conf.
      "  limit_req_zone $binary_remote_addr zone=iem_api:1m rate=30r/s;",
      "  limit_req_zone $binary_remote_addr zone=iem_login:1m rate=5r/m;",
      "  limit_req_zone $binary_remote_addr zone=iem_upload:1m rate=2r/s;",
      "  limit_conn_zone $binary_remote_addr zone=iem_conn:1m;",
      `  include ${slash(join(out, "live.conf"))};`,
      "}",
    ].join("\n"),
  );

  // Something to serve for each kind of response.
  const dist = join(appDir, "dist");
  for (const f of ["index.html", "admin.html", "stelle.html", "404.html", "50x.html"]) {
    writeFileSync(join(dist, f), `<!doctype html><title>${f}</title>`);
  }
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dataDir, "media", "2026", "photo-1a2b3c4d.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(
    join(dataDir, "media", "2026", "logo-5e6f7a8b.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(join(dataDir, "media", "bewerbungen", "2026", "cv.pdf"), "%PDF-1.4 secret");

  const prefix = slash(nginxDir) + "/";
  const conf = slash(join(out, "nginx.conf"));
  const check = spawnSync(nginxBin, ["-p", prefix, "-c", conf, "-t"], { encoding: "utf8" });
  if (check.status !== 0) {
    console.error(check.stderr);
    throw new Error("nginx -t rejected the rendered configuration");
  }
  const server = spawn(nginxBin, ["-p", prefix, "-c", conf], { stdio: "ignore", detached: false });
  await new Promise((r) => setTimeout(r, 800));

  const origin = `http://127.0.0.1:${port}`;
  const get = async (path) => {
    const res = await fetch(origin + path, { redirect: "manual" });
    await res.arrayBuffer();
    return res;
  };

  try {
    const documents = ["/", "/index.html", "/admin.html", "/stelle.html"];
    const required = [
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
      "strict-transport-security",
    ];
    for (const path of [...documents, "/assets/app-abc123.js", "/does-not-exist"]) {
      const res = await get(path);
      observed[path] = { status: res.status };
      for (const name of required) {
        const value = res.headers.get(name);
        observed[path][name] = value;
        if (!value) fail(`${path} (${res.status}) has no ${name}`);
      }
      const csp = res.headers.get("content-security-policy") ?? "";
      if (!csp.includes("frame-ancestors 'self'")) fail(`${path} CSP lacks frame-ancestors 'self'`);
    }
    for (const path of documents) {
      if (observed[path].status !== 200) fail(`${path} answered ${observed[path].status}`);
    }

    // Uploaded media: served (the ^~ fix), sandboxed (the SVG fix).
    for (const path of ["/media/2026/photo-1a2b3c4d.png", "/media/2026/logo-5e6f7a8b.svg"]) {
      const res = await get(path);
      const csp = res.headers.get("content-security-policy") ?? "";
      observed[path] = { status: res.status, "content-security-policy": csp, "content-type": res.headers.get("content-type") };
      if (res.status !== 200) fail(`${path} answered ${res.status} — uploads not served`);
      if (!csp.includes("sandbox")) fail(`${path} is not sandboxed`);
      if (!res.headers.get("x-content-type-options")) fail(`${path} lacks nosniff`);
    }

    // Dossiers: never, however the path is spelled.
    for (const path of [
      "/media/bewerbungen/2026/cv.pdf",
      "/media/%62ewerbungen/2026/cv.pdf",
      "/media/bewerbungen%2f2026%2fcv.pdf",
      "/media/2026/../bewerbungen/2026/cv.pdf",
    ]) {
      const res = await get(path);
      observed[path] = { status: res.status };
      if (res.status === 200) fail(`${path} served a dossier`);
    }
  } finally {
    spawnSync(nginxBin, ["-p", prefix, "-c", conf, "-s", "stop"]);
    await new Promise((r) => setTimeout(r, 300));
    if (!server.killed) server.kill();
  }
}

/* ---- Report --------------------------------------------------------- */

if (process.env.NGINX_HEADERS_REPORT) {
  writeFileSync(process.env.NGINX_HEADERS_REPORT, JSON.stringify(observed, null, 2));
}
rmSync(work, { recursive: true, force: true });

console.log(
  nginxBin
    ? `nginx headers: static checks and ${Object.keys(observed).length} live responses`
    : "nginx headers: static checks only (set NGINX_BIN to serve the configuration)",
);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("  ✓ every block that sets add_header includes a header snippet");
if (nginxBin) console.log("  ✓ documents, assets, errors, media and dossier paths behave as required");
