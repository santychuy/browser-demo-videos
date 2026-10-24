#!/usr/bin/env -S bun --no-env-file
import { resolve } from "node:path";
import { startDemoServer } from "../assets/demo/server.mjs";
import { createBrowser } from "./lib/browser.mjs";
import {
  doctor,
  runtimePrerequisites,
  sanitizeDiagnostic,
  setup,
} from "./lib/dependencies.mjs";
import { clearScript, sceneScript } from "./lib/overlay.mjs";
import { loadPlan, validatePlan } from "./lib/plan.mjs";
import { runPlan } from "./lib/run.mjs";

const VERSION = "0.1.0";
const HELP = `browser-demo ${VERSION} — local browser demonstration videos

Usage:
  browser-demo doctor [--deep]
  browser-demo setup [--install] [--install-system]
  browser-demo validate PLAN
  browser-demo rehearse PLAN --session NAME [--output DIR]
                         [--narration PROVIDER] [--voice VOICE]
  browser-demo record PLAN --session NAME --output DIR [--allow-cloud]
                       [--narration PROVIDER] [--voice VOICE]
  browser-demo demo --session NAME --output DIR [--allow-cloud]
                    [--narration PROVIDER] [--voice VOICE]
  browser-demo scene --session NAME --text TEXT [--target CSS] [--title TITLE]
                     [--placement auto|above|below|left|right|bottom]
                     [--spotlight] [--hold MS]
  browser-demo clear --session NAME
  browser-demo --help
  browser-demo --version

Bun 1.4.4+ runs this CLI; upstream agent-browser and skills launchers need Node 24+ on PATH.
setup checks only unless installation is explicitly requested.
setup --install also installs the optional private pinned GPT-Live WebSocket transport.
All browser operations use your explicit session; no authenticated profile is imported.
scene --hold accepts 0–25000ms. Longer scenes belong in a plan.
Narration providers: none, system, groq, openai, xai, openai-live. --voice requires --narration.
Cloud narration requires the selected provider's API key and record/demo --allow-cloud.
demo runs the bundled synthetic workspace with captions by default; no server or key needed.
openai-live uses gpt-live-1 billed sessions captured per scene before browser recording.
Live capture sends paced silence (no microphone) and waits for final session usage on close.
An absent key falls back to macOS Samantha; errors from configured keys never do.
Use --narration system for predictable local-only rehearsal (macOS speech).
The skill includes its runtime: invoke this file with bun --no-env-file after copying the skill.
`;

const commands = {
  doctor: { positional: 0, options: { deep: "boolean" } },
  setup: {
    positional: 0,
    options: { install: "boolean", "install-system": "boolean" },
  },
  validate: { positional: 1, options: {} },
  rehearse: {
    positional: 1,
    options: {
      session: "string",
      output: "string",
      narration: "string",
      voice: "string",
    },
  },
  record: {
    positional: 1,
    options: {
      session: "string",
      output: "string",
      "allow-cloud": "boolean",
      narration: "string",
      voice: "string",
    },
  },
  demo: {
    positional: 0,
    options: {
      session: "string",
      output: "string",
      "allow-cloud": "boolean",
      narration: "string",
      voice: "string",
    },
  },
  scene: {
    positional: 0,
    options: {
      session: "string",
      text: "string",
      target: "string",
      title: "string",
      placement: "string",
      spotlight: "boolean",
      hold: "string",
    },
  },
  clear: { positional: 0, options: { session: "string" } },
};

function parse(argv) {
  const [command, ...arguments_] = argv;
  if (!Object.hasOwn(commands, command ?? ""))
    throw new Error(
      `Unknown or missing command: ${command ?? "(none)"}. Use --help.`,
    );
  const specification = commands[command];
  const options = {};
  const positional = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (!argument.startsWith("--"))
      throw new Error(`Unknown option: ${argument}. Use --help.`);
    const equals = argument.indexOf("=");
    const name = argument.slice(2, equals < 0 ? undefined : equals);
    if (!Object.hasOwn(specification.options, name))
      throw new Error(`Unknown option for ${command}: --${name}.`);
    if (Object.hasOwn(options, name))
      throw new Error(`Repeated option: --${name}.`);
    if (specification.options[name] === "boolean") {
      if (equals >= 0) throw new Error(`--${name} does not take a value.`);
      options[name] = true;
    } else {
      const value =
        equals >= 0 ? argument.slice(equals + 1) : arguments_[++index];
      if (!value || (equals < 0 && value.startsWith("--")))
        throw new Error(`--${name} requires a nonempty value.`);
      options[name] = value;
    }
  }
  if (positional.length !== specification.positional) {
    throw new Error(
      `${command} requires ${specification.positional === 1 ? "exactly one PLAN path" : "no positional arguments"}. Use --help.`,
    );
  }
  return { command, options, positional };
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`--${name} is required.`);
  return value;
}

