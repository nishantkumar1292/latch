<!-- Latch — the independent merge gate for the agent era. -->

# Latch

**The independent merge gate for the agent era.**

> Two AIs argue about your PR until it's mergeable. You click merge.

Coding agents now open pull requests faster than anyone can review them — a swarm
of Devins, Codex jobs, Copilot agents, and Cursor background agents can produce
50 PRs by 7am. Latch is a bounded review⇄fix loop that converges any pull request
— human- or agent-authored — to *mergeable*, and then **stops**. It never merges;
a human always does.

The reviewer is **independent of the author-agent**: separate context, an
adversarial doctrine, and a model-independence knob so you can review with a model
*unlike* the one that wrote the code. Latch is not a merge-confidence oracle and it
is not an auto-merger. It is independent adversarial **triage-and-autofix** for the
agent-PR firehose — it clears the mechanically-verifiable debris, ranks the rest by
risk, argues each finding to a conclusion, and hands you a PR that is ready for the
one human action the loop deliberately reserves: pressing merge.

- **License:** [FSL-1.1-Apache-2.0](./LICENSE.md) — free to self-host forever;
  converts to Apache-2.0 in two years.
- **Site:** <https://latchgate.dev>.
- **npm:** `latch-gate` (CLI binary: `latch`).
- **Docs:** [strategy](./docs/STRATEGY.md) · [product](./docs/PRODUCT.md) ·
  [architecture](./docs/ARCHITECTURE.md) · [operations](./docs/OPERATIONS.md) ·
  [pricing](./docs/PRICING.md) · [roadmap](./docs/ROADMAP.md)

---

## The loop

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                    │
   PR opened /      ▼                                                    │
   ready_for_review ┌───────────────┐   inline findings +               │
        ──────────▶ │   REVIEWER    │   verdict as a                    │
                    │ (identity A)  │   NON-BLOCKING commit status       │
                    └───────┬───────┘   MERGE / MERGE-WITH-FIXES /       │
                            │           DO-NOT-MERGE                     │
          posts a review →  │                                            │
          fires a          ▼                                            │
     pull_request_review  ┌───────────────┐                             │
     event ─────────────▶ │    FIXER      │  judges each thread:        │
                          │ (identity B)  │   • real defect → fix it    │
                          └───────┬───────┘   • wrong/out-of-scope →    │
                                  │             reply, refuse, leave    │
             pushes fix with      │             it OPEN for a human     │
             GITHUB_TOKEN         │                                     │
             (recursion guard:    │  explicit workflow_dispatch         │
              triggers nothing)   └──── re-dispatches the REVIEW ───────┘
                                             (the fix → review hop)

   Clean review → no findings → no event → loop ENDS, PR sits mergeable.
   Never converges within 3 cycles → @-mention the author → STOP.

   ── Latch never presses merge. A human does. ──
