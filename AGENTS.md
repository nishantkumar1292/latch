# AGENTS.md — Latch project memory

> This file is the durable memory for any coding agent (or human) opening this repo
> cold. Read it first. It carries the end goal, the decisions and why, the current
> state, the repo map, and the protocol for continuing the work without re-deriving
> everything. If you change a decision, update the decision log with a dated entry.

---

## Mission and end goal

**Latch is the independent merge gate for the agent era** — a bounded review⇄fix loop
that converges any pull request (human- or agent-authored) to *mergeable*, then
stops. A human always merges; Latch never does.

One-liner: **"Two AIs argue about your PR until it's mergeable. You click merge."**

The business is **open-core under FSL**:

- The **complete loop is open source** (FSL-1.1-Apache-2.0), self-hostable free, run
  in the user's own GitHub Actions on their own Claude key. This is the trust
  artifact, the distribution funnel, and the credibility anchor.
- The **hosted gate is the revenue** — a zero-config GitHub App where we run the
  reviewer and fixer on our own inference and billing, so the customer never manages
  a token or a workflow file. Not built yet (phase 2).
- **Launch** is on X and Hacker News, led by a **real screen-recording video** of the
  loop converging a real PR (the middle-tile bug), because post-Devin the only
  credible AI demo is an independently verifiable one.

