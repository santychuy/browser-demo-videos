#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["scripts", "skills/browser-demo-videos", "test"];
const excludedDirectories = new Set([
  "node_modules",
  "runtime",
  "artifacts",
  "demo-output",
  "output",
  "outputs",
  "recordings",
  "screenshots",
]);

function* sourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".") || excludedDirectories.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) yield path;
  }
}

for (const directory of sourceRoots) {
  for (const file of sourceFiles(join(root, directory))) {
    const result = spawnSync(process.execPath, ["--check", file], {
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
