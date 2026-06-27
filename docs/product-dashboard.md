# Product Dashboard

`codedecay dashboard` generates a static, local-first product verification
dashboard from product run JSON artifacts.

It is designed for GitHub Pages, CI artifacts, or any static file host. It does
not require a hosted CodeDecay service.

## Generate

```bash
npx codedecay dashboard
```

Default discovery reads:

- `.codedecay/local/product-runs/**/*.json`
- `.codedecay/local/product-trends/**/*.json`

The command writes:

- `.codedecay/local/dashboard/index.html`
- `.codedecay/local/dashboard/dashboard.json`
- `.codedecay/local/dashboard/failures/*.json`
- `.codedecay/local/dashboard/failures/*.md`

Use `--output` for GitHub Pages or CI artifact paths:

```bash
npx codedecay dashboard \
  --input .codedecay/local/product-trends \
  --output public/codedecay-dashboard
```

## What It Shows

The dashboard summarizes:

- recent product verification runs
- pass/fail counts by run
- target ids seen in the artifacts
- confirmed regressions
- likely flaky checks
- failure bundle links
- exact rerun commands

Each failure links to exact JSON and Markdown bundle files so agents and humans
can inspect the same evidence without scraping the HTML.

## Redaction

Dashboard generation redacts sensitive values by default:

- bearer tokens
- common secret query keys such as `token`, `api_key`, `secret`, `password`,
  `session`, and `cookie`
- email addresses
- query strings in URLs

The dashboard is generated from sanitized failure bundles. Raw product run
artifacts remain local under `.codedecay/local/` unless your workflow uploads
them explicitly.

## CI Artifact Example

```yaml
- uses: SubmuxHQ/CodeDecay/packages/github-action@v0
  with:
    mode: product
    target: api
    preview-url: ${{ vars.STAGING_URL }}
    product-generate-api-tests: true
    product-run-generated-api-tests: true
    product-fail-on-classification: confirmed-regression
    format: json
    output: .codedecay/local/product-trends/staging-${{ github.run_id }}.json

- run: npx codedecay dashboard --output public/codedecay-dashboard

- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: codedecay-product-dashboard
    path: public/codedecay-dashboard
```

