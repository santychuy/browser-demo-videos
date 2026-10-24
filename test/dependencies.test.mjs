import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

test(
  "Bun doctor and setup reject missing or old actual upstream Node, not Bun's emulated Node version",
  {
    skip: process.platform === "win32" && "Fixture uses a POSIX executable",
  },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "browser-demo-node-prerequisite-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const cli = fileURLToPath(
      new URL("../skills/browser-demo-videos/scripts/cli.mjs", import.meta.url),
    );
    for (const scenario of ["missing", "old"]) {
      const bin = join(directory, scenario);
      await mkdir(bin);
      if (scenario === "old") {
        const node = join(bin, "node");
        await writeFile(node, "#!/bin/sh\nprintf 'v22.0.0\\n'\n");
        await chmod(node, 0o755);
      }
      for (const args of [
        ["doctor"],
        ["setup", "--install", "--install-system"],
      ]) {
        const result = spawnSync(
          process.execPath,
          ["--no-env-file", cli, ...args],
          {
            cwd: directory,
            env: {
              PATH: bin,
              HOME: directory,
              BROWSER_DEMO_HOME: join(directory, "private-cache"),
            },
            encoding: "utf8",
            timeout: 10000,
          },
        );
        assert.ifError(result.error);
        assert.equal(
          result.status,
          1,
          `${args[0]} must reject ${scenario} Node`,
        );
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(
          report.checks.find((check) => check.name === "bun")?.ok,
          true,
        );
        const node = report.checks.find((check) => check.name === "node");
        assert.equal(
          node?.ok,
          false,
          `${args[0]} must inspect the actual PATH Node`,
        );
        assert.match(
          node.detail,
          scenario === "old" ? /v22\.0\.0/ : /not found on PATH/,
        );
      }
    }
  },
);
