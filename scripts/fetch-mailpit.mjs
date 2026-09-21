/**
 * Fetches Mailpit into `var/tools/mailpit/`, once per machine.
 *
 * ---
 *
 * ## Why this exists rather than a Docker line in the README
 *
 * `e2e/mail.spec.ts` proves the last hop of the notification chain by asking a
 * **real SMTP server** whether a message arrived. Docker is the obvious way to
 * run one and is not available on every machine here, so the fallback is the
 * single static binary Mailpit ships — which is also faster to start and has
 * no daemon to leave running.
 *
 * ## Why it is not a dependency
 *
 * Nothing in the application knows Mailpit exists. It is reached through the
 * ordinary `mail.smtpHost` setting, exactly as a real relay would be, which is
 * the property that makes the acceptance test meaningful: if the test needed a
 * special code path, it would be testing the special code path.
 *
 * `var/` is gitignored, so the binary is never committed — a 26 MB executable
 * in a repository is a thing people copy forward for years.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = "var/tools/mailpit";

/** `windows`/`darwin`/`linux` and `amd64`/`arm64`, as Mailpit names them. */
function target() {
  const os = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os || !arch) {
    throw new Error(`Für ${process.platform}/${process.arch} gibt es kein Mailpit-Paket.`);
  }
  return { os, arch, ext: os === "windows" ? "zip" : "tar.gz" };
}

const { os, arch, ext } = target();

const release = await fetch("https://api.github.com/repos/axllent/mailpit/releases/latest", {
  headers: { accept: "application/vnd.github+json" },
}).then((r) => {
  if (!r.ok) throw new Error(`GitHub antwortete ${r.status}.`);
  return r.json();
});

const name = `mailpit-${os}-${arch}.${ext}`;
const asset = release.assets.find((a) => a.name === name);
if (!asset) throw new Error(`${name} ist in ${release.tag_name} nicht enthalten.`);

console.log(`Mailpit ${release.tag_name} — ${name}`);

const archive = join(tmpdir(), name);
const res = await fetch(asset.browser_download_url);
if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}).`);
await pipeline(res.body, createWriteStream(archive));

await rm(DIR, { recursive: true, force: true });
await mkdir(DIR, { recursive: true });

/*
  Unpacked with the platform's own tool rather than a dependency.

  `tar` is present on Windows 10+, macOS and Linux, and Expand-Archive handles
  the zip. Adding `adm-zip` to the root package for a script that runs once per
  machine is a dependency the application would then carry for ever.
*/
const unpack =
  ext === "zip"
    ? spawnSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -Path '${archive}' -DestinationPath '${DIR}' -Force`],
        { stdio: "inherit" },
      )
    : spawnSync("tar", ["-xzf", archive, "-C", DIR], { stdio: "inherit" });

if (unpack.status !== 0) throw new Error("Entpacken fehlgeschlagen.");
await rm(archive, { force: true });

// Some builds nest the binary one level down; flatten so the npm script's
// path is the same on every platform.
const entries = await readdir(DIR, { withFileTypes: true });
const nested = entries.find((e) => e.isDirectory());
if (nested && !entries.some((e) => e.isFile() && e.name.startsWith("mailpit"))) {
  for (const file of await readdir(join(DIR, nested.name))) {
    await rename(join(DIR, nested.name, file), join(DIR, file));
  }
  await rm(join(DIR, nested.name), { recursive: true, force: true });
}

console.log(`Bereit. Starten mit: npm run mail:catcher`);
console.log("  SMTP  localhost:1025");
console.log("  Web   http://localhost:8025");
