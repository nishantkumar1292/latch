# Contributing to Latch

Thank you for helping build the independent merge gate. The single most valuable
contribution you can make is a **doctrine or landmine pack** — read on.

## The headline: contribute doctrine / landmine packs

Features are copyable; a growing, community-contributed corpus of *how to catch the
bugs green CI can't see* is not. **The doctrine library is Latch's moat.** Every
falsification tactic and repo-landmine pattern you contribute compounds an asset that
lives in the policy, not in the model — and that a funded incumbent cannot clone in a
quarter.

Two kinds of contribution:

1. **Doctrine tactics** — general, model-agnostic review heuristics that catch a
   *class* of green-CI-but-wrong defect. The founding examples live in
   [`doctrines/skeptical-senior-engineer.md`](./doctrines/skeptical-senior-engineer.md):
   - treat the PR description as **claims to falsify**, not context to absorb;
   - **distrust golden/snapshot tests regenerated in the same commit** as the code
     they pin — they prove determinism, not correctness;
   - every new field, endpoint, or event needs a **producer *and* a consumer** — grep
     both ends of every new contract.

   A good new tactic names the bug class, explains why CI misses it, and gives a
   concrete falsification move.

2. **Landmine packs** — repo- or stack-specific traps encoded as policy. The
   archetype is the true **middle-tile bug**: a generated math drill sorted its answer
   choices so the correct answer was always the middle tile, and a five-year-old
   learned to just tap the middle. The landmine is "any content with selectable answer
   choices must randomize answer position at creation *and* at render." Others from the
   source deployment: silent migration-prefix collisions across branches;
   `include_str!` of a repo file needs a matching Dockerfile `COPY`; new content
   engines must land disabled. A pack pairs the trap with the check that catches it.

Contribute a pack as a policy fragment (see
[`policy/examples/policy.yml`](./policy/examples/policy.yml)) and/or a doctrine entry,
with a one-paragraph story of the real defect it prevents. Real bugs beat
hypotheticals — the middle-tile story carries because it actually happened.

## Non-negotiables

Any contribution must preserve the invariants that make Latch trustworthy. PRs that
weaken these will be declined:

- **The loop never merges.** A human always performs the merge. Do not add an
  auto-merge default.
- **The anti-tamper guard stays.** The fixer must never edit `.github/workflows/` or
  the policy file.
- **Identity separation and the recursion guard stay.** Reviewer and fixer are
  distinct identities; the fix push must not self-trigger the loop.
- **Honesty in demos and claims.** No invented metrics or uncited market stats; keep
  the model-independence knob and the escaped-bug measurement real.

## Dev setup

- **CLI** (`cli/bin/latch.js`): Node. Run the CLI tests; `latch init` must
  idempotently scaffold `workflows/` + `.latch/policy.yml` into a target repo.
- **Workflows** (`workflows/latch-*.yml`): validate the YAML (e.g. `actionlint`) and
  rehearse a full loop on a throwaway PR — the `pull_request_review` trigger only
  takes effect once the workflow is on the default branch, so it cannot fully
  self-test from its own PR.
- **Site:** static; no build step.

## Conventions

- Commits: **lowercase, imperative, no mention of AI**. American English.
- Every PR branches from the latest `origin/master` and carries **one** change.
  **No stacked PRs** — never set a PR base to anything but `master`. Never force-push
  `master`.

## License of contributions

By contributing you agree your contribution is licensed under the project's
[FSL-1.1-Apache-2.0](./LICENSE.md). No separate CLA is required — the license text
does the work.
