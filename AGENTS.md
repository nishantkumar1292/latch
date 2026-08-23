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

### 2026-08-12 — the fixer stops holding the pen

- **Replies and resolutions move behind the push.** The fixer agent no longer posts to
  GitHub at all: it writes a reply **plan** and stops, and the job pushes, verifies the
  commit is an ancestor of the remote branch, then replays the plan and mints the
  "Fixed in `<sha>`" claim itself. This supersedes the earlier arrangement (agent
  replies mid-run, job repairs afterwards) as the *primary* mechanism — the repair rail
  from the resolution work stays as the backstop, now fed by job-written evidence
  rather than by the agent's own bookkeeping. Rationale and the failure it prevents:
  [docs/OPERATIONS.md](./docs/OPERATIONS.md). Do not hand the agent back the ability to
  reply or resolve; ordering is the whole guarantee, and diligence is not a substitute.
- **The fix job re-asks whether it is needed before checking anything out.** Queued
  fixers from an event burst exit green in seconds instead of paying for a checkout and
  an agent to discover the threads are already answered.

### 2026-08-23 — configuration moves into the product

- **Configuration lives in the target repo's Actions variables, not in the workflow
  files.** Every tunable — the kill switch, the provider, models, efforts, the turn /
  timeout / cycle caps, the verdict status and its context, the reviewer login, the
  doctrine — is a repository variable the templates read **at runtime**, so a change
  takes effect on the next run with no commit and no PR. The failure that forced it:
  the production loop sat stuck on a reviewer credential that had hit a usage limit,
  and there was no way to pause the loop or point it at another provider without
  opening a PR against the workflow files while every gated PR waited. Configuration
  only a commit can change is not configuration. Every variable stays optional and
  validated — a fresh install that sets nothing must keep behaving exactly as before,
  and that is a supported path, not a fallback.
- **The UI for those variables is a static console — GitHub is the backend.**
  `site/console/` is plain HTML/CSS/vanilla JS on the same Pages deploy as the landing
  page, calling `api.github.com` direct from the browser. **Do not give it a backend.**
  The repo's Actions variables are already the single source of truth and GitHub's
  permissions are already the access control; a server of ours would add a second copy
  of the truth, a credential to guard, and an outage mode, and it would quietly become
  the hosted product (phase 2) without any of the things that make the hosted product
  worth money. Sign-in is the OAuth device flow (public client id, no client secret
  anywhere) with a fine-grained PAT as an always-available fallback; the token stays in
  that browser's `localStorage`. Say plainly, wherever this is described, that sign-in
  is **authentication UX, not server-side isolation** — there is no shared server state
  to isolate. The one piece of hosted code is `hosted/oauth-proxy/`, a stateless CORS
  pass-through for GitHub's two device-flow endpoints only; it must keep holding no
  secret, no state, and no repo data.
- **The engine is switchable: `LATCH_PROVIDER=claude|codex`.** This is the
  model-independence knob taken as far as a different vendor, and both legs run for
  real. It is not parity, and the difference must never be sold as parity: the Codex
  action's sandbox has **no network access**, so the codex reviewer holds no pen (it
  emits a structured verdict and a job step posts the review, with an explicit job for
  the review→fix hop because a `GITHUB_TOKEN` review fires no `pull_request_review`
  event), the fixer's threads are pre-fetched into a file and the **job**, not the
  agent, commits, network-dependent policy `checks:` cannot run and the fix is declared
  *unverified here*, and there is no salvage rail (it reads `claude-code-action`'s own
  execution log). `LATCH_MAX_TURNS` has no codex equivalent. `LATCH_REVIEW_LOGIN` exists
  because of all this — a non-claude reviewer does not post as `claude[bot]`, and the
  fixer's thread queries match nothing if it is not told who the reviewer is; the
  optional `LATCH_REVIEW_TOKEN` secret buys the codex review a login of its own, and
  then the dispatch job must stand down or the fixer runs twice on one review.
- **The kill switch is honest, and the consequence is documented, not papered over.**
  `LATCH_PAUSED=true` skips every job, so a paused Latch publishes **no** verdict
  status — so a team that has marked `latch/merge-gate` a *required* check has its
  merges blocked until it un-requires it. **Never post a passing status while paused.**
  A gate that reports `MERGE` having reviewed nothing is exactly the lie this project
  exists not to tell, and a required check is the one place that lie would be believed.
- **Three owner-side steps are still outstanding**, and the device-flow sign-in is not
  live until all three are done: register the GitHub OAuth App, deploy the CORS
  pass-through worker, and paste the client id + worker URL into the console's config.
  Until then the sign-in button shows a "not configured" state and the PAT path is the
  way in — which is why the PAT path is a first-class fallback and must not be removed
  once the device flow works.

---

## Current status

