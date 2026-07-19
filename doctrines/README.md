# Latch doctrines and landmine packs

A **doctrine** defines how Latch reviews. A **landmine** records a concrete bug
pattern that a particular kind of codebase is prone to.

The default doctrine is
[`skeptical-senior-engineer.md`](./skeptical-senior-engineer.md). Repositories can
add their own landmines to `.latch/policy.yml`.

## Landmine shape

```yaml
landmines:
  - id: migration-prefix-collision
    summary: >-
      Two migration files with the same numeric prefix can merge cleanly and
      fail when the service starts.
    hunt: >-
      Compare every added migration prefix with the default branch and other
      open work. Flag collisions.
    severity: blocking
```

Each landmine needs a `summary` that names the failure and a `hunt` that tells
the reviewer how to look for it. `id` and `severity` (`blocking`, `warn`, or
`nit`) are recommended.

## Contributing a pack

1. Add `doctrines/packs/<pack-name>.yml`.
2. Keep the pack focused on one type of codebase.
3. Base every rule on a real defect or near miss.
4. Make every hunt falsifiable using the pull request and repository.
5. Remove secrets and identifying details from the incident.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the repository contribution rules.
