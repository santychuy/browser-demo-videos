import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  loadPlan,
  validatePlan,
} from "../skills/browser-demo-videos/scripts/lib/plan.mjs";
import { prepareNarration } from "../skills/browser-demo-videos/scripts/lib/narration.mjs";

const execute = promisify(execFile);
const cli = fileURLToPath(
  new URL("../skills/browser-demo-videos/scripts/cli.mjs", import.meta.url),
);

function story() {
  return {
    version: 1,
    title: "Project export",
    url: "http://127.0.0.1:4173/",
    scenes: [
      {
        id: "overview",
        text: "Review the projects.",
        target: "#projects",
        waitFor: { selector: "#projects" },
      },
    ],
  };
}

// These are independent admission/security contracts, not copies of normalized
// defaults: a widened schema must not silently acquire an execution capability.
test("plan admission rejects unknown fields and non-native execution capabilities", () => {
  const cases = [
    [
      "root script",
      (plan) => {
        plan.script = "process.exit()";
      },
      /\$\.script/,
    ],
    [
      "scene eval",
      (plan) => {
        plan.scenes[0].eval = 'window.location="https://example.com"';
      },
      /scenes\[0\]\.eval/,
    ],
    [
      "shell action",
      (plan) => {
        plan.scenes[0].actions = [{ type: "shell", command: "touch file" }];
      },
      /actions\[0\]/,
    ],
    [
      "eval action",
      (plan) => {
        plan.scenes[0].actions = [{ type: "eval", value: "1" }];
      },
      /actions\[0\]\.type/,
    ],
    [
      "cross-action field",
      (plan) => {
        plan.scenes[0].actions = [
          { type: "click", selector: "#projects", value: "unexpected" },
        ];
      },
      /actions\[0\]\.value/,
    ],
    [
      "unknown viewport option",
      (plan) => {
        plan.viewport = { width: 1280, height: 720, deviceScaleFactor: 4 };
      },
      /viewport\.deviceScaleFactor/,
    ],
    [
      "unknown provider option",
      (plan) => {
        plan.narration = { provider: "openai", apiKey: "not-a-secret" };
      },
      /narration\.apiKey/,
    ],
    [
      "cloud model override",
      (plan) => {
        plan.narration = { provider: "openai", model: "arbitrary-model" };
      },
      /narration\.model/,
    ],
    [
      "cloud endpoint override",
      (plan) => {
        plan.narration = { provider: "xai", endpoint: "https://example.com/" };
      },
      /narration\.endpoint/,
    ],
    [
      "unknown wait condition",
      (plan) => {
        plan.scenes[0].waitFor = { selector: "#projects", script: "true" };
      },
      /waitFor\.script/,
    ],
    [
      "own prototype key",
      (plan) => {
        Object.defineProperty(plan, "__proto__", {
          value: {},
          enumerable: true,
        });
      },
      /\$\.__proto__/,
    ],
    ...["apiKey", "model", "endpoint", "url"].map((field) => [
      `Live ${field} override`,
      (plan) => {
        plan.narration = { provider: "openai-live", [field]: "not-allowed" };
      },
      new RegExp(`narration\\.${field}`),
    ]),
  ];
  for (const [name, change, expected] of cases) {
    const plan = story();
    change(plan);
    assert.throws(() => validatePlan(plan), expected, name);
  }
});

test("plan URLs and artifact identifiers cannot escape their supported boundaries", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "ftp://example.com/file",
    "https://user:password@example.com/",
    "/relative",
  ]) {
    const plan = story();
    plan.url = url;
    assert.throws(() => validatePlan(plan), /\$\.url/, url);
    const navigation = story();
    navigation.scenes[0].actions = [{ type: "navigate", url }];
    assert.throws(
      () => validatePlan(navigation),
      /actions\[0\]\.url/,
      `navigation ${url}`,
    );
  }
  for (const id of [
    "../escape",
    "/absolute",
    ".hidden",
    "a/b",
    "a\\b",
    "x".repeat(65),
  ]) {
    const plan = story();
    plan.scenes[0].id = id;
    assert.throws(() => validatePlan(plan), /scenes\[0\]\.id/, id);
  }
  const duplicate = story();
  duplicate.scenes.push({ id: "overview", text: "A second scene." });
  assert.throws(() => validatePlan(duplicate), /duplicate scene id/);
});

