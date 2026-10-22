import { readFile } from "node:fs/promises";

const placements = new Set([
  "auto",
  "above",
  "below",
  "left",
  "right",
  "bottom",
]);
const groqVoices = new Set([
  "autumn",
  "diana",
  "hannah",
  "austin",
  "daniel",
  "troy",
]);
const narrationVoices = {
  system: "Samantha",
  groq: "troy",
  openai: "marin",
  "openai-live": "marin",
  xai: "eve",
};
const openaiVoices = new Set(["marin", "cedar"]);
const liveVoices = new Set([
  "marin",
  "quartz",
  "ripple",
  "vesper",
  "willow",
  "stone",
  "gleam",
  "meridian",
  "bossa",
  "tempo",
  "beacon",
  "delta",
  "cinder",
  "nuri",
  "juni",
  "flitz",
  "brise",
  "sillage",
  "nira",
  "harema",
  "shida",
  "noeul",
]);

function fail(path, message) {
  throw new Error(`Invalid plan ${path}: ${message}`);
}

function object(value, path, allowed) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(path, "expected an object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      fail(
        `${path}.${key}`,
        "unknown field (scripts, eval and shell actions are not supported)",
      );
  }
  return value;
}

function text(value, path, max, { empty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    [...value].length > max ||
    value.includes("\0")
  ) {
    fail(
      path,
      `expected ${empty ? "a" : "a nonempty"} string of at most ${max} characters without NUL`,
    );
  }
  return value;
}

function integer(value, path, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(path, `expected an integer from ${min} to ${max}`);
  return value;
}

function url(value, path) {
  text(value, path, 8192);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(path, "expected an absolute http, https or file URL");
  }
  if (!["http:", "https:", "file:"].includes(parsed.protocol))
    fail(path, "only http, https and file URLs are supported");
  if (parsed.username || parsed.password)
    fail(
      path,
      "URL credentials are not allowed; authenticate in the explicit browser session instead",
    );
  return parsed.href;
}

function selector(value, path) {
  text(value, path, 2048);
  if (value.startsWith("-") || value.startsWith("@"))
    fail(
      path,
      "use a stable CSS selector, not a CLI option or browser snapshot reference",
    );
  return value;
}

function wait(value, path) {
  object(value, path, ["selector", "text", "url", "timeoutMs"]);
  if (!["selector", "text", "url"].some((key) => Object.hasOwn(value, key)))
    fail(path, "requires selector, text or url");
  const result = {};
  if (Object.hasOwn(value, "selector"))
    result.selector = selector(value.selector, `${path}.selector`);
  if (Object.hasOwn(value, "text"))
    result.text = text(value.text, `${path}.text`, 2048);
  if (Object.hasOwn(value, "url"))
    result.url = text(value.url, `${path}.url`, 2048);
  result.timeoutMs = Object.hasOwn(value, "timeoutMs")
    ? integer(value.timeoutMs, `${path}.timeoutMs`, 1, 60000)
    : 15000;
  return result;
}

function action(value, path) {
  object(value, path, [
    "type",
    "selector",
    "value",
    "key",
    "direction",
    "amount",
    "url",
    "text",
    "timeoutMs",
  ]);
  const shapes = {
    click: ["type", "selector"],
    fill: ["type", "selector", "value"],
    press: ["type", "key"],
    scroll: ["type", "direction", "amount"],
    navigate: ["type", "url"],
    wait: ["type", "selector", "text", "url", "timeoutMs"],
  };
  if (typeof value.type !== "string" || !Object.hasOwn(shapes, value.type))
    fail(
      `${path}.type`,
      "expected click, fill, press, scroll, navigate or wait",
    );
  object(value, path, shapes[value.type]);
  switch (value.type) {
    case "click":
      return {
        type: "click",
        selector: selector(value.selector, `${path}.selector`),
      };
    case "fill":
      return {
        type: "fill",
        selector: selector(value.selector, `${path}.selector`),
        value: text(value.value, `${path}.value`, 10000, { empty: true }),
      };
    case "press": {
      const key = text(value.key, `${path}.key`, 100);
      if (key.startsWith("-"))
        fail(`${path}.key`, "must not start with a CLI option marker");
      return { type: "press", key };
    }
    case "scroll":
      if (!["up", "down"].includes(value.direction))
        fail(`${path}.direction`, "expected up or down");
      return {
        type: "scroll",
        direction: value.direction,
        amount: integer(value.amount, `${path}.amount`, 1, 10000),
      };
    case "navigate":
      return { type: "navigate", url: url(value.url, `${path}.url`) };
    case "wait": {
      const { type, ...conditions } = value;
      return { type, ...wait(conditions, path) };
    }
  }
}

