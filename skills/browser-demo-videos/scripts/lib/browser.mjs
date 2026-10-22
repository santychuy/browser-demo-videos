import {
  browserEnvironment,
  resolveAgentBrowser,
  runProcess,
  sanitizeDiagnostic,
} from "./dependencies.mjs";

export function createBrowser({ session } = {}) {
  // Session is the sole user value that must appear in the native global argv parser.
  if (
    typeof session !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(session)
  ) {
    throw new Error(
      "A session name is required: use 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit.",
    );
  }
  const executable = resolveAgentBrowser();
  if (!executable)
    throw new Error(
      "Pinned agent-browser 0.39.1 is unavailable. Run browser-demo setup --install.",
    );
  const env = browserEnvironment();

  async function transport(
    args,
    { input, timeoutMs = 120000, batch = false } = {},
  ) {
    let result;
    let processError;
    try {
      result = await runProcess(
        executable,
        ["--session", session, "--json", ...args],
        { input, timeoutMs, env },
      );
    } catch (error) {
      processError = error;
      result = { stdout: error.stdout ?? "" };
    }
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      if (processError) throw processError;
      throw new Error(
        "agent-browser returned invalid JSON. Run browser-demo doctor --deep to inspect the runtime.",
      );
    }
    const response =
      batch && Array.isArray(payload) && payload.length === 1
        ? payload[0]
        : payload;
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      typeof response.success !== "boolean"
    ) {
      if (processError) throw processError;
      throw new Error(
        "agent-browser returned an unexpected JSON response. The pinned runtime is required.",
      );
    }
    if (!response.success) {
      const detail =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error ?? "Browser command failed.");
      const code = typeof response.code === "string" ? response.code : null;
      const error = new Error(
        sanitizeDiagnostic(
          `${code ? `${code}: ` : ""}${detail}${code === "outcome_unknown" ? " The operation may already have executed; inspect the page before retrying." : ""}`,
        ),
      );
      if (code) error.code = code;
      throw error;
    }
    if (processError) throw processError;
    return batch ? response.result : response.data;
  }

  return {
    async command(args, { timeoutMs = 120000 } = {}) {
      if (
        !Array.isArray(args) ||
        !args.length ||
        args.some((argument) => typeof argument !== "string")
      ) {
        throw new Error("Browser command must be a nonempty array of strings.");
      }
      // v0.39.1 scans global flags even inside positional operands. Its native batch
      // stdin parser preserves literal fill text such as "--headed" without replay.
      return transport(["batch", "--bail"], {
        input: JSON.stringify([args]),
        timeoutMs,
        batch: true,
      });
    },
    async evaluate(source, { timeoutMs = 35000 } = {}) {
      if (typeof source !== "string" || !source.trim())
        throw new Error("Browser evaluation source must be nonempty text.");
      // Source never enters argv. The native eval socket itself has a ~30s deadline;
      // callers must not await long presentation holds inside the page evaluation.
      const data = await transport(["eval", "--stdin"], {
        input: source,
        timeoutMs,
      });
      if (!data || !Object.hasOwn(data, "result"))
        throw new Error(
          "agent-browser eval response did not contain data.result.",
        );
      return data.result;
    },
    async close() {
      return transport(["batch", "--bail"], {
        input: JSON.stringify([["close"]]),
        batch: true,
      });
    },
  };
}
