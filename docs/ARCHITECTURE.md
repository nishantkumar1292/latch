# Architecture

How the loop works mechanically. The v1 engine is two GitHub Actions workflows plus a
CLI and a policy file, generalized from a production deployment. Every tunable lives in
the target repo's Actions variables, which the workflows read at runtime; the static
[console](#the-console-phase-15) is the UI for them. The hosted app (phase 2) is
sketched at the end as future work.

## Identities

The loop uses **two distinct identities**, and that separation is load-bearing:

- **Reviewer (identity A).** Posts the review — inline findings and the verdict.
  Because it posts under a GitHub App identity, its review **fires a
  `pull_request_review` event**, which is what triggers the fixer. (In the source
  deployment this is `claude[bot]`; GraphQL drops the suffix to `claude`.)
- **Fixer (identity B).** Pushes fix commits and replies to threads, using the default
  `GITHUB_TOKEN`. A `GITHUB_TOKEN` push **triggers no workflow** (GitHub's recursion
  guard), so the fix does not re-run the loop on itself. (In the source deployment this
  is `github-actions[bot]`.)

Why two identities: nothing can self-approve (GitHub blocks any identity from approving
a PR it authored), and the loop stays **directional** — a review triggers a fix, a fix
never triggers a fix.

The fixer finds its work by asking which unresolved threads were *opened by the
reviewer*, so it has to be told who that is: the `LATCH_REVIEW_LOGIN` variable
(default `claude`) is that login. It exists because a non-claude reviewer does not post
as `claude[bot]`. Set it to the identity the review actually posts under, or the
fixer's thread queries match nothing and the loop looks broken while every job runs
green.

Under `LATCH_PROVIDER=codex` that is exactly what happens: codex has no GitHub App
identity, so by default its review is posted with `GITHUB_TOKEN` and appears as
`github-actions` — the same identity the fixer pushes under. The separation is then no
longer by login, so it is carried two other ways: the review→fix hop becomes an
**explicit dispatch** (a `GITHUB_TOKEN` review fires no `pull_request_review` event, by
the same recursion guard the fix push relies on), and the fixer's replies carry a hidden
`<!-- latch:fixer -->` marker so the loop can still tell its own answers from the
reviewer's findings — which is what the pending-thread check reads. Set
`LATCH_REVIEW_LOGIN=github-actions` when you switch.

If you would rather keep the separation by login on codex, set the optional
`LATCH_REVIEW_TOKEN` **secret**: the review then posts under that token's own identity,
its `pull_request_review` event fires naturally, and the dispatch job stands down
(a natural event *and* a dispatch would run the fixer twice on one review). Point
`LATCH_REVIEW_LOGIN` at that identity instead. Either way the two-identity separation
is what makes the loop directional — on codex's default path it is preserved by
mechanism rather than by login.

## The verdict

The reviewer ends with one summary verdict: **`MERGE` / `MERGE-WITH-FIXES` /
`DO-NOT-MERGE`**, published as a **non-blocking commit status by default**. A team can
mark that status required itself once it trusts the false-positive rate — Latch never
imposes a hard gate by default (a required check driven by a probabilistic agent is a
self-DoS; see [STRATEGY.md](./STRATEGY.md#the-three-corrections-adopted)).

Two variables govern the status: `LATCH_VERDICT_CONTEXT` names it (default
`latch/merge-gate`) and `LATCH_VERDICT_STATUS=off` computes the verdict but publishes
no status at all, leaving it in the run summary. `LATCH_PAUSED=true` has the same
visible effect for a different reason — every job no-ops, so nothing is reviewed and
nothing is posted. Neither mode ever posts a passing status Latch has not earned, which
is why a team that has marked the context *required* must un-require it before pausing.

## The sequence

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Human / author-agent
    participant GH as GitHub
    participant Rev as Reviewer (identity A)
    participant Fix as Fixer (identity B)

    Dev->>GH: open / ready_for_review PR
    GH->>Rev: trigger review workflow
    Rev->>Rev: merge with origin/master, run checks,<br/>apply doctrine (falsify the PR's claims)
    Rev->>GH: post inline findings + verdict status
    Note over Rev,GH: review posted under identity A →<br/>fires pull_request_review event
    GH->>Fix: pull_request_review event triggers fix workflow

    Fix->>Fix: any thread still PENDING? if not, exit green in seconds
    Fix->>Fix: read every unresolved review-bot thread
    Fix->>Fix: JUDGE each thread on its merits
    alt real defect in this PR
        Fix->>Fix: fix in code, run touched-path checks,<br/>plan a "fixed" reply
    else wrong / out-of-scope / belongs elsewhere
        Fix->>Fix: change nothing, plan a "kept" reply
    end
    Note over Fix: the agent posts NOTHING — it writes a<br/>reply plan and stops

    alt committed a real fix
        Fix->>GH: push fix with GITHUB_TOKEN (recursion guard: triggers nothing)
        Fix->>GH: re-fetch and VERIFY the commit is on the branch
        Fix->>GH: replay the plan — "Fixed in sha" + resolve;<br/>refusals posted and left OPEN for a human
        Fix->>GH: workflow_dispatch → re-dispatch the REVIEW (fix → review hop)
        GH->>Rev: re-review the PR head
    else no code change (all threads refused)
        Fix->>GH: replay the plan (refusals only), comment<br/>"no change — needs a human", pause the loop
    end

    Note over Rev,GH: clean re-review posts no findings →<br/>no event → loop ENDS, PR sits mergeable
    Dev->>GH: press Merge (the one human action)
```

## The engine is switchable — claude or codex

`LATCH_PROVIDER` picks which agent runs **both** halves: `claude` (the default,
`anthropics/claude-code-action@v1`) or `codex` (`openai/codex-action@v1`). Both legs
run for real on either provider. The shape differs, and it differs for one hard
reason: **the Codex action's sandbox has no network access**, and the action does not
let a workflow switch that on through its arguments.

- **Review.** Codex cannot post as a GitHub App, so the codex reviewer **holds no
  pen**: under an output schema it emits a structured JSON verdict plus findings and
  posts nothing — it writes its JSON to a file in the runner temp dir, which the CLI
  process (outside the sandbox) can reach. A following step derives the same two-line
  verdict file the publish step already read and posts one `COMMENT` review carrying
  the inline comments, so the verdict commit status is published exactly as before.
  Because a review posted with `GITHUB_TOKEN` fires no `pull_request_review` event, a
  separate small job explicitly dispatches the fixer — so every hop is still its own
  auditable Actions run, which is the property this loop is built on.
- **Fix.** With no network the agent cannot query the review threads itself, so the job
  **pre-fetches them into a file** the agent reads. The agent then judges each thread
  exactly as before, edits the tree, and emits its reply plan as structured output; the
  **job** commits, pushes, verifies ancestry, replays the replies and re-dispatches —
  the codex agent does not commit. Everything after the agent is provider-agnostic and
  unchanged.

**What codex costs, stated plainly.** No network means policy `checks:` commands that
need it (`npm ci`, `cargo fetch`, …) cannot run, so the codex fixer declares the fix
**unverified here** and the re-dispatched review plus the human merge are the backstop.
There is no salvage rail for a codex run — that rail reads `claude-code-action`'s own
execution log, which does not exist here. And `LATCH_MAX_TURNS` has no codex
equivalent: the codex CLI exposes no turn cap, so the variable does nothing under
`LATCH_PROVIDER=codex`.

## The guards, precisely

1. **Anti-tamper.** Before doing anything, the fixer checks the PR's changed files; if
   any match `^\.github/workflows/` or `^\.latch/` (anything under `.latch/`), it
   **skips** — a fixer that could edit the workflows or policy under review is exactly
   what must not be built.
2. **Cycle cap.** At most **3 fixer cycles per PR**, tracked with a `latch-cycle:N`
   label. A cycle is consumed only when a real fix lands. On the cap, the fixer
   @-mentions the author, explains what it could not settle, and stops — it will not
   run again until the `latch-cycle:*` labels are cleared.
3. **Actionable check.** The fixer runs only when there is at least one *unresolved*
   thread whose first comment is by the reviewer identity — so a review event that
   fires with nothing left to do is a no-op, not a wasted run.
4. **Termination.** A clean review posts no inline findings, so it submits no
   `COMMENTED` review, so no `pull_request_review` event fires and the fix workflow
   simply does not run again. **The loop ends on its own when the review is clean.**
5. **Checks before commit.** The fixer runs the touched-path check commands (e.g.
   `cargo fmt/clippy/test`, `npm lint/tsc/build`) and keeps a fix only if its checks
   pass — never leaving a red tree. Toolchains it doesn't have installed (mobile
   builds) are declared plainly in the thread reply, with the re-dispatched review and
   the human merge as the backstop. One exception, disclosed on the PR when it
   happens: the race-rebase path in item 8 pushes the *combined* tree without
   re-running the checks (they ran on the pre-race commit), because the check commands
   are policy data only the agent resolves — there, too, the re-dispatched review and
   the human merge are the backstop.
6. **Nothing the fixer says outlives what it pushed.** A resolved thread is the loop's
   only signal that a finding was *actioned*, and a "Fixed in `<sha>`" reply is a claim
   about the branch — so neither is the agent's to make. It writes a reply **plan** and
   posts nothing; the job pushes, verifies the commit is an ancestor of the remote
   branch, and only then replays the plan, minting the commit claim itself from the sha
   it pushed. If the push fails or cannot be verified, not one reply is posted. The
   guard covers refusal replies too — any body that dates its own claim to a commit is
   dropped, because minting a commit claim is the job's privilege. Behind that,
   unchanged, sits the repair rail: the job snapshots the open reviewer threads before
   the agent runs and afterwards re-opens any that are resolved without a fix landing
   on the branch — announced on the PR, never silently. See
   [OPERATIONS.md](./OPERATIONS.md#1-the-phantom-fix) for the failure this prevents.
7. **A finished run is never binned.** `claude-code-action` re-checks the agent's
   turn count *after* the run and fails the step when it exceeds `--max-turns` — even
   when the agent itself returned success (seen live: 88 turns against a cap of 80,
   discarding sixteen minutes of completed work and advising a human to raise the cap
   after the money was spent). The cap is a runtime budget handed to the agent, so
   when the post-hoc check disagrees the fixer reads the run's own execution log,
   pushes the finished work if it completed, and says so loudly on the PR. Any run
   whose log does *not* show a successful result still fails.
8. **A burst of review events costs one fixer at a time, and the rest cost nothing.**
   Concurrency is two levels, never one — a workflow-level group is claimed before any
   job condition is evaluated, so it could cancel a fixer mid-push. The **guard** carries
   the burst filter (cancel; it can only ever cancel another guard) and the **fix job**
   carries serialisation with `cancel-in-progress: false` — queue, never cancel. Queueing
   bounds the damage but not the bill, so the fix job's first step re-asks a narrower
   question before the checkout — is any thread still *pending*: unresolved, opened by
   the reviewer, and **not** already answered by a fixer's own push-back — and exits
   green in seconds when nothing is, before the checkout and before the agent. A human's
   reply after a push-back makes the thread pending again, which is the right edge for
   free. See [OPERATIONS.md §6](./OPERATIONS.md#6-a-burst-of-review-events-is-a-burst-of-fixers).
9. **Push races are recovered, not misdiagnosed.** The fixer works on a checkout that
   can go stale under it: a human, another agent, or a base merge can push to the PR
   branch mid-run, and its own push is then rejected non-fast-forward. The job rebases
   the fix onto the new tip and retries **once**. A rebase *conflict* means the
   competing push touched the same lines, which is a human's call — so it stops and
   says so, naming the competing commit rather than blaming the turn cap.

**Which of these survive a provider switch.** Seven of the nine are
provider-agnostic, because they live in the job and not in the agent: anti-tamper (1),
the cycle cap (2), the actionable check (3), termination (4), reply-after-push and its
repair rail (6), the two-level concurrency and pending-thread early exit (8), and
push-race recovery (9). Termination is the one worth a footnote: on codex there is no
`pull_request_review` event to withhold, so a clean review ends the loop through the
dispatch job and the fixer's own actionable check instead — a different mechanism for
an identical property. Two guards genuinely degrade under `LATCH_PROVIDER=codex`, and
neither degradation is silent:

- **Checks before commit (5)** weakens where the check commands need the network. The
  codex sandbox has none, so those commands cannot run; the fix is kept and its thread
  reply declares the verification level honestly as *unverified here*, with the
  re-dispatched review and the human merge as the backstop — the same posture already
  used for toolchains the runner does not have.
- **A finished run is never binned (7)** does not apply at all. The salvage rail reads
  `claude-code-action`'s own execution log to rescue work a post-hoc turn-count check
  would have discarded; there is no such log, and no such post-hoc check, on codex.

## The fixer's judgment (STEP 2)

The fixer does **not** blindly comply. For each unresolved reviewer thread it reads the
surrounding code and decides:

- **(a) a legitimate defect in this PR's code** → fix it, and plan a `fixed` reply: the
  job posts it as `Fixed in <sha>: …` and resolves the thread once that sha is on the
  branch;
- **(b) it disagrees after reading the code, or the action belongs on a different
  branch/PR** → change nothing, plan a `kept` reply carrying concrete reasoning, and
  **leave the thread open for a human**.

Both are *planned*, not posted — see guard 6. A `fixed` reply also states the
**verification level** behind it (checks passed / parse-only / no toolchain here),
because the runner installs no project toolchains and a reader who is not told will
assume the strongest reading.

The reviewer is skeptical and usually right, but not always. This standing-to-refuse is
what stops the loop thrashing on a wrong review comment, and — shown in a demo — it is
the single highest-credibility moment: a scripted fake never argues with itself.

## Why every hop is its own run

Because the fixer's `GITHUB_TOKEN` push triggers nothing, the fixer must **explicitly**
re-dispatch the review via `workflow_dispatch`. That means review, fix, and re-review
are each a **separate, auditable Actions run** with its own timestamp — no PAT, deploy
key, or app token is used to make a bot push "trigger naturally." The audit trail
(review under A → fix under B → re-review under A, three runs) is impossible to fake
with a video cut, which is a deliberate honesty property (see the launch runbook in the
private ops repo `github.com/nishantkumar1292/latch-ops`).

One subtlety carried from the source deployment: a re-dispatched review arrives as a
`workflow_dispatch` with no `pull_request` in its payload, so the workflow synthesizes a
real `pull_request` event payload for the target PR and points the action at it — so the
dispatched re-review resolves the PR exactly like a native one. Concurrency is scoped
per-PR **and per event type**, because the reviewer's own inline comments fire events
that must not cancel the reviewer mid-post.

## The console (phase 1.5)

The console at <https://latchgate.dev/console/> (source in `site/console/`) is a static
page — plain HTML/CSS/vanilla JS, no framework, no build step — served by the same
GitHub Pages deploy as the landing page. It configures the loop; it never runs it.

```
   browser (latchgate.dev/console/)
      │
      │  every call direct, with the viewer's own token
      ├──────────────────────────────▶ api.github.com
      │                                  · repos / contents / pulls  (the install PR)
      │                                  · actions/variables         (READ + WRITE)
      │                                  · actions/secrets           (names only)
      │                                  · actions/workflows + runs  (readiness)
      │
      └── device-flow login only ────▶ [CORS pass-through worker] ──▶ github.com
                                        (hosted/oauth-proxy/)          /login/device/*
                                        no secret, no state,
                                        never sees repo data

   Actions variables ARE the config store. The workflow templates read them at
   runtime → a change takes effect on the NEXT run: no commit, no redeploy.
```

**Why there is no backend.** The thing a config UI must own is durable state, and
GitHub already owns it: the target repo's Actions variables are the single source of
truth, the workflows read them per run, and GitHub's own permissions are the access
control. A server of ours in this path would add a second copy of the truth, a
credential to guard, and an outage mode — for nothing. So the page holds no state
beyond the viewer's token in that browser's `localStorage`, namespaced per
authenticated login.

**The device-flow proxy, precisely.** Sign-in uses the OAuth 2.0 device flow with a
public client id and **no client secret anywhere**. GitHub's two device-flow endpoints
do not serve CORS, so a browser cannot call them directly; `hosted/oauth-proxy/` is a
minimal stateless worker that relays **only those two endpoints** (see its
`DEPLOY.md`). It holds no secret and no state, and it never sees repo data — every
`api.github.com` call still goes direct from the browser. A fine-grained PAT is an
explicit, always-available way in, and until an owner registers the OAuth app and
deploys the worker it is the *only* way in: the sign-in button shows a "not configured"
state.

Because the console is entirely client-side, signing in is **authentication UX, not
server-side isolation**. There is no shared server state to isolate.

**What the console cannot do**, and says so rather than guessing:

- **Read secret values.** The GitHub API exposes secret *names* only. The readiness
  check can confirm `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`, or
  `OPENAI_API_KEY`) exists by name; whether the credential is valid or has capacity
  left is only knowable from a real run — which is why a run that fails in under two
  minutes is surfaced as a probable credential or usage-limit problem.
- **Verify the reviewer App installation** without a token carrying the right scope.
  That check is best-effort, and reports as unverified rather than as absent.
- **Prove branch protection.** Whether `latch/merge-gate` is a required check lives in
  rulesets the console does not read, so the pause-blocks-required-merges consequence
  is documented, not detected.

## Hosted app sketch (phase 2 — future)

```
GitHub PR event ─▶ [App webhook receiver] ─▶ [queue] ─▶ [sandbox runner pool] ─▶ GitHub
   (opened/sync/     verify HMAC sig,          (Redis/    ephemeral container:      (status +
    review submitted, dedupe by repo#pr,        SQS)       clone → review OR fix     inline
    requested_action) enqueue one job                      → post → re-dispatch      comments +
                                                           → destroy)                fix push)
                                                              │
                                                              ▼
                                                   [policy store]   [inference plane]
```

Design intents for the hosted app (none built yet):

- **Two identities** preserved: the App token posts reviews/statuses; fix commits push
  under a distinct identity (v1 cut: committer-login guard on one App; upgrade to a
  second "Latch Fixer" App when it bites).
- **Webhook → queue → ephemeral sandbox per job.** The runner is stateless and
  destroyed after each job — clone into tmpfs, never persist the working tree. This is
  what lets us own latency (warm pool), not consume the customer's Actions minutes, and
  meter our own inference bill. **No customer-code retention** — a sales requirement,
  cheap because the runner is already ephemeral; retain only metadata (verdicts, thread
  IDs, cycle counts, timings, redacted findings for the dashboard).
- **Hosted defaults follow the corrections:** non-blocking verdict, suggested changes a
  human applies; required-check and silent-push are per-repo opt-ins.
- **The escaped-bug / false-negative metric** is a core artifact from the first design
  partner, not an afterthought — independence you can't prove is theater.

Keep the runner **model-pluggable** so we are never single-supplier-locked and so
"bring your own model / Bedrock / Vertex" is a real enterprise option — and so the
**model-independence knob** (review with a model unlike the author-agent) is real.