test("plan rejects malformed, unbounded and coerced values at their owning field", () => {
  const cases = [
    [
      (plan) => {
        plan.version = "1";
      },
      /version/,
    ],
    [
      (plan) => {
        plan.scenes = [];
      },
      /scenes/,
    ],
    [
      (plan) => {
        plan.scenes = Array.from({ length: 101 }, (_, i) => ({
          id: `scene-${i}`,
          text: "Scene",
        }));
      },
      /scenes/,
    ],
    [
      (plan) => {
        plan.viewport = { width: 3841, height: 720 };
      },
      /viewport\.width/,
    ],
    [
      (plan) => {
        plan.viewport = { width: 1280, height: 2161 };
      },
      /viewport\.height/,
    ],
    [
      (plan) => {
        plan.viewport = { width: 0, height: 720 };
      },
      /viewport\.width/,
    ],
    [
      (plan) => {
        plan.viewport = undefined;
      },
      /viewport/,
    ],
    [
      (plan) => {
        plan.narration = null;
      },
      /narration/,
    ],
    [
      (plan) => {
        plan.scenes[0].spotlight = "true";
      },
      /spotlight/,
    ],
    [
      (plan) => {
        plan.scenes[0].text = " ";
      },
      /\.text/,
    ],
    [
      (plan) => {
        plan.scenes[0].text = "a".repeat(601);
      },
      /\.text/,
    ],
    [
      (plan) => {
        plan.scenes[0].text = "contains\0nul";
      },
      /\.text/,
    ],
    ...[1499, 60001, 2000.5, Infinity, "2000"].map((value) => [
      (plan) => {
        plan.scenes[0].holdMs = value;
      },
      /holdMs/,
    ]),
    [
      (plan) => {
        plan.scenes[0].target = "@e12";
      },
      /target/,
    ],
    [
      (plan) => {
        plan.scenes[0].target = "--headed";
      },
      /target/,
    ],
    [
      (plan) => {
        plan.scenes[0].waitFor = { timeoutMs: 500 };
      },
      /requires selector, text or url/,
    ],
    [
      (plan) => {
        plan.scenes[0].waitFor = { selector: "#projects", timeoutMs: 60001 };
      },
      /timeoutMs/,
    ],
    [
      (plan) => {
        plan.scenes[0].actions = null;
      },
      /actions/,
    ],
    [
      (plan) => {
        plan.scenes[0].actions = [{ type: ["click"], selector: "#projects" }];
      },
      /actions\[0\]\.type/,
    ],
    [
      (plan) => {
        plan.scenes[0].actions = [
          { type: "scroll", direction: "sideways", amount: 400 },
        ];
      },
      /direction/,
    ],
    [
      (plan) => {
        plan.scenes[0].actions = [
          { type: "scroll", direction: "down", amount: 0 },
        ];
      },
      /amount/,
    ],
    [
      (plan) => {
        plan.scenes[0].actions = [{ type: "press", key: "--session" }];
      },
      /\.key/,
    ],
  ];
  for (const [change, expected] of cases) {
    const plan = story();
    change(plan);
    assert.throws(() => validatePlan(plan), expected);
  }
});

test("legal Unicode captions and boundary values remain usable without truncation", () => {
  const plan = story();
  plan.viewport = { width: 3840, height: 2160 };
  plan.scenes[0].text = "🧭".repeat(600);
  plan.scenes[0].holdMs = 60000;
  plan.scenes[0].actions = [
    { type: "fill", selector: "#search", value: "--headed" },
  ];
  const normalized = validatePlan(plan);
  assert.equal(normalized.scenes[0].text, plan.scenes[0].text);
  assert.equal(normalized.scenes[0].holdMs, 60000);
  assert.equal(normalized.scenes[0].actions[0].value, "--headed");
});

