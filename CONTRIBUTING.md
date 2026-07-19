# Contributing to Latch

Contributions to the CLI, workflows, documentation, and review doctrine are
welcome.

## Doctrine and landmine packs

A doctrine tactic describes a general review heuristic. A landmine describes a
specific failure pattern that ordinary CI can miss. Good rules:

- come from a real defect or near miss;
- name a concrete failure scenario;
- tell the reviewer how to find it in a diff; and
- avoid secrets or company-identifying details.

Start with [`doctrines/skeptical-senior-engineer.md`](./doctrines/skeptical-senior-engineer.md)
and [`policy/examples/policy.yml`](./policy/examples/policy.yml).

## Required invariants

- Latch never merges a pull request.
- The fixer never edits `.github/workflows/` or `.latch/`.
- Reviewer and fixer identities remain separate.
- Fix cycles remain bounded and unresolved work goes to a human.

## Development

- Run `npm test` after CLI or workflow-template changes.
- Validate workflow YAML after changing `workflows/latch-*.yml`.
- Keep `latch init` idempotent.
- The site is static and has no build step.

Use lowercase imperative commit messages and American English. Open each pull
request from the latest `origin/master` with one focused change.

By contributing, you agree that your contribution is licensed under
[FSL-1.1-Apache-2.0](./LICENSE.md).
