import {
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createBrowser } from "./browser.mjs";
import { doctor, resolveTool, runProcess } from "./dependencies.mjs";
import {
  prepareNarration,
  muxNarration,
  resolveNarration,
} from "./narration.mjs";
import { sceneScript, clearScript } from "./overlay.mjs";
import { validatePlan } from "./plan.mjs";

async function acquireOutput(directory) {
  await mkdir(dirname(directory), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Output must be a real directory, not a file or symbolic link",
    );
  if ((await readdir(directory)).length)
    throw new Error(
      "Output directory is not empty; choose a new directory (existing artifacts are never overwritten)",
    );
  const path = join(directory, ".browser-demo.lock");
  const handle = await open(path, "wx", 0o600);
  try {
    if (
      (await readdir(directory)).some((name) => name !== ".browser-demo.lock")
    )
      throw new Error(
        "Output directory changed while acquiring it; choose a new directory",
      );
  } catch (error) {
    await handle.close();
    await unlink(path);
    throw error;
  }
  return async () => {
    try {
      await handle.close();
    } finally {
      await unlink(path);
    }
  };
}

async function waitFor(browser, conditions) {
  const timeoutMs = conditions.timeoutMs ?? 15000;
  const options = { timeoutMs: timeoutMs + 15000 };
  // Multiple supplied predicates are all required; they are never a fixed sleep.
  if (conditions.selector !== undefined)
    await browser.command(
      ["wait", conditions.selector, "--timeout", String(timeoutMs)],
      options,
    );
  if (conditions.text !== undefined)
    await browser.command(
      ["wait", "--text", conditions.text, "--timeout", String(timeoutMs)],
      options,
    );
  if (conditions.url !== undefined)
    await browser.command(
      ["wait", "--url", conditions.url, "--timeout", String(timeoutMs)],
      options,
    );
}

async function documentReady(browser) {
  await browser.command(
    [
      "wait",
      "--fn",
      'document.readyState === "complete"',
      "--timeout",
      "15000",
    ],
    { timeoutMs: 30000 },
  );
}

async function perform(browser, action) {
  switch (action.type) {
    case "click":
      await browser.command(["click", action.selector]);
      break;
    case "fill":
      await browser.command(["fill", action.selector, action.value]);
      break;
    case "press":
      await browser.command(["press", action.key]);
      break;
    case "scroll":
      await browser.command([
        "scroll",
        action.direction,
        String(action.amount),
      ]);
      break;
    case "navigate":
      await browser.command(["open", action.url]);
      break;
    case "wait":
      await waitFor(browser, action);
      break;
  }
}

async function videoDuration(path) {
  const ffprobe = resolveTool("ffprobe");
  const { stdout } = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const durationMs = Number(JSON.parse(stdout).format?.duration) * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error(
      "Recorder produced no positive video duration; inspect raw.mp4 and browser diagnostics",
    );
  return durationMs;
}

function calibrateCapture(brackets, durationMs) {
  // The pinned recorder paces frames against wall time and adds a final frame.
  // Neither command returns the capture clock. Intersect start/stop brackets
  // with observed duration, allowing two frames for quantization/final frame.
  const frameAllowanceMs = 2000 / 30;
  const earliest = Math.max(
    brackets.startSent,
    brackets.stopSent - durationMs - frameAllowanceMs,
  );
  const latest = Math.min(
    brackets.startAcknowledged,
    brackets.stopAcknowledged - durationMs + frameAllowanceMs,
  );
  const calibrated = earliest <= latest;
  const origin = calibrated
    ? (earliest + latest) / 2
    : (brackets.startSent + brackets.startAcknowledged) / 2;
  const mismatch = Math.abs(
    durationMs - (brackets.stopSent - brackets.startAcknowledged),
  );
  const uncertaintyMs = calibrated
    ? (latest - earliest) / 2 + frameAllowanceMs
    : (brackets.startAcknowledged - brackets.startSent) / 2 +
      mismatch +
      frameAllowanceMs;
  return {
    origin,
    timing: {
      clock: "monotonic",
      method: calibrated
        ? "duration-constrained command brackets"
        : "start-command midpoint (duration brackets inconsistent)",
      rawDurationMs: Math.round(durationMs),
      startCommandMs: Math.round(
        brackets.startAcknowledged - brackets.startSent,
      ),
      stopCommandMs: Math.round(brackets.stopAcknowledged - brackets.stopSent),
      estimatedCaptureStartAfterRequestMs: Math.round(
        origin - brackets.startSent,
      ),
      estimatedUncertaintyMs: Math.ceil(uncertaintyMs),
      frameAllowanceMs: Math.ceil(frameAllowanceMs),
      precision:
        "Approximate, not frame-accurate. No capture clock is returned by agent-browser. Start/stop command brackets and measured raw duration estimate capture origin; uncertainty assumes wall-clock-paced recording. Browser command/overlay acknowledgement and display latency can add scene-level error. No footage is trimmed or time-scaled.",
    },
  };
}