test("cloud voice validation keeps provider identities separate and supports safe dynamic xAI IDs", () => {
  for (const [provider, voice, defaultVoice] of [
    ["groq", "troy", "troy"],
    ["openai", "cedar", "marin"],
    ["openai-live", "quartz", "marin"],
    ["xai", "future_voice-42", "eve"],
  ]) {
    const plan = story();
    plan.narration = { provider, voice };
    plan.scenes[0].narration = "Explain the actual project view.";
    const normalized = validatePlan(plan);
    assert.deepEqual(normalized.narration, { provider, voice });
    assert.equal(
      normalized.scenes[0].narration,
      "Explain the actual project view.",
    );
    plan.narration = { provider };
    assert.deepEqual(validatePlan(plan).narration, {
      provider,
      voice: defaultVoice,
    });
  }
  for (const narration of [
    { provider: "grok" },
    { provider: "openai", voice: "troy" },
    { provider: "groq", voice: "marin" },
    { provider: "openai-live", voice: "cedar" },
    { provider: "openai-live", voice: "eve" },
    { provider: "openai", voice: "quartz" },
    { provider: "none", voice: "marin" },
    { provider: "openai", voice: "--help" },
    { provider: "system", voice: "--help" },
    ...[
      "",
      " ",
      "--help",
      "eve\nother",
      "../eve",
      "eve name",
      "éve",
      "a".repeat(101),
    ].map((voice) => ({ provider: "xai", voice })),
  ]) {
    const plan = story();
    plan.narration = narration;
    assert.throws(() => validatePlan(plan), /narration\.(provider|voice)/);
  }
  const maximum = story();
  maximum.narration = { provider: "xai", voice: "v".repeat(100) };
  assert.equal(validatePlan(maximum).narration.voice.length, 100);
});