function emit(value) {
  process.stdout.write(
    `${JSON.stringify(value, (_key, item) => (typeof item === "string" ? sanitizeDiagnostic(item) : item), 2)}\n`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.length === 1 && argv[0] === "--version") {
    emit({ version: VERSION });
    return;
  }
  if (
    argv.length === 2 &&
    Object.hasOwn(commands, argv[0]) &&
    argv[1] === "--help"
  ) {
    process.stdout.write(HELP);
    return;
  }
  const { command, options, positional } = parse(argv);
  if (command === "doctor") {
    const report = await doctor({ deep: options.deep ?? false });
    emit(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "setup") {
    const report = await setup({
      install: options.install ?? false,
      installSystem: options["install-system"] ?? false,
    });
    emit(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const failedPrerequisite = (await runtimePrerequisites()).find(
    (check) => !check.ok,
  );
  if (failedPrerequisite) throw new Error(failedPrerequisite.detail);
  if (command === "validate") {
    emit({ ok: true, plan: await loadPlan(positional[0]) });
    return;
  }
  if (command === "rehearse" || command === "record" || command === "demo") {
    if (options.voice !== undefined && options.narration === undefined)
      throw new Error("--voice requires --narration.");
    const session = required(options, "session");
    const outputDir = resolve(
      command !== "rehearse"
        ? required(options, "output")
        : (options.output ?? "browser-demo-rehearsal"),
    );
    let fixture;
    try {
      if (command === "demo") fixture = await startDemoServer({ port: 0 });
      const loaded = await loadPlan(
        command === "demo"
          ? new URL("../assets/demo/walkthrough.json", import.meta.url)
          : positional[0],
      );
      const source = fixture
        ? validatePlan({ ...loaded, url: fixture.url })
        : loaded;
      const plan =
        options.narration === undefined
          ? source
          : validatePlan({
              ...source,
              narration: {
                provider: options.narration,
                ...(options.voice === undefined
                  ? {}
                  : { voice: options.voice }),
              },
            });
      const manifest = await runPlan(plan, {
        session,
        outputDir,
        record: command !== "rehearse",
        allowCloud: options["allow-cloud"] ?? false,
      });
      if (manifest.narration.fallbackReason === "missing-api-key")
        process.stderr.write(
          `${JSON.stringify({
            warning: "missing-api-key",
            requestedProvider: manifest.narration.requestedProvider,
            provider: manifest.narration.provider,
            voice: manifest.narration.voice,
            message: `No API key is configured for ${manifest.narration.requestedProvider}; used local Samantha narration. No cloud request was made.`,
          })}\n`,
        );
      emit({ ok: true, manifest });
    } finally {
      await fixture?.close();
    }
    return;
  }
  const session = required(options, "session");
  if (command === "clear") {
    const browser = createBrowser({ session });
    emit({ ok: true, result: await browser.evaluate(clearScript()) });
    return;
  }
  const text = required(options, "text");
  if (text.length > 600)
    throw new Error(
      "--text must contain at most 600 characters; keep captions concise.",
    );
  const placement = options.placement ?? "auto";
  if (
    !["auto", "above", "below", "left", "right", "bottom"].includes(placement)
  )
    throw new Error(
      "--placement must be auto, above, below, left, right or bottom.",
    );
  let holdMs;
  if (options.hold !== undefined) {
    if (!/^\d+$/.test(options.hold))
      throw new Error(
        "--hold must be an integer number of milliseconds from 0 to 25000.",
      );
    holdMs = Number(options.hold);
    if (!Number.isSafeInteger(holdMs) || holdMs > 25000)
      throw new Error(
        "--hold must be at most 25000ms because native browser eval has a ~30s deadline. Use plan holds for longer scenes.",
      );
  }
  if (options.target !== undefined && !options.target.trim())
    throw new Error("--target must be a nonempty CSS selector.");
  const browser = createBrowser({ session });
  const result = await browser.evaluate(
    sceneScript({
      text,
      title: options.title,
      target: options.target,
      placement,
      spotlight: options.spotlight ?? false,
      holdMs,
    }),
  );
  emit({ ok: true, result });
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: sanitizeDiagnostic(error.message ?? "Command failed.") })}\n`,
  );
  process.exitCode = 1;
});
