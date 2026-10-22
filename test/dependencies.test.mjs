import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function discoveryPackage(directory, version) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "ws", version, main: "index.cjs" }),
  );
  // A discovery-only constructor sentinel: it is never used as a WebSocket.
  await writeFile(
    join(directory, "index.cjs"),
    'module.exports = require("node:events").EventEmitter;\n',
  );
}

test("a copied skill resolves only the exact pinned private Live transport, never ambient ws", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "browser-demo-dependencies-"));
  const previousHome = process.env.BROWSER_DEMO_HOME;
  const previousCwd = process.cwd();
  t.after(async () => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.BROWSER_DEMO_HOME;
    else process.env.BROWSER_DEMO_HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });

  const skillDirectory = join(directory, "copied-skill", "scripts", "lib");
  await mkdir(skillDirectory, { recursive: true });
  const copiedModule = join(skillDirectory, "dependencies.mjs");
  await copyFile(
    new URL(
      "../skills/browser-demo-videos/scripts/lib/dependencies.mjs",
      import.meta.url,
    ),
    copiedModule,
  );
  await discoveryPackage(join(directory, "node_modules", "ws"), "8.22.0");
  const unrelatedCwd = join(directory, "unrelated-working-directory");
  await mkdir(unrelatedCwd);
  process.chdir(unrelatedCwd);
  process.env.BROWSER_DEMO_HOME = join(directory, "private-cache");
  const { resolveLiveWebSocket } = await import(
    pathToFileURL(copiedModule).href
  );

  assert.equal(
    resolveLiveWebSocket(),
    null,
    "an available ancestor package must not satisfy an absent private transport",
  );
  const privatePackage = join(
    process.env.BROWSER_DEMO_HOME,
    "live-runtime",
    "node_modules",
    "ws",
  );
  await discoveryPackage(privatePackage, "8.21.0");
  assert.equal(
    resolveLiveWebSocket(),
    null,
    "an executable but incorrectly versioned private package must be rejected",
  );
  await discoveryPackage(privatePackage, "8.22.0");
  assert.equal(
    resolveLiveWebSocket(),
    EventEmitter,
    "the pinned private constructor must resolve from a copied skill and unrelated cwd",
  );
});
