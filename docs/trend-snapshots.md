# Trend Snapshots

CodeDecay can emit a stable repository health snapshot so you can compare runs
over time without a hosted dashboard.

## Emit A Snapshot

```bash
npx codedecay snapshot --format json --output .codedecay/snapshot.json
```

The snapshot captures summary fields such as:

- merge risk
- decay risk
- risk level
- changed-file count
- impacted route or API count
- missing-test and weak-test counts
- evidence mode

## Compare With A Previous Snapshot

```bash
npx codedecay snapshot --compare .codedecay/previous-snapshot.json --format markdown
```

This produces a stable delta summary without any hosted service.

## GitHub-Native Artifact Workflow

You can run the CLI directly in GitHub Actions and upload the snapshot as an
artifact:

```yaml
name: CodeDecay Snapshot

on:
  pull_request:

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec codedecay snapshot --base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}" --format json --output codedecay-snapshot.json
      - uses: actions/upload-artifact@v4
        with:
          name: codedecay-snapshot
          path: codedecay-snapshot.json
```

## Baseline And History Patterns

Common local-first patterns:

- keep a checked-in baseline snapshot under `.codedecay/`
- upload the current snapshot as a workflow artifact on every PR
- regenerate a fresh snapshot on `main` after merge and keep that as the next
  comparison target

CodeDecay only compares files. You can choose whether the previous snapshot
lives in git, a release asset, or a workflow artifact.