test("record and rehearsal narration overrides replace provider voices and require cloud consent before output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-demo-cli-voice-"));
  const file = join(directory, "plan.json");
  const plan = story();
  plan.narration = { provider: "system", voice: "Samantha" };
  try {
    await writeFile(file, JSON.stringify(plan));
    for (const command of ["record", "rehearse"]) {
      for (const [provider, voice] of [
        ["openai", undefined],
        ["openai-live", undefined],
        ["xai", "future_voice-42"],
        ["groq", undefined],
      ]) {
        const output = join(directory, `${command}-${provider}`);
        await assert.rejects(
          execute(
            process.execPath,
            [
              "--no-env-file",
              cli,
              command,
              file,
              "--session",
              "voice-boundary",
              "--output",
              output,
              "--narration",
              provider,
              ...(voice === undefined ? [] : ["--voice", voice]),
            ],
            {
              env: {
                PATH: process.env.PATH,
                OPENAI_API_KEY: "fake-openai-no-request",
                XAI_API_KEY: "fake-xai-no-request",
                GROQ_API_KEY: "fake-groq-no-request",
              },
            },
          ),
          (error) => {
            assert.equal(error.code, 1);
            assert.equal(error.stdout, "");
            const diagnostic = JSON.parse(error.stderr);
            assert.match(diagnostic.error, /--allow-cloud/);
            assert.match(
              diagnostic.error.toLowerCase(),
              new RegExp(provider === "openai-live" ? "gpt-live" : provider),
            );
            assert.doesNotMatch(error.stderr, /fake-.*-no-request/);
            return true;
          },
        );
      }
    }
    assert.deepEqual(await readdir(directory), ["plan.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI voice overrides reject unsafe combinations and revalidate the selected provider's script limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-demo-cli-override-"));
  const file = join(directory, "plan.json");
  const plan = story();
  plan.narration = { provider: "openai", voice: "cedar" };
  plan.scenes[0].narration = "🧭".repeat(1001);
  try {
    await writeFile(file, JSON.stringify(plan));
    for (const command of ["record", "rehearse"]) {
      for (const [flags, expected] of [
        [["--voice", "eve"], /--voice requires --narration/],
        [["--narration", "grok"], /narration\.provider/],
        [["--narration", "none", "--voice", "eve"], /narration\.voice/],
        [["--narration", "openai", "--voice", "troy"], /narration\.voice/],
        [
          ["--narration", "openai-live", "--voice", "cedar"],
          /narration\.voice/,
        ],
        [["--narration", "xai", "--voice=--help"], /narration\.voice/],
        [["--narration", "groq"], /200 characters/],
        [["--narration", "openai-live"], /4000 UTF-8 byte limit/],
        ...(command === "rehearse"
          ? [
              [
                ["--narration", "system", "--allow-cloud"],
                /Unknown option for rehearse/,
              ],
            ]
          : []),
      ]) {
        await assert.rejects(
          execute(process.execPath, [
            "--no-env-file",
            cli,
            command,
            file,
            "--session",
            "override-boundary",
            "--output",
            join(directory, "must-not-exist"),
            ...flags,
          ]),
          (error) => {
            assert.equal(error.code, 1);
            assert.equal(error.stdout, "");
            assert.match(JSON.parse(error.stderr).error, expected);
            return true;
          },
        );
      }
    }
    assert.deepEqual(await readdir(directory), ["plan.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Groq Preview preflights the final scene before creating artifacts or requesting speech", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "browser-demo-groq-boundary-"),
  );
  const plan = story();
  plan.narration = { provider: "groq", voice: "troy" };
  plan.scenes[0].narration = "A short first scene.";
  plan.scenes.push({
    id: "too-long",
    text: "Keep the caption short.",
    narration: "🧭".repeat(201),
  });
  try {
    await assert.rejects(
      prepareNarration(plan, {
        directory: join(directory, "must-not-exist"),
        allowCloud: false,
      }),
      /200 characters/,
    );
    // Reading the real directory guards the no-side-effect boundary without a
    // provider mock or any credential/network access.
    assert.deepEqual(await readdir(directory), []);
    plan.scenes[1].narration = "🧭".repeat(200);
    assert.equal(
      validatePlan(plan).scenes[1].narration,
      plan.scenes[1].narration,
    );
    plan.narration.voice = "not-a-supported-voice";
    assert.throws(() => validatePlan(plan), /narration\.voice/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("GPT-Live preflights every script against the application UTF-8 byte bound without truncation", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "browser-demo-live-boundary-"),
  );
  const plan = story();
  plan.narration = { provider: "openai-live" };
  plan.scenes.push({
    id: "too-long",
    text: "Keep the caption short.",
    narration: "🧭".repeat(1001),
  });
  try {
    await assert.rejects(
      prepareNarration(plan, {
        directory: join(directory, "must-not-exist"),
      }),
      /4000 UTF-8 byte limit/,
    );
    assert.deepEqual(await readdir(directory), []);
    for (const narration of ["a".repeat(4000), "🧭".repeat(1000)]) {
      plan.scenes[1].narration = narration;
      assert.equal(validatePlan(plan).scenes[1].narration, narration);
      plan.scenes[1].narration += "a";
      assert.throws(() => validatePlan(plan), /4000 UTF-8 byte limit/);
    }
    // The original Chat provider does not inherit the Live capture bound.
    plan.narration = { provider: "openai" };
    plan.scenes[1].narration = "a".repeat(10000);
    assert.equal(validatePlan(plan).scenes[1].narration.length, 10000);
    plan.scenes[1].narration += "a";
    assert.throws(() => validatePlan(plan), /10000 characters/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loading rejects invalid JSON and oversized input without accepting a partial plan", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "browser-demo-plan-boundary-"),
  );
  const file = join(directory, "plan.json");
  try {
    await writeFile(file, '{"version":1,');
    await assert.rejects(loadPlan(file), /Cannot parse plan JSON/);
    await writeFile(file, " ".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(loadPlan(file), /2 MiB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
