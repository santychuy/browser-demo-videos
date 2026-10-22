import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

export const AGENT_BROWSER_VERSION = "0.39.1";
export const LIVE_WS_VERSION = "8.22.0";

const require = createRequire(import.meta.url);

export function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(
      /((?:api[_-]?key|authorization|password|token)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
}

export function runProcess(
  file,
  args = [],
  { input, timeoutMs = 120000, env, cwd } = {},
) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      cwd,
      env: env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finishError = (message, code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = new Error(sanitizeDiagnostic(message));
      // Preserve structured subprocess output for transports that report errors as JSON.
      Object.assign(error, { stdout, stderr, code, timedOut });
      reject(error);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      finishError(`Cannot start ${file}: ${error.message}`),
    );
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE")
        finishError(`Cannot send input to ${file}: ${error.message}`);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (timedOut)
        return finishError(
          `${file} timed out after ${timeoutMs}ms; the operation may already have taken effect.`,
          code,
        );
      if (code !== 0)
        return finishError(
          `${file} exited ${code ?? signal ?? "unexpectedly"}${stderr.trim() ? `: ${stderr.trim().slice(0, 4000)}` : ""}`,
          code,
        );
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}

export function resolveTool(name) {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  const candidates =
    isAbsolute(name) || name.includes("/") || name.includes("\\")
      ? [resolve(name)]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .flatMap((directory) =>
            extensions.map((extension) => join(directory, name + extension)),
          );
  for (const candidate of candidates) {
    try {
      accessSync(
        candidate,
        process.platform === "win32" ? constants.F_OK : constants.X_OK,
      );
      return resolve(candidate);
    } catch {
      /* Continue through PATH. */
    }
  }
  return null;
}

function privatePrefix() {
  return join(
    resolve(
      process.env.BROWSER_DEMO_HOME ||
        join(homedir(), ".cache", "browser-demo-videos"),
    ),
    "runtime",
  );
}

function privateLivePrefix() {
  return join(
    resolve(
      process.env.BROWSER_DEMO_HOME ||
        join(homedir(), ".cache", "browser-demo-videos"),
    ),
    "live-runtime",
  );
}

export function resolveLiveWebSocket() {
  const packagePath = join(privateLivePrefix(), "node_modules", "ws");
  try {
    const manifest = JSON.parse(
      readFileSync(join(packagePath, "package.json"), "utf8"),
    );
    if (manifest.version !== LIVE_WS_VERSION) return null;
    const WebSocket = require(packagePath);
    return typeof WebSocket === "function" ? WebSocket : null;
  } catch {
    return null;
  }
}

function privateBrowser() {
  return join(
    privatePrefix(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "agent-browser.cmd" : "agent-browser",
  );
}

function compatibleBrowser(file) {
  if (!file) return false;
  const result = spawnSync(file, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    shell: false,
    windowsHide: true,
  });
  return (
    !result.error &&
    result.status === 0 &&
    /(?:^|\s)0\.39\.1(?:\s|$)/.test(result.stdout.trim())
  );
}

export function resolveAgentBrowser() {
  const global = resolveTool("agent-browser");
  if (compatibleBrowser(global)) return global;
  const local = resolveTool(privateBrowser());
  return compatibleBrowser(local) ? local : null;
}

export function browserEnvironment() {
  const ffmpeg = resolveTool("ffmpeg");
  return {
    ...process.env,
    PATH: ffmpeg
      ? `${dirname(ffmpeg)}${delimiter}${process.env.PATH ?? ""}`
      : (process.env.PATH ?? ""),
  };
}

