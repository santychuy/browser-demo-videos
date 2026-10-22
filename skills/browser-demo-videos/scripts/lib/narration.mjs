import { constants } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  resolveLiveWebSocket,
  resolveTool,
  runProcess,
} from "./dependencies.mjs";
import { validatePlan } from "./plan.mjs";
import { requestSpeech, speechProviders } from "./speech.mjs";

async function durationOf(path, ffprobe) {
  const { stdout } = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const seconds = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`Media has no positive duration: ${path}`);
  return seconds * 1000;
}

// Resolve the selected key only. Missing credentials are the sole reason to
// switch providers; configured-key failures must never silently become local.
export function resolveNarration(input, { allowCloud = false } = {}) {
  const plan = validatePlan(input);
  if (typeof allowCloud !== "boolean")
    throw new Error("--allow-cloud consent must be a boolean");
  const { provider: requestedProvider, voice: requestedVoice } = plan.narration;
  const narration = {
    requestedProvider,
    ...(requestedVoice ? { requestedVoice } : {}),
    provider: requestedProvider,
    ...(requestedVoice ? { voice: requestedVoice } : {}),
  };
  if (Object.hasOwn(speechProviders, requestedProvider)) {
    const config = speechProviders[requestedProvider];
    if (!process.env[config.keyEnv]?.trim()) {
      narration.provider = "system";
      narration.voice = "Samantha";
      narration.fallbackReason = "missing-api-key";
    } else {
      if (!allowCloud)
        throw new Error(
          `${config.label} narration requires explicit --allow-cloud consent; scene text will leave this machine`,
        );
      if (config.model) narration.model = config.model;
    }
  }
  if (narration.provider === "openai-live" && !resolveLiveWebSocket())
    throw new Error(
      "OpenAI GPT-Live narration requires the optional ws transport; run browser-demo setup --install",
    );
  if (narration.provider === "system" && !resolveTool("say"))
    throw new Error(
      "System narration requires macOS say; install or enable it, select provider none, or configure the selected cloud key and explicitly consent with --allow-cloud",
    );
  return narration;
}

// All scene limits, selected-provider consent and local dependencies are checked
// before mkdir or synthesis, so later invalid input cannot cause a paid request.
export async function prepareNarration(
  input,
  { directory, allowCloud = false } = {},
) {
  const narration = resolveNarration(input, { allowCloud });
  const plan = validatePlan(input);
  const { provider, voice } = narration;
  if (provider === "none")
    return {
      clips: plan.scenes.map(() => ({ path: null, durationMs: 0 })),
      narration,
    };
  if (typeof directory !== "string" || !isAbsolute(directory))
    throw new Error("Narration directory must be an absolute path");
  const scripts = plan.scenes.map((scene) => scene.narration ?? scene.text);
  const say = provider === "system" ? resolveTool("say") : null;
  const ffprobe = resolveTool("ffprobe");
  if (!ffprobe)
    throw new Error(
      "Narration requires ffprobe; run browser-demo setup for dependency guidance",
    );
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length)
    throw new Error(
      "Narration directory must be empty; refusing to overwrite existing clips",
    );
  const clips = [];
  for (let index = 0; index < scripts.length; index++) {
    const stem = `${String(index + 1).padStart(2, "0")}-${plan.scenes[index].id}`;
    const path = join(
      directory,
      `${stem}.${provider === "system" ? "aiff" : "wav"}`,
    );
    const scriptPath = join(directory, `${stem}.txt`);
    await writeFile(scriptPath, scripts[index], {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    let transcriptPath;
    let providerMetadataPath;
    if (provider === "system") {
      await runProcess(say, [
        "-v",
        voice,
        "-f",
        scriptPath,
        "-r",
        "175",
        "-o",
        path,
        "--file-format=AIFF",
      ]);
    } else {
      const { audio, transcript, metadata } = await requestSpeech({
        provider,
        voice,
        text: scripts[index],
        allowCloud,
      });
      if (transcript !== undefined) {
        transcriptPath = join(directory, `${stem}.transcript.txt`);
        await writeFile(transcriptPath, transcript, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }
      if (metadata !== undefined) {
        providerMetadataPath = join(directory, `${stem}.provider.json`);
        await writeFile(
          providerMetadataPath,
          `${JSON.stringify(metadata, null, 2)}\n`,
          {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          },
        );
      }
      await writeFile(path, audio, {
        flag: "wx",
        mode: 0o600,
      });
    }
    clips.push({
      path,
      durationMs: await durationOf(path, ffprobe),
      ...(transcriptPath ? { transcriptPath } : {}),
      ...(providerMetadataPath ? { providerMetadataPath } : {}),
    });
  }
  return { clips, narration };
}

export async function muxNarration({ videoPath, outputPath, clips, timeline }) {
  if (
    !Array.isArray(clips) ||
    !Array.isArray(timeline) ||
    clips.length !== timeline.length
  )
    throw new Error(
      "Narration clips and timeline must have matching scene counts",
    );
  if (
    !isAbsolute(videoPath) ||
    !isAbsolute(outputPath) ||
    videoPath === outputPath
  )
    throw new Error("Mux requires distinct absolute input and output paths");
  const active = [];
  for (let index = 0; index < clips.length; index++) {
    const scene = timeline[index];
    if (
      !Number.isFinite(scene.startMs) ||
      scene.startMs < 0 ||
      !Number.isFinite(scene.durationMs) ||
      scene.durationMs <= 0
    )
      throw new Error(`Invalid narration timeline at scene ${index + 1}`);
    if (clips[index].path !== null) {
      if (
        !isAbsolute(clips[index].path) ||
        !Number.isFinite(clips[index].durationMs) ||
        clips[index].durationMs <= 0
      )
        throw new Error(`Invalid narration clip at scene ${index + 1}`);
      active.push({ ...clips[index], startMs: scene.startMs });
    }
  }
  if (!active.length) {
    await copyFile(videoPath, outputPath, constants.COPYFILE_EXCL);
    return;
  }
  const ffmpeg = resolveTool("ffmpeg");
  const ffprobe = resolveTool("ffprobe");
  if (!ffmpeg || !ffprobe)
    throw new Error("Muxing narration requires ffmpeg and ffprobe");
  const videoDurationMs = await durationOf(videoPath, ffprobe);
  for (const clip of active) {
    if (clip.startMs + clip.durationMs > videoDurationMs + 50)
      throw new Error(
        "Narration extends past captured video; refusing to truncate speech",
      );
  }
  const filters = active.map(
    (clip, index) =>
      `[${index + 1}:a:0]asetpts=PTS-STARTPTS,adelay=${Math.round(clip.startMs)}:all=1[a${index}]`,
  );
  const labels = active.map((_, index) => `[a${index}]`).join("");
  filters.push(
    `${labels}amix=inputs=${active.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${(videoDurationMs / 1000).toFixed(6)}[narration]`,
  );
  const args = ["-hide_banner", "-loglevel", "error", "-n", "-i", videoPath];
  for (const clip of active) args.push("-i", clip.path);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[narration]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  );
  // Audio is padded to the observed full video duration. Never use -shortest:
  // that would silently remove action/navigation footage after the last clip.
  await runProcess(ffmpeg, args, {
    timeoutMs: Math.max(120000, Math.ceil(videoDurationMs * 2)),
  });
}