```

Every hop is a separate, auditable CI run. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
for the full sequence, identities, and guards.

---

## Why independence — told honestly

The agent that wrote the code is structurally the wrong one to clear it. A model
reviewing its own PR runs on the same weights, the same context, and the same blind
spots that produced the bug — its errors are **correlated with the code's errors**,
so it clears exactly the mistakes it was always going to make. A separate reviewer
with fresh context and an adversarial doctrine *decorrelates* that error.

Here is the honest version of what that buys you, in four sentences. Independence is
a real, measurable *probabilistic* lift, not a magic wall: a sufficiently different
prompt on the same model already decorrelates some errors, and pointing the reviewer
at a *different model family* than the author-agent decorrelates more. The true
middle-tile story is the proof: a generated math drill sorted its answer choices, so
the correct answer was always the middle tile, and a five-year-old learned to just
tap the middle every time until a parent reported it. Green CI could never see that —
it compiled, linted clean, and any test that checked "the answer is present in the
choices" passed. An adversarial reviewer told "a golden regenerated in the same commit
proves nothing, and answer position must be randomized" attacked it from outside the
author's frame and caught it — which is the whole wedge: **Latch catches the
green-CI-but-wrong class of bug**, and it is designed to measure its own catch
rate rather than ask you to take independence on faith (that measurement is on
the [roadmap](./docs/ROADMAP.md), not something v0 ships yet).

We do **not** sell "merge confidence." The loop never underwrites a merge — see the
[FAQ](#faq) for why that tension is resolved in your favor, not papered over.

---

## How the loop actually works

Seven mechanics carry the whole design. None is optional; each exists because a
one-shot autofix handoff fails without it.

1. **Two identities, one direction.** The reviewer posts under identity A; the fixer
   pushes under identity B. Because they are distinct, nothing self-approves and
   GitHub's recursion guard keeps the loop *directional* — a review triggers a fix,
   a fix never triggers a fix.
2. **Recursion guard, exploited on purpose.** The fixer pushes with the default
   `GITHUB_TOKEN`, and a `GITHUB_TOKEN` push triggers **no** workflow. That is what
   stops the loop from re-running itself on its own commit.
3. **Explicit dispatch hops.** Because the fix push triggers nothing, the fixer
   *explicitly* re-dispatches the review via `workflow_dispatch`. Every hop —
   review, fix, re-review — is its own auditable Actions run with its own timestamp.
   No PAT, deploy key, or app token is used to make a bot push "trigger naturally."
4. **Anti-tamper.** The fixer skips any PR that touches `.github/workflows/` or
   anything under `.latch/`. A loop that could edit the rules that govern it is
   exactly what we refuse to build.
5. **Cycle cap with human escalation.** At most 3 fixer cycles per PR (tracked with a
   `latch-cycle:N` label). On the cap, Latch @-mentions the author, explains what it
   could not settle, and stops.
6. **Reply after push, never before.** The fixer holds no pen of its own: it writes a
   reply *plan* and posts nothing. The job pushes, verifies the commit is really on
   the branch, and only then posts the replies — minting the "Fixed in `<sha>`" claim
   itself. So a thread can never read as fixed while the fix exists only on a runner
   that has already died.
7. **It never merges.** A clean review posts no findings, so no event fires and the
   loop simply ends with the PR sitting mergeable. The convergence is the product;
   the merge is a human's.

Running it in anger — the failure modes, and the protocol for deciding when a PR is
converged — is [docs/OPERATIONS.md](./docs/OPERATIONS.md).

The fixer does not blindly comply. It **judges each thread on its merits** — fixing
real defects, and *refusing* a finding it disagrees with (or that belongs on a
different branch), replying with concrete reasoning and leaving the thread open for a
human. That standing-to-refuse is what stops the loop thrashing on a wrong review
comment.

---

## Quickstart (human)

Latch runs entirely inside **your** GitHub Actions, on **your** Claude key. Nothing
about your code ever reaches us.

```bash
# 1. Scaffold the two workflows + a starter .latch/policy.yml into your repo.
#    Works before the npm package is published (installs straight from GitHub):
npx github:nishantkumar1292/latch init
#    (after npm publish, `npx latch-gate init` works too)
```

Then, once (per repo):

2. **Install the Claude GitHub App** on the repo, so the reviewer posts under an app
   identity whose review *fires the `pull_request_review` event* that drives the
   fix hop. (This identity separation is load-bearing — see mechanic #1 above.)
3. **Generate a Claude token** — `claude setup-token` — using your own Claude
   subscription or API key. You bring the key; Latch brings the loop.
4. **Add the token as a repository secret** named `CLAUDE_CODE_OAUTH_TOKEN`.

Open a PR. The reviewer runs, posts inline findings and a verdict status, the fixer
converges the actionable threads, and when the review comes back clean the PR sits
ready for you to merge.

Full step-by-step, including the app-hash and secret details, lives in
[docs/PRODUCT.md](./docs/PRODUCT.md).

## Quickstart (agent)

If a coding agent is setting Latch up, hand it this and point it at the machine-readable
guide:

> Install Latch (the independent merge gate) into this repo. Read
> `INSTALL_FOR_AGENTS.md` at the repo root of `github:nishantkumar1292/latch` and
> follow it exactly: run `npx github:nishantkumar1292/latch init`, then wire the
> `CLAUDE_CODE_OAUTH_TOKEN` secret and confirm the reviewer identity fires
> `pull_request_review`. Do not weaken the never-merges posture or the anti-tamper
> guard. Report the PR where the loop first ran green.

See [`INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md) for the full copy-paste
protocol.

---

## Configuration

Latch is configured with repository **variables** plus a per-repo policy file.

**Secrets** — the credential the agent runs on, picked by `LATCH_PROVIDER`:

| Name | What it controls |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` (secret) | Your Claude subscription token — or `ANTHROPIC_API_KEY` for metered API auth. Set exactly one. Required for `LATCH_PROVIDER=claude` (the default). |
| `OPENAI_API_KEY` (secret) | Required instead when `LATCH_PROVIDER=codex`. |

**Repository variables** — repo → Settings → Secrets and variables → Actions →
Variables. These are *not* workflow edits: the scaffolded
[`workflows/latch-review.yml`](./workflows/latch-review.yml) and
[`workflows/latch-fix.yml`](./workflows/latch-fix.yml) read them at runtime, so a
change takes effect on the **next run**, with no commit and no PR. The
[console](#console) sets them for you; `gh variable set NAME` does the same thing
from a terminal.

| Variable | Default when unset | What it controls |
|---|---|---|
| `LATCH_PAUSED` | not paused | The kill switch. Set it to `true` and every job in both workflows no-ops immediately. Read the consequence below before using it. |
| `LATCH_PROVIDER` | `claude` | Which agent engine runs both halves: `claude` or `codex`. Any other value fails the run at config time. |
| `LATCH_MODEL` | claude: `claude-opus-4-8`; codex: the provider's own default | The reviewer's model, and the fixer's unless `LATCH_FIX_MODEL` is set. Independence knob — set a model *unlike* your author-agent. |
| `LATCH_FIX_MODEL` | falls back to `LATCH_MODEL` | The fixer's model, when it should differ from the reviewer's. |
| `LATCH_REVIEW_EFFORT` | claude `xhigh`, codex `high` | The reviewer's reasoning effort — the doctrine pass is the differentiator. |
| `LATCH_EFFORT` | `high` | The fixer's reasoning effort. |
| `LATCH_MAX_TURNS` | `80` | Agent turn budget per run. **Claude engine only** — the codex CLI exposes no turn cap. |
| `LATCH_TIMEOUT_MINUTES` | fixer job `25`; review job `360` | The job wall clock. `360` is GitHub's own job default, so leaving this unset leaves the review exactly as uncapped as it already was. Raise it together with `LATCH_MAX_TURNS` — more turns need more minutes, or the job is cancelled mid-run instead of finishing. |
| `LATCH_MAX_FIX_CYCLES` | `3` | Max fixer cycles per PR before human escalation. |
| `LATCH_VERDICT_STATUS` | on | Set to `off` to compute the verdict but publish no commit status. The verdict still goes to the run summary, so it is not lost. |
| `LATCH_VERDICT_CONTEXT` | `latch/merge-gate` | The commit-status context name. Change it and branch protection must be updated to match, or a required check waits on a status nobody posts. |
| `LATCH_REVIEW_LOGIN` | `claude` | The reviewer identity whose threads the fixer answers. It must match whoever actually posts the review — `claude` for provider `claude`, `github-actions` when a codex review posts under `GITHUB_TOKEN`. |
| `LATCH_DOCTRINE` | built-in doctrine only | Also load `.latch/doctrines/<name>.md` on top of the built-in doctrine. |

Every variable is optional: **a fresh install with none of them set runs on the
defaults**, which is the supported path. When you do set one, Latch validates it
before use — these values land inside the agent's own command line, so the
numbers must be JSON-numeric (garbage fails the run at config time; `0` and
negatives fall back to the default) and the free-text ones must be a single
`[A-Za-z0-9._-]` token that does not start with `-`. A value like
`claude-opus-4-8 --dangerously-skip-permissions` is refused loudly rather than
quietly splicing a second flag into the agent's arguments.
(`LATCH_VERDICT_CONTEXT` is the one exception that also allows `/`, and it is
safe because it is never an argument — it is passed as a quoted API field.)

**Pausing is honest, and honesty has a consequence.** While `LATCH_PAUSED=true`,
Latch publishes **no** verdict commit status — not a passing one, not a neutral
one, none. So if your team has marked `latch/merge-gate` a *required* check,
pausing Latch blocks every merge until you un-require it. Un-require first, then
pause. Latch deliberately does not post a `MERGE` status having reviewed nothing;
a gate that lies is the thing this project exists not to build.

**Switching the engine to codex** costs something, and the cost is stated plainly
rather than buried: the Codex action's sandbox has **no network access**, so the
codex reviewer holds no pen (it emits a structured verdict and a following job
step posts the review under `GITHUB_TOKEN`, plus an explicit job to dispatch the
fixer), policy `checks:` commands that need the network (`npm ci`, `cargo
fetch`, …) cannot run in the codex fixer — which then declares the fix
"unverified here" and leans on the re-dispatched review and the human merge —
and there is no salvage rail for a codex run. Both halves of the loop do run for
real; every guard after the agent is unchanged. Details in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#the-engine-is-switchable--claude-or-codex).

**`.latch/policy.yml`** — your review doctrine and repo landmines as versioned,
per-repo policy: the falsify-the-claims doctrine, the landmine list (e.g. "answer
position must be randomized," migration-prefix collisions, `include_str!` needs a
matching `COPY`), the touched-path check commands, the cycle cap, and the merge
posture. A starter policy ships at
[`policy/examples/policy.yml`](./policy/examples/policy.yml); the review doctrine
itself lives in [`doctrines/skeptical-senior-engineer.md`](./doctrines/skeptical-senior-engineer.md).
Latch can also mine an existing `CLAUDE.md` / `AGENTS.md` for landmines.

---

## Console

<https://latchgate.dev/console/> is a **static** page for setting all of the above
without opening a PR against your workflow files. It does four things:

1. **Connect a repo.**
2. **Produce the integration change** — it opens the `latch/install` PR for you
   through the GitHub API, or hands you copyable instructions to give your own
   coding agent.
3. **Check readiness** — the browser-side sibling of `latch doctor`: are both
   workflows present and active, is `.latch/policy.yml` there, is the right
   credential secret present *by name*, is the reviewer GitHub App installed
   (best effort), are the `LATCH_*` variables present and valid, and is recent
   run health sane — a run that fails in under two minutes is flagged as a
   probable credential or usage-limit problem rather than a code problem.
4. **Read and write the `LATCH_*` variables** in a grouped form — Reviewer,
   Fixer, Loop guards, Kill switch — each value shown against its default.

<!-- Screenshot placeholder: the console's readiness check + config panel. Not committed; attach it to the PR or host it, don't add a binary to the repo. -->

**GitHub is the backend.** There is no Latch server and no backend of ours in
this picture: the page calls `api.github.com` directly from your browser, and the
source of truth for every tunable is your own repo's Actions variables — which
is exactly why a change lands on the next run with no commit and no redeploy.
Your token lives only in that browser's `localStorage`, namespaced per
authenticated login, and we never see it or your code.

Sign in with **"Sign in with GitHub"** — the OAuth 2.0 device flow, a public
client id with no client secret anywhere — or with a **fine-grained PAT**, which
is always available as an explicit fallback. Because GitHub's two device-flow
endpoints do not serve CORS, the repo ships a minimal stateless pass-through
worker at `hosted/oauth-proxy/` that relays only those two endpoints; it holds no
secret and no state and never sees repo data, and every `api.github.com` call
still goes direct from the browser. Until an owner registers the OAuth app and
deploys that worker, the sign-in button shows a "not configured" state and the
PAT path is the way in.

One honesty note about that sign-in: because the console is entirely
client-side, signing in is **authentication UX, not server-side isolation**.
There is no shared server state to isolate — GitHub's own permissions are the
access control.

To run it locally:

```bash
cd site && python3 -m http.server 8000
# then open http://localhost:8000/console/
```

---

## The verdict status — non-blocking by default

Latch ships the verdict (`MERGE` / `MERGE-WITH-FIXES` / `DO-NOT-MERGE`) as a
**non-blocking commit status by default.** This is deliberate: a *required* check
controlled by a probabilistic agent is a self-DoS — the first false `DO-NOT-MERGE`
on a correct, urgent PR blocks the team from shipping, and the check gets ripped out
that afternoon. Non-blocking means Latch informs and triages without ever standing
between you and a merge you've decided is right.

When a team has watched Latch on its own repos and trusts its false-positive rate,
**it can mark the status required itself** — in a branch ruleset / required-status-check
setting — and turn Latch into a hard gate on its own terms. That is a decision you
earn into, not a default we impose.

---

## Security posture

Latch is designed so that the worst a poisoned PR can achieve is a wrong *comment* —
never an unsafe *merge*.

- **It runs entirely in your Actions, on your key.** In the OSS self-hosted mode
  there is no Latch server in the loop: the reviewer and fixer run in your CI, on
  your own credential (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`, or
  `OPENAI_API_KEY` on the codex provider). **We never see your code.** The
  [console](#console) adds no server either — it is a static page that calls
  `api.github.com` from your browser with your own token.
- **Prompt-injection hardening.** The reviewer treats PR text as *claims to falsify*,
  not instructions to obey. Malicious PR content cannot steer the verdict into
  approving itself.
- **What the fixer may never touch.** The anti-tamper guard skips any PR that
  modifies `.github/workflows/` or anything under `.latch/`, so the loop can never
  rewrite the rules that govern it.
- **Directional identity separation.** Nothing self-approves; a fix push (under
  `GITHUB_TOKEN`) triggers no workflow, so the automation cannot self-trigger or
  loop unboundedly.
- **Bounded, then human.** The 3-cycle cap plus author escalation caps blast radius,
  and the loop **never merges** — a human always performs the merge.

Full threat model and reporting process: [SECURITY.md](./SECURITY.md).

---

## Pricing / hosted

- **OSS, self-hosted — free forever.** The complete loop under FSL, run in your own
  Actions on your own Claude key. Everything that matters — the directional
  identity-separated loop, the anti-tamper guard, the cycle cap and escalation, the
  fixer that can push back, the doctrine library — is here and free.
- **Hosted gate (waitlist — not built yet).** A zero-config GitHub App where we run the
  reviewer and fixer on our inference and billing, so you never manage a token or a
  workflow file: **$49 / active repo / mo incl. 25 gated PRs, then $8 / gated PR**,
  with a BYOK discount for teams that bring their own key.
- **Enterprise — talk to us.** SSO, org-wide policy governance, per-hop audit export,
  self-hosted license.

Full rationale in [docs/PRICING.md](./docs/PRICING.md). Join the hosted waitlist at
<https://latchgate.dev>.

---

## FAQ

**Is this just circular AI — AI reviewing AI, then AI fixing it?**
Partly, and here is the honest line. Fresh context plus an adversarial doctrine is a
real decorrelation of error, not theater — a reviewer that never saw the author's
rationalization chain catches things a self-review inherits and misses. But if the
reviewer is the *same model family* as the author-agent, the decorrelation is
context-and-doctrine only, which is weaker than "independent" sounds. So Latch ships
a **model-independence knob**: point the reviewer at a model *unlike* your
author-agent, and we recommend the mismatch. And rather than ask you to trust the
verdict, Latch is **designed to measure its own escaped-bug / false-negative rate** —
a catch rate with a denominator, not a survivorship reel of catches (a core artifact
planned for the hosted dashboard; see the [roadmap](./docs/ROADMAP.md), not shipped
in v0).

**What does a gated PR cost in inference?**
Ballpark, on your own key: a clean PR is a single pass (roughly `$0.30–$0.60` with
caching and a triage-tier model); a typical dirty PR that runs the full loop is
`~$1.50–$3`; a heavy PR (large diff, several cycles, top model throughout) can reach
`$8–$15`. The three levers that keep it sane — prompt-cache the repo+doctrine prefix
across hops, tier models (doctrine pass on the strong model, triage/fix/delta
re-reviews on a cheaper one), and the fact that the loop only fires when there are
findings — are covered in [docs/PRICING.md](./docs/PRICING.md).

**What happens at the cycle cap?**
After 3 fixer cycles without convergence, Latch stops, @-mentions the PR author, and
explains which threads it could not settle within the cap. It will not run again on
that PR until the `latch-cycle:*` labels are cleared. It never merges and never
force-converges — an unconverged PR is a human's decision.

**Does Latch merge my PRs?**
No — never, in any tier. Converge-then-a-human-merges is the trust posture *and* the
security boundary. You can wire the verdict into GitHub's native auto-merge yourself
if you want that, but it is off by default and not something Latch does.

---

## License

Latch is licensed under **[FSL-1.1-Apache-2.0](./LICENSE.md)** (Sentry's Functional
Source License). In plain terms: **free to self-host forever**, every feature open
and readable; the *only* thing forbidden is reselling Latch as a competing hosted
product. Two years after each release, that release **converts to Apache-2.0**. No
CLA gymnastics, no per-feature paywall in the source — the license text does the
work.

## Contributing

The highest-value contribution is a **doctrine / landmine pack** — the accumulating,
per-repo-tunable library of falsification tactics and bug patterns is the moat the
model itself does not have. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[doctrine library](./doctrines/skeptical-senior-engineer.md).
