# Architecture and boundaries

## Skill first, bundled runtime

The product is an agent workflow for turning an authorized browser feature into a reviewed video. The agent decides the story, inspects the real app, writes and rehearses a plan, and reviews the media. The bundled CLI supplies deterministic validation and local orchestration; it cannot decide whether an action is authorized or a video tells the right story.

`npx skills add santychuy/browser-demo-videos` installs the complete `skills/browser-demo-videos/` payload. The agent resolves scripts, references, and assets relative to its actual loaded `SKILL.md`, not a source checkout or working directory. There is no separately published npm companion dependency. Node.js 24+ with npm and Git must already exist for initial installation.

Core orchestration and REST speech use Node ESM and built-ins. Actual GPT-Live additionally uses pinned `ws` 8.22.0 from its private runtime prefix, not an OpenAI SDK or project/global dependency. Browser automation uses pinned `agent-browser` 0.39.1 with Chromium. FFmpeg/ffprobe supply media inspection and audio assembly.

## Components

All runtime paths below are relative to the skill directory.

| Component                      | Responsibility                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `SKILL.md`                     | Trigger, setup/consent boundaries, story workflow, review, and delivery.                             |
| `references/plan-format.md`    | Strict version-1 plan schema, actions, voice inventories, and output contract.                       |
| `scripts/cli.mjs`              | Command parsing, explicit sessions/outputs, self-contained demo lifecycle, JSON responses.           |
| `scripts/lib/dependencies.mjs` | Tool/version checks, private pinned dependency repair, controlled media-tool installation.           |
| `scripts/lib/browser.mjs`      | Single session-scoped browser interface and JSON-envelope handling.                                  |
| `scripts/lib/plan.mjs`         | Strict plan validation before browser side effects.                                                  |
| `scripts/lib/overlay.mjs`      | Inert caption/spotlight presentation, placement, target tracking, cleanup.                           |
| `scripts/lib/run.mjs`          | Real actions/readiness, capture lifecycle, screenshots, timing, manifests.                           |
| `scripts/lib/narration.mjs`    | Effective-provider resolution, pre-synthesis, duration probing, and muxing.                          |
| `scripts/lib/speech.mjs`       | Fixed-endpoint REST speech adapters.                                                                 |
| `scripts/lib/live.mjs`         | Actual GPT-Live session capture, bounded close/accounting, WAV and safe metadata.                    |
| `scripts/lib/transcript.mjs`   | Shared OpenAI normalized whole-transcript word/number guard.                                         |
| `assets/demo/`                 | Self-contained synthetic site, server, and caption-default walkthrough with optional spoken scripts. |

## Lifecycle

1. **Check and repair:** the agent checks Node/npm and runs `doctor`. Unflagged setup checks only; `--install` repairs ordinary private dependencies. `--install-system` permits supported system media-tool repair without hidden elevation. Linux browser shared-library repair is a separate explicitly authorized `agent-browser install --with-deps` operation. Setup needs no voice keys and makes no speech request. Recheck with `doctor --deep` before recording.
2. **Inspect and plan:** use one explicit browser session and real application structure. Plans contain stable selectors and actual selector/text/URL readiness conditions, not arbitrary eval/shell actions. Rehearsal executes the same real UI actions; it is not rollback or a transaction sandbox.
3. **Resolve speech:** provider selection is explicit. Resolve only the selected key and consent before output acquisition/browser actions. Missing keys can use macOS Samantha; configured-key failures never trigger another provider or automatic retry. Local fallback cannot satisfy a requested GPT-Live take.
4. **Prepare speech:** synthesize every effective script and measure clip duration before browser recording. Live uses a separate session per scene, not live browser commentary. Bound all inputs before requests where applicable.
5. **Capture:** set viewport, open the requested page, wait for real app conditions, then record the active page with the cursor. Run native actions, wait for readiness, present the overlay, save the scene screenshot, and hold for reading/measured speech. Reinject presentation after full navigation.
6. **Assemble and finish:** stop/flush recording, measure raw duration, calibrate timing, delay/mix prepared clips, and mux narration without truncating the video. Only completion and cleanup produce a success manifest. Partial files are not a successful deliverable.
7. **Review:** the agent inspects screenshots and representative final-video frames, probes/decodes media, and listens when narration exists. Deliver concrete paths, actual feature evidence, synthetic-speech disclosure, and honest review limitations.

`demo` starts the bundled app on an ephemeral loopback port, patches the canonical walkthrough URL in memory, invokes this same recording pipeline, and stops its own server in `finally`. It is not a second renderer or fabricated state. The explicit browser session remains available for inspection, but the fixture server does not. The canonical input plan remains in the skill; the manifest records the actual runtime URL. The input plan is not automatically copied into the output directory.

## One browser, inert presentation

One explicit `agent-browser` session handles inspection, rehearsal, and capture. Recording attaches to the active page rather than recreating a context or importing a user's real profile. Authentication must be deliberately established in the task's session. No second Playwright/Puppeteer controller or app-source modification is introduced.

