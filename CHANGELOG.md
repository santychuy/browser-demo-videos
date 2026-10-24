# Changelog

## Unreleased

- Use Bun 1.4.4+ for the bundled CLI, dependency installation, project tasks, tests, and CI; retain Node 24+ for upstream launchers.
- Replace the npm lockfile with `bun.lock`; disable automatic `.env` loading while preserving explicitly approved narration credential files.
- Check the actual upstream Node executable instead of Bun's emulated Node version, and scope dependency lifecycle trust to the pinned browser package.
- Keep GitHub release titles identical to their tags and simplify the README to list the tools actually used.

## 0.1.0 — First public release

### Skill and distribution

- One installation entry point: `npx skills add santychuy/browser-demo-videos`.
- Self-contained `browser-demo-videos` skill with bundled Node CLI/runtime, exact plan reference, MIT license, and synthetic sample app. No separate npm-registry companion installation or source checkout is required.
- Skill-owned prerequisite checks and permission-scoped dependency repair: Node 24+, pinned `agent-browser` 0.39.1, Chromium, FFmpeg/ffprobe, and optional private `ws` 8.22.0 for GPT-Live.
- Self-contained `demo` command that serves the bundled Northstar app on an ephemeral loopback port, records its caption-default walkthrough, and stops its server on success or failure.
- Maintainer `.skill` archive packaging and public usage, architecture, contribution, and security guidance.

### Recording and review

- Strict version-1 JSON plans for native clicks, fills, key presses, scrolling, navigation, and selector/text/URL readiness. Unknown fields and arbitrary eval/shell actions are rejected.
- One explicit browser session, readable plain-text captions, target spotlights, viewport-aware placement, movement tracking, visible cursor, and navigation/target-removal cleanup without modifying application source.
- Real-app inspection, rehearsal, capture, and review workflow with guarded fresh output directories.
- Final/raw MP4s, scene screenshots, timeline, complete-run manifest, and disclosed capture-timing uncertainty. Input plans are retained separately rather than automatically copied into output.
- Bundled synthetic project flow with a real attention filter and full-navigation export summary. Optional longer spoken scripts retain spelled-out numbers and currency.

### Optional synthetic narration

- Caption-only default, local macOS `say`, OpenAI REST Chat (`openai`, `gpt-audio-1.5`), actual OpenAI GPT-Live (`openai-live`, `gpt-live-1`), xAI Grok TTS, and the distinct Groq Preview provider.
- Explicit provider/voice overrides, selected-key privacy, cloud-script disclosure and consent, and no paid setup checks.
- Missing selected cloud keys may fall back to macOS Samantha with honest requested/effective-provider metadata. Linux has no local speech fallback. Configured-key/provider failures do not trigger automatic retries, fallback, or another provider; local fallback never satisfies a requested GPT-Live take.
- Pre-generated scene speech with measured duration, strict whole-transcript word/number guards for both OpenAI providers, and retained transcripts for review.
- Actual Live WebSocket sessions with paced silent input, bounded heuristic completion/close, terminal usage accounting, and safe per-scene provider metadata. This is prepared narration, not live browser commentary or a guarantee of acoustic fidelity.

### Scope

Features are not certification of every site, operating system, or provider account. Cloud speech can incur charges; generated artifacts are local but not automatically redacted. The public sample uses synthetic data and disclosed synthesized GPT-Live narration. No voice-quality or frame-perfect synchronization guarantee is made.