export async function runPlan(
  input,
  { session, outputDir, record = true, allowCloud = false } = {},
) {
  const plan = validatePlan(input);
  if (
    typeof session !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(session)
  )
    throw new Error(
      "An explicit safe browser session name is required (1–80 letters, digits, dots, underscores or hyphens)",
    );
  if (typeof outputDir !== "string" || !outputDir.trim())
    throw new Error("An output directory is required");
  if (typeof record !== "boolean" || typeof allowCloud !== "boolean")
    throw new Error("record and allowCloud must be booleans");
  // Resolve consent and local fallback dependencies before any output side effect.
  resolveNarration(plan, { allowCloud });
  const directory = resolve(outputDir);
  const report = await doctor();
  if (!report.ok)
    throw new Error(
      `Required dependencies are unavailable: ${report.checks
        .filter((check) => !check.ok && check.name !== "system-narration")
        .map((check) => `${check.name}: ${check.detail}`)
        .join("; ")}. Run browser-demo setup --install.`,
    );
  const releaseOutput = await acquireOutput(directory);
  const rawPath = join(directory, "raw.mp4");
  const finalPath = join(directory, "demo.mp4");
  const screenshotDir = join(directory, "screenshots");
  let manifest;
  let operationError;
  try {
    await mkdir(screenshotDir);
    // Synthesis and actual duration probing finish before the recorder starts.
    const { clips, narration } = await prepareNarration(plan, {
      directory: join(directory, "narration"),
      allowCloud,
    });
    const browser = createBrowser({ session });
    const scenes = [];
    const brackets = {};
    let recorderMayBeRunning = false;
    let failure;
    let currentScene;
    let rehearsalOrigin;
    try {
      await browser.command([
        "set",
        "viewport",
        String(plan.viewport.width),
        String(plan.viewport.height),
        "1",
      ]);
      await browser.command(["open", plan.url]);
      await documentReady(browser);
      await browser.evaluate(clearScript());
      rehearsalOrigin = performance.now();
      if (record) {
        brackets.startSent = performance.now();
        // Mark before sending: an outcome_unknown start may still have started.
        recorderMayBeRunning = true;
        await browser.command([
          "record",
          "start",
          rawPath,
          "--fps",
          "30",
          "--cursor",
        ]);
        brackets.startAcknowledged = performance.now();
      }
      for (let index = 0; index < plan.scenes.length; index++) {
        const scene = plan.scenes[index];
        currentScene = scene.id;
        await browser.evaluate(clearScript());
        for (const action of scene.actions) await perform(browser, action);
        await documentReady(browser);
        if (scene.waitFor) await waitFor(browser, scene.waitFor);
        // Also wait for the target itself when readiness describes another state.
        if (scene.target && scene.waitFor?.selector !== scene.target)
          await waitFor(browser, { selector: scene.target });
        const overlayRequested = performance.now();
        // Never pass holdMs: the browser eval socket has a fixed ~30s deadline.
        const overlay = await browser.evaluate(
          sceneScript({
            text: scene.text,
            title: scene.title,
            target: scene.target,
            placement: scene.placement,
            spotlight: scene.spotlight,
          }),
        );
        const visibleAt = performance.now();
        const screenshot = join(
          screenshotDir,
          `${String(index + 1).padStart(2, "0")}-${scene.id}.png`,
        );
        await browser.command(["screenshot", screenshot]);
        const readingMs = Math.min(
          60000,
          Math.max(
            1500,
            Math.ceil(
              (scene.text.trim().split(/\s+/u).length / 3) * 1000 + 500,
            ),
          ),
        );
        const holdMs = Math.max(
          scene.holdMs,
          readingMs,
          clips[index].durationMs + 250,
        );
        await delay(Math.max(0, holdMs - (performance.now() - visibleAt)));
        const endedAt = performance.now();
        scenes.push({
          id: scene.id,
          title: scene.title,
          text: scene.text,
          visibleAt,
          endedAt,
          overlayAcknowledgementMs: Math.round(visibleAt - overlayRequested),
          screenshot,
          narrationDurationMs: clips[index].durationMs,
          overlay,
        });
      }
    } catch (error) {
      failure = new Error(
        `Demo ${currentScene ? `scene ${currentScene}` : "initialization"} failed: ${error.message}. Partial artifacts remain in ${directory}; no successful manifest was written.`,
        { cause: error },
      );
      if (error.code) failure.code = error.code;
    } finally {
      const cleanupErrors = [];
      try {
        await browser.evaluate(clearScript());
      } catch (error) {
        cleanupErrors.push(
          new Error(`Overlay cleanup failed: ${error.message}`, {
            cause: error,
          }),
        );
      }
      if (record && recorderMayBeRunning) {
        brackets.stopSent = performance.now();
        try {
          await browser.command(["record", "stop"]);
        } catch (error) {
          cleanupErrors.push(
            new Error(`Recorder stop failed: ${error.message}`, {
              cause: error,
            }),
          );
        }
        brackets.stopAcknowledged = performance.now();
      }
      if (cleanupErrors.length) {
        const errors = failure ? [failure, ...cleanupErrors] : cleanupErrors;
        failure = new AggregateError(
          errors,
          errors.map((error) => error.message).join("; "),
        );
      }
      // The explicit session intentionally remains open for inspection.
    }
    if (failure) throw failure;
    let origin = rehearsalOrigin;
    let timing = {
      clock: "monotonic",
      method: "rehearsal wall clock",
      precision:
        "No video was captured; timestamps are relative to rehearsal start.",
    };
    let rawDurationMs;
    if (record) {
      rawDurationMs = await videoDuration(rawPath);
      const calibration = calibrateCapture(brackets, rawDurationMs);
      origin = calibration.origin;
      timing = calibration.timing;
    }
    const timeline = scenes.map(({ visibleAt, endedAt, ...scene }) => {
      const startMs = Math.max(0, visibleAt - origin);
      const durationMs = Math.min(
        endedAt - visibleAt,
        record ? rawDurationMs - startMs : Infinity,
      );
      if (durationMs <= 0)
        throw new Error(
          `Scene ${scene.id} lies outside the observed recording; refusing to produce misleading timestamps`,
        );
      return {
        ...scene,
        startMs: Math.round(startMs),
        durationMs: Math.round(durationMs),
      };
    });
    if (record)
      await muxNarration({
        videoPath: rawPath,
        outputPath: finalPath,
        clips,
        timeline,
      });
    const timelinePath = join(directory, "timeline.json");
    await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, {
      flag: "wx",
    });
    manifest = {
      version: 1,
      status: "complete",
      title: plan.title,
      url: plan.url,
      session,
      outputDir: directory,
      recorded: record,
      viewport: plan.viewport,
      narration,
      artifacts: {
        rawVideo: record ? rawPath : null,
        video: record ? finalPath : null,
        timeline: timelinePath,
        screenshots: timeline.map((scene) => scene.screenshot),
        narration: clips.filter((clip) => clip.path).map((clip) => clip.path),
        ...(clips.some((clip) => clip.transcriptPath)
          ? {
              transcriptPaths: clips
                .filter((clip) => clip.transcriptPath)
                .map((clip) => clip.transcriptPath),
            }
          : {}),
        ...(clips.some((clip) => clip.providerMetadataPath)
          ? {
              providerMetadataPaths: clips
                .filter((clip) => clip.providerMetadataPath)
                .map((clip) => clip.providerMetadataPath),
            }
          : {}),
      },
      timing,
      scenes: timeline,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseOutput();
    } catch (error) {
      if (operationError)
        throw new AggregateError(
          [operationError, error],
          `${operationError.message}; output lock cleanup failed: ${error.message}`,
        );
      throw error;
    }
  }
  // Success is published only after recording, muxing and all cleanup succeed.
  const manifestPath = join(directory, "manifest.json");
  const handle = await open(manifestPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(manifestPath).catch(() => {});
    throw error;
  }
  return manifest;
}