Positioning is deliberately narrow and honest (see the judge's corrections below):
**independent adversarial triage-and-autofix for the agent-PR firehose.** We do NOT
sell "merge confidence"; the loop never merges. The reviewer is independent of the
author-agent (separate context, adversarial doctrine, model-independence knob). The
verdict ships as a **non-blocking commit status by default**; teams may mark it
required themselves after trusting their own false-positive rate.

Read [docs/STRATEGY.md](./docs/STRATEGY.md) for the full positioning and the
competitive picture.

---

## Decision log

### 2026-07-18 — founding decisions

- **Name: Latch.** It is the product in one syllable — a directional gate that stays
  shut until a human releases it, i.e. "converge, then a human merges." Verbs cleanly
  ("Latch gated this PR"). Runner-up was Cinch. Avoided the overfished
  green\*/merge\* naming space.
- **Repo home: `github.com/nishantkumar1292/latch` — personal account, permanently
  for now.** The owner decided (2026-07-18) to **stay on the personal account and not
  create a GitHub org.** An org transfer happens only if traction ever demands it — and
  if it ever does, GitHub 301-redirects the old path, so links written today keep
  working. Use `nishantkumar1292/latch` in all links. (See the pre-launch operational
  decision below, which supersedes the abandoned `latchgate` org handle.)
- **Domain: `latchgate.dev`** (being purchased). Until DNS resolves, the site lives
  at <https://nishantkumar1292.github.io/latch/>.
- **npm package: `latch-gate`** (the bare `latch` name was taken). CLI binary is
  `latch`. Primary install path that works before npm publish:
  `npx github:nishantkumar1292/latch init`.
- **License: FSL-1.1-Apache-2.0** (Sentry's Functional Source License). Chosen over
  MIT/Apache (a funded competitor could host our exact loop and out-distribute a solo
  founder) and over AGPL (a friction moat, not a wall — it forces disclosure but does
  not forbid resale). FSL bans exactly the one thing that kills us — a competing
  hosted product — while keeping every feature open and auto-converting to Apache-2.0
  in two years. No CLA, no per-feature paywall, no enforcement bandwidth needed.
- **The three judge corrections are adopted** (an adversarial review of the original
  plan; full text distilled in [docs/STRATEGY.md](./docs/STRATEGY.md)):
  1. **Demote the two highest-liability heroes from v1 defaults.** The verdict ships
     as a **non-blocking** status and fixes ship as changes the loop converges but a
     human merges — "required gate" is an opt-in a team turns on *after* seeing its
     own false-positive rate. A required check driven by a probabilistic agent is a
     self-DoS; a hosted app pushing agent commits into stranger repos is an
     uninsurable liability. Non-blocking + suggested-not-forced removes both.
  2. **Make independence real and measured.** Default the reviewer to a model family
     *unlike* the customer's author-agent (offer the knob, recommend the mismatch),
     and build the **escaped-bug / false-negative dashboard as a core artifact**, not
     an afterthought. Independence you can't prove is theater; confidence you can't
     measure is comments.
  3. **The doctrine library is the moat, not the feature table.** Features are
     copyable; a growing, community-contributed corpus of falsification tactics and
     landmine packs is the one asset a funded incumbent can't clone in a quarter.
     Lead with it.
- **Pricing.** OSS self-hosted = free forever (BYO Claude key). Hosted =
  **$49 / active repo / mo incl. 25 gated PRs, then $8 / gated PR**, with a BYOK
  discount. Enterprise = custom (SSO, audit export, self-hosted license). Metric is
  **per-active-repo + gated-PR overage**, not per-seat (agents have no seats) and not
  pure per-PR (the market punishes raw usage meters). See
  [docs/PRICING.md](./docs/PRICING.md).
- **Phasing.** **v1 = OSS loop + landing page + demo video.** **Hosted GitHub App =
  phase 2** (our own auth/billing/inference — the one thing the self-hosted mode
  can't do). **MCP server (`request_review` / `await_verdict`, the pre-PR inner loop)
  = phase 3.** See [docs/ROADMAP.md](./docs/ROADMAP.md).
- **The engine is proven, not speculative.** Latch is the generalization of a loop
  running in production in a private source deployment (two GitHub Actions
  workflows: a review half and a fix half). The mechanics —
  identity separation, recursion-guard exploitation, explicit dispatch hops,
  anti-tamper skip, cycle-cap-3 with escalation, the fixer's judge-don't-comply step
  — are lifted from that deployment. Generalize them out of that repo's specifics;
  do not reinvent them.

### 2026-07-18 — pre-launch operational decisions

These revise the founding decisions above where they conflict.

- **Stay on the personal GitHub account — no org.** The repo home is
  `github.com/nishantkumar1292/latch`, permanently for now; we are **not** creating a
  `latchgate` org. An org transfer happens only if traction ever demands it (GitHub
  301-redirects the old path if so). Supersedes the founding "GitHub org handle:
  `latchgate`" decision.
- **v0 payment rail = Razorpay hosted-checkout link; the site slot is
  gateway-agnostic.** The site CONFIG constant is `PAYMENT_LINK_URL` (renamed from
  `STRIPE_PAYMENT_LINK`) and accepts **any** hosted-checkout URL — a Razorpay Payment
  Page for v0, a Stripe Payment Link later. Set it to turn the hosted CTA into "Buy";
  leave it `""` for the waitlist. The Stripe-metered + merchant-of-record billing in
  [docs/PRICING.md](./docs/PRICING.md) is the scale-up plan, not v0.
- **Launch operations live in a private repo.** The launch sequence, the video
  runbook, and the demo-repo assets moved to the **private** repo
  `github.com/nishantkumar1292/latch-ops`. They are kept out of the public repo
  pre-launch so pre-published launch scripts don't spoil the demo's credibility;
  after launch, `LAUNCH.md` may be published as a transparency post.
- **Domain `latchgate.dev` purchased; DNS already points at GitHub Pages.** The
  `latchgate` name survives only as the domain — there is no `latchgate` GitHub org.

---

## Current status

- [x] Repo initialized (`git init`, branch `master`), empty working tree.
- [x] Docs + in-repo memory authored (this file, README, LICENSE, SECURITY,
      CONTRIBUTING, and `docs/`).
- [ ] Engine ported from the source deployment: `workflows/latch-review.yml`,
      `workflows/latch-fix.yml`, `cli/bin/latch.js`,
      `doctrines/skeptical-senior-engineer.md`, `policy/examples/policy.yml`,
      `INSTALL_FOR_AGENTS.md`. *(Owned by the engine builder — reference, do not
      duplicate here.)*
- [ ] Demo repo (`math-drills`) reproducing the middle-tile bug and a real recorded
      run of the loop converging it.
- [ ] Landing page live (GitHub Pages now; `latchgate.dev` after DNS).
- [ ] npm publish of `latch-gate`.
- _Org transfer: deliberately deferred — owner decision (2026-07-18); staying on
  `nishantkumar1292/latch` unless traction demands an org._
- [ ] Public launch (X + HN) with the real-recording video.
- [ ] Hosted GitHub App (phase 2) — not started.
- [ ] MCP server (phase 3) — not started.

Keep this checklist honest: a box is checked only when the thing exists and works.

---

## Repo map

| Path | What it is | Owner |
|---|---|---|
| `README.md` | Launch-grade trust artifact: pitch, loop diagram, mechanics, quickstart, security, FAQ. | docs |
| `AGENTS.md` | This file — the project memory and resume protocol. | docs |
| `CLAUDE.md` | Two lines: project description + `@AGENTS.md` import, so Claude Code loads the same memory. | docs |
| `LICENSE.md` | Exact FSL-1.1-Apache-2.0 text, licensor filled in. | docs |
| `SECURITY.md` | Reporting + threat model in brief. | docs |
| `CONTRIBUTING.md` | Doctrine/landmine-pack contribution path (the moat) + dev setup. | docs |
| `docs/STRATEGY.md` | Judge-corrected positioning, the three corrections, what we do NOT claim, competitive summary. | docs |
| `docs/PRODUCT.md` | The product design — surfaces, v1 scope, quickstart detail. | docs |
| `docs/PRICING.md` | License + unit economics + packaging + billing rails. | docs |
| `docs/ARCHITECTURE.md` | How the loop works mechanically: sequence, identities, guards; hosted sketch as future. | docs |
| `docs/ROADMAP.md` | Phased checklist with current truth. | docs |
| _(launch ops — moved out)_ | The demo storyboard, honesty armor, and launch copy (X/HN) now live in the **private** ops repo `github.com/nishantkumar1292/latch-ops` (`LAUNCH.md`), kept private pre-launch so pre-published scripts don't spoil the demo. | ops |
| `INSTALL_FOR_AGENTS.md` | Machine-readable install protocol for a coding agent. | **engine builder** |
| `workflows/latch-review.yml` | The reviewer half of the loop (generalized from the source deployment's review workflow). | **engine builder** |
| `workflows/latch-fix.yml` | The fixer half (generalized from the source deployment's fix workflow). | **engine builder** |
| `cli/bin/latch.js` | The `latch` CLI — `init` scaffolds the workflows + policy; runs the loop locally. | **engine builder** |
| `doctrines/skeptical-senior-engineer.md` | The review doctrine (falsify-the-claims, distrust regenerated goldens, producer-and-consumer). | **engine builder** |
| `policy/examples/policy.yml` | Starter `.latch/policy.yml` — doctrine + landmines + check commands + cycle cap + merge posture. | **engine builder** |

The demo repo lives in a separate local checkout — the public `math-drills` repo
carrying the middle-tile bug.

---

## How to develop

- **CLI:** `cli/bin/latch.js` is Node. Run its tests before shipping changes; `latch
  init` must idempotently scaffold `workflows/` + `.latch/policy.yml` into a target
  repo. (Owned by the engine builder.)
- **Workflows:** validate the YAML (lint / `actionlint`) and rehearse a full loop on a
  throwaway PR before trusting it — the `pull_request_review` trigger only takes
  effect once the fixer workflow is on the default branch, so it can't fully self-test
  from its own PR. Confirm: review posts inline + a verdict status; fixer opens
  `latch-cycle:1`, commits under the fixer identity, resolves fixed threads, leaves a
  disagreed thread open with reasoning, and re-dispatches; the re-review returns clean.
- **Site:** static (GitHub Pages). No build step assumed.

---

## Conventions

- **Commits:** lowercase, imperative, no mention of AI. American English throughout.
- **Branching:** every PR branches from the latest `origin/master` and carries **one**
  change. **Never open a stacked PR** — if B depends on A, land A first, then branch
  B. Never set a PR base to anything but `master`.
- **Never force-push `master`.**
- Run the CLI tests and validate workflow YAML before committing.

---

## THE RESUME PROTOCOL — new agent starts here

Read, in order:

1. **`AGENTS.md`** (this file) — mission, decisions, status, repo map.
2. **[`docs/STRATEGY.md`](./docs/STRATEGY.md)** — why the product is shaped this way,
   the three judge corrections, what we do NOT claim.
3. **[`docs/ROADMAP.md`](./docs/ROADMAP.md)** — what is built, what is next, the
   pre-launch task list.
4. **`LAUNCH.md` in the private ops repo `github.com/nishantkumar1292/latch-ops`** —
   the demo and launch plan, so any work stays aimed at the launch artifact. It lives
   in a private repo (not here) because publishing the launch scripts pre-launch would
   spoil the demo's credibility.

Then, for mechanics, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and the
engine files (`workflows/`, `cli/`, `doctrines/`, `policy/`) if they exist yet.

### What NOT to do

- **Never weaken the never-merges posture.** Latch converges and stops; a human
  merges. This is the trust story *and* the security boundary. Do not add an
  auto-merge default, in any tier.
- **Never weaken the anti-tamper guard.** The fixer must never edit
  `.github/workflows/` or the policy file. A loop that can rewrite its own rules is
  the thing we refuse to build.
- **Never make independence or the metric into theater.** Keep the model-independence
  knob real and default toward a model unlike the author-agent; keep measuring the
  escaped-bug / false-negative rate. Do not ship a survivorship reel of catches and
  call it confidence.
- **Never overclaim in demos.** Real repo, real PR, real SHAs, real timestamps,
  every hop a visible run, the fixer's disagreement shown in full, "it never merges —
  you do" stated out loud. Post-Devin, the honesty *is* the marketing.
- **Never invent metrics or citations.** The market stats in the corpus need real
  citations before they go in front of anyone who diligences; do not assert them as
  fact without a source.