- [x] Repo initialized (`git init`, branch `master`), empty working tree.
- [x] Docs + in-repo memory authored (this file, README, LICENSE, SECURITY,
      CONTRIBUTING, and `docs/`).
- [x] Engine ported from the source deployment: `workflows/latch-review.yml`,
      `workflows/latch-fix.yml`, `cli/bin/latch.js`,
      `doctrines/skeptical-senior-engineer.md`, `policy/examples/policy.yml`,
      `INSTALL_FOR_AGENTS.md`. *(Owned by the engine builder — reference, do not
      duplicate here.)*
- [x] `latch` CLI shipped — `init` idempotently scaffolds the two workflows +
      `.latch/policy.yml` into a target repo.
- [x] Demo repo (`math-drills`) live — reproduces the middle-tile bug for the loop
      to converge (the recorded run of that convergence ships with the launch video,
      below).
- [x] Landing page live at `latchgate.dev` (served via GitHub Pages; DNS resolves).
- [x] Waitlist wired — the site's hosted CTA points at the live Tally form
      (`WAITLIST_URL`); flip `PAYMENT_LINK_URL` to turn that button into Buy.
- [x] Rehearsal #1 complete — all loop mechanisms verified live on a throwaway PR;
      2 latent guard bugs found + fixed.
- [x] Every tunable read from repo Actions variables at runtime (kill switch,
      provider, models, efforts, caps, verdict status/context, reviewer login,
      doctrine) — all optional, all validated; setting none is the supported path.
- [x] `LATCH_PROVIDER=claude|codex` — both legs run on either engine, with the codex
      sandbox's no-network cost documented (see the 2026-08-23 decision).
- [x] Static console shipped at `latchgate.dev/console/` (`site/console/`): connect a
      repo, produce the integration change, readiness check, `LATCH_*` config panel.
- [x] CORS device-flow pass-through worker written (`hosted/oauth-proxy/`).
- [ ] Console device-flow sign-in **live** — needs three owner steps: register the
      GitHub OAuth App, deploy the worker, paste the client id + worker URL into the
      console config. Until then, fine-grained PAT is the way in.
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
| `docs/OPERATIONS.md` | Running the loop in anger: the failure modes and their remedies, and the termination protocol for deciding when a PR is converged. | docs |
| `docs/ROADMAP.md` | Phased checklist with current truth. | docs |
| _(launch ops — moved out)_ | The demo storyboard, honesty armor, and launch copy (X/HN) now live in the **private** ops repo `github.com/nishantkumar1292/latch-ops` (`LAUNCH.md`), kept private pre-launch so pre-published scripts don't spoil the demo. | ops |
| `INSTALL_FOR_AGENTS.md` | Machine-readable install protocol for a coding agent. | **engine builder** |
| `site/index.html` | The landing page (GitHub Pages, custom domain `latchgate.dev`). | site |
| `site/console/` | The static console — connect a repo, produce the integration change, readiness check, and the `LATCH_*` variable panel. No backend: it calls `api.github.com` from the browser. | console |
| `hosted/oauth-proxy/` | Stateless CORS pass-through for GitHub's two device-flow endpoints, so the console's "Sign in with GitHub" works from a browser. Holds no secret, no state, no repo data. Deploy steps in its own `DEPLOY.md`. | console |
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
- **Workflows:** run `npm test` (it pins the templates' real `jq`/shell filters, and
  CI additionally parses both templates with PyYAML) and rehearse a full loop on a
  throwaway PR before trusting it — the `pull_request_review` trigger only takes
  effect once the fixer workflow is on the default branch, so it can't fully self-test
  from its own PR. Confirm: review posts inline + a verdict status; fixer opens
  `latch-cycle:1`, commits under the fixer identity, resolves fixed threads, leaves a
  disagreed thread open with reasoning, and re-dispatches; the re-review returns clean.
- **Site and console:** static (GitHub Pages), no build step. Serve them locally with
  `cd site && python3 -m http.server` and open `/console/`. The console has no backend
  by design — it talks to `api.github.com` from the browser, so testing it needs only a
  token, not an environment.

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
- **Never give the console a backend.** It is static, GitHub's Actions variables are
  the config store, and GitHub's permissions are the access control. A server of ours
  in that path duplicates the truth, adds a credential and an outage mode, and drifts
  into being the hosted product (phase 2) without the inference, metering, and billing
  that make the hosted product worth money. The device-flow proxy stays what it is:
  stateless, secretless, two endpoints, no repo data.
- **Never post a verdict status Latch has not earned.** While `LATCH_PAUSED=true`
  nothing is reviewed, so nothing is posted — a required check will block merges, and
  the fix is to un-require it, never to fake a passing `MERGE`.
- **Never invent metrics or citations.** The market stats in the corpus need real
  citations before they go in front of anyone who diligences; do not assert them as
  fact without a source.