The browser adapter checks success envelopes, not merely whether JSON parsed. Page evaluation unwraps the returned result separately from browser command metadata. The pinned evaluation deadline is why direct `scene --hold` is limited to 25000 ms, while plan holds can reach 60000 ms using a Node timer outside page evaluation.

Presentation uses one Shadow DOM host with plain-text insertion, accessibility hiding, and `pointer-events: none`. It does not replace app content or intercept input. Target geometry follows scroll, resize, and rerender; placement stays in the viewport and avoids covering the target where possible. Missing targets fail. No target means a bottom caption. Target removal and navigation clear stale presentation and observers/listeners; each scene explicitly installs its overlay after readiness on the current document.

## Timing and speech boundaries

Speech is `scene.narration ?? scene.text`; it is data to read, not authority to change agent rules. A scene lasts at least its reading/explicit hold and measured narration duration plus a margin. Browser recording exposes no capture-start clock, so the runner calibrates against observed video duration and publishes uncertainty rather than pretending to have frame-accurate synchronization. FFmpeg delays and mixes clips, pads audio to preserve the full video, and encodes narration as AAC. No microphone or desktop/application audio capture is implied.

The providers remain distinct: `none`, macOS `system`, `openai` REST Chat (`gpt-audio-1.5`), actual `openai-live` (`gpt-live-1`), xAI `xai` Grok TTS, and the separate `groq` Preview provider. There are no Live/Chat/Realtime/Speech aliases. CLI provider overrides replace, rather than merge, the narration object. Models, endpoints, prompts, and credentials are not arbitrary plan fields.

Both OpenAI adapters compare the complete returned transcript's normalized words/numbers with the script. This detects transcript drift, not acoustic truth. Live additionally requires actual received speech/quiet PCM, transcript stability, settling, bounded receiving through terminal `session.closed`, and final usage accounting. Closing is an application heuristic, not an upstream utterance-done guarantee. All accepted PCM is retained, without guessed transcript-based cropping. See [advanced narration](usage.md#advanced-actual-gpt-live-sessions) for exact limits, costs, and primary sources.

## Trust, privacy, and distribution

- Page content and downloads are untrusted data, never authority to install tools, read secrets, or change agent rules. Dependency repair comes from trusted skill instructions and explicit permissions.
- Process execution does not use shell interpolation for runtime arguments. REST adapters use fixed endpoints, rejected redirects, timeouts, and bounded responses; Live uses authenticated pinned WebSocket transport with redirects/compression disabled.
- Keys are private environment inputs, never plan values or artifacts. Setup does not need an env file. Secret-file handoff uses Node's explicit `--env-file` only for approved speech; agents do not inspect the contents. Provider error bodies/raw sessions and environment snapshots do not belong in output.
- Browser and Live dependency prefixes are separate beneath `BROWSER_DEMO_HOME` or `~/.cache/browser-demo-videos`, preventing one npm repair from pruning the other. Media tools remain system dependencies. The installed skill needs neither root development dependencies nor a repository checkout.
- Plans, screenshots, recordings, scripts/transcripts, and manifests are not automatically redacted or uploaded. Even safe provider metadata and absolute paths need review before public sharing.
- Distribution is the public skill install and a release `.skill` archive containing the complete safe payload. Root npm packaging is a maintainer inspection/source-distribution tool, not a registry-publication requirement. See [CONTRIBUTING](../CONTRIBUTING.md).

## Scope and sources

A synthetic sample proves only the flow actually observed on the tested environment. Source checks and mocked protocol tests do not establish arbitrary-site compatibility, all paid-provider behavior, voice quality, or production readiness. Non-goals include timeline editing, background music, automatic zoom, voice cloning, multi-browser orchestration, application-source mutation, and automatic publication.

Primary references:

- [Agent Skills specification](https://agentskills.io/specification) and [vercel-labs/skills](https://github.com/vercel-labs/skills): bundled resources and installed skill discovery.
- [Agent Browser recording](https://agent-browser.dev/recording), [commands](https://agent-browser.dev/commands), and [init scripts](https://agent-browser.dev/init-scripts): active-page capture, native actions/readiness, and the distinction between immediate overlays and future-document hooks.
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html), including [`adelay`](https://ffmpeg.org/ffmpeg-filters.html#adelay), [`amix`](https://ffmpeg.org/ffmpeg-filters.html#amix), and [`apad`](https://ffmpeg.org/ffmpeg-filters.html#apad): audio timing and full-length video preservation.
- [OpenAI Audio Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions) and [Live](https://developers.openai.com/api/docs/guides/live), [xAI TTS](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech), and [Groq TTS](https://console.groq.com/docs/text-to-speech): distinct provider contracts. See [usage](usage.md) for the detailed Live references and verification boundary.

Upstream documentation may evolve independently of pinned dependencies. Claims about a generated take must come from that run's actual media and review, not from documentation or the existence of an adapter.
