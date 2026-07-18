# Roadmap

Phased checklist with current truth. A box is checked only when the thing exists and
works. Dates use the founding date 2026-07-18 as t0.

## Phase 0 — docs + memory (in progress)

- [x] Product identity locked (name Latch, personal repo `nishantkumar1292/latch` —
      no org, domain `latchgate.dev`, npm `latch-gate`, FSL license) — see
      [AGENTS.md](../AGENTS.md#decision-log).
- [x] Docs + in-repo memory authored: [README](../README.md), [AGENTS](../AGENTS.md),
      [CLAUDE](../CLAUDE.md), [LICENSE](../LICENSE.md), [SECURITY](../SECURITY.md),
      [CONTRIBUTING](../CONTRIBUTING.md), and `docs/` (strategy, product, pricing,
      architecture, roadmap, launch).

## Phase 1 — v1: OSS loop + landing + demo (current focus)

The trust layer and the launch. Everything here runs in the user's own Actions on
their own key.

- [ ] **Engine ported from the source deployment** *(engine builder)*:
  - [ ] `workflows/latch-review.yml` — the reviewer half, generalized.
  - [ ] `workflows/latch-fix.yml` — the fixer half, generalized.
  - [ ] `cli/bin/latch.js` — the `latch` CLI; `latch init` scaffolds the workflows +
        `.latch/policy.yml` idempotently and can run the loop locally.
  - [ ] `doctrines/skeptical-senior-engineer.md` — the review doctrine.
  - [ ] `policy/examples/policy.yml` — starter `.latch/policy.yml`.
  - [ ] `INSTALL_FOR_AGENTS.md` — machine-readable install protocol.
- [ ] Landmine list generalized out of hardcoded source-repo specifics into policy;
      a `CLAUDE.md` / `AGENTS.md` auto-miner.
- [ ] Model/auth pluggable (Claude key first; Bedrock/Vertex stubs); the
      **model-independence knob** exposed (review with a model unlike the author-agent).
- [ ] **Demo repo** (`math-drills`) reproducing the middle-tile bug, and a real
      recorded run of the loop converging it — one thread fixed, one refused. See
      the launch runbook in the private ops repo `github.com/nishantkumar1292/latch-ops`.
- [x] **Landing page** live at <https://latchgate.dev> (GitHub Pages + custom domain, HTTPS enforced),
      with the animated demo and the hosted waitlist.
- [ ] **Escaped-bug / false-negative measurement** wired from the first real run — the
      metric is a core artifact, not a week-11 afterthought.

## Pre-launch tasks (gate the public launch)

- [ ] **npm publish** of `latch-gate` (until then, `npx github:nishantkumar1292/latch
      init` is the install path — keep it working).
- Org transfer deliberately deferred (owner decision 2026-07-18) — stay on
  `nishantkumar1292/latch` unless traction demands an org (GitHub 301-redirects if it
  ever happens).
- [ ] **Domain DNS** for `latchgate.dev` (until it resolves, the site is the GitHub
      Pages URL above).
- [ ] Doctrine library seeded as a **community-contributable corpus** (the moat), with
      the middle-tile pack as the archetype — see [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] Launch copy finalized (X variants + HN title) — see the launch runbook in the
      private ops repo `github.com/nishantkumar1292/latch-ops`.

## Phase 2 — hosted GitHub App (revenue; not started)

- [ ] GitHub App registration; webhook receiver (HMAC verify + dedupe by `repo#pr`).
- [ ] Queue (Redis) + one containerized **ephemeral** runner; no customer-code
      retention (clone to tmpfs, destroy on exit).
- [ ] Verdict as a commit status / check run — **non-blocking by default**;
      required-check and silent-push as per-repo opt-ins.
- [ ] Identity separation via committer-login guard (one App; defer the second
      "Latch Fixer" App until it bites).
- [ ] Our own auth (GitHub OAuth) + metering + Stripe (usage meters) + a
      merchant-of-record for tax.
- [ ] Org dashboard: per-hop loop timeline, convergence rate, the escaped-bug metric,
      "which of last night's PRs are mergeable."
- [ ] Enterprise: SSO/RBAC, org-wide policy governance, per-hop audit export.

See the hosted sketch in [ARCHITECTURE.md](./ARCHITECTURE.md#hosted-app-sketch-phase-2--future).

## Phase 3 — MCP inner loop (not started)

- [ ] MCP server exposing `request_review` / `await_verdict` so MCP-capable agents
      (Claude Code, Codex plugins, Cursor) can gate code **pre-PR**.
- [ ] Distribution via Codex plugins / Claude Code / Cursor MCP config.

## Explicitly deferred / out of scope for now

- Multi-forge (GitLab/Bitbucket) — GitHub only at launch; GitLab is the likely next
  forge if the platform-native-gate threat materializes.
- Merge-queue / stacking (Graphite's lane) — Latch posts a status a queue can consume.
- Auto-merge as a default — never; a human always merges (opt-in wiring only).
