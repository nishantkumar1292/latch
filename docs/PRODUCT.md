# Product

The product design for Latch — surfaces, v1 scope, and the quickstart in detail.
Ported and trimmed from the original product brief, edited to the adopted decisions
(the Latch name, the three [judge corrections](./STRATEGY.md#the-three-corrections-adopted),
non-blocking-by-default enforcement, model-independence as a real knob).

## Surfaces — three, one engine

Latch is one engine (the review⇄fix loop) exposed through three surfaces, shipped in
this order.

### A) OSS GitHub Action + CLI — the trust and distribution layer (v1)

The two workflows plus a `latch` CLI that runs the same review/fix loop locally or in
any CI. This is what exists as proven mechanics (generalized from a production
deployment). It is the transparency artifact — every hop an auditable
Actions run, in *your* repo, on *your* audit trail, on *your* key — the top of the
funnel and the credibility anchor: "here's the actual thing, read the source." It
spends the customer's Actions minutes and needs a per-repo edit to install, so it is
the trust layer, not the growth engine. **This is v1.**

### B) Hosted GitHub App — the growth product (phase 2)

Install on an org/repo, grant permissions, done — no YAML committed, no per-repo
wiring. Every PR (including bot/agent-authored ones) fires the loop on **our** sandbox.
We run the reviewer and fixer on **our** inference and billing, so the customer never
manages a token or a workflow file. This is the one thing the self-hosted mode cannot
do, and the paid conversion. Per the [corrections](./STRATEGY.md#the-three-corrections-adopted),
the hosted defaults are a **non-blocking verdict** and **suggested changes a human
applies** — with the required-check gate and silent fix-pushes as opt-ins a team
enables after trusting its own false-positive rate. Not built yet — see
[ROADMAP.md](./ROADMAP.md).

### C) MCP server — the inner-loop upgrade (phase 3)

An opt-in server exposing `request_review` / `await_verdict` that MCP-capable agents
(Claude Code, Codex plugins, Cursor) install so they can call the gate **pre-push** —
get a verdict and a fix *before a PR ever exists*. Sticky and differentiated, but
per-agent opt-in and doesn't reach Copilot's or Devin's hosted loops, which is why it
is an add-on, not the beachhead. Not built yet.

## What v1 is

- The **OSS Action + CLI** running the full loop, key-agnostic (Claude first;
  Bedrock/Vertex pluggable later), with:
  - **directional identity separation** (reviewer identity ≠ fixer identity, so
    nothing self-approves and GitHub's recursion guard keeps the loop directional);
  - the **anti-tamper guard** (never touch `.github/workflows/` or the policy file);
  - **bounded cycles with human escalation** (cap-3 → @-mention the author);
  - a **fixer that judges each thread and may disagree** with reasoning rather than
    blindly comply;
  - **converge-then-a-human-merges** — the loop never merges.
- The verdict (`MERGE` / `MERGE-WITH-FIXES` / `DO-NOT-MERGE`) as a **non-blocking
  commit status by default**, which a team can mark required itself once it trusts the
  false-positive rate.
- A **per-repo policy file** (`.latch/policy.yml`, or mined from an existing
  `CLAUDE.md` / `AGENTS.md`): the doctrine and repo landmines as configurable,
  versioned policy.
- A landing page and a **real recorded demo** of the loop converging the middle-tile
  bug (see the launch runbook in the private ops repo
  `github.com/nishantkumar1292/latch-ops`).

## What v1 is explicitly NOT

- **Not an auto-merger.** Converge and stop. Native auto-merge is an opt-in a team
  wires up itself; the default and the sold posture is a human presses merge.
- **Not a PR-authoring agent**, **not a merge queue**, **not a generic linter/SAST**,
  **not a codebase Q&A tool**, **not MCP-first**, **not multi-forge** (GitHub only at
  launch).
- **Not a required check by default**, and (in the hosted product) **not a silent
  fix-pusher by default** — both are opt-ins, per the corrections.

## Quickstart (human) — in detail

Latch runs in **your** GitHub Actions on **your** Claude key. Nothing about your code
reaches us in the OSS mode.

1. **Scaffold.** `npx github:nishantkumar1292/latch init` writes
   `workflows/latch-review.yml`, `workflows/latch-fix.yml`, and a starter
   `.latch/policy.yml` into the repo. (After npm publish, `npx latch-gate init`
   also works.)
2. **Install the Claude GitHub App** on the repo. This matters for a mechanical
   reason: the reviewer must post under an app identity whose review **fires the
   `pull_request_review` event**, which is what triggers the fix hop. If the review
   posted under a plain `GITHUB_TOKEN` identity, that event would not fire and the loop
   would never turn. (See [ARCHITECTURE.md](./ARCHITECTURE.md).)
3. **Generate a token** with `claude setup-token`, using your own Claude subscription
   or API key.
4. **Add the repository secret** `CLAUDE_CODE_OAUTH_TOKEN` with that token.
5. **Open a PR.** The reviewer runs, posts inline findings and a verdict status; the
   fixer converges the actionable threads (fixing real defects, refusing and leaving
   open the ones it disagrees with), and re-dispatches the review; when the re-review
   is clean the PR sits ready for you to merge.

## Quickstart (agent)

Hand a coding agent the copy-paste prompt in [README.md](../README.md#quickstart-agent)
and point it at [`INSTALL_FOR_AGENTS.md`](../INSTALL_FOR_AGENTS.md), the
machine-readable install protocol. It must not weaken the never-merges posture or the
anti-tamper guard.

## Configuration

- **Workflow variables / secrets:** `CLAUDE_CODE_OAUTH_TOKEN` (required); reviewer and
  fixer model + effort; cycle cap (default 3); verdict status mode (`non-blocking`
  default, `required` opt-in). Details in [README.md](../README.md#configuration).
- **`.latch/policy.yml`:** the review doctrine, the repo landmines, the touched-path
  check commands, the cycle cap, and the merge posture. Starter at
  [`policy/examples/policy.yml`](../policy/examples/policy.yml); the doctrine at
  [`doctrines/skeptical-senior-engineer.md`](../doctrines/skeptical-senior-engineer.md).