export async function doctor({ deep = false } = {}) {
  const checks = [];
  checks.push({
    name: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 24,
    detail: `Node ${process.versions.node}; version 24 or newer is required.`,
  });
  const browser = resolveAgentBrowser();
  checks.push({
    name: "agent-browser",
    ok: Boolean(browser),
    detail: browser
      ? `${browser} (pinned ${AGENT_BROWSER_VERSION})`
      : `agent-browser ${AGENT_BROWSER_VERSION} not found; run setup --install.`,
  });
  const ffmpeg = resolveTool("ffmpeg");
  if (!ffmpeg) {
    checks.push({
      name: "ffmpeg",
      ok: false,
      detail:
        "ffmpeg not found; install it or explicitly use setup --install-system.",
    });
  } else {
    try {
      const result = await runProcess(ffmpeg, ["-hide_banner", "-encoders"], {
        timeoutMs: 15000,
      });
      const encoders = result.stdout + result.stderr;
      const missing = ["libx264", "aac"].filter(
        (name) => !new RegExp(`\\b${name}\\b`).test(encoders),
      );
      checks.push({
        name: "ffmpeg",
        ok: missing.length === 0,
        detail: missing.length
          ? `Missing required encoders: ${missing.join(", ")} (${ffmpeg}).`
          : `${ffmpeg}; libx264 and AAC encoders available.`,
      });
    } catch (error) {
      checks.push({
        name: "ffmpeg",
        ok: false,
        detail: sanitizeDiagnostic(error.message),
      });
    }
  }
  const ffprobe = resolveTool("ffprobe");
  if (ffprobe) {
    try {
      await runProcess(ffprobe, ["-version"], { timeoutMs: 15000 });
      checks.push({ name: "ffprobe", ok: true, detail: ffprobe });
    } catch (error) {
      checks.push({
        name: "ffprobe",
        ok: false,
        detail: sanitizeDiagnostic(error.message),
      });
    }
  } else {
    checks.push({
      name: "ffprobe",
      ok: false,
      detail: "ffprobe not found; install the FFmpeg tools.",
    });
  }
  const say = process.platform === "darwin" ? resolveTool("say") : null;
  checks.push({
    name: "system-narration",
    ok: true,
    detail: say
      ? `${say}; optional macOS system speech is available.`
      : "Optional macOS system speech is unavailable; use provider none or explicitly consent to Groq.",
  });
  const liveWebSocket = resolveLiveWebSocket();
  checks.push({
    name: "live-websocket",
    ok: true,
    optional: true,
    available: Boolean(liveWebSocket),
    detail: liveWebSocket
      ? `Optional GPT-Live transport ws ${LIVE_WS_VERSION} is available in ${privateLivePrefix()}.`
      : `Optional GPT-Live transport ws ${LIVE_WS_VERSION} is unavailable; run setup --install for openai-live narration. Other providers do not need it.`,
  });
  if (deep) {
    if (!browser) {
      checks.push({
        name: "browser-runtime",
        ok: false,
        detail:
          "Cannot inspect the browser runtime until the pinned agent-browser is installed.",
      });
    } else {
      try {
        const result = await runProcess(
          browser,
          ["doctor", "--json", "--offline"],
          { env: browserEnvironment() },
        );
        const report = JSON.parse(result.stdout);
        checks.push({
          name: "browser-runtime",
          ok: report.success === true,
          detail: sanitizeDiagnostic(JSON.stringify(report)),
        });
      } catch (error) {
        let detail = error.message;
        if (error.stdout) {
          try {
            detail = JSON.stringify(JSON.parse(error.stdout));
          } catch {
            /* Keep subprocess diagnostic, not arbitrary stdout. */
          }
        }
        checks.push({
          name: "browser-runtime",
          ok: false,
          detail: sanitizeDiagnostic(detail),
        });
      }
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

async function installSystemMedia() {
  let manager;
  let args;
  if (resolveTool("brew")) {
    manager = resolveTool("brew");
    args = ["install", "ffmpeg"];
  } else if (process.platform === "linux" && resolveTool("apt-get")) {
    manager = resolveTool("apt-get");
    args = ["install", "-y", "ffmpeg"];
  } else if (process.platform === "linux" && resolveTool("dnf")) {
    manager = resolveTool("dnf");
    args = ["install", "-y", "ffmpeg"];
  } else if (process.platform === "linux" && resolveTool("pacman")) {
    manager = resolveTool("pacman");
    args = ["-S", "--needed", "--noconfirm", "ffmpeg"];
  } else {
    throw new Error(
      "No supported existing package manager found (Homebrew, apt-get, dnf, pacman). Install FFmpeg and ffprobe manually, then run doctor. No sudo is invoked automatically.",
    );
  }
  try {
    await runProcess(manager, args, { timeoutMs: 600000 });
  } catch (error) {
    throw new Error(
      `${error.message} System installation never invokes sudo; arrange package-manager permissions explicitly or install FFmpeg manually.`,
    );
  }
}

export async function setup({ install = false, installSystem = false } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 24) return doctor();
  if (installSystem && (!resolveTool("ffmpeg") || !resolveTool("ffprobe")))
    await installSystemMedia();
  if (install) {
    let browser = resolveAgentBrowser();
    if (!browser) {
      const npm = resolveTool("npm");
      if (!npm)
        throw new Error(
          "npm is required to install the pinned private agent-browser runtime. Install Node 24 with npm, then retry setup --install.",
        );
      mkdirSync(privatePrefix(), { recursive: true });
      await runProcess(
        npm,
        [
          "install",
          "--prefix",
          privatePrefix(),
          "--no-save",
          "--no-audit",
          "--no-fund",
          `agent-browser@${AGENT_BROWSER_VERSION}`,
        ],
        { timeoutMs: 600000 },
      );
      browser = resolveAgentBrowser();
      if (!browser)
        throw new Error(
          `The private installation did not provide agent-browser ${AGENT_BROWSER_VERSION}.`,
        );
    }
    // Never pass --with-deps: OS dependency installation must remain explicit.
    await runProcess(browser, ["install"], {
      timeoutMs: 600000,
      env: browserEnvironment(),
    });
    if (!resolveLiveWebSocket()) {
      const npm = resolveTool("npm");
      if (!npm)
        throw new Error(
          "npm is required to install the optional pinned GPT-Live transport. Install Node 24 with npm, then retry setup --install.",
        );
      mkdirSync(privateLivePrefix(), { recursive: true });
      await runProcess(
        npm,
        [
          "install",
          "--prefix",
          privateLivePrefix(),
          "--no-save",
          "--no-audit",
          "--no-fund",
          "--ignore-scripts",
          "--omit=optional",
          `ws@${LIVE_WS_VERSION}`,
        ],
        { timeoutMs: 600000 },
      );
      if (!resolveLiveWebSocket())
        throw new Error(
          `The private installation did not provide GPT-Live transport ws ${LIVE_WS_VERSION}.`,
        );
    }
  }
  return doctor({ deep: install });
}
