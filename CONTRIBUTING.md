# Contributing

Contributions should keep the installed skill self-contained, the workflow reviewable, and the browser/voice safety contracts explicit. Read [design](docs/design.md), [usage](docs/usage.md), and the [plan reference](skills/browser-demo-videos/references/plan-format.md) before changing behavior. For vulnerabilities, use [private security reporting](SECURITY.md), not a public issue.

## Source development

Use **Bun 1.4.4+** for package management, runtime, and tooling, plus Git. **Node.js 24+** is required only for upstream skills and agent-browser launchers; do not force those packages to run under Bun with `--bun`. Clone the repository and install development dependencies without running install scripts:

```sh
git clone https://github.com/santychuy/browser-demo-videos.git
cd browser-demo-videos
bun install --frozen-lockfile --ignore-scripts
```

The production skill does not depend on this root development install. Runtime files, references, license, and the canonical demo belong beneath `skills/browser-demo-videos/`. Do not add a dependency on a checkout-relative resource, root `node_modules`, global CLI, symlink outside the skill, or unpublished npm package.

To try your modified skill in a supported agent, an optional developer-only install from the checkout is:

```sh
bun --no-env-file x skills add .
```

Select the intended agent and reload its skills/session if required. To make a copied install for a specific agent noninteractively, the installer's `--agent AGENT --copy --yes` options can be added; use your host's supported agent identifier. This local development command does not replace the public README installation.

## Local gates

Run these after changes are complete:

```sh
bun run check
bun run test
bun run format:check
bun pm pack --dry-run
bun run package:skill
```

`bun run format` applies formatting when needed. The root `bunfig.toml` disables implicit dotenv loading for checkout tasks. Do not report a gate as passed unless you actually ran it. Explain platform or integration limits in the pull request.

**Python 3 is a maintainer-only requirement** for `bun run package:skill`, which uses the standard library to write `artifacts/distribution/browser-demo-videos.skill`. It is not required to install/use the skill or generate a video. The archive has a `browser-demo-videos/` top-level directory and must contain the whole safe skill payload, never secrets, caches, recordings, symlinks, or `node_modules`. Inspect distribution contents before release; `bun pm pack` is not an instruction to publish to a registry.

## Browser/media integration

Local gates are not proof that recording works on a real machine. For an explicitly authorized integration check, use the skill's trusted setup and the bundled sample:

```sh
bun --no-env-file skills/browser-demo-videos/scripts/cli.mjs setup --install
bun --no-env-file skills/browser-demo-videos/scripts/cli.mjs doctor --deep
bun --no-env-file skills/browser-demo-videos/scripts/cli.mjs demo --session contributor-demo --output ./demo-output
```

Use a fresh output directory on subsequent runs. `demo` manages its own server and defaults to captions without a paid speech request. `bun run demo` is the corresponding source shortcut. For fixture development only, `bun run demo:serve` starts `skills/browser-demo-videos/assets/demo/server.mjs` separately; `PORT` overrides its default 4173. The canonical plan is `skills/browser-demo-videos/assets/demo/walkthrough.json`.

Dependency setup uses Bun with implicit dotenv loading disabled to install exact private packages and download Chromium. The browser prefix explicitly trusts only pinned agent-browser's lifecycle script; the separate Live prefix installs pinned ws with scripts ignored. System media/browser-library installation needs explicit authorization and may require an existing package manager or administrator help; no hidden elevation is acceptable. Run network-dependent integration only when network access is permitted. Review scene screenshots, actual app results, and representative final-video frames; probe/decode media, and listen if it includes narration. Report exactly what you reviewed, including unavailable playback.

### Paid integrations and private data

- Do not make paid provider calls merely to test setup, key presence, or a pull request. Source tests and ordinary CI must not require cloud keys or paid services.
- A keyed integration needs separate consent for the chosen provider, script disclosure, and potential cost. Use a fresh output directory; never automatically retry failures or switch providers.
- Use synthetic data and a task-specific session. Do not auto-load real profiles or record login, secrets, customer records, or production-changing operations.
- Never open or commit private env files, credentials, browser state, raw private manifests, or recordings. Keys belong in a private environment/ignored file, not a report or fixture.
- Local outputs are unredacted. Review and sanitize any screenshot, video, transcript, URL, session metadata, or path before proposing it as a public asset.

## Review expectations

Keep changes focused. Describe the user-visible behavior, why it is needed, gates actually run, and integration work actually observed. Add behavioral coverage for changed contracts rather than tests that merely assert copied strings or file wiring. Preserve existing plan/provider semantics unless the proposed change explicitly addresses them.

Use real browser actions and readiness conditions; do not modify application source, intercept requests, or fabricate UI state to make a demo succeed. Preserve the distinction between OpenAI Chat and actual GPT-Live, explicit cloud consent, macOS-only missing-key speech fallback, and honest effective-provider metadata. A matching transcript or audio stream is not an acoustic quality guarantee.

For ordinary bug reports, include version, OS, Bun version, upstream Node version, a minimal synthetic plan, expected/actual behavior, and redacted diagnostics. Do not include secret values or unreviewed artifacts. Contributions are provided under the project's [MIT license](LICENSE); the installed skill also includes its [MIT license](skills/browser-demo-videos/LICENSE).

## Releases

When publishing an authorized release, its GitHub release title must be exactly its tag, with no descriptive suffix. For example, use `gh release create "$TAG" --title "$TAG" --notes-file /path/to/release-notes`. Do not create a release or mutate a tag as part of ordinary contribution checks.
