# AGENTS.md

Latch is a bounded GitHub review-and-fix loop. A reviewer posts findings, a
separate fixer may repair them, and the reviewer checks the result again. The
loop stops for a human to merge.

## Project invariants

- Never add auto-merge behavior. Latch stops; a human merges.
- Never let the fixer edit `.github/workflows/` or `.latch/`.
- Keep reviewer and fixer identities separate.
- Keep the fix cycle bounded and escalate unresolved work to a human.
- Do not request, print, store, or commit user credentials.

## Repository map

- `cli/bin/latch.js`: Node CLI used by `latch init`, `doctor`, and `uninstall`.
- `workflows/`: workflow templates installed into target repositories.
- `policy/examples/policy.yml`: starter repository policy.
- `doctrines/`: review doctrine and contributed landmine packs.
- `site/`: static GitHub Pages site; no build step.
- `docs/ARCHITECTURE.md`: public description of the shipped loop.

## Development

- Run `npm test` after CLI or template changes.
- Validate workflow YAML before shipping workflow changes.
- Keep `latch init` idempotent and refuse destructive overwrites unless the user
  explicitly passes `--force`.
- Use lowercase imperative commit messages and American English.
- Branch from the latest `origin/master`; do not force-push `master`.
