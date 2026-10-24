# Demo plan format (version 1)

A plan is UTF-8 JSON, not JavaScript. First follow [the installed skill's Bun and dependency bootstrap](../SKILL.md#1-locate-and-bootstrap-the-installed-skill): check Bun >=1.4.4 and external Node >=24 (upstream launchers only) before running bundled JavaScript with Bun, repair within permissions, and require `doctor --deep` before recording. Setup needs no API keys; never load private environment files for dependency installation. Validate a custom plan before browser actions:

```sh
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" validate /absolute/path/plan.json
```

`SKILL_DIR` is the absolute directory containing the loaded `SKILL.md`. All field names are exact. Unknown fields, unknown action types, incorrect types, duplicate scene IDs, and arbitrary `eval`/shell actions are rejected. CSS selectors must identify real page elements; this schema does not accept snapshot refs as a substitute for stable selectors.

Files are limited to 2 MiB. String limits count Unicode code points; strings containing NUL are rejected. Unless a field explicitly permits empty text, whitespace-only strings are rejected. Absolute navigation URLs have a maximum of 8192 characters and reject embedded usernames/passwords. Selectors must not start with `-` or `@`; key/voice strings must not start with `-`, avoiding accidental CLI-option interpretation.

## Complete example

This example is for an app whose existing UI exposes the named selectors. Inspect your app and replace them with its actual selectors; the runtime never creates the app behavior for you.

```json
{
  "version": 1,
  "title": "Find and export projects needing attention",
  "url": "http://127.0.0.1:4173/",
  "viewport": { "width": 1280, "height": 720 },
  "narration": { "provider": "none" },
  "scenes": [
    {
      "id": "overview",
      "title": "Your workspace",
      "text": "Start with the real project list.",
      "target": "#projects",
      "placement": "auto",
      "spotlight": true,
      "holdMs": 2500,
      "waitFor": { "selector": "#projects" }
    },
    {
      "id": "focus",
      "title": "Focus the list",
      "text": "Show only projects that need attention.",
      "target": "#projects",
      "actions": [{ "type": "click", "selector": "#filter-attention" }],
      "waitFor": { "selector": "#projects[data-filter='attention']" }
    },
    {
      "id": "result",
      "title": "Check the export",
      "text": "The export summary reflects the filtered projects.",
      "target": "#export-summary",
      "actions": [{ "type": "click", "selector": "#export-link" }],
      "waitFor": {
        "url": "**/export/result*",
        "selector": "#export-summary"
      },
      "narration": "The app has navigated to its export result. Check that the summary contains the projects selected by the filter."
    }
  ]
}
```

## Bundled sample

The installed canonical [assets/demo/walkthrough.json](../assets/demo/walkthrough.json) is the portable caption-default Northstar sample. It retains expanded per-scene spoken scripts for optional narration, with spoken numbers/currency spelled out for the OpenAI transcript guard. Its real [site.html](../assets/demo/site.html) and [server.mjs](../assets/demo/server.mjs) are bundled alongside the plan; no checkout or separate server is required.

After setup, choose a fresh explicit session and absent/empty output directory:

```sh
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" demo --session sample-demo-take-1 --output /absolute/path/sample-demo-take-1
```

`demo` starts the loopback-only sample server on an ephemeral port, patches/validates the plan URL, and executes the ordinary recording pipeline. It always stops that server afterward, including failures; browser session handling remains explicit. It defaults to `none`, without a key or paid request. Optional `--narration PROVIDER`, `--voice VOICE`, and `--allow-cloud` follow the same provider/permission rules as `record`. Inspect actual output before claiming success. The sample demonstrates synthetic sample data, not the user's app.

For a custom app, inspect its real UI and author/rehearse a plan with actual selectors. The generic JSON example above teaches structure, not a second sample contract.

## Top-level fields

| Field       | Type                                    | Meaning                                                                     |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `version`   | integer, exactly `1`                    | Required format version.                                                    |
| `title`     | nonempty string, at most 200 characters | Human-readable demo title.                                                  |
| `url`       | nonempty URL string                     | Starting page; only `http:`, `https:`, or `file:`. No embedded credentials. |
| `viewport`  | object                                  | Optional; defaults to `{ "width": 1280, "height": 720 }`.                   |
| `narration` | object                                  | Optional; defaults to `{ "provider": "none" }`.                             |
| `scenes`    | array, 1–100 items                      | Required ordered scenes.                                                    |

Viewport fields are exactly `width` and `height`, both positive integers, with maximums 3840 and 2160 respectively. Use dimensions large enough for the actual app and readable captions.

Narration fields are exactly `provider` and optional `voice`:

| Provider      | Default voice | Selected environment variable | Speech contract                                                                                                   |
| ------------- | ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `none`        | Omit          | None                          | Portable caption-only default; no speech request.                                                                 |
| `system`      | `Samantha`    | None                          | Installed macOS `say` voice, AIFF; not a Linux TTS engine.                                                        |
| `openai`      | `marin`       | `OPENAI_API_KEY`              | `gpt-audio-1.5` REST Chat Completions; JSON containing base64 WAV and transcript.                                 |
| `openai-live` | `marin`       | `OPENAI_API_KEY`              | Actual `gpt-live-1` Live WebSocket session; 24 kHz mono PCM16 saved as WAV, transcript and safe session metadata. |
| `xai`         | `eve`         | `XAI_API_KEY`                 | xAI Grok TTS, raw 48 kHz WAV, `language: "auto"`; no model field.                                                 |
| `groq`        | `troy`        | `GROQ_API_KEY`                | Separate vendor Groq, Preview `canopylabs/orpheus-v1-english`, WAV.                                               |

Voice strings have at most 100 Unicode code points and cannot start with `-`. `openai` accepts the confirmed voice IDs `marin` and `cedar`. `openai-live` defaults to `marin` and supports the documented IDs `marin`, `quartz`, `ripple`, `vesper`, `willow`, `stone`, `gleam`, `meridian`, `bossa`, `tempo`, `beacon`, `delta`, `cinder`, `nuri`, `juni`, `flitz`, `brise`, `sillage`, `nira`, `harema`, `shida`, and `noeul`; do not carry a Chat-only voice into Live. xAI accepts a bounded safe voice ID matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`, without a discovery request or voice cloning. Groq English voice names remain `autumn`, `diana`, `hannah`, `austin`, `daniel`, and `troy`. Models, endpoints, prompts, language, output formats, and credentials are not configurable plan fields.

For **any selected cloud provider**, an absent or whitespace-only selected key resolves to local `system` / `Samantha`, regardless of the requested cloud voice. It needs no cloud consent and makes no provider request. If local `say` is unavailable (including Linux), this is an actionable blocker, not silent caption-only output. With a selected key present, `record` or `demo` requires explicit cloud consent and `--allow-cloud` before output/browser side effects. A nonempty key is not proof of validity: invalid credentials, rate limits, account/provider/network errors, malformed audio, and OpenAI transcript mismatch fail without fallback, automatic retry, or switching paid providers. Unrelated providers' keys do not affect selection.

A user request for GPT-Live must select `openai-live`, not `openai`, Realtime, or Speech. For a requested real Live proof, stop on a missing key instead of presenting the ordinary local fallback as Live. Live failures, including access, audio, transcript, timeout, or unconfirmed finalization, never trigger automatic retries or another provider.

The CLI writes a JSON warning on stderr for missing-key fallback. `manifest.narration` reports safe effective configuration: `requestedProvider`, optional `requestedVoice`, effective `provider` / `voice` / `model` where applicable, and `fallbackReason: "missing-api-key"` for fallback only. It never contains keys or an environment snapshot.

Configure keys privately in the inherited environment or an ignored `.env.local`; never paste them into chat, plans, argv, logs, or artifacts. Never read secret files, print secret values or environment/presence dumps, or load `.env.local`, `.env.private`, or another credential file for `setup`, `doctor`, or dependency installation. Those operations need no keys or paid calls. Bundled commands use `--no-env-file` to disable implicit env-file loading, and exports in another terminal are not automatically inherited. Only for an explicitly approved speech invocation, use `bun --no-env-file --env-file=/absolute/approved.env "$SKILL_DIR/scripts/cli.mjs" ...` for the user's chosen file. Both flags are required so only the explicit file loads. The user can privately configure it and say which provider is ready; do not request its contents or overwrite it.

Both OpenAI providers use the same private `OPENAI_API_KEY`. Live additionally needs pinned `ws` 8.22.0, installed by Bun through `setup --install` into `${BROWSER_DEMO_HOME || ~/.cache/browser-demo-videos}/live-runtime/`, separate from the browser's `runtime/` prefix. Private installs use exact-version manifests and `--no-env-file`: only agent-browser's required lifecycle script is explicitly trusted; ws scripts are ignored. Live resolves only that private transport; no OpenAI SDK, global `ws`, or project dependency is required. Doctor reports missing Live transport as optional for other providers.

The separate `openai` provider uses a fixed natural explanatory reading prompt and requires a completed Chat response with a transcript whose normalized Unicode word/number sequence matches the script, ignoring punctuation, case, and spacing. Reordered, added, or missing words fail; punctuation differences pass. Numerals versus spelled-out numbers can fail, so write spoken numbers/currency as words. Both OpenAI providers use this strict whole-transcript guard; it does not guarantee verbatim acoustic rendering or voice quality. Accepted transcript files support manual review. This [Audio Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions) design is not an assertion of OpenAI's official migration recommendation for [Speech models shutting down January 6, 2027](https://developers.openai.com/api/docs/guides/text-to-speech). See also [xAI TTS](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech) and [Groq TTS](https://console.groq.com/docs/text-to-speech). Wire contracts are not live-provider or listening proof.

### Live session contract and limits

Live captures one scene's narration before browser recording, not commentary reacting to browser state. It uses `wss://api.openai.com/v1/live/sessions`, startup developer history containing the script, and a short fixed read instruction. Paced zero-valued 24 kHz mono PCM16 input advances the Live session without microphone capture. It uses no native backend delegation or tool calls; unexpected delegation fails and closes.

There is no documented utterance-done event. The application's conservative closing heuristic requires genuine received speech followed by actual quiet PCM, transcript stability, and settling time. Packet inactivity alone is insufficient; transcript timestamps are not an exact audio clock. Receivers remain active during bounded close; success requires terminal `session.closed` with final `usage.seconds`, followed by strict equality of the entire drained transcript's normalized words/numbers with the requested script. Missing quiet tail, transcript drift, malformed audio, timeout, unexpected transport close, or missing finalization fails. All accepted PCM is retained rather than trimming using guessed transcript timestamps. This heuristic does not guarantee turn completion, acoustic accuracy, or frame-accurate alignment.

Each effective Live script is limited to **4000 UTF-8 bytes by this application**, in addition to the generic scene bound. This is not a guaranteed provider token-count validation: upstream history and instruction token limits still apply. Split or rewrite overlong scenes; never silently truncate. Session duration, including input silence and closing time, is billable. Startup, capture, and close are bounded, and final usage is retained in safe metadata; a transport disconnect is not a successful accounting event.

Official sources: [Live](https://developers.openai.com/api/docs/guides/live), [`gpt-live-1`](https://developers.openai.com/api/docs/models/gpt-live-1), [Live WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets?api=live), [conversations](https://developers.openai.com/api/docs/guides/live-conversations), [prompting](https://developers.openai.com/api/docs/guides/live-prompting), and [client delegation](https://developers.openai.com/api/docs/guides/live-delegation?delegation-mode=client).

## Scene fields

| Field       | Type                                           | Meaning                                                                                                             |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`        | string                                         | Required, unique; matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Also used for artifact names.                         |
| `text`      | nonempty string, at most 600 characters        | Required visible caption, treated as plain text rather than HTML.                                                   |
| `title`     | nonempty string, at most 200 characters        | Optional short caption heading.                                                                                     |
| `target`    | nonempty CSS selector, at most 2048 characters | Optional actual page element to anchor/highlight. A missing target fails; it is not silently ignored.               |
| `placement` | string                                         | Optional `auto` (default), `above`, `below`, `left`, `right`, or `bottom`. Geometry is constrained to the viewport. |
| `spotlight` | boolean                                        | Optional; default `false`. Dims around the target.                                                                  |
| `holdMs`    | integer, 1500–60000                            | Optional minimum visible scene duration.                                                                            |
| `narration` | nonempty string, at most 10000 characters      | Optional spoken script instead of `text`; unused when provider is `none`.                                           |
| `actions`   | array, at most 100 items                       | Optional ordered actions before the caption appears.                                                                |
| `waitFor`   | wait-condition object                          | Optional readiness check after actions, before the caption appears.                                                 |

The default reading hold is `max(1500, ceil(wordCount / 3 * 1000 + 500))`, capped at 60000 ms. With speech, the runtime holds for at least the measured clip duration plus 250 ms, as well as the caption's reading/explicit hold. Long speech can therefore extend actual scene time beyond an explicit caption hold. Narration is generated before capture so provider latency is not recorded.

For Groq, the effective script (`narration` when present, otherwise `text`) for **every** scene must be at most 200 Unicode code points. All scripts are checked before a paid request; overlength inputs fail rather than being truncated. Split a story into shorter scenes or rewrite it. Do not store credentials, access tokens, or private customer information in any field: plans, speech text files, screenshots, and manifests are local artifacts.

## Exact action shapes

Only the following keys are accepted for each action. Selectors are nonempty strings up to 2048 characters. Action values are plain data, never evaluated as code.

```json
{ "type": "click", "selector": "#filter-attention" }
{ "type": "fill", "selector": "#search", "value": "Quarterly" }
{ "type": "press", "key": "Enter" }
{ "type": "scroll", "direction": "down", "amount": 400 }
{ "type": "navigate", "url": "http://127.0.0.1:4173/" }
{ "type": "wait", "selector": "#results", "timeoutMs": 15000 }
{ "type": "wait", "text": "Export ready", "timeoutMs": 15000 }
{ "type": "wait", "url": "**/export/result*", "timeoutMs": 15000 }
```

`fill.value` is a string up to 10000 characters and may be empty to clear the input. `press.key` is a nonempty string up to 100 characters using an `agent-browser` key name, such as `Enter`, `Tab`, or `Control+a`. Scrolling supports `up` or `down` only; `amount` is an integer from 1 to 10000 pixels. Navigation uses the same permitted URL schemes as the top-level URL and stays in the same browser session.

`click`, `fill`, and `press` are native browser-controller interactions. The plan cannot invoke a shell command, arbitrary JavaScript, hidden application API, network mock, or fabricated application outcome.

## Readiness conditions

`waitFor` and `type: "wait"` support these exact condition keys:

```json
{
  "selector": "#export-summary",
  "text": "Export ready",
  "url": "**/export/result*",
  "timeoutMs": 15000
}
```

At least one of `selector`, `text`, or `url` is required; when multiple are supplied, **all** are checked. `text` is an actual page-text condition; `url` is an `agent-browser` URL pattern (not a shell pattern executed by a shell). `text` and `url` are nonempty strings up to 2048 characters. `timeoutMs` is an integer from 1 to 60000 and defaults to 15000. A timeout fails the run rather than presenting an unproven result.

Actions run first, then scene readiness, then overlay presentation and its screenshot/hold. Full navigation removes the old document's overlay; the new scene installs a fresh one after readiness. Use readiness instead of sleep to prove an application transition; a scene's hold exists for human reading, not to hide loading failures.

## Commands and artifacts

```sh
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" demo --session sample-demo-take-1 --output /absolute/path/sample-demo-take-1
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" validate /absolute/path/plan.json
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" rehearse /absolute/path/plan.json --session feature-demo --output /absolute/path/rehearsal-take-1 --narration none
bun --no-env-file "$SKILL_DIR/scripts/cli.mjs" record /absolute/path/plan.json --session feature-demo --output /absolute/path/take-1
```

Every browser command requires an explicit `--session`; keep one name throughout inspection, rehearsal, capture, and review of a take. Rehearsal still performs real actions. `demo`, `record`, and `rehearse` accept `--narration none|system|openai|openai-live|xai|groq` and optional `--voice VOICE` (only with `--narration`). Overrides replace the complete narration object and are revalidated; another provider's voice is never inherited. For local cloud-story rehearsal, select `--narration system` on macOS or `--narration none` for captions. `rehearse` offers no `--allow-cloud`; missing-key fallback can run locally, but a configured cloud key without consent fails. Do not pay merely to explore a script or check setup.

For separately approved OpenAI Chat, GPT-Live, and xAI takes, after the user privately configures the corresponding keys:

```sh
bun --no-env-file --env-file=/absolute/approved.env "$SKILL_DIR/scripts/cli.mjs" record /absolute/path/plan.json --session openai-live-demo --output /absolute/path/openai-live-take-1 --narration openai-live --allow-cloud
bun --no-env-file --env-file=/absolute/approved.env "$SKILL_DIR/scripts/cli.mjs" record /absolute/path/plan.json --session feature-demo --output /absolute/path/openai-take-1 --narration openai --allow-cloud
bun --no-env-file --env-file=/absolute/approved.env "$SKILL_DIR/scripts/cli.mjs" record /absolute/path/plan.json --session feature-demo --output /absolute/path/xai-take-1 --narration xai --allow-cloud
```

For a separately approved voiced sample, replace `record /absolute/path/plan.json` with `demo` and use another fresh session/output. The bundled plan is `"$SKILL_DIR/assets/demo/walkthrough.json"`; `demo` owns its ephemeral server and URL patching, so recording that source directly is not the self-contained sample path. Omit `--env-file` when using inherited environment variables. An absent selected key triggers local macOS fallback without needing `--allow-cloud`, but that fallback does not satisfy an explicitly requested real Live take. Use fresh output directories for repeated takes; never delete existing artifacts to make room.

Output directories must be empty or absent. On successful capture, the directory contains:

- `demo.mp4`: final delivery, with synthesized speech when enabled.
- `raw.mp4`: original browser video with visible cursor.
- `screenshots/NN-scene-id.png`: scene review stills.
- `timeline.json`: timing information for scene/audio assembly.
- `manifest.json`: complete-run status, absolute artifact paths, scene details, and timing uncertainty.
- `narration/NN-scene-id.txt` plus `.aiff` (system) or `.wav` (cloud) when speech is enabled; accepted OpenAI Chat and Live `.transcript.txt` files are retained for review. Live also writes safe `.provider.json` metadata with model, voice, sample rate, optional session ID, final usage seconds, close reason, heuristic completion method, and transcript events.

The manifest's `artifacts` object lists absolute `rawVideo`, `video`, `timeline`, `screenshots`, and `narration` paths. Its `scenes` describe scene IDs/text/titles, timing, screenshot paths, measured narration duration, and overlay bounds. Recorded timing uses a monotonic clock and includes `rawDurationMs`, start/stop command durations, `estimatedCaptureStartAfterRequestMs`, `estimatedUncertaintyMs`, `frameAllowanceMs`, the calibration `method`, and a `precision` disclaimer. It constrains capture start using observed duration and command brackets when possible; otherwise it reports a midpoint estimate with larger uncertainty. It does not trim or time-scale the video to pretend the clocks match. Rehearsal uses wall-clock timing and has no capture-calibration evidence.

The manifest's top-level `narration` describes the effective provider rather than falsely claiming cloud synthesis after local fallback. When transcript artifacts are produced, their paths are exposed as `manifest.artifacts.transcriptPaths` alongside the existing artifact path arrays. Live provider metadata paths appear as `manifest.artifacts.providerMetadataPaths`; files contain no keys, environment snapshots, or raw session objects. For a Live take, confirm effective `provider: "openai-live"`, `model: "gpt-live-1"`, no fallback, final usage/close confirmation, and the completion heuristic. Inspect transcripts and metadata and listen to the audio; no local or mocked check establishes live provider quality.

Rehearsal produces review artifacts without video. A failure may leave partial files but does not produce a success manifest. Inspect artifacts before sharing them; output is not automatically redacted or uploaded. The browser recorder has no capture clock, so timing calibration is approximate, not a frame-accurate synchronization guarantee. Direct ad hoc `scene --hold` is limited to 25000 ms; the plan runner supports longer holds by waiting outside browser evaluation.
