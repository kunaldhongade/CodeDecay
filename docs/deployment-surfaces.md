# Deployment Surfaces

This page is the current source of truth for what CodeDecay is today and what
is still roadmap work.

## Available Today

| Surface | Status | Notes |
| --- | --- | --- |
| CLI | Available | Primary OSS product surface. |
| GitHub Action | Available | Composite wrapper around the CLI for PR workflows. |
| Local MCP server | Available | Repo-local tool surface for agent clients. |

## Experimental Or Partial

| Surface | Status | Notes |
| --- | --- | --- |
| GitHub App package | Partial | Repo scaffolding exists, but there is no managed public service promise. |
| Optional LLM providers | Partial | Provider abstraction exists, but deterministic analysis remains the default. |

## Not Shipped Yet

These are not available today and should not be implied by the README:

- multi-tenant hosted dashboard
- managed SaaS billing surface
- SSO
- enterprise audit log product surface
- hosted trend analytics

## Recommended Adoption Story Today

If you are evaluating CodeDecay today, assume:

1. local CLI first
2. GitHub Action for CI
3. local MCP for agent workflows

If you need a managed hosted offering, treat that as future roadmap work rather
than a current product promise.