export function validatePlan(value) {
  object(value, "$", [
    "version",
    "title",
    "url",
    "viewport",
    "narration",
    "scenes",
  ]);
  if (value.version !== 1) fail("$.version", "only version 1 is supported");
  const result = {
    version: 1,
    title: text(value.title, "$.title", 200),
    url: url(value.url, "$.url"),
  };
  const viewport = Object.hasOwn(value, "viewport")
    ? value.viewport
    : { width: 1280, height: 720 };
  object(viewport, "$.viewport", ["width", "height"]);
  result.viewport = {
    width: integer(viewport.width, "$.viewport.width", 1, 3840),
    height: integer(viewport.height, "$.viewport.height", 1, 2160),
  };
  const narration = Object.hasOwn(value, "narration")
    ? value.narration
    : { provider: "none" };
  object(narration, "$.narration", ["provider", "voice"]);
  if (
    !["none", "system", "groq", "openai", "openai-live", "xai"].includes(
      narration.provider,
    )
  )
    fail(
      "$.narration.provider",
      "expected none, system, groq, openai, openai-live or xai",
    );
  result.narration = { provider: narration.provider };
  if (narration.provider === "none") {
    if (Object.hasOwn(narration, "voice"))
      fail("$.narration.voice", "voice requires a narration provider");
  } else {
    const voice = Object.hasOwn(narration, "voice")
      ? text(narration.voice, "$.narration.voice", 100)
      : narrationVoices[narration.provider];
    if (voice.startsWith("-"))
      fail("$.narration.voice", "must not start with a CLI option marker");
    if (narration.provider === "groq" && !groqVoices.has(voice))
      fail(
        "$.narration.voice",
        "unsupported English Orpheus voice; use autumn, diana, hannah, austin, daniel or troy",
      );
    if (narration.provider === "openai" && !openaiVoices.has(voice))
      fail("$.narration.voice", "unsupported OpenAI voice; use marin or cedar");
    if (narration.provider === "openai-live" && !liveVoices.has(voice))
      fail("$.narration.voice", "unsupported OpenAI GPT-Live voice");
    if (
      narration.provider === "xai" &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(voice)
    )
      fail(
        "$.narration.voice",
        "xAI voice IDs must be 1 to 100 ASCII letters, digits, underscores or hyphens, starting with a letter or digit",
      );
    result.narration.voice = voice;
  }
  if (
    !Array.isArray(value.scenes) ||
    value.scenes.length < 1 ||
    value.scenes.length > 100
  )
    fail("$.scenes", "expected 1 to 100 scenes");
  const ids = new Set();
  result.scenes = value.scenes.map((scene, index) => {
    const path = `$.scenes[${index}]`;
    object(scene, path, [
      "id",
      "title",
      "text",
      "target",
      "placement",
      "spotlight",
      "holdMs",
      "narration",
      "actions",
      "waitFor",
    ]);
    const id = text(scene.id, `${path}.id`, 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id))
      fail(
        `${path}.id`,
        "use 1 to 64 ASCII letters, digits, underscores or hyphens, starting with a letter or digit",
      );
    if (ids.has(id)) fail(`${path}.id`, "duplicate scene id");
    ids.add(id);
    const caption = text(scene.text, `${path}.text`, 600);
    const words = caption.trim().split(/\s+/u).length;
    const normalized = {
      id,
      text: caption,
      placement: "auto",
      spotlight: false,
      holdMs: Math.min(
        60000,
        Math.max(1500, Math.ceil((words / 3) * 1000 + 500)),
      ),
      actions: [],
    };
    if (Object.hasOwn(scene, "title"))
      normalized.title = text(scene.title, `${path}.title`, 200);
    if (Object.hasOwn(scene, "target"))
      normalized.target = selector(scene.target, `${path}.target`);
    if (Object.hasOwn(scene, "placement")) {
      if (!placements.has(scene.placement))
        fail(`${path}.placement`, "unsupported caption placement");
      normalized.placement = scene.placement;
    }
    if (Object.hasOwn(scene, "spotlight")) {
      if (typeof scene.spotlight !== "boolean")
        fail(`${path}.spotlight`, "expected a boolean");
      normalized.spotlight = scene.spotlight;
    }
    if (Object.hasOwn(scene, "holdMs"))
      normalized.holdMs = integer(scene.holdMs, `${path}.holdMs`, 1500, 60000);
    if (Object.hasOwn(scene, "narration"))
      normalized.narration = text(scene.narration, `${path}.narration`, 10000);
    if (
      result.narration.provider === "groq" &&
      [...(normalized.narration ?? caption)].length > 200
    )
      fail(
        `${path}.narration`,
        "Groq Preview input is limited to 200 characters; shorten the narration or use system narration",
      );
    // Application capture bound, not a validation of the provider's token limits.
    if (
      result.narration.provider === "openai-live" &&
      Buffer.byteLength(normalized.narration ?? caption, "utf8") > 4000
    )
      fail(
        `${path}.narration`,
        "OpenAI GPT-Live narration exceeds this application's 4000 UTF-8 byte limit per scene; provider token limits are enforced separately",
      );
    if (Object.hasOwn(scene, "actions")) {
      if (!Array.isArray(scene.actions) || scene.actions.length > 100)
        fail(`${path}.actions`, "expected an array of at most 100 actions");
      normalized.actions = scene.actions.map((item, actionIndex) =>
        action(item, `${path}.actions[${actionIndex}]`),
      );
    }
    if (Object.hasOwn(scene, "waitFor"))
      normalized.waitFor = wait(scene.waitFor, `${path}.waitFor`);
    return normalized;
  });
  return result;
}

export async function loadPlan(file) {
  const raw = await readFile(file, "utf8");
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error("Plan exceeds the 2 MiB size limit");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot parse plan JSON: ${file}`);
  }
  return validatePlan(value);
}
