# Product Testing

CodeDecay is adding a local-first product verification layer so UI/API failures
can be handed to humans, PR comments, and coding agents as concrete evidence.

This is the foundation for replacing hosted autonomous testing workflows without
giving up CodeDecay's default safety model.

## Target Model

Product targets live in `productTesting.targets` inside CodeDecay config.

```yaml
version: 1

productTesting:
  targets:
    web:
      baseUrl: http://127.0.0.1:3000
      healthCheck: http://127.0.0.1:3000/api/health
      timeoutMs: 60000
```

`codedecay config --format markdown` shows each target's readiness:

- `ready`: CodeDecay can use `baseUrl` or a resolved `previewUrlEnv`.
- `command-required`: a start command exists and commands are allowed, but it
  still requires an explicit product verification command to run.
- `needs-command-approval`: a start command exists, but
  `safety.allowCommands` is false.
- `missing-preview-url`: `previewUrlEnv` is configured but not available.
- `unresolved`: the target has no usable URL or startup command.

Config inspection never executes product target commands.

## Run Product Target Checks

Use `codedecay product` to verify configured live app targets.

```bash
npx codedecay product --format markdown
npx codedecay product --target web --format json
```

The command performs only the steps declared in config:

- run `authSetupCommand` if present,
- start `startCommand` if present and commands are allowed,
- poll `healthCheck`, resolved `previewUrlEnv`, or `baseUrl`,
- stop the managed startup process,
- run `teardownCommand` if configured.

Targets with only `baseUrl` or `previewUrlEnv` can be checked without running
commands. This is useful for already-running local apps and PR preview URLs.

```yaml
version: 1

productTesting:
  targets:
    preview:
      previewUrlEnv: VERCEL_URL
      timeoutMs: 60000
```

Startup remains opt-in. If `startCommand` is configured but
`safety.allowCommands` is false, `codedecay product` reports the target as
blocked and does not run the command.

```yaml
version: 1

productTesting:
  targets:
    local:
      startCommand: pnpm dev
      healthCheck: http://127.0.0.1:3000/api/health
      teardownCommand: pnpm stop
      timeoutMs: 60000

safety:
  allowCommands: true
```

## Playwright Flow Explorer

Use `codedecay product --explore` to crawl configured product targets and write a
stable flow map artifact.

```bash
npx codedecay product --target web --explore --max-pages 5 --format markdown
```

The explorer is intentionally conservative:

- it runs only when `safety.allowCommands: true`,
- it loads `playwright` from the target project,
- it does not install Playwright packages or browser binaries,
- it crawls same-origin links from the product target URL,
- it records page URLs, titles, links, forms, buttons, inputs, selectors, and
  accessible names,
- it records screenshots when the project Playwright driver can provide them,
- it blocks potentially destructive forms and actions unless
  `--allow-destructive-actions` is passed,
- it obeys `--max-pages` and `--max-actions`.

Flow maps are written under:

```text
.codedecay/local/product-flow-maps/<target-id>/flow-map.json
```

The JSON schema lives at
[`schemas/product-flow-map.schema.json`](schemas/product-flow-map.schema.json).

Markdown and JSON product reports link to the flow-map artifact so agents and
humans can reuse the discovered product surface as test-generation input.

## Failure Bundle Schema

Product verification failures are represented as versioned bundles on
`CodeDecayReport.productFailureBundles`.

The JSON schema lives at
[`schemas/product-failure-bundle.schema.json`](schemas/product-failure-bundle.schema.json).

Each bundle includes:

- failing check ID and priority,
- target and environment,
- failing step plus neighboring steps,
- screenshot, trace, video, DOM, console, network, test-source, or
  request/response-diff artifacts,
- expected and actual behavior,
- likely impacted files,
- root-cause hypothesis when available,
- suggested fix tasks,
- exact rerun command,
- failure classification.

Failure classifications are:

- `confirmed-regression`
- `likely-flaky`
- `environment-failure`
- `auth-or-test-data-failure`
- `generated-test-weakness`
- `unknown`

## Agent And PR Output

Markdown reports render a **Product Failure Bundles** section. SARIF output adds
product verification results and links them to impacted files when available.

Agent task bundles include the same product failure bundles in machine-readable
JSON and Markdown, so agents can fix and rerun a specific failed check instead
of guessing from a dashboard screenshot.

## Current Limits

This release defines the target model, live health-check runner, Playwright flow
map explorer, and failure evidence contract. It does not yet generate UI/API
tests automatically.

The next implementation pieces are:

- generated UI regression tests,
- OpenAPI/API scenario generation,
- MCP run-fix-rerun tools,
- retained product-test memory,
- flake/setup/real-regression classification,
- PR preview verification and scheduled monitoring.
