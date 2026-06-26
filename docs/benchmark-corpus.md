# Benchmark Corpus

CodeDecay keeps an explicit regression-signal benchmark corpus in the repo so
scoring changes are forced through representative cases instead of anecdotes.

## What The Corpus Covers

The current benchmark set includes:

- low-signal docs or copy style changes that must stay below headline high risk
- medium-risk behavior changes that should stay visible without being inflated
- clearly risky auth or API changes that should remain high signal

## How It Is Enforced

The benchmark cases run in CI through the test suite. Each case locks:

- expected risk level
- allowed score range
- key findings that must remain present

That means a scoring tweak that turns a low-signal case into severe risk, or
hides a clearly risky case, fails in CI.

Run the benchmark directly with:

```bash
pnpm eval:benchmark
```

## How To Add A Case

1. Add a new benchmark case in the benchmark test file.
2. Describe the intent of the case in plain language.
3. Set the expected score range and expected key findings.
4. Explain why the case should stay low, medium, or high signal.

Keep the corpus small and representative. The goal is calibration, not a giant
fixture zoo.
