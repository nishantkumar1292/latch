# Latch doctrines & landmine packs

A **doctrine** is how Latch reviews. A **landmine pack** is what a specific kind
of codebase gets wrong. The doctrine is generic and ships in the box
([`skeptical-senior-engineer.md`](./skeptical-senior-engineer.md)); the landmine
packs are the community-contributed library that makes Latch sharp on *your* kind
of repo — and that library is the moat. A model can be copied; an accumulating
corpus of real, reported "green CI but wrong" traps cannot.

This directory is where that corpus lives.

---

## What a landmine pack is

A landmine pack is a small, focused set of review rules for a recurring class of
codebase — "sqlx-migrations", "react-server-components", "stripe-webhooks",
"terraform-aws", "protobuf-contracts". Each rule encodes a bug that was *actually
shipped* (or actually caught), phrased as something a reviewer can hunt for.

A pack is just a YAML file that slots into the same shape as `.latch/policy.yml`'s
`landmines:` and `doctrine:` sections. A repo adopts a pack by copying its entries
into its own `.latch/policy.yml` (packs are ingredients, not dependencies — Latch
reads one policy file per repo, with no network fetch, on purpose).

### Pack file shape

```yaml
# pack: sqlx-migrations
# what kind of repo this is for, in one line
name: sqlx-migrations
description: Rust services using sqlx file-based migrations keyed by numeric prefix.

# Review rules. Each is a claim the reviewer must actively try to falsify in the
# diff. Write them as "hunt for X", not "X is bad".
landmines:
  - id: migration-prefix-collision
    summary: >-
      Migrations are keyed by numeric prefix. Two branches can add the same
      number with different filenames — git merges both silently and the service
      fails at boot with a version mismatch.
    hunt: >-
      For every added migration file, compare its numeric prefix against the
      highest on the default branch AND every other open PR/branch. Flag any
      collision; the fix is to renumber above whichever lands first.
    severity: blocking

  - id: embed-without-build-copy
    summary: >-
      A file embedded at compile time (include_str!/embed) needs a matching COPY
      in the release Dockerfile, or the workspace build passes and the release
      build fails.
    hunt: >-
      For every newly embedded repo file, grep the Dockerfile for a COPY that
      brings it into the image. Missing COPY -> blocking.
    severity: blocking

# Optional extra doctrine lines appended to the generic doctrine for this repo.
doctrine:
  - When a new content type/engine is added, its enabling row must ship disabled
    until the client that renders it is released.
```

The two required fields per landmine are **`summary`** (what the trap is) and
**`hunt`** (how the reviewer looks for it in a diff). `id` and `severity`
(`blocking` | `warn` | `nit`) are recommended.

---

## How to contribute a pack

1. Fork [`nishantkumar1292/latch`](https://github.com/nishantkumar1292/latch).
2. Add `doctrines/packs/<pack-name>.yml` in the shape above.
3. Every rule must trace to a **real** defect — link the PR/issue/commit or
   describe the incident in the rule's `summary`. No hypotheticals; the value of
   the corpus is that every entry bit someone.
4. Keep rules **falsifiable and diff-local**: a reviewer with only the PR and the
   repo must be able to act on the `hunt` text. "Write good code" is not a rule;
   "for every new webhook handler, verify the signature is checked before the
   body is parsed" is.
5. Open a PR. Latch reviews its own contribution PRs, so your pack will be read by
   the same doctrine it extends — a good first test of whether the `hunt` text is
   concrete enough to act on.

### Quality bar

- **One class of codebase per pack.** Don't mix stripe rules into the migrations
  pack.
- **No secrets, no company-identifying detail.** Generalize the incident; keep
  the trap.
- **American English, imperative voice**, matching the generic doctrine's style.

---

## Why this is the moat

Latch's differentiation is not the model and not the loop mechanics — those are
copyable in a quarter. It is (1) **independence** (the reviewer is never the
author-agent) and (2) **this corpus**: a growing, community-owned library of the
exact "green CI but wrong" traps that real teams have hit, phrased so an
independent reviewer can catch them before a human has to. Every contributed pack
compounds it. That is the asset a funded incumbent can out-fund but cannot
out-community.
