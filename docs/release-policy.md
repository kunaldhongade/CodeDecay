# Release Policy

CodeDecay is pre-`1.0`, so compatibility should be explicit instead of implied.

## What Is Stable Enough To Rely On

- CLI command names documented in `codedecay help`
- repo-local config file locations
- deterministic local-first default behavior
- GitHub Action `analyze`, `redteam`, and `agent` modes

## What May Still Evolve Before 1.0

- JSON report fields may grow
- SARIF `properties` may gain additional metadata
- score calibration may shift as benchmark coverage improves
- optional LLM and hosted surfaces may change faster than deterministic core

## Upgrade Guidance

- Pin CI usage to an explicit package version or action ref.
- Review release notes before moving across minor versions.
- Treat minor upgrades as the place where pre-`1.0` breaking changes may be
  announced.
- Treat patch upgrades as compatibility-preserving unless the release notes say
  otherwise.

## Breaking-Change Discipline

When CodeDecay changes config shape, CLI behavior, or report semantics in a way
that can break automation, the release notes should call it out explicitly.

Until `1.0`, users should assume:

- deterministic default behavior is a stronger compatibility target than
  optional integrations
- report fields can expand, so consumers should ignore unknown fields
- score calibration can improve as long as benchmark expectations stay explicit
