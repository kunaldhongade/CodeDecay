# Editor Workflows

CodeDecay can surface findings before a pull request is opened without relying
on Markdown parsing or a hosted service.

## Recommended VS Code Path

The simplest local-first setup is SARIF plus a SARIF-capable editor extension
such as the VS Code SARIF Viewer.

1. Generate SARIF locally:

```bash
npx codedecay analyze --format sarif --output .codedecay/codedecay.sarif
```

2. Open `.codedecay/codedecay.sarif` in the editor extension.
3. Review inline diagnostics for risky files and lines.
4. Re-run the command after changes.

This gives you inline file annotations before PR creation and uses a stable
machine-readable format instead of parsing Markdown.

## JSON Workflow For Custom Tooling

If you want your own editor task, MCP client, or repo-local script to consume
CodeDecay findings directly, generate JSON:

```bash
npx codedecay analyze --format json --output .codedecay/codedecay.json
```

Useful fields:

- `summary.mergeRiskBreakdown`
- `summary.decayBreakdown`
- `impactedRoutes`
- `testEvidence`
- `findings`

These fields are stable enough for repo-local tooling and do not require any
Markdown scraping.

## Suggested Local Loop

```bash
npx codedecay analyze --format sarif --output .codedecay/codedecay.sarif
npx codedecay analyze --format json --output .codedecay/codedecay.json
```

Use SARIF for inline editor diagnostics and JSON for any richer local UI or
automation.

## Limits

- CodeDecay does not yet ship a first-party VS Code or JetBrains extension.
- The richer route/API and score-breakdown metadata is available directly in
  JSON and SARIF `properties`, but generic editors may only render line
  findings by default.
- Command execution remains separate and explicit through `codedecay execute`
  and `codedecay differential`.
